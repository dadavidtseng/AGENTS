import { useEffect, useRef, useState, useCallback } from 'react';
import {
  wsService,
  type WsEventName,
  type WsEventHandler,
  type ConnectionStatus,
} from '../services/WebSocketService.js';

/**
 * React hook for subscribing to WebSocket events.
 *
 * Automatically connects on mount and disconnects on unmount (if this is the
 * last component using the hook). Subscriptions are cleaned up on unmount.
 *
 * @example
 * ```tsx
 * function QuestList() {
 *   const { status } = useWebSocket();
 *
 *   useWsEvent('quest.created', (data) => {
 *     console.log('New quest:', data);
 *   });
 *
 *   return <div>WS: {status}</div>;
 * }
 * ```
 */

/** Track how many components are using the WebSocket connection. */
let activeConsumers = 0;

/**
 * Connect to the WebSocket server and track connection status.
 * Manages the shared connection lifecycle across components.
 */
export function useWebSocket(): { status: ConnectionStatus } {
  const [status, setStatus] = useState<ConnectionStatus>(wsService.status);

  useEffect(() => {
    activeConsumers++;
    if (activeConsumers === 1) {
      wsService.connect();
    }

    const unsubStatus = wsService.onStatusChange(setStatus);

    return () => {
      unsubStatus();
      activeConsumers--;
      if (activeConsumers === 0) {
        wsService.disconnect();
      }
    };
  }, []);

  return { status };
}

/**
 * Subscribe to a specific WebSocket event. The handler is automatically
 * cleaned up when the component unmounts.
 *
 * @param event - The event name to subscribe to.
 * @param handler - Callback invoked with the event data.
 */
export function useWsEvent(event: WsEventName | string, handler: WsEventHandler): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const stableHandler = useCallback<WsEventHandler>(
    (data, message) => handlerRef.current(data, message),
    [],
  );

  useEffect(() => {
    const unsub = wsService.subscribe(event, stableHandler);
    return unsub;
  }, [event, stableHandler]);
}
