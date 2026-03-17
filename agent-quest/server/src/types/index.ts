/** Server-side type definitions */

export interface QuestDTO {
  id: string;
  title: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDTO {
  id: string;
  questId: string;
  title: string;
  description: string;
  status: string;
  assignedTo?: string;
  agentRole?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalDTO {
  id: string;
  title: string;
  description: string;
  status: string;
  requestedBy: string;
  respondedBy?: string;
  response?: string;
  createdAt: string;
  respondedAt?: string;
}

/**
 * Re-export WebSocket types from websocket module for convenience.
 * Route handlers should import `broadcastEvent` from '../websocket.js'
 * and use `WsEventName` for type-safe event names.
 */
export type { WsEventName, WsMessage } from '../websocket.js';

export interface WebSocketEvent {
  event: string;
  data: unknown;
  timestamp: string;
}
