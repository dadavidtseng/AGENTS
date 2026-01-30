/**
 * WebSocket hook for real-time updates
 */

import { useEffect, useRef, useState } from 'react';

export function useWebSocket(url: string) {
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<any>(null);

  useEffect(() => {
    ws.current = new WebSocket(url);

    ws.current.onopen = () => {
      setIsConnected(true);
      console.log('[WebSocket] Connected');
    };

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setLastMessage(data);
      console.log('[WebSocket] Message:', data);
    };

    ws.current.onclose = () => {
      setIsConnected(false);
      console.log('[WebSocket] Disconnected');
    };

    ws.current.onerror = (error) => {
      console.error('[WebSocket] Error:', error);
    };

    return () => {
      ws.current?.close();
    };
  }, [url]);

  return { isConnected, lastMessage };
}
