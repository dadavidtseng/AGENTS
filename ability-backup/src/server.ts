/**
 * HTTP server for backup-ability — serves the web dashboard and REST API.
 *
 * REST API endpoints:
 *   GET  /api/status                — overall status (schedules + recent backups)
 *   GET  /api/providers             — list cloud storage providers & availability
 *   GET  /api/backups               — list cloud backups (query: database, provider, limit)
 *   POST /api/backup                — trigger a backup
 *   POST /api/restore               — trigger a restore
 *   GET  /api/schedules             — list active schedules
 *   POST /api/schedules             — create/update a schedule
 *   DELETE /api/schedules/:database — remove schedule(s) for a database
 *   DELETE /api/backups             — delete a cloud backup file
 *   GET  /api/health                — health check (includes provider status)
 *   GET  /api/token/status          — check OAuth token health for cloud providers
 *   POST /api/token/refresh         — force-refresh OAuth tokens for a provider
 *   POST /api/token/auth-url        — generate OAuth authorization URL for re-auth
 *   POST /api/token/exchange        — exchange OAuth authorization code for tokens
 *   GET  /api/oauth/callback        — OAuth redirect callback (hosted flow)
 *   POST /api/auth/login            — authenticate and get a session token
 *   GET  /api/auth/check            — verify current session token
 *
 * Static files served from `public/` directory.
 *
 * @module server
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes, timingSafeEqual } from 'crypto';
import type { KadiClient } from '@kadi.build/core';
import { loadConfig } from './lib/config.js';
import {
  listSchedules,
  getSchedulesByDatabase,
  createSchedule,
  removeSchedulesByDatabase,
} from './lib/scheduler.js';

// ── Authentication ────────────────────────────────────────────────────

/** In-memory session store: token → expiry timestamp */
const sessions = new Map<string, number>();

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

// Periodically clean expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of sessions) {
    if (now >= expiry) sessions.delete(token);
  }
}, SESSION_CLEANUP_INTERVAL).unref();

/** Pluggable secret getter — set externally by index.ts with native secret-ability. */
type SecretGetter = (key: string, vault: string) => Promise<string | undefined>;
let _vaultGetSecret: SecretGetter | undefined;

/** Try to read a secret: env var → native vault getter. */
async function getSecret(envKey: string, vault = 'backup'): Promise<string | undefined> {
  // 1. Check env var first (fastest)
  const envVal = process.env[envKey];
  if (envVal) return envVal;

  // 2. Try native secret-ability vault lookup
  if (_vaultGetSecret) {
    try {
      const val = await _vaultGetSecret(envKey, vault);
      if (val) {
        // Cache in env for subsequent calls
        process.env[envKey] = val;
        return val;
      }
    } catch {
      // vault read failed
    }
  }

  return undefined;
}

/** Cached credentials — resolved once at startup */
let _cachedCreds: { username: string; password: string } | null | undefined;

async function resolveAuthCredentials(): Promise<{ username: string; password: string } | null> {
  if (_cachedCreds !== undefined) return _cachedCreds;

  const username = await getSecret('DASHBOARD_USERNAME');
  const password = await getSecret('DASHBOARD_PASSWORD');
  if (username && password) {
    _cachedCreds = { username, password };
    console.log('[dashboard] Auth credentials loaded — login required');
  } else {
    _cachedCreds = null;
    console.log('[dashboard] No auth credentials found — dashboard is open access');
  }
  return _cachedCreds;
}

/** Sync accessor — only valid after resolveAuthCredentials() has been awaited. */
function getAuthCredentials(): { username: string; password: string } | null {
  return _cachedCreds ?? null;
}

function createSession(): string {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function isValidSession(token: string): boolean {
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (Date.now() >= expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Returns true if the request is authenticated (or auth is disabled).
 * Returns false if the request should be rejected.
 */
function checkAuth(req: IncomingMessage): boolean {
  const creds = getAuthCredentials();
  if (!creds) return true; // no credentials configured → auth disabled

  // Check session token from cookie or Authorization header
  const cookieHeader = req.headers.cookie ?? '';
  const tokenFromCookie = cookieHeader
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('kadi_session='))
    ?.split('=')[1];

  if (tokenFromCookie && isValidSession(tokenFromCookie)) return true;

  // Also accept Bearer token
  const authHeader = req.headers.authorization ?? '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (isValidSession(token)) return true;
  }

  return false;
}

// ── Helpers ───────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function json(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function readBody(req: IncomingMessage): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

// ── Dashboard origin resolution ────────────────────────────────────────

/**
 * Resolve the dashboard's public origin from request headers / frontend hint.
 *
 * This is critical for OAuth callbacks — the redirect URI must match the URL
 * the user's browser is actually accessing (not an internal hostname like
 * `localhost` inside a container).
 *
 * Priority: explicit frontend hint → X-Forwarded headers → Origin header
 *           → Host header → env-based fallback.
 */
function resolveDashboardOrigin(req: IncomingMessage, hint?: string): string {
  // 1. Explicit hint from the frontend (most reliable — it knows its own URL)
  if (hint) {
    return hint.replace(/\/+$/, '');
  }

  // 2. X-Forwarded headers (set by reverse proxies / tunnels / Akash)
  const fwdProto = req.headers['x-forwarded-proto'];
  const fwdHost = req.headers['x-forwarded-host'];
  if (fwdProto && fwdHost) {
    const proto = Array.isArray(fwdProto) ? fwdProto[0] : fwdProto;
    const host = Array.isArray(fwdHost) ? fwdHost[0] : fwdHost;
    return `${proto}://${host}`;
  }

  // 3. Origin header (present in browser POST requests)
  const origin = req.headers.origin;
  if (origin && origin !== 'null') return origin;

  // 4. Host header
  const host = req.headers.host;
  if (host) return `http://${host}`;

  // 5. Fallback
  const port = process.env.DASHBOARD_PORT ?? '80';
  return `http://localhost:${port}`;
}

// ── Static file serving ───────────────────────────────────────────────

function resolvePublicDir(): string {
  // In production (dist/), public is at ../public relative to dist/
  // In dev (src/), public is at ../public relative to src/
  const candidates = [
    join(__dirname, '..', 'public'),
    join(__dirname, 'public'),
    join(process.cwd(), 'public'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]; // fallback
}

function serveStaticFile(
  req: IncomingMessage,
  res: ServerResponse,
  publicDir: string,
): boolean {
  let urlPath = (req.url ?? '/').split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  // Security: prevent directory traversal
  const safePath = urlPath.replace(/\.\./g, '');
  const filePath = join(publicDir, safePath);

  if (!existsSync(filePath)) return false;

  try {
    const content = readFileSync(filePath);
    const ext = extname(filePath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': content.length,
      'Cache-Control': 'public, max-age=300',
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

// ── Server factory ────────────────────────────────────────────────────

export interface DashboardServerOptions {
  port?: number;
  host?: string;
  /** Native vault secret getter from secret-ability (set by index.ts). */
  getSecret?: (key: string, vault: string) => Promise<string | undefined>;
}

export async function startDashboardServer(
  client: KadiClient,
  options: DashboardServerOptions = {},
): Promise<{ port: number; close: () => void }> {
  // Wire up the native secret getter if provided
  if (options.getSecret) {
    _vaultGetSecret = options.getSecret;
  }

  // Eagerly resolve auth credentials before starting the server
  await resolveAuthCredentials();

  const port = options.port ?? parseInt(process.env.DASHBOARD_PORT ?? '80', 10);
  const host = options.host ?? '0.0.0.0';
  const publicDir = resolvePublicDir();

  console.log(`[dashboard] Public dir: ${publicDir}`);
  console.log(`[dashboard] Exists: ${existsSync(publicDir)}`);

  const server = createServer(async (req, res) => {
    cors(res);

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;

    try {
      // ── Auth routes (unauthenticated) ─────────────────────────────
      if (path === '/api/auth/login' && req.method === 'POST') {
        const body = await readBody(req);
        handleLogin(body, res);
        return;
      }

      if (path === '/api/auth/check' && req.method === 'GET') {
        handleAuthCheck(req, res);
        return;
      }

      // OAuth callback must be unauthenticated — the browser arrives here
      // via a cross-site redirect from the OAuth provider, so neither the
      // session cookie (SameSite=Strict) nor the Bearer token is present.
      if (path === '/api/oauth/callback' && req.method === 'GET') {
        await handleOAuthCallback(client, url, res);
        return;
      }

      // ── Auth guard ────────────────────────────────────────────────
      // All routes below require authentication (when credentials are set)
      if (path.startsWith('/api/') && !checkAuth(req)) {
        json(res, { error: 'Unauthorized', requiresAuth: true }, 401);
        return;
      }

      // Static files also require auth (except login page check below)
      if (!path.startsWith('/api/') && !checkAuth(req)) {
        // Serve the HTML (which has its own login screen) — the JS will
        // detect auth status and show login UI. So allow index.html through.
      }

      // ── REST API routes ─────────────────────────────────────────
      if (path === '/api/health' && req.method === 'GET') {
        await handleHealth(client, res);
        return;
      }

      if (path === '/api/providers' && req.method === 'GET') {
        await handleProviders(client, res);
        return;
      }

      if (path === '/api/status' && req.method === 'GET') {
        await handleStatus(client, url, res);
        return;
      }

      if (path === '/api/backups' && req.method === 'GET') {
        await handleListBackups(client, url, res);
        return;
      }

      if (path === '/api/backup' && req.method === 'POST') {
        const body = await readBody(req);
        await handleBackup(client, body, res);
        return;
      }

      if (path === '/api/restore' && req.method === 'POST') {
        const body = await readBody(req);
        await handleRestore(client, body, res);
        return;
      }

      if (path === '/api/backups' && req.method === 'DELETE') {
        const body = await readBody(req);
        await handleDeleteBackup(client, body, res);
        return;
      }

      if (path === '/api/schedules' && req.method === 'GET') {
        handleGetSchedules(url, res);
        return;
      }

      if (path === '/api/schedules' && req.method === 'POST') {
        const body = await readBody(req);
        handleCreateSchedule(client, body, res);
        return;
      }

      if (path.startsWith('/api/schedules/') && req.method === 'DELETE') {
        const database = decodeURIComponent(path.split('/api/schedules/')[1]);
        handleDeleteSchedule(database, res);
        return;
      }

      // ── Token management routes ───────────────────────────────────
      if (path === '/api/token/status' && req.method === 'GET') {
        await handleTokenStatus(client, url, res);
        return;
      }

      if (path === '/api/token/refresh' && req.method === 'POST') {
        const body = await readBody(req);
        await handleTokenRefresh(client, body, res);
        return;
      }

      if (path === '/api/token/auth-url' && req.method === 'POST') {
        const body = await readBody(req);
        await handleTokenAuthUrl(client, req, body, res);
        return;
      }

      if (path === '/api/token/exchange' && req.method === 'POST') {
        const body = await readBody(req);
        await handleTokenExchange(client, body, res);
        return;
      }

      // ── Static files ────────────────────────────────────────────
      if (serveStaticFile(req, res, publicDir)) return;

      // ── 404 ─────────────────────────────────────────────────────
      json(res, { error: 'Not found' }, 404);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[dashboard] Error handling ${req.method} ${path}:`, message);
      json(res, { error: message }, 500);
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' ? addr?.port ?? port : port;
      console.log(`[dashboard] Dashboard server listening on http://${host}:${actualPort}`);
      resolve({
        port: actualPort,
        close: () => server.close(),
      });
    });
    server.on('error', reject);
  });
}

// ── Route handlers ────────────────────────────────────────────────────

/**
 * List backup files from cloud storage, scoped to the backup base path.
 *
 * Strategy: list the base path non-recursively to discover database folders,
 * then list each folder to get the actual backup files.  This avoids relying
 * on recursive listing (which some providers/versions don't handle well) and
 * avoids cloud-search (which can return files from the entire account).
 *
 * When `database` is provided, only that folder is listed.
 */
async function listBackupFilesFromCloud(
  client: KadiClient,
  provider: string,
  basePath: string,
  database?: string,
): Promise<any[]> {
  const isBackupFile = (f: any): boolean => {
    if (f.type === 'folder' || f['.tag'] === 'folder') return false;
    const name: string = f.name ?? f.path ?? '';
    return name.endsWith('.tar.gz') || name.endsWith('.zip');
  };

  // If a specific database was requested, just list that single folder
  if (database) {
    const result = await client.invokeRemote<any>('cloud-list', {
      provider,
      path: `${basePath}/${database}/`,
    });
    if (!result.success) return [];
    return (result.files ?? result.items ?? []).filter(isBackupFile);
  }

  // Step 1: list the base path to discover database sub-folders
  const rootResult = await client.invokeRemote<any>('cloud-list', {
    provider,
    path: `${basePath}/`,
  });

  if (!rootResult.success) {
    console.warn(`[dashboard] listBackupFilesFromCloud: root list failed: ${rootResult.error}`);
    return [];
  }

  const rootItems: any[] = rootResult.files ?? rootResult.items ?? [];

  // Collect any backup files sitting directly in the base path
  const allFiles: any[] = rootItems.filter(isBackupFile);

  // Identify sub-folders (database folders) and list each one
  const folders = rootItems.filter(
    (f: any) => f.type === 'folder' || f['.tag'] === 'folder',
  );

  for (const folder of folders) {
    const folderPath: string = folder.path ?? `${basePath}/${folder.name}`;
    try {
      const subResult = await client.invokeRemote<any>('cloud-list', {
        provider,
        path: `${folderPath}/`,
      });
      if (subResult.success) {
        const subFiles = (subResult.files ?? subResult.items ?? []).filter(isBackupFile);
        allFiles.push(...subFiles);
      }
    } catch (err: unknown) {
      console.warn(`[dashboard] listBackupFilesFromCloud: failed to list ${folderPath}: ${err}`);
    }
  }

  return allFiles;
}

/** Sanitize cloud-storage error messages for the dashboard. */
function sanitizeCloudError(errStr: string): string {
  // Token expiry / refresh errors — cloud-storage handles renewal internally;
  // the dashboard should not tell users to "reauthenticate".
  if (/access.?token.*expired|token.*revoked|invalid.*grant|refresh.*token/i.test(errStr)) {
    return 'Cloud provider authentication is being refreshed. Please retry in a moment.';
  }
  return errStr;
}

async function handleProviders(
  client: KadiClient,
  res: ServerResponse,
): Promise<void> {
  try {
    const result = await client.invokeRemote<any>('cloud-providers', {});

    if (result.success) {
      json(res, {
        success: true,
        providers: result.providers ?? [],
        count: result.count ?? 0,
        available: result.available ?? 0,
      });
    } else {
      json(res, { success: false, error: sanitizeCloudError(String(result.error ?? 'Unknown')), providers: [] }, 500);
    }
  } catch (err: unknown) {
    json(res, {
      success: false,
      error: sanitizeCloudError(err instanceof Error ? err.message : String(err)),
      providers: [],
    }, 500);
  }
}

async function handleHealth(
  client: KadiClient,
  res: ServerResponse,
): Promise<void> {
  const baseHealth: Record<string, any> = {
    status: 'ok',
    service: 'backup-ability',
    uptime: process.uptime(),
    providers: [],
  };

  // Try to get provider status
  try {
    const provResult = await client.invokeRemote<any>('cloud-providers', {});
    if (provResult.success) {
      baseHealth.providers = provResult.providers ?? [];
      baseHealth.providerCount = provResult.count ?? 0;
      baseHealth.providersAvailable = provResult.available ?? 0;
    }
  } catch {
    // Provider check failed — not critical for health endpoint
  }

  json(res, baseHealth);
}

async function handleStatus(
  client: KadiClient,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  const database = url.searchParams.get('database') ?? undefined;
  const cloudConfig = loadConfig('cloud', 'CLOUD');
  const backupConfig = loadConfig('backup', 'BACKUP');
  const defaultProvider = cloudConfig.default_provider || 'dropbox';

  // Get schedules
  const schedules = database
    ? getSchedulesByDatabase(database)
    : listSchedules();

  // Get recent cloud backups from ALL configured providers
  let recentBackups: any[] = [];
  try {
    const cloudBasePath = backupConfig.cloud_backup_path || '/kadi-backups';

    // Discover configured providers so we query all of them
    let providers: string[] = [defaultProvider];
    try {
      const provResult = await client.invokeRemote<any>('cloud-providers', {});
      if (provResult.success && Array.isArray(provResult.providers)) {
        const configured = provResult.providers
          .filter((p: any) => p.configured)
          .map((p: any) => p.name as string);
        if (configured.length > 0) providers = configured;
      }
    } catch {
      // Fall back to default provider only
    }

    // Query each provider in parallel
    const perProviderResults = await Promise.allSettled(
      providers.map(async (prov) => {
        const files = await listBackupFilesFromCloud(client, prov, cloudBasePath, database);
        return files.map((f: any) => ({ ...f, provider: prov }));
      }),
    );

    for (const result of perProviderResults) {
      if (result.status === 'fulfilled') {
        recentBackups.push(...result.value);
      }
    }

    recentBackups = recentBackups
      .sort((a: any, b: any) => {
        const dateA = new Date(a.modified ?? 0).getTime();
        const dateB = new Date(b.modified ?? 0).getTime();
        return dateB - dateA;
      })
      .slice(0, 20)
      .map((item: any) => ({
        path: item.path ?? item.name,
        name: item.name,
        size: item.size,
        modified: item.modified,
        provider: item.provider,
      }));
  } catch (err: unknown) {
    console.warn(`[dashboard] Could not list cloud backups: ${err}`);
  }

  json(res, {
    success: true,
    schedules,
    recentBackups,
    config: {
      defaultProvider,
      cloudBasePath: backupConfig.cloud_backup_path || '/kadi-backups',
      compressionFormat: 'tar.gz',
      stagingDir: backupConfig.staging_dir || '/tmp/kadi-staging',
      distributedMode: backupConfig.distributed_mode || 'auto',
    },
  });
}

async function handleListBackups(
  client: KadiClient,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  const database = url.searchParams.get('database') ?? undefined;
  const provider =
    url.searchParams.get('provider') ??
    loadConfig('cloud', 'CLOUD').default_provider ??
    'dropbox';
  const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const basePath =
    loadConfig('backup', 'BACKUP').cloud_backup_path ||
    loadConfig('cloud', 'CLOUD').cloud_backup_path ||
    '/kadi-backups';

  try {
    let rawFiles: any[] = [];

    if (database) {
      // List a specific database folder
      const listResult = await client.invokeRemote<any>('cloud-list', {
        provider,
        path: `${basePath}/${database}/`,
      });
      if (!listResult.success) {
        const errStr = String(listResult.error ?? '');
        if (errStr.includes('not_found') || errStr.includes('not found')) {
          json(res, { success: true, provider, backups: [], count: 0 });
          return;
        }
        json(res, { success: false, error: sanitizeCloudError(errStr) }, 500);
        return;
      }
      rawFiles = listResult.files ?? listResult.items ?? [];
    } else {
      // No database specified: enumerate database folders under the base
      // path, then list each folder's contents.  This avoids cloud-search
      // (which isn't scoped to the folder) and avoids relying on recursive
      // listing which may not be fully supported by all providers.
      rawFiles = await listBackupFilesFromCloud(client, provider, basePath);
    }
    const backups = rawFiles
      .filter((f: any) => {
        if (f.type === 'folder' || f['.tag'] === 'folder') return false;
        const name: string = f.name ?? f.path ?? '';
        return name.endsWith('.tar.gz') || name.endsWith('.zip');
      })
      .map((f: any) => {
        const remotePath: string = f.path ?? f.pathDisplay ?? f.name;
        const name: string = f.name ?? remotePath.split('/').pop() ?? '';

        let db: string | undefined;
        const pathParts = remotePath.split('/').filter(Boolean);
        const baseIdx = pathParts.indexOf('kadi-backups');
        if (baseIdx >= 0 && pathParts.length > baseIdx + 1) {
          db = pathParts[baseIdx + 1];
        }

        let timestamp: string | undefined;
        const tsMatch = name.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/);
        if (tsMatch) {
          timestamp = tsMatch[1].replace(
            /(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/,
            '$1:$2:$3.$4Z',
          );
        }

        return { remotePath, name, database: db, size: f.size, modified: f.modified, timestamp };
      })
      .sort((a, b) => {
        const dateA = new Date(a.modified ?? a.timestamp ?? 0).getTime();
        const dateB = new Date(b.modified ?? b.timestamp ?? 0).getTime();
        return dateB - dateA;
      })
      .slice(0, limit);

    json(res, { success: true, provider, backups, count: backups.length });
  } catch (err: unknown) {
    json(res, { success: false, error: sanitizeCloudError(err instanceof Error ? err.message : String(err)) }, 500);
  }
}

async function handleBackup(
  client: KadiClient,
  body: Record<string, any>,
  res: ServerResponse,
): Promise<void> {
  const database = body.database || 'kadi';
  const provider = body.provider || loadConfig('cloud', 'CLOUD').default_provider || 'dropbox';
  const compress = body.compress !== false;
  const verify = body.verify !== false;
  const skipUpload = body.skipUpload === true;

  console.log(`[dashboard] Triggering backup: database=${database}, provider=${provider}`);

  try {
    const result = await client.invokeRemote<any>('backup-database', {
      database,
      provider,
      compress,
      verify,
      skipUpload,
    });
    // Sanitize any error messages in result
    if (!result.success && result.error) {
      result.error = sanitizeCloudError(String(result.error));
    }
    json(res, result);
  } catch (err: unknown) {
    json(res, {
      success: false,
      error: sanitizeCloudError(err instanceof Error ? err.message : String(err)),
    }, 500);
  }
}

async function handleRestore(
  client: KadiClient,
  body: Record<string, any>,
  res: ServerResponse,
): Promise<void> {
  const { database, remotePath, provider, overwrite } = body;

  if (!database || !remotePath) {
    json(res, { success: false, error: 'database and remotePath are required' }, 400);
    return;
  }

  const resolvedProvider =
    provider || loadConfig('cloud', 'CLOUD').default_provider || 'dropbox';

  console.log(`[dashboard] Triggering restore: ${remotePath} → ${database}`);

  try {
    const result = await client.invokeRemote<any>('backup-restore', {
      database,
      remotePath,
      provider: resolvedProvider,
      overwrite: overwrite === true,
    });
    if (!result.success && result.error) {
      result.error = sanitizeCloudError(String(result.error));
    }
    json(res, result);
  } catch (err: unknown) {
    json(res, {
      success: false,
      error: sanitizeCloudError(err instanceof Error ? err.message : String(err)),
    }, 500);
  }
}

function handleGetSchedules(url: URL, res: ServerResponse): void {
  const database = url.searchParams.get('database') ?? undefined;
  const schedules = database
    ? getSchedulesByDatabase(database)
    : listSchedules();
  json(res, { success: true, schedules });
}

function handleCreateSchedule(
  client: KadiClient,
  body: Record<string, any>,
  res: ServerResponse,
): void {
  try {
    const database = body.database || 'kadi';
    const provider = body.provider || 'dropbox';
    const intervalHours = body.intervalHours ?? 24;

    const entry = createSchedule({ database, provider, intervalHours }, client);
    json(res, { success: true, schedule: entry });
  } catch (err: unknown) {
    json(res, {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
}

function handleDeleteSchedule(database: string, res: ServerResponse): void {
  if (!database) {
    json(res, { success: false, error: 'database parameter required' }, 400);
    return;
  }

  const count = removeSchedulesByDatabase(database);
  json(res, {
    success: true,
    removed: count,
    message: count > 0
      ? `Removed ${count} schedule(s) for "${database}"`
      : `No active schedules for "${database}"`,
    activeSchedules: listSchedules(),
  });
}

// ── Auth handlers ─────────────────────────────────────────────────────

function handleLogin(
  body: Record<string, any>,
  res: ServerResponse,
): void {
  const creds = getAuthCredentials();
  if (!creds) {
    // Auth not configured — grant session anyway
    const token = createSession();
    res.setHeader('Set-Cookie', `kadi_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`);
    json(res, { success: true, authRequired: false, token });
    return;
  }

  const { username, password } = body;
  if (
    typeof username === 'string' &&
    typeof password === 'string' &&
    safeCompare(username, creds.username) &&
    safeCompare(password, creds.password)
  ) {
    const token = createSession();
    res.setHeader('Set-Cookie', `kadi_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`);
    json(res, { success: true, token });
  } else {
    json(res, { success: false, error: 'Invalid username or password' }, 401);
  }
}

function handleAuthCheck(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const creds = getAuthCredentials();
  if (!creds) {
    json(res, { authenticated: true, authRequired: false });
    return;
  }
  json(res, {
    authenticated: checkAuth(req),
    authRequired: true,
  });
}

// ── Token management handlers ─────────────────────────────────────────

/** Pending OAuth flows — state → { provider, callbackUrl } */
const pendingOAuthFlows = new Map<string, { provider: string; callbackUrl: string; timestamp: number }>();

// Clean up stale pending flows older than 15 minutes
setInterval(() => {
  const staleThreshold = Date.now() - 15 * 60 * 1000;
  for (const [state, flow] of pendingOAuthFlows) {
    if (flow.timestamp < staleThreshold) pendingOAuthFlows.delete(state);
  }
}, 5 * 60 * 1000).unref();

async function handleTokenStatus(
  client: KadiClient,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  const provider = url.searchParams.get('provider') ?? undefined;
  const testConnection = url.searchParams.get('test') === 'true';

  try {
    const params: Record<string, unknown> = {};
    if (provider) params.provider = provider;
    if (testConnection) params.testConnection = true;

    const result = await client.invokeRemote<any>('cloud-token-status', params);
    json(res, result);
  } catch (err: unknown) {
    json(res, {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
}

async function handleTokenRefresh(
  client: KadiClient,
  body: Record<string, any>,
  res: ServerResponse,
): Promise<void> {
  const { provider } = body;

  if (!provider) {
    json(res, { success: false, error: 'provider is required' }, 400);
    return;
  }

  console.log(`[dashboard] Triggering token refresh for: ${provider}`);

  try {
    const result = await client.invokeRemote<any>('cloud-token-refresh', {
      provider,
      testAfterRefresh: true,
    });

    if (!result.success && result.error) {
      result.error = sanitizeCloudError(String(result.error));
    }
    json(res, result);
  } catch (err: unknown) {
    json(res, {
      success: false,
      error: sanitizeCloudError(err instanceof Error ? err.message : String(err)),
    }, 500);
  }
}

async function handleTokenAuthUrl(
  client: KadiClient,
  req: IncomingMessage,
  body: Record<string, any>,
  res: ServerResponse,
): Promise<void> {
  const { provider, useHostedCallback, dashboardOrigin } = body;

  if (!provider) {
    json(res, { success: false, error: 'provider is required' }, 400);
    return;
  }

  try {
    // Resolve the dashboard's public origin (the URL the user's browser is
    // actually accessing — NOT localhost inside the container).
    const origin = resolveDashboardOrigin(req, dashboardOrigin);
    const callbackUrl = `${origin}/api/oauth/callback`;

    console.log(`[dashboard] OAuth auth-url: provider=${provider}, callback=${callbackUrl}`);

    const result = await client.invokeRemote<any>('cloud-token-auth-url', {
      provider,
      callbackUrl,
    });

    // Track the pending flow for BOTH hosted and non-hosted modes.
    // Non-hosted can also land on the callback if the URL is reachable;
    // this lets the callback endpoint exchange the code automatically.
    if (result.success && result.state) {
      pendingOAuthFlows.set(result.state, {
        provider,
        callbackUrl: result.callbackUrl ?? callbackUrl,
        timestamp: Date.now(),
      });
    }

    // Include the resolved callback URL so the frontend can display it
    // (the user needs to register this URL with their OAuth app).
    if (result.success) {
      result.resolvedCallbackUrl = result.callbackUrl ?? callbackUrl;
    }

    json(res, result);
  } catch (err: unknown) {
    json(res, {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
}

async function handleTokenExchange(
  client: KadiClient,
  body: Record<string, any>,
  res: ServerResponse,
): Promise<void> {
  const { provider, code, callbackUrl } = body;

  if (!provider || !code) {
    json(res, { success: false, error: 'provider and code are required' }, 400);
    return;
  }

  console.log(`[dashboard] Exchanging auth code for: ${provider}`);

  try {
    const result = await client.invokeRemote<any>('cloud-token-exchange', {
      provider,
      code,
      callbackUrl,
    });

    if (!result.success && result.error) {
      result.error = sanitizeCloudError(String(result.error));
    }
    json(res, result);
  } catch (err: unknown) {
    json(res, {
      success: false,
      error: sanitizeCloudError(err instanceof Error ? err.message : String(err)),
    }, 500);
  }
}

/**
 * Handle the OAuth redirect callback.
 *
 * When the user authorizes via the hosted callback flow, the OAuth provider
 * redirects to /api/oauth/callback?code=...&state=...
 *
 * We look up the pending flow by state, exchange the code via
 * cloud-token-exchange, and return an HTML page with the result.
 */
async function handleOAuthCallback(
  client: KadiClient,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    const errorDesc = url.searchParams.get('error_description') ?? error;
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html><head><title>Authorization Failed</title></head>
      <body style="font-family: system-ui, sans-serif; text-align: center; padding: 60px 20px;">
        <h1 style="color: #e74c3c;">Authorization Failed</h1>
        <p>${escapeHtml(errorDesc)}</p>
        <p>You can close this window and try again from the dashboard.</p>
      </body></html>
    `);
    return;
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html><head><title>No Authorization Code</title></head>
      <body style="font-family: system-ui, sans-serif; text-align: center; padding: 60px 20px;">
        <h1 style="color: #e74c3c;">No Authorization Code</h1>
        <p>No authorization code received. Please try again from the dashboard.</p>
      </body></html>
    `);
    return;
  }

  // Look up the pending flow by state
  let provider = 'unknown';
  let callbackUrl: string | undefined;

  if (state && pendingOAuthFlows.has(state)) {
    const flow = pendingOAuthFlows.get(state)!;
    provider = flow.provider;
    callbackUrl = flow.callbackUrl;
    pendingOAuthFlows.delete(state);
  } else {
    // Try to extract provider from state string (format: kadi_<provider>_<timestamp>)
    if (state) {
      const match = state.match(/^kadi_(\w+)_/);
      if (match) provider = match[1];
    }
  }

  console.log(`[dashboard] OAuth callback received for: ${provider}`);

  try {
    const result = await client.invokeRemote<any>('cloud-token-exchange', {
      provider,
      code,
      callbackUrl,
    });

    if (result.success) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html><head><title>Authorization Successful</title></head>
        <body style="font-family: system-ui, sans-serif; text-align: center; padding: 60px 20px;">
          <h1 style="color: #27ae60;">Authorization Successful!</h1>
          <p>Your <strong>${escapeHtml(provider)}</strong> integration has been re-authorized.</p>
          <p>Tokens have been saved to the encrypted vault.</p>
          ${result.connectionTest?.success
            ? `<p>Connection verified — user: ${escapeHtml(result.connectionTest.user ?? '')}</p>`
            : ''}
          <p style="margin-top: 30px;">You can close this window and return to the dashboard.</p>
          <script>
            // Notify the opener window (dashboard) that auth is complete
            if (window.opener) {
              window.opener.postMessage({ type: 'oauth-complete', provider: '${escapeHtml(provider)}', success: true }, '*');
            }
          </script>
        </body></html>
      `);
    } else {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html><head><title>Token Exchange Failed</title></head>
        <body style="font-family: system-ui, sans-serif; text-align: center; padding: 60px 20px;">
          <h1 style="color: #e74c3c;">Token Exchange Failed</h1>
          <p>${escapeHtml(result.error ?? 'Unknown error')}</p>
          <p>You can close this window and try again from the dashboard.</p>
        </body></html>
      `);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html><head><title>Error</title></head>
      <body style="font-family: system-ui, sans-serif; text-align: center; padding: 60px 20px;">
        <h1 style="color: #e74c3c;">Error</h1>
        <p>${escapeHtml(msg)}</p>
        <p>You can close this window and try again from the dashboard.</p>
      </body></html>
    `);
  }
}

/** Escape HTML entities to prevent XSS in rendered pages. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Delete backup handler ─────────────────────────────────────────────

async function handleDeleteBackup(
  client: KadiClient,
  body: Record<string, any>,
  res: ServerResponse,
): Promise<void> {
  const { remotePath, provider } = body;

  if (!remotePath) {
    json(res, { success: false, error: 'remotePath is required' }, 400);
    return;
  }

  const resolvedProvider =
    provider || loadConfig('cloud', 'CLOUD').default_provider || 'dropbox';

  console.log(`[dashboard] Deleting backup: ${remotePath} on ${resolvedProvider}`);

  try {
    const result = await client.invokeRemote<any>('cloud-delete', {
      provider: resolvedProvider,
      path: remotePath,
      confirm: true,
    });

    if (result.success) {
      json(res, {
        success: true,
        message: `Deleted ${remotePath} from ${resolvedProvider}`,
        remotePath,
        provider: resolvedProvider,
      });
    } else {
      json(res, {
        success: false,
        error: sanitizeCloudError(String(result.error ?? 'Delete failed')),
      }, 500);
    }
  } catch (err: unknown) {
    json(res, {
      success: false,
      error: sanitizeCloudError(err instanceof Error ? err.message : String(err)),
    }, 500);
  }
}
