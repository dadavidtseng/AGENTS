/**
 * Event History Route — REST endpoint for persisted system events.
 *
 * GET /api/events?after=<iso>&limit=100&type=<filter>&agent=<filter>
 *
 * Queries ArcadeDB via ability-log's event_query tool. Returns paginated
 * JSON so the dashboard can load history on mount (survives page refresh).
 */

import { Router, type Request, type Response } from 'express';
import { abilityLog } from '../kadi-agent.js';

export const eventRoutes = Router();

/**
 * GET /api/events
 *
 * Query params:
 *  - after: ISO timestamp — return events after this time
 *  - before: ISO timestamp — return events before this time
 *  - type: event type filter (e.g., quest.created, task.assigned)
 *  - agent: agent ID filter
 *  - limit: max results (default 100, max 500)
 */
eventRoutes.get('/', async (req: Request, res: Response) => {
  if (!abilityLog) {
    res.status(503).json({ error: 'ability-log not available — event persistence disabled' });
    return;
  }

  const params: Record<string, unknown> = {};
  if (req.query.after) params.after = String(req.query.after);
  if (req.query.before) params.before = String(req.query.before);
  if (req.query.type) params.type = String(req.query.type);
  if (req.query.agent) params.agentId = String(req.query.agent);
  if (req.query.limit) params.limit = Math.min(parseInt(String(req.query.limit), 10) || 100, 500);

  try {
    const result = await abilityLog.invoke('event_query', params);
    const data = typeof result === 'string' ? JSON.parse(result) : result;
    res.json({
      events: data.events ?? [],
      count: data.count ?? 0,
      hasMore: (data.count ?? 0) >= (params.limit ?? 100),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Failed to query events' });
  }
});
