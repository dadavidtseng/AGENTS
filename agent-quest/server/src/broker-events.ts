/**
 * Broker Event Bridge
 *
 * Subscribes to quest.* and task.* events on the KĀDI broker and forwards
 * them to the WebSocket broadcast system so the React frontend receives
 * real-time updates without polling.
 */

import type { KadiClient, BrokerEvent } from '@kadi.build/core';
import { broadcastEvent, type WsEventName } from './websocket.js';
import { pushEntry } from './routes/logs.js';
import type { LogLevel } from './routes/logs.js';
import { abilityLog } from './kadi-agent.js';

// ---------------------------------------------------------------------------
// Topic → WsEventName mapping
// ---------------------------------------------------------------------------

/**
 * Map a broker topic string to the corresponding dashboard WsEventName.
 * Returns undefined for topics we don't care about.
 */
function mapTopicToEvent(topic: string): WsEventName | undefined {
  // Quest events
  if (topic === 'quest.created') return 'quest.created';
  if (topic.startsWith('quest.')) return 'quest.updated';

  // Task events
  if (topic === 'task.assigned') return 'task.assigned';
  if (topic === 'task.completed' || topic === 'task.failed' || topic === 'task.verified') {
    return 'task.completed';
  }
  if (topic === 'task.revision_needed') return 'task.assigned';

  // Approval events
  if (topic === 'approval.requested') return 'approval.requested';

  // GitHub PR webhook events
  if (topic.startsWith('github.pr.')) return 'quest.updated';
  if (topic === 'pr.changes_requested') return 'quest.updated';

  return undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Subscribe to broker events and forward them to the WebSocket broadcast.
 * Call this after the agent has connected to the broker.
 */
export function setupBrokerEventBridge(client: KadiClient): void {
  const patterns = ['quest.*', 'task.*', 'approval.*', 'github.pr.*', 'pr.*'];

  for (const pattern of patterns) {
    client.subscribe(pattern, (event: BrokerEvent) => {
      const wsEvent = mapTopicToEvent(event.channel);
      if (!wsEvent) {
        console.log(`[agent-quest] Ignoring broker event: ${event.channel}`);
        return;
      }

      console.log(`[agent-quest] Broker event ${event.channel} → ws ${wsEvent}`);
      broadcastEvent(wsEvent, event.data);

      // Persist system event to ArcadeDB via ability-log
      if (abilityLog) {
        abilityLog.invoke('event_write', {
          type: wsEvent,
          agentId: (event.data as any)?.agentId ?? '',
          data: JSON.stringify(event.data),
          timestamp: new Date().toISOString(),
        }).catch(() => {});
      }
    });

    console.log(`[agent-quest] Subscribed to broker pattern: ${pattern}`);
  }

  // Subscribe to agent log forwarding (fire-and-forget from agents-library logger)
  client.subscribe('log.*', (event: BrokerEvent) => {
    const d = event.data as any;
    if (event.channel !== 'log.agent') return;
    if (!d?.agentId || !d?.message) return;
    const level = (['info', 'warn', 'error'].includes(d.level) ? d.level : 'info') as LogLevel;
    const prefix = d.module ? `[${d.module}] ` : '';
    pushEntry(d.agentId, level, `${prefix}${d.message}`, 'broker');
  });
  console.log('[agent-quest] Subscribed to log.* for log forwarding');
}
