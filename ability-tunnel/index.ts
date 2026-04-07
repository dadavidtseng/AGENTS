/**
 * ability-tunnel — Unified Tunnel Provider
 *
 * Exposes local services to the internet via multiple backends:
 *   - kadi-tunnel (self-hosted frp + Caddy)
 *   - SSH reverse tunnels
 *   - frpc (frp client)
 *   - ngrok, serveo, localtunnel, pinggy, localhost.run (third-party)
 *
 * Auto mode tries kadi-tunnel first, then falls back through public providers.
 */

import { spawn, execSync, ChildProcess } from 'child_process';
import fs from 'fs';
import { KadiClient, z } from '@kadi.build/core';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_PORT = parseInt(process.env.TUNNEL_DEFAULT_PORT || '3000', 10);
const DEFAULT_MODE = process.env.TUNNEL_DEFAULT_MODE || 'auto';
const TUNNEL_TIMEOUT_MS = parseInt(process.env.TUNNEL_TIMEOUT_MS || '0', 10);
const MAX_CONCURRENT = parseInt(process.env.TUNNEL_MAX_CONCURRENT || '10', 10);

// kadi-tunnel (KĀDI cloud infrastructure)
const KADI_TUNNEL_SERVER = process.env.KADI_TUNNEL_SERVER || 'broker.kadi.build';
const KADI_TUNNEL_DOMAIN = process.env.KADI_TUNNEL_DOMAIN || 'tunnel.kadi.build';
const KADI_TUNNEL_TOKEN = process.env.KADI_TUNNEL_TOKEN || '';
const KADI_TUNNEL_SSH_PORT = process.env.KADI_TUNNEL_SSH_PORT || '2200';
const KADI_TUNNEL_SSH_USER = process.env.KADI_TUNNEL_SSH_USER || 'v0';
const KADI_TUNNEL_FRPC_PORT = process.env.KADI_TUNNEL_FRPC_PORT || '7000';
const KADI_TUNNEL_TRANSPORT = process.env.KADI_TUNNEL_TRANSPORT || 'wss';
const KADI_TUNNEL_WSS_HOST = process.env.KADI_TUNNEL_WSS_HOST || 'tunnel-control.kadi.build';

// Optional: local control API (for self-hosted kadi-tunnel)
const CONTROL_API_URL = process.env.KADI_TUNNEL_CONTROL_API_URL || '';
const KADI_AGENT_ID = process.env.KADI_TUNNEL_AGENT_ID || 'default-agent';
const REQUEST_TIMEOUT = parseInt(process.env.KADI_TUNNEL_REQUEST_TIMEOUT_MS || '30000', 10);

// Public provider tokens
const NGROK_AUTH_TOKEN = process.env.NGROK_AUTH_TOKEN || '';
const PINGGY_TOKEN = process.env.PINGGY_TOKEN || '';

// SSH config
const SSH_HOST = process.env.SSH_TUNNEL_HOST || '';
const SSH_PORT = process.env.SSH_TUNNEL_PORT || '22';
const SSH_USER = process.env.SSH_TUNNEL_USER || 'tunnel';
const SSH_KEY_PATH = process.env.SSH_TUNNEL_KEY_PATH || '';

// frpc config
const FRPC_SERVER_ADDR = process.env.FRPC_SERVER_ADDR || '';
const FRPC_SERVER_PORT = process.env.FRPC_SERVER_PORT || '7000';
const FRPC_TOKEN = process.env.FRPC_TOKEN || '';

// Reconnection
const AUTO_RECONNECT = process.env.TUNNEL_AUTO_RECONNECT !== 'false';
const MAX_RECONNECT = parseInt(process.env.TUNNEL_MAX_RECONNECT_ATTEMPTS || '10', 10);
const RECONNECT_DELAY = parseInt(process.env.TUNNEL_RECONNECT_DELAY_MS || '1000', 10);

// ============================================================================
// KadiClient
// ============================================================================

const brokerConfig: Record<string, unknown> = {
  url: process.env.KADI_BROKER_URL || 'ws://localhost:8080/kadi',
};
if (process.env.KADI_NETWORK) {
  brokerConfig.networks = process.env.KADI_NETWORK.split(',').map(n => n.trim());
}

const client = new KadiClient({
  name: 'ability-tunnel',
  brokers: { default: brokerConfig as any },
});

// ============================================================================
// kadi-tunnel Control API helper
// ============================================================================

async function controlApi<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${CONTROL_API_URL}${path}`;
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Agent-Id': KADI_AGENT_ID },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data: any = await res.json();
  if (!res.ok) throw new Error(`Control API ${res.status}: ${data.error?.message || res.statusText}`);
  return data as T;
}

interface KadiTunnelResponse {
  id: string; agentId: string; localPort: number; subdomain: string;
  hostname: string; security: string; status: string; expiresAt: string;
}
interface KadiListResponse { tunnels: KadiTunnelResponse[]; }
interface KadiHealthResponse { status: string; timestamp: string; version?: string; uptime?: number; }

// ============================================================================
// Unified Tunnel State
// ============================================================================

type TunnelMode = 'kadi' | 'ssh' | 'frpc' | 'ngrok' | 'serveo' | 'localtunnel' | 'pinggy' | 'localhost_run';

interface TunnelInfo {
  id: string;
  mode: TunnelMode;
  localPort: number;
  publicUrl: string;
  status: 'active' | 'connecting' | 'closed' | 'error';
  createdAt: string;
  process?: ChildProcess;
  subdomain?: string;
  remoteHost?: string;
  remotePort?: number;
  proxyName?: string;
  serverAddr?: string;
  expiresAt?: string;
  timeoutId?: ReturnType<typeof setTimeout>;
}

const tunnels = new Map<string, TunnelInfo>();
let idCounter = 0;

function nextId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}`;
}

function destroyTunnel(id: string): boolean {
  const t = tunnels.get(id);
  if (!t) return false;
  if (t.process && !t.process.killed) t.process.kill();
  if (t.timeoutId) clearTimeout(t.timeoutId);
  t.status = 'closed';
  tunnels.delete(id);
  return true;
}

function destroyAll() {
  for (const id of [...tunnels.keys()]) destroyTunnel(id);
}

// ============================================================================
// Provider: process-based tunnel spawner (public providers)
// ============================================================================

function spawnTunnel(
  cmd: string, args: string[], urlPattern: RegExp, timeoutMs = 30000,
): Promise<{ process: ChildProcess; publicUrl: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) { resolved = true; proc.kill(); reject(new Error(`Timed out after ${timeoutMs}ms`)); }
    }, timeoutMs);

    function check(data: Buffer) {
      const m = data.toString().match(urlPattern);
      if (m && !resolved) { resolved = true; clearTimeout(timer); resolve({ process: proc, publicUrl: m[1] || m[0] }); }
    }
    proc.stdout?.on('data', check);
    proc.stderr?.on('data', check);
    proc.on('error', (err) => { if (!resolved) { resolved = true; clearTimeout(timer); reject(new Error(`spawn ${cmd}: ${err.message}`)); } });
    proc.on('exit', (code) => { if (!resolved) { resolved = true; clearTimeout(timer); reject(new Error(`${cmd} exited ${code}`)); } });
  });
}

async function createNgrok(port: number, sub?: string) {
  const args = ['http', String(port)];
  if (NGROK_AUTH_TOKEN) args.push('--authtoken', NGROK_AUTH_TOKEN);
  if (sub) args.push('--subdomain', sub);
  args.push('--log', 'stdout', '--log-format', 'term');
  return spawnTunnel('ngrok', args, /url=(https?:\/\/[^\s]+)/);
}

async function createServeo(port: number, sub?: string) {
  const spec = sub ? `${sub}:80:localhost:${port}` : `0:localhost:${port}`;
  return spawnTunnel('ssh', ['-R', spec, '-o', 'StrictHostKeyChecking=no', 'serveo.net'], /(https?:\/\/[^\s]*serveo\.net[^\s]*)/);
}

async function createLocaltunnel(port: number, sub?: string) {
  const args = ['--port', String(port)];
  if (sub) args.push('--subdomain', sub);
  return spawnTunnel('npx', ['localtunnel', ...args], /(https?:\/\/[^\s]*loca\.lt[^\s]*|your url is: (https?:\/\/[^\s]+))/i);
}

async function createPinggy(port: number) {
  return spawnTunnel('ssh', ['-p', '443', `-R0:localhost:${port}`, '-o', 'StrictHostKeyChecking=no', 'a.pinggy.io'], /(https?:\/\/[^\s]*pinggy[^\s]*)/);
}

async function createLocalhostRun(port: number) {
  return spawnTunnel('ssh', ['-R', `80:localhost:${port}`, '-o', 'StrictHostKeyChecking=no', 'nokey@localhost.run'], /(https?:\/\/[^\s]*localhost\.run[^\s]*)/);
}

// ============================================================================
// Provider: kadi-tunnel (KĀDI cloud — frpc or SSH gateway)
// ============================================================================

function findFrpc(): string | null {
  const paths = ['frpc', '/usr/local/bin/frpc', '/usr/bin/frpc'];
  for (const p of paths) {
    try { execSync(`${p} --version`, { stdio: 'pipe' }); return p; } catch { /* try next */ }
  }
  return null;
}

function hasFrpc(): boolean {
  return findFrpc() !== null;
}

function generateKadiSubdomain(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

async function createKadiViaFrpc(port: number, sub: string): Promise<TunnelInfo> {
  const proxyName = `kadi_${sub}`;
  const configPath = `/tmp/frpc_kadi_${sub}.toml`;
  let config = `serverAddr = "${KADI_TUNNEL_SERVER}"\n`;
  if (KADI_TUNNEL_TRANSPORT === 'wss') {
    config += `serverPort = 443\ntransport.protocol = "wss"\ntransport.tls.serverName = "${KADI_TUNNEL_WSS_HOST}"\n`;
  } else {
    config += `serverPort = ${KADI_TUNNEL_FRPC_PORT}\n`;
  }
  config += `auth.method = "token"\nauth.token = "${KADI_TUNNEL_TOKEN}"\n`;
  config += `transport.heartbeatInterval = 30\ntransport.heartbeatTimeout = 90\n\n`;
  config += `[[proxies]]\nname = "${proxyName}"\ntype = "http"\n`;
  config += `localIP = "127.0.0.1"\nlocalPort = ${port}\nsubdomain = "${sub}"\n`;
  fs.writeFileSync(configPath, config, 'utf-8');

  const frpcPath = findFrpc()!;
  const proc = spawn(frpcPath, ['-c', configPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  const id = nextId('kadi');
  const publicUrl = `https://${sub}.${KADI_TUNNEL_DOMAIN}`;
  const tunnel: TunnelInfo = {
    id, mode: 'kadi', localPort: port, publicUrl,
    status: 'connecting', createdAt: new Date().toISOString(),
    process: proc, subdomain: sub, proxyName, serverAddr: KADI_TUNNEL_SERVER,
  };

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { if (tunnel.status === 'connecting') tunnel.status = 'error'; resolve(); }, 8000);
    proc.on('error', (err) => { fs.appendFileSync('/tmp/ability-tunnel.log', `[frpc] spawn error: ${err.message}\n`); tunnel.status = 'error'; clearTimeout(timer); resolve(); });
    proc.stdout?.on('data', (d: Buffer) => {
      const s = d.toString(); fs.appendFileSync('/tmp/ability-tunnel.log', `[frpc] stdout: ${s.trim()}\n`);
      if (s.includes('start proxy success')) { tunnel.status = 'active'; clearTimeout(timer); resolve(); }
    });
    proc.stderr?.on('data', (d: Buffer) => {
      const s = d.toString(); fs.appendFileSync('/tmp/ability-tunnel.log', `[frpc] stderr: ${s.trim()}\n`);
      if (s.includes('start proxy success')) { tunnel.status = 'active'; clearTimeout(timer); resolve(); }
    });
    proc.on('exit', (code) => { fs.appendFileSync('/tmp/ability-tunnel.log', `[frpc] exited with code ${code}\n`); if (tunnel.status === 'connecting') tunnel.status = 'error'; clearTimeout(timer); resolve(); });
  });

  if (tunnel.status === 'error') { proc.kill(); throw new Error('kadi frpc connection failed — frpc did not report success within 8s'); }

  // Monitor process exit after creation — update status if frpc dies unexpectedly
  proc.on('exit', (code) => {
    if (tunnel.status === 'active') {
      tunnel.status = 'error';
      console.error(`[ability-tunnel] frpc process exited unexpectedly (code=${code}) for tunnel ${tunnel.id}`);
    }
  });
  return tunnel;
}

async function createKadiViaSsh(port: number, sub: string): Promise<TunnelInfo> {
  const args = [
    '-R', `:80:localhost:${port}`,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=30',
    '-p', KADI_TUNNEL_SSH_PORT,
    `${KADI_TUNNEL_SSH_USER}@${KADI_TUNNEL_SERVER}`,
    'http', '--sd', sub, '--token', KADI_TUNNEL_TOKEN, '--proxy_name', `kadi_${sub}`,
  ];

  const proc = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const id = nextId('kadi');
  const publicUrl = `https://${sub}.${KADI_TUNNEL_DOMAIN}`;
  const tunnel: TunnelInfo = {
    id, mode: 'kadi', localPort: port, publicUrl,
    status: 'connecting', createdAt: new Date().toISOString(),
    process: proc, subdomain: sub, serverAddr: KADI_TUNNEL_SERVER,
  };

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { if (tunnel.status === 'connecting') tunnel.status = 'error'; resolve(); }, 8000);
    proc.on('error', () => { tunnel.status = 'error'; clearTimeout(timer); resolve(); });
    proc.stderr?.on('data', (d: Buffer) => {
      const s = d.toString();
      if (s.includes('start proxy success') || s.includes(sub)) { tunnel.status = 'active'; clearTimeout(timer); resolve(); }
    });
    proc.on('exit', () => { if (tunnel.status === 'connecting') tunnel.status = 'error'; clearTimeout(timer); resolve(); });
  });

  if (tunnel.status === 'error') { proc.kill(); throw new Error('kadi SSH gateway connection failed — did not connect within 8s'); }

  // Monitor process exit after creation
  proc.on('exit', (code) => {
    if (tunnel.status === 'active') {
      tunnel.status = 'error';
      console.error(`[ability-tunnel] SSH tunnel process exited unexpectedly (code=${code}) for tunnel ${tunnel.id}`);
    }
  });
  return tunnel;
}

async function createKadi(port: number, subdomain?: string): Promise<TunnelInfo> {
  fs.appendFileSync('/tmp/ability-tunnel.log', `[kadi] createKadi called: port=${port}, token=${KADI_TUNNEL_TOKEN ? 'set' : 'NOT SET'}, hasFrpc=${hasFrpc()}\n`);
  if (!KADI_TUNNEL_TOKEN) throw new Error('KADI_TUNNEL_TOKEN is required for kadi mode. Set it in .env.');
  const sub = subdomain || generateKadiSubdomain();
  // Try frpc first (better performance), fall back to SSH gateway
  if (hasFrpc()) {
    try { return await createKadiViaFrpc(port, sub); } catch (e) {
      fs.appendFileSync('/tmp/ability-tunnel.log', `[kadi] frpc failed: ${e instanceof Error ? e.message : e}, falling back to SSH\n`);
    }
  }
  return createKadiViaSsh(port, sub);
}

// ============================================================================
// Provider: SSH reverse tunnel
// ============================================================================

async function createSsh(port: number, opts: {
  remote_port?: number; remote_host?: string; ssh_port?: string; ssh_user?: string; ssh_key?: string;
}): Promise<TunnelInfo> {
  const host = opts.remote_host || SSH_HOST;
  if (!host) throw new Error('No SSH host. Set SSH_TUNNEL_HOST or pass remote_host.');
  const rPort = opts.remote_port || 0;
  const args = [
    '-N', '-T', '-o', 'StrictHostKeyChecking=no', '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3', '-o', 'ExitOnForwardFailure=yes',
    '-p', opts.ssh_port || SSH_PORT, '-R', `${rPort}:localhost:${port}`,
  ];
  const keyPath = opts.ssh_key || SSH_KEY_PATH;
  if (keyPath) args.push('-i', keyPath);
  args.push(`${opts.ssh_user || SSH_USER}@${host}`);

  const proc = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const id = nextId('ssh');
  const tunnel: TunnelInfo = {
    id, mode: 'ssh', localPort: port, publicUrl: `ssh://${host}:${rPort}`,
    status: 'connecting', createdAt: new Date().toISOString(),
    process: proc, remoteHost: host, remotePort: rPort,
  };

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { if (tunnel.status === 'connecting') tunnel.status = 'active'; resolve(); }, 3000);
    proc.on('error', () => { tunnel.status = 'error'; clearTimeout(timer); resolve(); });
    proc.stderr?.once('data', (data: Buffer) => {
      const m = data.toString().match(/Allocated port (\d+)/);
      if (m) { tunnel.remotePort = parseInt(m[1], 10); tunnel.publicUrl = `ssh://${host}:${tunnel.remotePort}`; }
      tunnel.status = 'active'; clearTimeout(timer); resolve();
    });
    proc.on('exit', () => { if (tunnel.status === 'connecting') tunnel.status = 'error'; clearTimeout(timer); resolve(); });
  });

  if (tunnel.status === 'error') { proc.kill(); throw new Error('SSH connection failed'); }

  if (AUTO_RECONNECT) {
    let rc = 0;
    proc.on('exit', () => {
      if (tunnels.has(id) && rc < MAX_RECONNECT) {
        rc++;
        setTimeout(() => {
          if (!tunnels.has(id)) return;
          const np = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
          tunnel.process = np; tunnel.status = 'active';
          np.on('exit', () => { tunnel.status = 'closed'; });
        }, RECONNECT_DELAY * Math.pow(2, rc - 1));
      }
    });
  }
  return tunnel;
}

// ============================================================================
// Provider: frpc (frp client)
// ============================================================================

function writeFrpcConfig(proxyName: string, localPort: number): string {
  const configPath = `/tmp/frpc_${proxyName}.toml`;
  const config = `serverAddr = "${FRPC_SERVER_ADDR}"
serverPort = ${FRPC_SERVER_PORT}
${FRPC_TOKEN ? `auth.token = "${FRPC_TOKEN}"` : ''}

[[proxies]]
name = "${proxyName}"
type = "tcp"
localIP = "127.0.0.1"
localPort = ${localPort}
`;
  fs.writeFileSync(configPath, config, 'utf-8');
  return configPath;
}

async function createFrpc(port: number, opts: {
  proxy_name?: string; server_addr?: string;
}): Promise<TunnelInfo> {
  const addr = opts.server_addr || FRPC_SERVER_ADDR;
  if (!addr) throw new Error('No frp server. Set FRPC_SERVER_ADDR or pass server_addr.');
  const proxyName = opts.proxy_name || `kadi_${Date.now()}`;
  const configPath = writeFrpcConfig(proxyName, port);

  const proc = spawn('frpc', ['-c', configPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  const id = nextId('frpc');
  const tunnel: TunnelInfo = {
    id, mode: 'frpc', localPort: port, publicUrl: `frpc://${addr}/${proxyName}`,
    status: 'connecting', createdAt: new Date().toISOString(),
    process: proc, proxyName, serverAddr: addr,
  };

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { if (tunnel.status === 'connecting') tunnel.status = 'active'; resolve(); }, 5000);
    proc.on('error', () => { tunnel.status = 'error'; clearTimeout(timer); resolve(); });
    proc.stdout?.on('data', (data: Buffer) => {
      if (data.toString().includes('start proxy success')) { tunnel.status = 'active'; clearTimeout(timer); resolve(); }
    });
    proc.on('exit', () => { if (tunnel.status === 'connecting') tunnel.status = 'error'; clearTimeout(timer); resolve(); });
  });

  if (tunnel.status === 'error') { proc.kill(); throw new Error('frpc connection failed'); }

  if (AUTO_RECONNECT) {
    let rc = 0;
    proc.on('exit', () => {
      if (tunnels.has(id) && rc < MAX_RECONNECT) {
        rc++;
        setTimeout(() => {
          if (!tunnels.has(id)) return;
          const np = spawn('frpc', ['-c', configPath], { stdio: ['ignore', 'pipe', 'pipe'] });
          tunnel.process = np; tunnel.status = 'active';
          np.on('exit', () => { tunnel.status = 'closed'; });
        }, RECONNECT_DELAY * Math.pow(2, rc - 1));
      }
    });
  }
  return tunnel;
}

// ============================================================================
// Unified creation dispatcher
// ============================================================================

const PUBLIC_FALLBACK: TunnelMode[] = ['localtunnel', 'serveo', 'pinggy', 'localhost_run', 'ngrok'];

async function createPublicTunnel(mode: TunnelMode, port: number, sub?: string): Promise<TunnelInfo> {
  let result: { process: ChildProcess; publicUrl: string };
  switch (mode) {
    case 'ngrok': result = await createNgrok(port, sub); break;
    case 'serveo': result = await createServeo(port, sub); break;
    case 'localtunnel': result = await createLocaltunnel(port, sub); break;
    case 'pinggy': result = await createPinggy(port); break;
    case 'localhost_run': result = await createLocalhostRun(port); break;
    default: throw new Error(`Unknown public provider: ${mode}`);
  }
  const id = nextId(mode);
  const info: TunnelInfo = {
    id, mode, localPort: port, publicUrl: result.publicUrl,
    status: 'active', createdAt: new Date().toISOString(),
    process: result.process, subdomain: sub,
  };
  result.process.on('exit', () => {
    const t = tunnels.get(id);
    if (t && t.status === 'active') { t.status = 'closed'; tunnels.delete(id); }
  });
  return info;
}

interface CreateOpts {
  port: number; mode: string; subdomain?: string; fallback?: boolean;
  remote_port?: number; remote_host?: string; ssh_port?: string; ssh_user?: string; ssh_key?: string;
  proxy_name?: string; server_addr?: string;
}

async function createTunnelUnified(opts: CreateOpts): Promise<TunnelInfo> {
  const { port, mode, subdomain, fallback = true } = opts;

  if (mode !== 'auto') {
    if (mode === 'kadi') return createKadi(port, subdomain);
    if (mode === 'ssh') return createSsh(port, opts);
    if (mode === 'frpc') return createFrpc(port, opts);
    return createPublicTunnel(mode as TunnelMode, port, subdomain);
  }

  // Auto: try kadi first, then public providers
  const tryOrder: TunnelMode[] = ['kadi', ...PUBLIC_FALLBACK];
  const errors: string[] = [];
  for (const m of tryOrder) {
    try {
      if (m === 'kadi') return await createKadi(port, subdomain);
      return await createPublicTunnel(m, port, subdomain);
    } catch (err: any) {
      errors.push(`${m}: ${err.message}`);
      if (!fallback) throw err;
    }
  }
  throw new Error(`All providers failed: ${errors.join('; ')}`);
}

// ============================================================================
// Tool 1: tunnel_create
// ============================================================================

client.registerTool({
  name: 'tunnel_create',
  description: 'Create a tunnel to expose a local port. Modes: auto (tries kadi then public), kadi, ssh, frpc, ngrok, serveo, localtunnel, pinggy, localhost_run.',
  input: z.object({
    port: z.number().optional().describe('Local port to expose (default from env)'),
    mode: z.string().optional().describe('Tunnel mode: auto, kadi, ssh, frpc, ngrok, serveo, localtunnel, pinggy, localhost_run'),
    subdomain: z.string().optional().describe('Requested subdomain (not all modes support this)'),
    fallback: z.boolean().optional().describe('In auto mode, try next provider on failure (default: true)'),
    // SSH-specific
    remote_port: z.number().optional().describe('SSH: remote port to bind (0 = auto)'),
    remote_host: z.string().optional().describe('SSH: server host'),
    ssh_port: z.string().optional().describe('SSH: port (default: 22)'),
    ssh_user: z.string().optional().describe('SSH: user'),
    ssh_key: z.string().optional().describe('SSH: path to private key'),
    // frpc-specific
    proxy_name: z.string().optional().describe('frpc: proxy name'),
    server_addr: z.string().optional().describe('frpc: server address'),
  }),
}, async (params) => {
  if (tunnels.size >= MAX_CONCURRENT) {
    return { success: false, error: `Max concurrent tunnels (${MAX_CONCURRENT}) reached` };
  }
  try {
    const info = await createTunnelUnified({
      port: params.port || DEFAULT_PORT,
      mode: params.mode || DEFAULT_MODE,
      subdomain: params.subdomain,
      fallback: params.fallback,
      remote_port: params.remote_port,
      remote_host: params.remote_host,
      ssh_port: params.ssh_port,
      ssh_user: params.ssh_user,
      ssh_key: params.ssh_key,
      proxy_name: params.proxy_name,
      server_addr: params.server_addr,
    });
    if (TUNNEL_TIMEOUT_MS > 0) {
      info.timeoutId = setTimeout(() => destroyTunnel(info.id), TUNNEL_TIMEOUT_MS);
    }
    tunnels.set(info.id, info);
    return {
      success: true, tunnel_id: info.id, mode: info.mode,
      public_url: info.publicUrl, local_port: info.localPort,
      subdomain: info.subdomain, status: info.status,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// ============================================================================
// Tool 2: tunnel_destroy
// ============================================================================

client.registerTool({
  name: 'tunnel_destroy',
  description: 'Destroy a tunnel by ID.',
  input: z.object({ tunnel_id: z.string().describe('Tunnel ID') }),
}, async (params) => {
  const t = tunnels.get(params.tunnel_id);
  if (!t) return { success: false, error: `Tunnel ${params.tunnel_id} not found` };
  destroyTunnel(params.tunnel_id);
  return { success: true, message: `Tunnel ${params.tunnel_id} destroyed` };
});

// ============================================================================
// Tool 3: tunnel_destroy_all
// ============================================================================

client.registerTool({
  name: 'tunnel_destroy_all',
  description: 'Destroy all active tunnels',
  input: z.object({}),
}, async () => {
  const count = tunnels.size;
  destroyAll();
  return { success: true, destroyed: count };
});

// ============================================================================
// Tool 4: tunnel_list
// ============================================================================

client.registerTool({
  name: 'tunnel_list',
  description: 'List all active tunnels across all modes',
  input: z.object({}),
}, async () => {
  const list = [...tunnels.values()].map((t) => ({
    id: t.id, mode: t.mode, local_port: t.localPort, public_url: t.publicUrl,
    status: t.status, subdomain: t.subdomain, created_at: t.createdAt,
  }));
  return { success: true, tunnels: list, count: list.length };
});

// ============================================================================
// Tool 5: tunnel_status
// ============================================================================

client.registerTool({
  name: 'tunnel_status',
  description: 'Get detailed status of a specific tunnel',
  input: z.object({ tunnel_id: z.string().describe('Tunnel ID') }),
}, async (params) => {
  const t = tunnels.get(params.tunnel_id);
  if (!t) return { success: false, error: `Tunnel ${params.tunnel_id} not found` };
  return {
    success: true, id: t.id, mode: t.mode, local_port: t.localPort,
    public_url: t.publicUrl, status: t.status, process_alive: t.process ? !t.process.killed : false,
    subdomain: t.subdomain, remote_host: t.remoteHost, remote_port: t.remotePort,
    proxy_name: t.proxyName, server_addr: t.serverAddr,
    expires_at: t.expiresAt, created_at: t.createdAt,
  };
});

// ============================================================================
// Tool 6: tunnel_providers
// ============================================================================

client.registerTool({
  name: 'tunnel_providers',
  description: 'List available tunnel modes and their capabilities',
  input: z.object({}),
}, async () => {
  return {
    success: true,
    providers: [
      { mode: 'kadi', type: 'managed', subdomain: true, notes: 'KĀDI cloud tunnel. Spawns frpc or SSH to broker.kadi.build. Requires KADI_TUNNEL_TOKEN.' },
      { mode: 'ssh', type: 'self-hosted', subdomain: false, notes: 'SSH reverse tunnel. Requires SSH server access.' },
      { mode: 'frpc', type: 'self-hosted', subdomain: false, notes: 'frp client. Requires frp server.' },
      { mode: 'localtunnel', type: 'public', subdomain: true, notes: 'Free, no signup. Uses npx localtunnel.' },
      { mode: 'serveo', type: 'public', subdomain: true, notes: 'Free, SSH-based. No install needed.' },
      { mode: 'pinggy', type: 'public', subdomain: false, notes: 'Free tier. SSH-based. Token for persistent URLs.' },
      { mode: 'localhost_run', type: 'public', subdomain: false, notes: 'Free, SSH-based. No signup.' },
      { mode: 'ngrok', type: 'public', subdomain: true, notes: 'Requires auth token. Most reliable.' },
    ],
    default_mode: DEFAULT_MODE,
  };
});

// ============================================================================
// Tool 7: tunnel_health
// ============================================================================

client.registerTool({
  name: 'tunnel_health',
  description: 'Check health of the kadi-tunnel control API (only for self-hosted setups with control API)',
  input: z.object({}),
}, async () => {
  if (!CONTROL_API_URL) {
    return { success: true, note: 'No control API configured. kadi mode uses frpc/SSH to broker.kadi.build directly.' };
  }
  try {
    const h = await controlApi<KadiHealthResponse>('GET', '/health');
    return { success: true, status: h.status, version: h.version, uptime: h.uptime };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// ============================================================================
// Tool 8: tunnel_reconnect_config
// ============================================================================

client.registerTool({
  name: 'tunnel_reconnect_config',
  description: 'Get reconnection settings for SSH and frpc tunnels',
  input: z.object({}),
}, async () => {
  return {
    success: true,
    config: {
      auto_reconnect: AUTO_RECONNECT,
      max_attempts: MAX_RECONNECT,
      base_delay_ms: RECONNECT_DELAY,
      strategy: 'exponential_backoff',
    },
  };
});

// ============================================================================
// Cleanup & Startup
// ============================================================================

export default client;

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  process.on('SIGINT', () => { destroyAll(); process.exit(0); });
  process.on('SIGTERM', () => { destroyAll(); process.exit(0); });

  const mode = (process.env.KADI_MODE || process.argv[2] || 'stdio') as 'stdio' | 'broker';

  console.log(`[ability-tunnel] Default mode: ${DEFAULT_MODE}`);
  console.log(`[ability-tunnel] Starting in ${mode} mode...`);

  client.serve(mode);
}