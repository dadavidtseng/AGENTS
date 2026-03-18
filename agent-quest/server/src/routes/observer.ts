/**
 * Observer SSE Proxy Route
 *
 * Proxies the kadi-broker's /api/admin/observer SSE stream to the frontend.
 * The frontend ObserverService connects to /api/observer, and this route
 * pipes the upstream SSE stream through to the client.
 *
 * Connection lifecycle:
 *  - On client connect: opens upstream fetch to broker observer endpoint
 *  - On client disconnect: aborts upstream fetch via AbortController
 *  - On upstream error: closes client response with appropriate status
 *
 * Environment variables:
 *  - KADI_BROKER_URL: WebSocket URL (ws://host:port/mcp) — HTTP base derived
 *  - OBSERVER_PASSWORD: Password for X-Observer-Password header (optional)
 */

import { Router, type Request, type Response } from 'express';
import { Readable } from 'stream';
import { getBrokerUrls } from '../kadi-agent.js';

export const observerRoutes = Router();

/**
 * Derive HTTP base URL from a WebSocket URL.
 * ws://localhost:8080/kadi → http://localhost:8080
 */
function wsToHttpBase(wsUrl: string): string {
  return wsUrl
    .replace(/^wss:/, 'https:')
    .replace(/^ws:/, 'http:')
    .replace(/\/(mcp|kadi)\/?$/, '');
}

/**
 * Get all broker HTTP bases for observer queries.
 */
function getAllBrokerBases(): Array<{ name: string; httpBase: string }> {
  const brokers = getBrokerUrls();
  return brokers.map(({ name, url }) => ({
    name,
    httpBase: wsToHttpBase(url),
  }));
}

/**
 * GET /api/observer — SSE proxy to broker observer endpoint(s).
 * Merges snapshots from all configured brokers.
 */
observerRoutes.get('/', async (req: Request, res: Response) => {
  const brokers = getAllBrokerBases();
  const password = process.env.OBSERVER_PASSWORD ?? '';

  // Prepare upstream requests
  const abortControllers = brokers.map(() => new AbortController());

  // Abort all upstreams when client disconnects
  req.on('close', () => {
    for (const controller of abortControllers) {
      controller.abort();
    }
  });

  try {
    const headers: Record<string, string> = {};
    if (password) {
      headers['X-Observer-Password'] = password;
    }

    // Connect to all brokers
    const upstreamPromises = brokers.map(async ({ name, httpBase }, index) => {
      const observerUrl = `${httpBase}/api/admin/observer`;
      try {
        const upstream = await fetch(observerUrl, {
          headers,
          signal: abortControllers[index].signal,
        });

        if (!upstream.ok) {
          console.warn(`[observer-proxy] Broker ${name} returned ${upstream.status}`);
          return null;
        }

        return { name, upstream };
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.warn(`[observer-proxy] Failed to connect to broker ${name}:`, err.message);
        }
        return null;
      }
    });

    const upstreams = (await Promise.all(upstreamPromises)).filter((u) => u !== null);

    console.log(`[observer-proxy] Connected to ${upstreams.length}/${brokers.length} brokers:`, upstreams.map(u => u.name).join(', '));

    if (upstreams.length === 0) {
      res.status(502).json({ error: 'Failed to connect to any broker' });
      return;
    }

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Merge and forward SSE streams from all brokers
    const streamHandlers = upstreams.map(({ name, upstream }) => {
      if (!upstream.body) return null;

      const readable = Readable.fromWeb(upstream.body as import('stream/web').ReadableStream);
      let buffer = '';
      let currentEvent = '';

      readable.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          // Track event type
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
            res.write(line + '\n');
          }
          // Parse and modify data lines
          else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              // Add broker name to the top-level data object
              data.brokerName = name;

              // Add broker name to agents in snapshot events
              if (data.agents && Array.isArray(data.agents)) {
                for (const agent of data.agents) {
                  agent.brokerName = name;
                }
              }

              console.log(`[observer-proxy] Forwarding event from broker ${name}:`, {
                event: currentEvent,
                brokerName: data.brokerName,
                agentCount: data.agents?.length || 0,
              });

              // Re-serialize and send
              res.write(`data: ${JSON.stringify(data)}\n`);
            } catch {
              // Not JSON, forward as-is
              res.write(line + '\n');
            }
          }
          // Forward other lines (empty lines, comments, etc.)
          else {
            res.write(line + '\n');
          }
        }
      });

      readable.on('error', (err: Error) => {
        if (err.name === 'AbortError') return;
        console.error(`[observer-proxy] Stream error from ${name}:`, err.message);
      });
      
      return readable;
    }).filter(r => r !== null);

    // Handle end/error for all streams - reuse the streamHandlers we already created
    const endPromises = streamHandlers.map((readable) => {
      return new Promise<void>((resolve) => {
        readable.on('end', resolve);
        readable.on('error', resolve);
      });
    });

    await Promise.race(endPromises);
    res.end();
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') return;

    console.error('[observer-proxy] Failed to connect to brokers:', (err as Error).message);
    if (!res.headersSent) {
      res.status(502).json({
        error: 'Failed to connect to broker observer endpoints',
      });
    }
  }
});
