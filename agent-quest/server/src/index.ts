import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createServer, type Server as HttpServer } from 'http';
import { setupWebSocket, getConnectedClientCount } from './websocket.js';
import { questRoutes } from './routes/quest.js';
import { taskRoutes } from './routes/task.js';
import { approvalRoutes } from './routes/approval.js';
import { agentRoutes } from './routes/agent.js';
import { questActionRoutes, taskActionRoutes } from './routes/actions.js';
import { KadiMcpClient } from './kadi-client.js';
import { startFileWatcher, stopFileWatcher } from './file-watcher.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env from project root (two levels up from server/src/)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ---------------------------------------------------------------------------
// KĀDI Broker client (singleton)
// ---------------------------------------------------------------------------
export const kadiClient = new KadiMcpClient();

const PORT = parseInt(process.env.PORT ?? '8888', 10);
const NODE_ENV = process.env.NODE_ENV ?? 'development';

/**
 * Parse CORS_ORIGINS env var into an array of allowed origins.
 * Supports comma-separated values for multi-origin deployment.
 * Falls back to CLIENT_ORIGIN for backward compatibility, then localhost default.
 */
function parseCorsOrigins(): (string | RegExp)[] {
  const raw = process.env.CORS_ORIGINS ?? process.env.CLIENT_ORIGIN;
  if (!raw) {
    return ['http://localhost:5173'];
  }
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

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    environment: NODE_ENV,
    wsClients: getConnectedClientCount(),
    kadiBroker: kadiClient.isConnected() ? 'connected' : 'disconnected',
    fileWatcher: process.env.QUEST_DATA_PATH ? 'enabled' : 'disabled',
    timestamp: new Date().toISOString(),
  });
});

// List available KĀDI tools (debug endpoint)
app.get('/api/tools', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const tools = await kadiClient.listTools();
    res.json({ tools });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(`[error] ${err.message}`, err.stack);
  const status = (err as Error & { status?: number }).status ?? 500;
  res.status(status).json({
    error: NODE_ENV === 'production' ? 'Internal server error' : err.message,
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
  } catch (err) {
    console.warn('[mcp-client-quest] Failed to connect to KĀDI broker:', (err as Error).message);
    console.warn('[mcp-client-quest] Server will start without broker — routes will return 503');
  }

  // Start file watcher for live dashboard updates
  const questDataPath = process.env.QUEST_DATA_PATH;
  if (questDataPath) {
    startFileWatcher(questDataPath);
    console.log(`[mcp-client-quest] File watcher started for ${questDataPath}`);
  } else {
    console.warn('[mcp-client-quest] QUEST_DATA_PATH not set — file watcher disabled');
  }

  server.listen(PORT, () => {
    console.log(`[mcp-client-quest] Server running on http://localhost:${PORT} (${NODE_ENV})`);
    console.log(`[mcp-client-quest] WebSocket available on ws://localhost:${PORT}/ws`);
    console.log(`[mcp-client-quest] Allowed CORS origins: ${allowedOrigins.join(', ')}`);
  });
}

bootstrap();

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n[mcp-client-quest] Received ${signal}, shutting down gracefully…`);
  await stopFileWatcher();
  await kadiClient.disconnect();
  server.close(() => {
    console.log('[mcp-client-quest] HTTP server closed');
    process.exit(0);
  });
  // Force exit after 10 s if connections linger
  setTimeout(() => {
    console.warn('[mcp-client-quest] Forcing shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { app, server };
