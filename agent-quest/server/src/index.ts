import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createServer, type Server as HttpServer } from 'http';
import { setupWebSocket, getConnectedClientCount } from './websocket.js';
import { questRoutes } from './routes/quest.js';
import { taskRoutes } from './routes/task.js';
import { approvalRoutes } from './routes/approval.js';
import { agentRoutes } from './routes/agent.js';
import { questActionRoutes, taskActionRoutes } from './routes/actions.js';
import { observerRoutes } from './routes/observer.js';
import { logRoutes, startLogCapture } from './routes/logs.js';
import { containerRoutes } from './routes/containers.js';
import { webhookRoutes } from './routes/webhook.js';
import { QuestAgentClient, cfg, client } from './kadi-agent.js';
import { setupBrokerEventBridge } from './broker-events.js';
import { startFileWatcher, stopFileWatcher } from './file-watcher.js';

// ---------------------------------------------------------------------------
// KĀDI Broker client (singleton)
// ---------------------------------------------------------------------------
export const kadiClient = new QuestAgentClient();

const PORT = cfg.has('server.PORT') ? cfg.number('server.PORT') : 8888;

/**
 * Parse CORS_ORIGINS config into an array of allowed origins.
 * Supports comma-separated values for multi-origin deployment.
 */
function parseCorsOrigins(): (string | RegExp)[] {
  if (!cfg.has('server.CORS_ORIGINS')) {
    return ['http://localhost:5173'];
  }
  const raw = cfg.string('server.CORS_ORIGINS');
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

const allowedOrigins = parseCorsOrigins();

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  const start = Date.now();
  _res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `[http] ${req.method} ${req.originalUrl} ${_res.statusCode} ${duration}ms`,
    );
  });
  next();
});

// CORS — supports multiple origins for local + remote deployment
app.use(
  cors({
    origin(origin, callback) {
      // Allow requests with no origin (server-to-server, curl, etc.)
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.some((allowed) =>
          typeof allowed === 'string' ? allowed === origin : allowed.test(origin),
        )
      ) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);

app.use(express.json());

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------
app.use('/api/quests', questRoutes);
app.use('/api/quests', questActionRoutes);  // Quest approval actions: /:questId/approve|revise|reject
app.use('/api/tasks', taskRoutes);
app.use('/api/tasks', taskActionRoutes);    // Task approval actions: /:taskId/approve|revise|reject
app.use('/api/approvals', approvalRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/agents', logRoutes);
app.use('/api/containers', containerRoutes);
app.use('/api/observer', observerRoutes);
app.use('/api/webhook', webhookRoutes);

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  const questDataPath = cfg.has('data.QUEST_DATA_PATH') ? cfg.string('data.QUEST_DATA_PATH') : '';
  res.json({
    status: 'ok',
    wsClients: getConnectedClientCount(),
    kadiBroker: kadiClient.isConnected() ? 'connected' : 'disconnected',
    fileWatcher: questDataPath ? 'enabled' : 'disabled',
    timestamp: new Date().toISOString(),
  });
});

// List available KĀDI tools — aggregates from multiple sources:
//  1. mcp-server-quest /tools endpoint (quest_quest_* tools with full schemas)
//  2. Observer agent tools (agent-advertised tools — handled client-side as fallback)
app.get('/api/tools', async (_req: Request, res: Response) => {
  const toolMap = new Map<string, { name: string; description?: string; inputSchema?: unknown }>();

  // Source: mcp-server-quest direct endpoint
  const questPort = process.env.MCP_QUEST_PORT ?? '3100';
  const questPrefix = process.env.MCP_QUEST_PREFIX ?? 'quest_';
  try {
    const resp = await fetch(`http://localhost:${questPort}/tools`);
    if (resp.ok) {
      const data = (await resp.json()) as any;
      const tools = data?.tools ?? [];
      for (const t of tools) {
        const prefixedName = `${questPrefix}${t.name}`;
        toolMap.set(prefixedName, {
          name: prefixedName,
          description: t.description,
          inputSchema: t.inputSchema,
        });
      }
    }
  } catch (err: any) {
    console.warn(`[api/tools] mcp-server-quest /tools failed: ${err.message}`);
  }

  const tools = Array.from(toolMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  res.json({ tools });
});


// Execute a tool by name (playground endpoint)
app.post('/api/tools/:toolName/execute', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const toolName = req.params.toolName as string;
    const args = req.body ?? {};
    const result = await kadiClient.callTool(toolName, args);
    if (!result || !result.content) {
      res.status(502).json({
        success: false,
        error: `Tool "${toolName}" returned no response — it may not be routable from this client. The tool is visible via observer but may belong to an agent on a different network.`,
      });
      return;
    }
    res.json({ success: true, result });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (msg.includes('undefined') || msg.includes('Cannot read properties')) {
      res.status(502).json({
        success: false,
        error: `Tool "${req.params.toolName}" is not reachable — likely registered by an agent on a network this client is not subscribed to.`,
      });
    } else {
      next(err);
    }
  }
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(`[error] ${err.message}`, err.stack);
  const status = (err as Error & { status?: number }).status ?? 500;
  res.status(status).json({
    error: err.message,
  });
});

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------
const server: HttpServer = createServer(app);
setupWebSocket(server);

async function bootstrap(): Promise<void> {
  // Connect to KĀDI broker
  try {
    await kadiClient.connect();
    setupBrokerEventBridge(client);
  } catch (err) {
    console.warn('[agent-quest] Failed to connect to KĀDI broker:', (err as Error).message);
    console.warn('[agent-quest] Server will start without broker — routes will return 503');
  }

  // Start file watcher for live dashboard updates
  const questDataPath = cfg.has('data.QUEST_DATA_PATH') ? cfg.string('data.QUEST_DATA_PATH') : '';
  if (questDataPath) {
    startFileWatcher(questDataPath);
    console.log(`[agent-quest] File watcher started for ${questDataPath}`);
  } else {
    console.warn('[agent-quest] data.QUEST_DATA_PATH not set — file watcher disabled');
  }

  // Start log capture from broker observer SSE
  startLogCapture();

  server.listen(PORT, () => {
    console.log(`[agent-quest] Server running on http://localhost:${PORT}`);
    console.log(`[agent-quest] WebSocket available on ws://localhost:${PORT}/ws`);
    console.log(`[agent-quest] Allowed CORS origins: ${allowedOrigins.join(', ')}`);
  });
}

bootstrap();

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n[agent-quest] Received ${signal}, shutting down gracefully…`);
  await stopFileWatcher();
  await kadiClient.disconnect();
  server.close(() => {
    console.log('[agent-quest] HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.warn('[agent-quest] Forcing shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { app, server };
