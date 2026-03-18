/**
 * Broker Event Bridge
 *
 * Subscribes to quest.* and task.* events on the KĀDI broker and forwards
 * them to the WebSocket broadcast system so the React frontend receives
 * real-time updates without polling.
 */

import type { KadiClient, BrokerEvent } from '@kadi.build/core';
import { broadcastEvent, type WsEventName } from './websocket.js';

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
    });

    console.log(`[agent-quest] Subscribed to broker pattern: ${pattern}`);
  }
}
