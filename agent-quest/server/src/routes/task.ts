import { Router, type Request, type Response, type NextFunction } from 'express';
import { kadiClient } from '../index.js';
import { parseToolResult } from '../kadi-client.js';

export const taskRoutes = Router();

/**
 * GET /api/tasks — Query tasks with optional filters
 * Query params: questId, status, agentId
 */
taskRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters: Record<string, unknown> = {};
    if (req.query.questId) filters.questId = req.query.questId;
    if (req.query.status) filters.status = req.query.status;
    if (req.query.agentId) filters.agentId = req.query.agentId;

    const result = await kadiClient.taskQuery(filters);
    const data = parseToolResult(result);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tasks/:taskId — Get task details
 */
taskRoutes.get('/:taskId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskId = req.params.taskId as string;
    const result = await kadiClient.taskGetDetails(taskId);
    const data = parseToolResult(result);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});
