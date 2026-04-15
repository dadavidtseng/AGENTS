/**
 * Container Log Streaming Routes — Docker/Podman container management + SSE log stream.
 *
 * GET /api/containers           — List running containers
 * GET /api/containers/:name/logs — SSE stream of container logs (docker/podman logs -f)
 *
 * On Windows, commands are invoked via `wsl podman ...`.
 * On Linux, defaults to `docker`, falls back to `podman`.
 *
 * Environment:
 *  - CONTAINER_CMD: Override the container command (default: auto-detect docker vs podman)
 */

import { Router, type Request, type Response } from 'express';
import { spawn, execSync, type ChildProcess } from 'child_process';
import os from 'os';
import { logger, MODULE_AGENT, timer } from 'agents-library';

export const containerRoutes = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip ANSI escape sequences from a string. */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
}

/** Check if a container runtime is functional (not just installed). */
function runtimeWorks(cmd: string): boolean {
  try {
    execSync(`${cmd} ps --format json`, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Cached runtime detection result. */
let _cachedRuntime: { cmd: string; prefix: string[] } | null = null;

/**
 * Build the command + args to invoke the container runtime.
 * Priority: CONTAINER_CMD env var → auto-detect (docker or podman) → wsl podman (Windows).
 */
function containerCommand(): { cmd: string; prefix: string[] } {
  if (_cachedRuntime) return _cachedRuntime;

  const override = process.env.CONTAINER_CMD;
  if (override) {
    _cachedRuntime = { cmd: override, prefix: [] };
    return _cachedRuntime;
  }
  if (os.platform() === 'win32') {
    _cachedRuntime = { cmd: 'wsl', prefix: ['podman'] };
    return _cachedRuntime;
  }
  // Linux: auto-detect — try docker first, then podman (check if runtime actually works)
  if (runtimeWorks('docker')) {
    _cachedRuntime = { cmd: 'docker', prefix: [] };
  } else if (runtimeWorks('podman')) {
    _cachedRuntime = { cmd: 'podman', prefix: [] };
  } else {
    _cachedRuntime = { cmd: 'docker', prefix: [] }; // will fail gracefully
  }
  return _cachedRuntime;
}

/**
 * Spawn a podman command and collect stdout + stderr into a single string.
 * Rejects on non-zero exit or timeout.
 */
function execContainer(args: string[], timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const { cmd, prefix } = containerCommand();
    const child = spawn(cmd, [...prefix, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });

    let out = '';
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { out += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('podman command timed out'));
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`podman exited with code ${code}: ${out.slice(0, 500)}`));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Container type
// ---------------------------------------------------------------------------

interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string[];
  created: string;
}

// ---------------------------------------------------------------------------
// GET /api/containers — list running containers
// ---------------------------------------------------------------------------

containerRoutes.get('/', async (_req: Request, res: Response) => {
  try {
    const raw = await execContainer([
      'ps', '--format', 'json',
    ]);

    // Docker outputs one JSON object per line (NDJSON); Podman outputs a JSON array.
    let containers: unknown[];
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      // Podman: JSON array
      containers = JSON.parse(trimmed);
    } else {
      // Docker: one JSON object per line
      containers = trimmed
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    }

    const result: ContainerInfo[] = containers.map((c: any) => ({
      id: (c.Id ?? c.ID ?? '').slice(0, 12),
      name: Array.isArray(c.Names) ? c.Names[0] : (c.Names ?? c.Id ?? c.ID ?? ''),
      image: c.Image ?? '',
      status: c.Status ?? '',
      state: c.State ?? '',
      ports: Array.isArray(c.Ports)
        ? c.Ports.map((p: any) =>
            p.host_port ? `${p.host_port}→${p.container_port}/${p.protocol}` : `${p.container_port}/${p.protocol}`,
          )
        : typeof c.Ports === 'string' ? [c.Ports] : [],
      created: c.CreatedAt ?? '',
    }));

    res.json({ containers: result });
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `[containers] No container runtime available: ${err.message}`, timer.elapsed('main'));
    res.json({
      containers: [],
      unavailable: true,
      reason: 'No container runtime (docker/podman) available. Container logs are not supported in this environment.',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/containers/:name/logs — SSE log stream
//
// Query params:
//  - tail: number of historical lines (default 200)
//  - follow: "true" to keep streaming (default "true")
//  - timestamps: "true" to include timestamps (default "true")
// ---------------------------------------------------------------------------

/** Active streaming processes — cleaned up on disconnect. */
const activeStreams = new Map<string, ChildProcess>();

containerRoutes.get('/:name/logs', (req: Request, res: Response) => {
  const containerName = String(req.params.name);
  const tail = parseInt(String(req.query.tail ?? '200'), 10);
  const follow = String(req.query.follow ?? 'true') !== 'false';
  const timestamps = String(req.query.timestamps ?? 'true') !== 'false';

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Build container logs command
  const { cmd, prefix } = containerCommand();
  const args = [
    ...prefix,
    'logs',
    '--tail', String(tail),
  ];
  if (follow) args.push('--follow');
  if (timestamps) args.push('--timestamps');
  args.push(containerName);

  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const streamKey = `${containerName}-${Date.now()}`;
  activeStreams.set(streamKey, child);

  let lineBuffer = '';

  /** Parse and send a single log line as an SSE event. */
  function processLine(raw: string) {
    const clean = stripAnsi(raw);
    if (!clean.trim()) return;

    // Try to parse structured log: [timestamp] message
    // Podman --timestamps format: "2026-03-03T10:06:01.917Z message..."
    let timestamp = '';
    let message = clean;

    // Match ISO timestamp prefix from podman --timestamps
    const tsMatch = clean.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+(?:[+-]\d{2}:\d{2}|Z)?)\s+(.*)$/);
    if (tsMatch) {
      timestamp = tsMatch[1];
      message = tsMatch[2];
    }

    // Try to detect log level from the message content
    let level: 'debug' | 'info' | 'warn' | 'error' = 'info';
    const msgLower = message.toLowerCase();
    if (msgLower.includes('error') || msgLower.includes('err:') || msgLower.startsWith('error')) {
      level = 'error';
    } else if (msgLower.includes('warn') || msgLower.includes('wrn:')) {
      level = 'warn';
    } else if (msgLower.includes('debug') || msgLower.includes('dbg:')) {
      level = 'debug';
    }

    const entry = {
      container: containerName,
      timestamp: timestamp || new Date().toISOString(),
      level,
      message,
    };

    try {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
      }
    } catch {
      // Connection dead
    }
  }

  /** Buffer data chunks and emit complete lines. */
  function handleData(chunk: Buffer) {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() ?? '';
    for (const line of lines) {
      processLine(line);
    }
  }

  child.stdout.on('data', handleData);
  child.stderr.on('data', handleData);

  // Send history-end marker after initial burst (give podman 500ms to flush tail)
  const historyTimer = setTimeout(() => {
    try {
      if (!res.writableEnded) {
        res.write(`event: history-end\ndata: {}\n\n`);
      }
    } catch { /* ignore */ }
  }, 500);

  // Keepalive every 30s
  const keepalive = setInterval(() => {
    try {
      if (!res.writableEnded) {
        res.write(': keepalive\n\n');
      }
    } catch { /* ignore */ }
  }, 30_000);

  // Handle podman process exit
  child.on('close', (code) => {
    activeStreams.delete(streamKey);
    clearInterval(keepalive);
    clearTimeout(historyTimer);

    try {
      if (!res.writableEnded) {
        const msg = code === 0 ? 'Container stopped' : `podman logs exited with code ${code}`;
        res.write(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`);
        res.end();
      }
    } catch { /* ignore */ }
  });

  child.on('error', (err) => {
    activeStreams.delete(streamKey);
    clearInterval(keepalive);
    clearTimeout(historyTimer);

    try {
      if (!res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
        res.end();
      }
    } catch { /* ignore */ }
  });

  // Client disconnect — kill the podman process
  req.on('close', () => {
    activeStreams.delete(streamKey);
    clearInterval(keepalive);
    clearTimeout(historyTimer);
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  });
});
