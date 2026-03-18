/**
 * ConnectionStatus — Persistent footer status bar with glassmorphism.
 *
 * Displays system connectivity at a glance:
 *  - WebSocket connection state
 *  - SSE Observer state (live agent/network/tool data)
 *  - KĀDI broker health
 *  - Connected agent count
 *
 * Polls /api/health every 30s for broker + watcher status.
 * WebSocket status is reactive via useWebSocket hook.
 */

import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useObserverDirect } from '../hooks/useObserver';
import { apiClient, type HealthResponse } from '../api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServiceHealth {
  kadiBroker: 'connected' | 'disconnected' | 'unknown';
  fileWatcher: 'enabled' | 'disabled' | 'unknown';
  wsClients: number;
  lastChecked: string | null;
}

type StatusLevel = 'ok' | 'warn' | 'error' | 'muted';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEALTH_POLL_INTERVAL = 30_000;

const DOT_COLOR: Record<StatusLevel, string> = {
  ok: 'bg-green',
  warn: 'bg-yellow',
  error: 'bg-red',
  muted: 'bg-text-tertiary',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wsLevel(s: string): StatusLevel {
  if (s === 'connected') return 'ok';
  if (s === 'connecting') return 'warn';
  return 'error';
}

function brokerLevel(s: string): StatusLevel {
  if (s === 'connected') return 'ok';
  if (s === 'unknown') return 'muted';
  return 'error';
}

function watcherLevel(s: string): StatusLevel {
  if (s === 'enabled') return 'ok';
  if (s === 'unknown') return 'muted';
  return 'muted';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConnectionStatus() {
  const { status: wsStatus } = useWebSocket();
  const { status: observerStatus, snapshot } = useObserverDirect();
  const [health, setHealth] = useState<ServiceHealth>({
    kadiBroker: 'unknown',
    fileWatcher: 'unknown',
    wsClients: 0,
    lastChecked: null,
  });

  const pollHealth = useCallback(async () => {
    try {
      const res: HealthResponse = await apiClient.healthCheck();
      setHealth({
        kadiBroker: res.kadiBroker,
        fileWatcher: res.fileWatcher,
        wsClients: res.wsClients,
        lastChecked: res.timestamp,
      });
    } catch {
      setHealth((prev) => ({
        ...prev,
        kadiBroker: 'unknown',
        fileWatcher: 'unknown',
      }));
    }
  }, []);

  useEffect(() => {
    pollHealth();
    const id = setInterval(pollHealth, HEALTH_POLL_INTERVAL);
    return () => clearInterval(id);
  }, [pollHealth]);

  // SSE Observer status
  const sseLevel: StatusLevel = wsLevel(observerStatus);
  const sseLabel = observerStatus === 'connected'
    ? `${snapshot.agents.filter((a) => a.status === 'active').length} agents`
    : observerStatus === 'connecting' ? 'Connecting…' : 'Offline';

  const activeAgents = snapshot.agents.filter((a) => a.status === 'active').length;

  return (
    <footer className="fixed bottom-0 left-0 w-full z-40 bg-bg/80 backdrop-blur-xl backdrop-saturate-[180%] border-t border-border">
      <div className="max-w-[1100px] mx-auto px-8 max-md:px-6 h-10 flex items-center justify-between text-[0.7rem] font-mono">
        {/* Left: service indicators */}
        <div className="flex items-center gap-5">
          <StatusChip
            label="WebSocket"
            level={wsLevel(wsStatus)}
            detail={wsStatus === 'connected' ? 'Live' : wsStatus === 'connecting' ? 'Connecting…' : 'Offline'}
          />
          <StatusChip
            label="Observer"
            level={sseLevel}
            detail={sseLabel}
          />
          <StatusChip
            label="Broker"
            level={brokerLevel(health.kadiBroker)}
            detail={health.kadiBroker === 'connected' ? 'Healthy' : health.kadiBroker === 'unknown' ? 'Unknown' : 'Down'}
          />
          <StatusChip
            label="Watcher"
            level={watcherLevel(health.fileWatcher)}
            detail={health.fileWatcher === 'enabled' ? 'Active' : health.fileWatcher === 'unknown' ? '—' : 'Off'}
          />
        </div>

        {/* Right: meta info */}
        <div className="flex items-center gap-5 text-text-tertiary">
          {activeAgents > 0 && (
            <span>{activeAgents} agent{activeAgents !== 1 ? 's' : ''}</span>
          )}
          <span>{health.wsClients} client{health.wsClients !== 1 ? 's' : ''}</span>
          {health.lastChecked && (
            <span>
              {new Date(health.lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Sub-component
// ---------------------------------------------------------------------------

function StatusChip({
  label,
  level,
  detail,
}: {
  label: string;
  level: StatusLevel;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-1.5 h-1.5 rounded-full ${DOT_COLOR[level]} ${level === 'warn' ? 'animate-pulse' : ''}`} />
      <span className="text-text-tertiary">{label}</span>
      <span className={`${level === 'ok' ? 'text-text-secondary' : level === 'error' ? 'text-red' : 'text-text-tertiary'}`}>
        {detail}
      </span>
    </div>
  );
}
