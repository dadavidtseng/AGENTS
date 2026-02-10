import { Router, type Request, type Response, type NextFunction } from 'express';
import { kadiClient } from '../index.js';
import { parseToolResult } from '../kadi-client.js';
import { broadcastEvent } from '../websocket.js';

export const approvalRoutes = Router();

/**
 * GET /api/approvals/:questId — Get approval status for a quest
 */
approvalRoutes.get('/:questId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const questId = req.params.questId as string;
    const result = await kadiClient.approvalGetStatus(questId);
    const data = parseToolResult(result);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/approvals/:questId — Submit approval decision (legacy route)
 * Body: { decision: 'approved' | 'rejected', reason?: string }
 */
approvalRoutes.post('/:questId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const questId = req.params.questId as string;
    const { decision, reason } = req.body;

    if (!decision || !['approved', 'rejected'].includes(decision)) {
      res.status(400).json({
        success: false,
        error: 'decision must be "approved" or "rejected"',
      });
      return;
    }

    const result = await kadiClient.approvalSubmit(questId, decision, reason);
    const data = parseToolResult(result);
    broadcastEvent('approval.requested', { questId, decision, ...data as object });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});
