/**
 * GitHub Webhook Handler
 *
 * Receives GitHub webhook POST requests for PR events, verifies the
 * HMAC-SHA256 signature, and publishes KĀDI events to the broker.
 *
 * Published events:
 *   github.pr.approved           — PR review approved
 *   github.pr.changes_requested  — PR review requested changes
 *   github.pr.merged             — PR merged
 *   github.pr.closed             — PR closed without merge
 *   quest.merged                 — Quest completed (PR merged)
 *   quest.pr_rejected            — Quest PR closed without merge
 *   pr.changes_requested         — PR changes requested (for agent-lead)
 */

import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { client } from '../kadi-agent.js';

export const webhookRoutes = Router();

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

// ---------------------------------------------------------------------------
// Signature verification (HMAC-SHA256)
// ---------------------------------------------------------------------------

function verifySignature(payload: string, signature: string | undefined): boolean {
  if (!WEBHOOK_SECRET) {
    console.warn('[webhook] GITHUB_WEBHOOK_SECRET not set — skipping signature verification');
    return true; // Allow in dev mode
  }
  if (!signature) return false;

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload, 'utf8').digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// PR event parsing
// ---------------------------------------------------------------------------

interface PrEventPayload {
  channel: string;
  data: Record<string, unknown>;
}

function parsePrEvent(
  event: string,
  action: string,
  payload: Record<string, unknown>,
): PrEventPayload | null {
  const pr = payload.pull_request as Record<string, unknown> | undefined;
  if (!pr) return null;

  const repo = payload.repository as Record<string, unknown> | undefined;

  // Extract questId from head branch (convention: quest/{questId})
  const headRef = ((pr.head as Record<string, unknown>)?.ref as string) ?? '';
  const questId = headRef.startsWith('quest/') ? headRef.slice('quest/'.length) : undefined;

  const base = {
    prNumber: pr.number,
    prTitle: pr.title,
    prUrl: pr.html_url,
    repo: repo?.full_name,
    sender: (payload.sender as Record<string, unknown>)?.login,
    ...(questId && { questId }),
    timestamp: Date.now(),
  };

  // pull_request events (merged / closed)
  if (event === 'pull_request') {
    if (action === 'closed' && pr.merged) {
      return {
        channel: 'github.pr.merged',
        data: {
          ...base,
          mergedBy: (pr.merged_by as Record<string, unknown>)?.login,
        },
      };
    }
    if (action === 'closed' && !pr.merged) {
      return { channel: 'github.pr.closed', data: base };
    }
    return null;
  }

  // pull_request_review events (approved / changes_requested)
  if (event === 'pull_request_review') {
    const review = payload.review as Record<string, unknown> | undefined;
    const state = review?.state as string | undefined;

    if (state === 'approved') {
      return {
        channel: 'github.pr.approved',
        data: {
          ...base,
          reviewer: (review?.user as Record<string, unknown>)?.login,
        },
      };
    }
    if (state === 'changes_requested') {
      return {
        channel: 'github.pr.changes_requested',
        data: {
          ...base,
          reviewer: (review?.user as Record<string, unknown>)?.login,
        },
      };
    }
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// POST /api/webhook/github
// ---------------------------------------------------------------------------

webhookRoutes.post('/github', async (req: Request, res: Response) => {
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const event = req.headers['x-github-event'] as string | undefined;
  const deliveryId = req.headers['x-github-delivery'] as string | undefined;

  // 1. Verify signature
  const rawBody = JSON.stringify(req.body);
  if (!verifySignature(rawBody, signature)) {
    console.warn(`[webhook] Invalid signature for delivery ${deliveryId}`);
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // 2. Handle ping (sent when webhook is first configured on GitHub)
  if (event === 'ping') {
    console.log(`[webhook] GitHub ping received (${deliveryId})`);
    res.status(200).json({ pong: true });
    return;
  }

  // 3. Only handle PR-related events
  if (event !== 'pull_request' && event !== 'pull_request_review') {
    console.log(`[webhook] Ignoring event: ${event}`);
    res.status(200).json({ ignored: true, event });
    return;
  }

  const action = (req.body as Record<string, unknown>).action as string;
  const parsed = parsePrEvent(event, action, req.body as Record<string, unknown>);

  if (!parsed) {
    console.log(`[webhook] No actionable PR event: ${event}/${action}`);
    res.status(200).json({ ignored: true, event, action });
    return;
  }

  console.log(`[webhook] ${parsed.channel} — PR #${parsed.data.prNumber} (${deliveryId})`);

  // 4. Publish low-level github.pr.* event to broker
  try {
    await client.publish(parsed.channel, parsed.data);
  } catch (err) {
    console.error(`[webhook] Failed to publish ${parsed.channel}:`, (err as Error).message);
  }

  // 5. Publish high-level quest/pr events for agent-lead / agent-producer
  try {
    if (parsed.channel === 'github.pr.merged') {
      await client.publish('quest.merged', parsed.data);
      // Publish quest.completed so agent-producer can notify HUMAN
      if (parsed.data.questId) {
        await client.publish('quest.completed', {
          questId: parsed.data.questId,
          timestamp: new Date().toISOString(),
        });
      }
    } else if (parsed.channel === 'github.pr.closed') {
      await client.publish('quest.pr_rejected', parsed.data);
    } else if (parsed.channel === 'github.pr.changes_requested') {
      await client.publish('pr.changes_requested', parsed.data);
    }
  } catch (err) {
    console.error('[webhook] Failed to publish quest event:', (err as Error).message);
  }

  res.status(200).json({ ok: true, channel: parsed.channel });
});
