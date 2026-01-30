/**
 * Dashboard Server - Fastify server with WebSocket broadcasting
 * Serves React UI and provides REST API + real-time updates
 */

import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { WebSocket } from '@fastify/websocket';
import { join } from 'path';
import { config } from '../utils/config.js';
import { setupRoutes } from './routes.js';

/**
 * Dashboard Server class with WebSocket broadcasting
 */
export class DashboardServer {
  private app: FastifyInstance;
  private clients: Set<WebSocket> = new Set();

  constructor() {
    this.app = Fastify({ logger: true });
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  /**
   * Setup Fastify middleware
   */
  private setupMiddleware(): void {
    // CORS for localhost development (using Fastify's built-in CORS)
    this.app.addHook('onRequest', async (request, reply) => {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (request.method === 'OPTIONS') {
        reply.status(200).send();
      }
    });

    // WebSocket support
    this.app.register(fastifyWebsocket);

    // Static file serving (React build)
    // Note: Dashboard frontend will be built to src/dashboard/dist
    const staticPath = join(process.cwd(), 'src', 'dashboard', 'dist');
    this.app.register(fastifyStatic, {
      root: staticPath,
      prefix: '/',
    });
  }

  /**
   * Setup REST API routes
   */
  private setupRoutes(): void {
    setupRoutes(this.app, this.broadcast.bind(this));
  }

  /**
   * Setup WebSocket endpoint for real-time updates
   */
  private setupWebSocket(): void {
    this.app.get('/ws', { websocket: true }, (socket, request) => {
      // In @fastify/websocket v11+, socket is directly the WebSocket instance
      // Add client to set
      this.clients.add(socket);
      console.log('[WebSocket] Client connected. Total clients:', this.clients.size);

      // Send welcome message
      socket.send(
        JSON.stringify({
          event: 'connected',
          data: { message: 'Connected to quest dashboard', timestamp: new Date() },
        })
      );

      // Handle client messages (for future interactive features)
      socket.on('message', (message: Buffer | string) => {
        try {
          const data = JSON.parse(message.toString());
          console.log('[WebSocket] Received message:', data);
          // Echo back for now (can add custom handlers later)
          socket.send(
            JSON.stringify({
              event: 'echo',
              data,
            })
          );
        } catch (error) {
          console.error('[WebSocket] Invalid message format:', error);
        }
      });

      // Handle client disconnect
      socket.on('close', () => {
        this.clients.delete(socket);
        console.log('[WebSocket] Client disconnected. Total clients:', this.clients.size);
      });

      // Handle errors
      socket.on('error', (error: Error) => {
        console.error('[WebSocket] Socket error:', error);
        this.clients.delete(socket);
      });
    });
  }

  /**
   * Broadcast event to all connected WebSocket clients
   * 
   * @param event - Event type (e.g., 'quest_created', 'task_updated')
   * @param data - Event data
   * 
   * @example
   * dashboardServer.broadcast('quest_created', { questId: '123', questName: 'New Quest' });
   */
  broadcast(event: string, data: any): void {
    const message = JSON.stringify({ event, data, timestamp: new Date() });
    
    // Send to all connected clients
    for (const client of this.clients) {
      // Only send to open connections (readyState 1 = OPEN)
      if (client.readyState === 1) {
        try {
          client.send(message);
        } catch (error) {
          console.error('[WebSocket] Failed to send to client:', error);
          // Remove failed client
          this.clients.delete(client);
        }
      } else {
        // Remove closed clients
        this.clients.delete(client);
      }
    }
  }

  /**
   * Start the dashboard server
   */
  async start(): Promise<void> {
    try {
      const address = await this.app.listen({
        port: config.dashboardPort,
        host: config.dashboardHost,
      });
      console.log(`[Dashboard] Server listening on ${address}`);
      console.log(`[Dashboard] WebSocket available at ws://${config.dashboardHost}:${config.dashboardPort}/ws`);
    } catch (error) {
      console.error('[Dashboard] Failed to start server:', error);
      throw error;
    }
  }

  /**
   * Stop the dashboard server
   */
  async stop(): Promise<void> {
    // Close all WebSocket connections
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    // Close server
    await this.app.close();
    console.log('[Dashboard] Server stopped');
  }
}

/**
 * Singleton dashboard server instance
 * Export for use by models to broadcast updates
 */
export const dashboardServer = new DashboardServer();
