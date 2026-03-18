/**
 * useObserver — React hooks for observer SSE state.
 *
 * Re-exports context-based hooks from ObserverContext for convenience.
 * Also exports the low-level service hook for components that need
 * direct service access outside the context tree (e.g. ConnectionStatus).
 *
 * Preferred usage (inside ObserverProvider):
 *   import { useObserverContext } from '../contexts/ObserverContext';
 *   const { agents, tools, status } = useObserverContext();
 *
 * Low-level usage (outside provider, e.g. status bar):
 *   import { useObserverDirect } from '../hooks/useObserver';
 *   const { status, snapshot } = useObserverDirect();
 */

import { useState, useEffect } from 'react';
import {
  observerService,
  type ObserverConnectionStatus,
  type ObserverSnapshot,
} from '../services/ObserverService';

// Re-export context hooks for convenience
export {
  useObserverContext,
  useObserverAgents,
  useActiveAgents,
  useObserverNetworks,
  useObserverTools,
  useObserverStatus,
} from '../contexts/ObserverContext';

// Re-export types
export type { ObserverState, ToolEntry } from '../contexts/ObserverContext';

/**
 * Low-level hook that subscribes directly to the ObserverService singleton.
 * Use this for components outside the ObserverProvider tree (e.g. ConnectionStatus).
 */
export function useObserverDirect(): {
  status: ObserverConnectionStatus;
  snapshot: ObserverSnapshot;
} {
  const [status, setStatus] = useState<ObserverConnectionStatus>(observerService.status);
  const [snapshot, setSnapshot] = useState<ObserverSnapshot>(observerService.snapshot);

  useEffect(() => {
    const unsubStatus = observerService.onStatusChange(setStatus);
    const unsubSnapshot = observerService.onSnapshot(setSnapshot);

    setStatus(observerService.status);
    setSnapshot(observerService.snapshot);

    return () => {
      unsubStatus();
      unsubSnapshot();
    };
  }, []);

  return { status, snapshot };
}

/**
 * @deprecated Use useObserverContext() inside ObserverProvider,
 * or useObserverDirect() outside it.
 */
export function useObserver(): {
  status: ObserverConnectionStatus;
  snapshot: ObserverSnapshot;
} {
  return useObserverDirect();
}
