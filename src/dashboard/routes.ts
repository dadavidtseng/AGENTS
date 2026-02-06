/**
 * Dashboard REST API route handlers
 * Provides data access endpoints for dashboard UI
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { QuestModel } from '../models/questModel.js';
import { TaskModel } from '../models/taskModel.js';
import { AgentModel } from '../models/agentModel.js';
import { ApprovalModel } from '../models/approvalModel.js';
import type { ApprovalDecision, QuestStatus, AgentStatus, AgentRole } from '../types/index.js';

/**
 * Standardized success response
 */
interface SuccessResponse<T = any> {
  success: true;
  data: T;
}

/**
 * Standardized error response
 */
interface ErrorResponse {
  success: false;
  error: string;
  message?: string;
}

/**
 * Response helper functions
 */
const success = <T>(data: T): SuccessResponse<T> => ({ success: true, data });
const error = (error: string, message?: string): ErrorResponse => ({ 
  success: false, 
  error,
  ...(message && { message })
});

/**
 * Setup all dashboard API routes
 * @param app - Fastify instance
 * @param broadcast - Function to broadcast WebSocket events
 */
export function setupRoutes(
  app: FastifyInstance, 
  broadcast: (event: string, data: any) => void
): void {
  // Request logging hook
  app.addHook('onRequest', async (request, reply) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${request.method} ${request.url}`);
  });

  /**
   * GET /api/quests
   * List all quests with optional status filtering
   * Query parameters:
   *   - status: QuestStatus (optional) - Filter quests by status
   */
  app.get<{
    Querystring: { status?: QuestStatus };
  }>('/api/quests', async (request, reply) => {
    try {
      const { status } = request.query;
      let quests = await QuestModel.listAll();

      // Filter by status if provided
      if (status) {
        quests = quests.filter((quest) => quest.status === status);
      }

      return success({ quests });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[API] Failed to load quests:', errorMsg);
      reply.status(500);
      return error('Failed to load quests', errorMsg);
    }
  });

  /**
   * GET /api/quests/:questId
   * Get full quest details by ID
   * Path parameters:
   *   - questId: string - Quest identifier
   */
  app.get<{
    Params: { questId: string };
  }>('/api/quests/:questId', async (request, reply) => {
    try {
      const { questId } = request.params;

      // Validate questId
      if (!questId || questId.trim() === '') {
        reply.status(400);
        return error('Invalid quest ID');
      }

      const quest = await QuestModel.load(questId);
      return success({ quest });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[API] Failed to load quest ${request.params.questId}:`, errorMsg);
      reply.status(404);
      return error('Quest not found', errorMsg);
    }
  });

  /**
   * GET /api/agents
   * List all agents with optional filtering
   * Query parameters:
   *   - status: AgentStatus (optional) - Filter by availability status
   *   - role: AgentRole (optional) - Filter by agent role
   */
  app.get<{
    Querystring: { status?: AgentStatus; role?: AgentRole };
  }>('/api/agents', async (request, reply) => {
    try {
      const { status, role } = request.query;

      // Build filters
      const filters: { status?: AgentStatus; role?: AgentRole } = {};
      if (status) filters.status = status;
      if (role) filters.role = role;

      const agents = await AgentModel.listAll(filters);
      return success({ agents });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[API] Failed to load agents:', errorMsg);
      reply.status(500);
      return error('Failed to load agents', errorMsg);
    }
  });

  /**
   * POST /api/approvals/:questId
   * Submit approval decision for a quest
   * Path parameters:
   *   - questId: string - Quest identifier
   * Body:
   *   - decision: 'approved' | 'revision_requested' | 'rejected'
   *   - approvedBy: string - User who made the decision
   *   - approvedVia: 'discord' | 'slack' | 'dashboard'
   *   - feedback?: string - Optional feedback/comments
   */
  app.post<{
    Params: { questId: string };
    Body: {
      decision: 'approved' | 'revision_requested' | 'rejected';
      approvedBy: string;
      approvedVia: 'discord' | 'slack' | 'dashboard';
      feedback?: string;
    };
  }>('/api/approvals/:questId', async (request, reply) => {
    try {
      const { questId } = request.params;
      const { decision, approvedBy, approvedVia, feedback } = request.body;

      // Validate required fields
      if (!questId || questId.trim() === '') {
        reply.status(400);
        return error('Invalid quest ID');
      }

      if (!decision || !approvedBy || !approvedVia) {
        reply.status(400);
        return error('Missing required fields: decision, approvedBy, approvedVia');
      }

      // Validate decision value
      const validDecisions = ['approved', 'revision_requested', 'rejected'];
      if (!validDecisions.includes(decision)) {
        reply.status(400);
        return error(`Invalid decision. Must be one of: ${validDecisions.join(', ')}`);
      }

      // Validate approvedVia value
      const validPlatforms = ['discord', 'slack', 'dashboard'];
      if (!validPlatforms.includes(approvedVia)) {
        reply.status(400);
        return error(`Invalid platform. Must be one of: ${validPlatforms.join(', ')}`);
      }

      // Create approval decision
      const approvalDecision: ApprovalDecision = {
        approvalId: randomUUID(),
        questId,
        decision,
        approvedBy,
        approvedVia,
        feedback,
        timestamp: new Date(),
      };

      // Submit approval
      const result = await ApprovalModel.submitApproval(questId, approvalDecision);

      // Broadcast update to all WebSocket clients
      broadcast('approval_submitted', {
        questId,
        decision,
        result,
        timestamp: new Date().toISOString(),
      });

      console.log(`[API] Approval submitted for quest ${questId}: ${decision}`);
      return success({ result });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[API] Failed to submit approval for quest ${request.params.questId}:`, errorMsg);
      reply.status(500);
      return error('Failed to submit approval', errorMsg);
    }
  });

  /**
   * GET /api/tasks/:taskId
   * Get task details by ID
   * Path parameters:
   *   - taskId: string - Task identifier
   * Query parameters:
   *   - questId: string (required) - Quest identifier
   */
  app.get<{
    Params: { taskId: string };
    Querystring: { questId: string };
  }>('/api/tasks/:taskId', async (request, reply) => {
    try {
      const { taskId } = request.params;
      const { questId } = request.query;

      // Validate required parameters
      if (!taskId || taskId.trim() === '') {
        reply.status(400);
        return error('Invalid task ID');
      }

      if (!questId || questId.trim() === '') {
        reply.status(400);
        return error('Missing required query parameter: questId');
      }

      const task = await TaskModel.getTaskById(taskId, questId);
      return success({ task });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[API] Failed to load task ${request.params.taskId}:`, errorMsg);
      reply.status(404);
      return error('Task not found', errorMsg);
    }
  });

  /**
   * GET /api/health
   * Health check endpoint
   */
  app.get('/api/health', async () => {
    return success({ 
      status: 'ok', 
      timestamp: new Date().toISOString() 
    });
  });

  /**
   * Catch-all route for React Router
   * Serves index.html for all non-API routes to support client-side routing
   */
  app.setNotFoundHandler(async (request, reply) => {
    // Only serve index.html for non-API routes
    if (!request.url.startsWith('/api') && !request.url.startsWith('/ws')) {
      // Serve index.html for client-side routing
      const fs = await import('fs/promises');
      const path = await import('path');
      const indexPath = path.join(process.cwd(), 'src', 'dashboard', 'dist', 'index.html');
      
      try {
        const content = await fs.readFile(indexPath, 'utf-8');
        reply.type('text/html');
        return reply.send(content);
      } catch (err) {
        console.error('[Routes] Failed to serve index.html:', err);
        reply.status(500);
        return error('Failed to serve application', 'index.html not found');
      }
    }
    
    // For API routes, return 404 JSON
    reply.status(404);
    return error('Route not found', `${request.method} ${request.url} not found`);
  });
}
