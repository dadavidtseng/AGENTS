/**
 * MCP Server - Model Context Protocol server implementation
 * Provides quest management tools for AI agents
 *
 * Supports two transport modes via MCP_TRANSPORT_TYPE env var:
 *   - "stdio" (default): Standard I/O transport for local/broker usage
 *   - "http": Streamable HTTP transport for containerized broker or remote access
 *     Configure port via MCP_PORT (default: 3100)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { randomUUID } from 'node:crypto';

// Import all tools and handlers from categorized structure
import { allTools } from '../tools/index.js';

// Import handlers by category
import {
  handleQuestRegisterAgent,
  handleQuestUnregisterAgent,
  handleQuestListAgents,
  handleQuestAgentHeartbeat,
} from '../tools/agent/index.js';

import {
  handleQuestCreateQuest,
  handleQuestQueryQuest,
  handleQuestListQuest,
  handleQuestArchiveQuest,
  handleQuestDeleteQuest,
  handleQuestUpdateQuest,
} from '../tools/quest/index.js';

import {
  handleQuestAssignTask,
  handleQuestQueryTask,
  handleQuestUpdateTask,
  handleQuestDeleteTask,
  handleQuestSubmitTaskResult,
  handleQuestVerifyTask,
  handleQuestLogImplementation,
  handleQuestSplitTask,
  handleQuestPlanTask,
  handleQuestAnalyzeTask,
  handleQuestReflectTask,
} from '../tools/task/index.js';

import {
  handleQuestRequestQuestApproval,
  handleQuestSubmitApproval,
  handleQuestQueryApproval,
  handleQuestRequestTaskApproval,
} from '../tools/approval/index.js';

import {
  handleQuestWorkflowGuide,
} from '../tools/workflow/index.js';

/**
 * Create a configured MCP Server instance with all tool handlers registered.
 * Transport-agnostic — caller decides how to connect it.
 */
function createMCPServer(): Server {
  const server = new Server(
    {
      name: 'mcp-server-quest',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: allTools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'quest_create_quest':
          return await handleQuestCreateQuest(args);
        case 'quest_update_quest':
          return await handleQuestUpdateQuest(args);
        case 'quest_request_quest_approval':
          return await handleQuestRequestQuestApproval(args);
        case 'quest_submit_approval':
          return await handleQuestSubmitApproval(args);
        case 'quest_split_task':
          return await handleQuestSplitTask(args);
        case 'quest_list_quest':
          return await handleQuestListQuest(args);
        case 'quest_query_quest':
          return await handleQuestQueryQuest(args);
        case 'quest_assign_task':
          return await handleQuestAssignTask(args);
        case 'quest_submit_task_result':
          return await handleQuestSubmitTaskResult(args);
        case 'quest_verify_task':
          return await handleQuestVerifyTask(args);
        case 'quest_register_agent':
          return await handleQuestRegisterAgent(args);
        case 'quest_list_agents':
          return await handleQuestListAgents(args);
        case 'quest_archive_quest':
          return await handleQuestArchiveQuest(args);
        case 'quest_delete_quest':
          return await handleQuestDeleteQuest(args);
        case 'quest_delete_task':
          return await handleQuestDeleteTask(args);
        case 'quest_log_implementation':
          return await handleQuestLogImplementation(args || {});
        case 'quest_query_approval':
          return await handleQuestQueryApproval(args);
        case 'quest_request_task_approval':
          return await handleQuestRequestTaskApproval(args);
        case 'quest_analyze_task':
          return await handleQuestAnalyzeTask(args || {});
        case 'quest_plan_task':
          return await handleQuestPlanTask(args || {});
        case 'quest_query_task':
          return await handleQuestQueryTask(args || {});
        case 'quest_update_task':
          return await handleQuestUpdateTask(args || {});
        case 'quest_reflect_task':
          return await handleQuestReflectTask(args || {});
        case 'quest_agent_heartbeat':
          return await handleQuestAgentHeartbeat(args || {});
        case 'quest_unregister_agent':
          return await handleQuestUnregisterAgent(args || {});
        case 'quest_workflow_guide':
          return await handleQuestWorkflowGuide();
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          { type: 'text', text: `Error: ${errorMessage}` },
        ],
        isError: true,
      };
    }
  });

  return server;
}

// ── Stdio Transport ─────────────────────────────────────────────────────

async function startStdioTransport(): Promise<void> {
  const server = createMCPServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] Server started (stdio)');
}

// ── HTTP Transport (Streamable HTTP, MCP 2025-03-26+) ───────────────────

async function startHttpTransport(): Promise<void> {
  const port = parseInt(process.env.MCP_PORT || '3100', 10);
  const app = express();
  app.use(express.json());

  // Session → transport map
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // Health check
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

  // Tool inventory — returns all MCP tool definitions for dashboard discovery
  app.get('/tools', (_req, res) => {
    res.json({
      tools: allTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  });

  // GET /mcp — SSE stream for existing sessions
  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  // POST /mcp — JSON-RPC over HTTP
  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    try {
      // Existing session
      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // New session (must be initialize request)
      if (!sessionId && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports.set(sid, transport);
            console.error(`[MCP/HTTP] Session initialized: ${sid}`);
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) transports.delete(sid);
        };

        const server = createMCPServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      });
    } catch (error) {
      console.error('[MCP/HTTP] Error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // DELETE /mcp — session termination
  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  app.listen(port, () => {
    console.error(`[MCP] Server started (http) → http://0.0.0.0:${port}/mcp`);
  });
}

// ── Public entry point ──────────────────────────────────────────────────

/**
 * Initialize and start MCP server.
 * Transport is selected via MCP_TRANSPORT_TYPE env var ("stdio" | "http").
 */
export async function startMCPServer(): Promise<void> {
  const transportType = (process.env.MCP_TRANSPORT_TYPE || 'stdio').toLowerCase();

  if (transportType === 'http') {
    await startHttpTransport();
  } else {
    await startStdioTransport();
  }
}
