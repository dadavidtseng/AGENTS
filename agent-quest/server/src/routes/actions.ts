/**
 * Action Routes
 *
 * Routes that call agent-producer tools for quest and task approval actions.
 * These are the "action" routes that trigger approval decisions through the
 * agent-producer's approval tools via KĀDI broker.
 *
 * Quest-level actions (workflow steps 10a/10b/10c):
 *   POST /api/quests/:questId/approve
 *   POST /api/quests/:questId/revise
 *   POST /api/quests/:questId/reject
 *
 * Task-level actions (workflow steps 23a/23b/23c):
 *   POST /api/tasks/:taskId/approve
 *   POST /api/tasks/:taskId/revise
 *   POST /api/tasks/:taskId/reject
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { kadiClient } from '../index.js';
import { parseToolResult } from '../kadi-agent.js';
import { broadcastEvent } from '../websocket.js';

export const questActionRoutes = Router();
export const taskActionRoutes = Router();

// ---------------------------------------------------------------------------
// Quest-level approval actions
// ---------------------------------------------------------------------------

/**
 * POST /api/quests/:questId/approve — Approve a quest plan
 * Body: { feedback?: string }
 */
questActionRoutes.post('/:questId/approve', async (req: Request, res: Response, _next: NextFunction) => {
  const questId = req.params.questId as string;
  const { feedback } = req.body;

  // Respond immediately — the LLM orchestrator in agent-producer can take minutes
  res.json({ success: true, data: { questId, action: 'approved', status: 'submitted' } });

  // Fire-and-forget: process asynchronously
  kadiClient.questApprove(questId, feedback)
    .then((result) => {
      const data = parseToolResult(result);
      broadcastEvent('quest.updated', { questId, action: 'approved', data });
    })
    .catch((err) => {
      console.error(`[actions] questApprove async error for ${questId}:`, err?.message ?? err);
      broadcastEvent('quest.updated', { questId, action: 'approved', error: String(err?.message ?? 'Unknown error') });
    });
});

/**
 * POST /api/quests/:questId/revise — Request revision of a quest plan
 * Body: { feedback: string } (required)
 */
questActionRoutes.post('/:questId/revise', async (req: Request, res: Response, _next: NextFunction) => {
  const questId = req.params.questId as string;
  const { feedback } = req.body;

  if (!feedback || typeof feedback !== 'string' || feedback.trim().length === 0) {
    res.status(400).json({ success: false, error: 'feedback is required for revision' });
    return;
  }

  // Respond immediately — the LLM orchestrator in agent-producer can take minutes
  res.json({ success: true, data: { questId, action: 'revision_requested', status: 'submitted' } });

  // Fire-and-forget: process asynchronously
  kadiClient.questRequestRevision(questId, feedback)
    .then((result) => {
      const data = parseToolResult(result);
      broadcastEvent('quest.updated', { questId, action: 'revision_requested', data });
    })
    .catch((err) => {
      console.error(`[actions] questRequestRevision async error for ${questId}:`, err?.message ?? err);
      broadcastEvent('quest.updated', { questId, action: 'revision_requested', error: String(err?.message ?? 'Unknown error') });
    });
});

/**
 * POST /api/quests/:questId/reject — Reject a quest plan
 * Body: { feedback: string } (required)
 */
questActionRoutes.post('/:questId/reject', async (req: Request, res: Response, _next: NextFunction) => {
  const questId = req.params.questId as string;
  const { feedback } = req.body;

  if (!feedback || typeof feedback !== 'string' || feedback.trim().length === 0) {
    res.status(400).json({ success: false, error: 'feedback is required for rejection' });
    return;
  }

  // Respond immediately — the LLM orchestrator in agent-producer can take minutes
  res.json({ success: true, data: { questId, action: 'rejected', status: 'submitted' } });

  // Fire-and-forget: process asynchronously
  kadiClient.questReject(questId, feedback)
    .then((result) => {
      const data = parseToolResult(result);
      broadcastEvent('quest.updated', { questId, action: 'rejected', data });
    })
    .catch((err) => {
      console.error(`[actions] questReject async error for ${questId}:`, err?.message ?? err);
      broadcastEvent('quest.updated', { questId, action: 'rejected', error: String(err?.message ?? 'Unknown error') });
    });
});

// ---------------------------------------------------------------------------
// Task-level approval actions
// ---------------------------------------------------------------------------

/**
 * POST /api/tasks/:taskId/approve — Approve a completed task
 * Body: { questId: string, feedback?: string }
 */
taskActionRoutes.post('/:taskId/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskId = req.params.taskId as string;
    const { questId, feedback } = req.body;

    if (!questId) {
      res.status(400).json({ success: false, error: 'questId is required' });
      return;
    }

    const result = await kadiClient.taskApprove(questId, taskId, feedback);
    const data = parseToolResult(result);
    broadcastEvent('task.completed', { questId, taskId, action: 'approved' });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tasks/:taskId/revise — Request revision of a task
 * Body: { questId: string, feedback: string } (feedback required)
 */
taskActionRoutes.post('/:taskId/revise', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskId = req.params.taskId as string;
    const { questId, feedback } = req.body;

    if (!questId) {
      res.status(400).json({ success: false, error: 'questId is required' });
      return;
    }
    if (!feedback || typeof feedback !== 'string' || feedback.trim().length === 0) {
      res.status(400).json({ success: false, error: 'feedback is required for revision' });
      return;
    }

    const result = await kadiClient.taskRequestRevision(questId, taskId, feedback);
    const data = parseToolResult(result);
    broadcastEvent('task.assigned', { questId, taskId, action: 'revision_requested' });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tasks/:taskId/reject — Reject a task result
 * Body: { questId: string, feedback: string } (feedback required)
 */
taskActionRoutes.post('/:taskId/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskId = req.params.taskId as string;
    const { questId, feedback } = req.body;

    if (!questId) {
      res.status(400).json({ success: false, error: 'questId is required' });
      return;
    }
    if (!feedback || typeof feedback !== 'string' || feedback.trim().length === 0) {
      res.status(400).json({ success: false, error: 'feedback is required for rejection' });
      return;
    }

    const result = await kadiClient.taskReject(questId, taskId, feedback);
    const data = parseToolResult(result);
    broadcastEvent('task.completed', { questId, taskId, action: 'rejected' });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});
