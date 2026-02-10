import { Router, type Request, type Response, type NextFunction } from 'express';
import { kadiClient, } from '../index.js';
import { parseToolResult } from '../kadi-client.js';
import { broadcastEvent } from '../websocket.js';

export const questRoutes = Router();

/**
 * GET /api/quests — List all quests
 */
questRoutes.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await kadiClient.questList();
    const data = parseToolResult(result);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/quests/:questId — Get quest details
 */
questRoutes.get('/:questId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const questId = req.params.questId as string;
    const result = await kadiClient.questGetDetails(questId);
    const data = parseToolResult(result);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/quests — Create a new quest
 */
questRoutes.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, tasks } = req.body;
    if (!name || !description) {
      res.status(400).json({ success: false, error: 'name and description are required' });
      return;
    }
    const result = await kadiClient.questCreate({ name, description, tasks });
    const data = parseToolResult(result);
    broadcastEvent('quest.created', data);
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
});
