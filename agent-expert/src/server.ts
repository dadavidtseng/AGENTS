/**
 * HTTP server — serves the chat UI and REST API.
 */

import express from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KadiClient } from '@kadi.build/core';
import {
  searchDocs, discoverTool,
  formatAnswer, formatExample, formatToolReport, formatGuide, formatTdd,
  DEFAULT_MODEL, FEATURED_MODELS,
} from './tools.js';
import { secretCache } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function startServer(
  client: KadiClient,
  port: number,
  isBrokerConnected: () => boolean,
) {
  const app = express();
  app.use(express.json());

  const apiKey = () => secretCache['MM-1_API_KEY'] ?? secretCache['MEMORY_API_KEY'];

  // ── Serve UI ──────────────────────────────────────────────────────

  app.get('/', (_req, res) => {
    const paths = [
      join(__dirname, '..', 'public', 'index.html'),
      join(__dirname, '..', '..', 'public', 'index.html'),
    ];
    for (const p of paths) {
      try {
        res.type('html').send(readFileSync(p, 'utf-8'));
        return;
      } catch { /* try next */ }
    }
    res.status(500).send('Chat UI not found. Ensure public/index.html exists.');
  });

  // ── POST /api/ask ─────────────────────────────────────────────────

  app.post('/api/ask', async (req, res) => {
    try {
      const { question, model } = req.body;
      if (!question) { res.status(400).json({ error: 'Missing "question"' }); return; }
      const results = await searchDocs(client, question, 'hybrid', 8);
      res.json(await formatAnswer(client, question, results, apiKey(), model ?? DEFAULT_MODEL));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── POST /api/example ─────────────────────────────────────────────

  app.post('/api/example', async (req, res) => {
    try {
      const { topic, model } = req.body;
      if (!topic) { res.status(400).json({ error: 'Missing "topic"' }); return; }
      const results = await searchDocs(client, `${topic} code example`, 'hybrid', 8);
      res.json(await formatExample(client, topic, results, apiKey(), model ?? DEFAULT_MODEL));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── POST /api/explain ─────────────────────────────────────────────

  app.post('/api/explain', async (req, res) => {
    try {
      const { agent, model } = req.body;
      if (!agent) { res.status(400).json({ error: 'Missing "agent"' }); return; }
      const [discovery, docs] = await Promise.all([
        discoverTool(client, agent),
        searchDocs(client, `${agent} tool usage`, 'hybrid', 5),
      ]);
      res.json(await formatToolReport(client, agent, discovery, docs, apiKey(), model ?? DEFAULT_MODEL));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── POST /api/tdd ─────────────────────────────────────────────────

  app.post('/api/tdd', async (req, res) => {
    try {
      const { feature, scope, model } = req.body;
      if (!feature) { res.status(400).json({ error: 'Missing "feature"' }); return; }
      const [arch, impl, scopeDocs] = await Promise.all([
        searchDocs(client, `${feature} architecture`, 'hybrid', 6),
        searchDocs(client, `${feature} implementation`, 'hybrid', 6),
        scope ? searchDocs(client, `${scope} design`, 'hybrid', 4) : Promise.resolve([]),
      ]);
      res.json(await formatTdd(client, feature, scope, [...arch, ...impl, ...scopeDocs], apiKey(), model ?? DEFAULT_MODEL));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── POST /api/guide ───────────────────────────────────────────────

  app.post('/api/guide', async (req, res) => {
    try {
      const { goal, model } = req.body;
      if (!goal) { res.status(400).json({ error: 'Missing "goal"' }); return; }
      const [tutorials, configs, examples] = await Promise.all([
        searchDocs(client, `tutorial ${goal}`, 'hybrid', 5),
        searchDocs(client, `${goal} configuration setup`, 'hybrid', 5),
        searchDocs(client, `${goal} example code`, 'hybrid', 5),
      ]);
      res.json(await formatGuide(client, goal, [...tutorials, ...configs, ...examples], apiKey(), model ?? DEFAULT_MODEL));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── GET /api/models ───────────────────────────────────────────────

  app.get('/api/models', (_req, res) => {
    res.json({ default: DEFAULT_MODEL, featured: FEATURED_MODELS });
  });

  // ── GET /api/status ───────────────────────────────────────────────

  app.get('/api/status', async (_req, res) => {
    const status: Record<string, unknown> = {
      broker: isBrokerConnected() ? 'connected' : 'disconnected',
      agent: 'agent-expert',
      version: '1.0.0',
    };

    if (isBrokerConnected()) {
      try {
        const disco = await discoverTool(client, 'docs-search');
        status.docsSearch = disco?.tools?.[0]
          ? { available: true, providers: disco.tools[0].providerCount }
          : { available: false };
      } catch {
        status.docsSearch = { available: false };
      }
    }

    res.json(status);
  });

  // ── Start ─────────────────────────────────────────────────────────

  const server = app.listen(port, () => {
    console.log(`[agent-expert] HTTP server: http://localhost:${port}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[agent-expert] Port ${port} is already in use.`);
      console.error(`[agent-expert] Kill the existing process or use: PORT=${port + 1} kadi run`);
      process.exit(1);
    }
    throw err;
  });
}
