/**
 * agent-expert — AGENTS developer assistant.
 *
 * Connects to the broker, registers tools (ask-agents, write-tdd, etc.),
 * and starts an HTTP server with a chat UI.
 */

import { KadiClient } from '@kadi.build/core';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.js';
import { registerTools } from './tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load agent.json ───────────────────────────────────────────────────

function loadAgentJson(): Record<string, any> {
  try {
    return JSON.parse(readFileSync(join(__dirname, '..', 'agent.json'), 'utf-8'));
  } catch {
    return JSON.parse(readFileSync(join(__dirname, '..', '..', 'agent.json'), 'utf-8'));
  }
}

const agentJson = loadAgentJson();
const brokerUrl = process.env.BROKER_URL ?? agentJson.brokers?.local ?? 'ws://localhost:8080/kadi';

// ── Create client ─────────────────────────────────────────────────────

const client = new KadiClient({
  name: agentJson.name ?? 'agent-expert',
  version: agentJson.version ?? '1.0.0',
  description: agentJson.description,
  defaultBroker: 'default',
  brokers: {
    default: { url: brokerUrl, networks: agentJson.networks ?? ['default'] },
  },
});

// ── Load secrets ──────────────────────────────────────────────────────

export const secretCache: Record<string, string> = {};

try {
  const secrets = await client.loadNative('secret-ability');
  console.log('[agent-expert] secret-ability loaded');

  for (const key of ['MM-1_API_KEY', 'MEMORY_API_KEY']) {
    for (const vault of ['model-manager', 'anthropic']) {
      try {
        const result = await secrets.invoke('get', { vault, key }) as { value?: string };
        if (result?.value) {
          secretCache[key] = result.value;
          console.log(`[agent-expert] ${key} loaded from vault "${vault}"`);
          break;
        }
      } catch { /* not in this vault */ }
    }
  }

  await secrets.disconnect();
} catch {
  console.warn('[agent-expert] secret-ability not available — model calls may fail');
}

// ── Register broker tools ─────────────────────────────────────────────

registerTools(client, secretCache);

// ── Connect to broker ─────────────────────────────────────────────────

let brokerConnected = false;

try {
  await client.connect();
  brokerConnected = true;
  console.log(`[agent-expert] Connected to broker: ${brokerUrl}`);
} catch (err) {
  console.warn(`[agent-expert] Broker connection failed: ${(err as Error).message}`);
  console.warn('[agent-expert] Running in HTTP-only mode (no broker tools)');
}

// ── Start HTTP server ─────────────────────────────────────────────────

const port = Number(process.env.PORT) || 3500;
startServer(client, port, () => brokerConnected);

// ── Graceful shutdown ─────────────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('[agent-expert] Shutting down…');
  client.disconnect?.().catch(() => {});
  process.exit(0);
});
