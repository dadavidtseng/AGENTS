import { Router, type Request, type Response, type NextFunction } from 'express';
import { kadiClient } from '../index.js';
import { parseToolResult } from '../kadi-agent.js';

export const agentRoutes = Router();

/**
 * GET /api/agents — List all registered agents
 * Optional query params: status (available|busy|offline), role (artist|designer|programmer)
 */
agentRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters: Record<string, string> = {};
    if (req.query.status) filters.status = req.query.status as string;
    if (req.query.role) filters.role = req.query.role as string;

    const result = await kadiClient.agentList(filters);
    const data = parseToolResult(result);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});
