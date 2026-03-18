/**
 * Container Log Streaming Routes — Podman container management + SSE log stream.
 *
 * GET /api/containers           — List running containers
 * GET /api/containers/:name/logs — SSE stream of container logs (podman logs -f)
 *
 * Podman runs in WSL; commands are invoked via `wsl podman ...` on Windows
 * or `podman ...` directly when running inside WSL/Linux.
 *
 * Environment:
 *  - PODMAN_CMD: Override the podman command (default: auto-detect wsl vs native)
 */

import { Router, type Request, type Response } from 'express';
import { spawn, type ChildProcess } from 'child_process';
import os from 'os';

export const containerRoutes = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip ANSI escape sequences from a string. */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
}

/**
 * Build the command + args to invoke podman.
 * On Windows, use `wsl podman`; otherwise use `podman` directly.
 */
function podmanCommand(): { cmd: string; prefix: string[] } {
  const override = process.env.PODMAN_CMD;
  if (override) {
    return { cmd: override, prefix: [] };
  }
  if (os.platform() === 'win32') {
    return { cmd: 'wsl', prefix: ['podman'] };
  }
  return { cmd: 'podman', prefix: [] };
}

/**
 * Spawn a podman command and collect stdout + stderr into a single string.
 * Rejects on non-zero exit or timeout.
 */
function execPodman(args: string[], timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const { cmd, prefix } = podmanCommand();
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
    const raw = await execPodman([
      'ps', '--format', 'json',
    ]);

    const containers: unknown[] = JSON.parse(raw);

    const result: ContainerInfo[] = containers.map((c: any) => ({
      id: (c.Id ?? '').slice(0, 12),
      name: Array.isArray(c.Names) ? c.Names[0] : (c.Names ?? c.Id ?? ''),
      image: c.Image ?? '',
      status: c.Status ?? '',
      state: c.State ?? '',
      ports: (c.Ports ?? []).map((p: any) =>
        p.host_port ? `${p.host_port}→${p.container_port}/${p.protocol}` : `${p.container_port}/${p.protocol}`,
      ),
      created: c.CreatedAt ?? '',
    }));

    res.json({ containers: result });
  } catch (err: any) {
    console.error('[containers] Failed to list:', err.message);
    res.status(503).json({
      error: 'Cannot reach Podman. Is it running?',
      detail: err.message,
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

  // Build podman logs command
  const { cmd, prefix } = podmanCommand();
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
