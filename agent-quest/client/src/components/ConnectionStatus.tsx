/**
 * ConnectionStatus — Persistent indicator showing system connectivity.
 *
 * Displays:
 * - WebSocket connection state (connected / connecting / disconnected)
 * - KĀDI broker status (connected / disconnected)
 * - File watcher status (enabled / disabled)
 *
 * Polls the /api/health endpoint every 30s for broker + watcher status.
 * WebSocket status is reactive via the useWebSocket hook.
 */

import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { apiClient, type HealthResponse } from '../api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServiceStatus {
  kadiBroker: 'connected' | 'disconnected' | 'unknown';
  fileWatcher: 'enabled' | 'disabled' | 'unknown';
  lastChecked: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Health poll interval (ms). */
const HEALTH_POLL_INTERVAL = 30_000;

// ---------------------------------------------------------------------------
// Status indicator dot colors
// ---------------------------------------------------------------------------

const DOT_COLORS = {
  connected: 'bg-green-500',
  connecting: 'bg-yellow-500 animate-pulse',
  disconnected: 'bg-red-500',
  enabled: 'bg-green-500',
  disabled: 'bg-gray-400',
  unknown: 'bg-gray-400',
} as const;

const STATUS_LABELS = {
  connected: 'Connected',
  connecting: 'Connecting…',
  disconnected: 'Disconnected',
  enabled: 'Active',
  disabled: 'Disabled',
  unknown: 'Unknown',
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConnectionStatus() {
  const { status: wsStatus } = useWebSocket();
  const [services, setServices] = useState<ServiceStatus>({
    kadiBroker: 'unknown',
    fileWatcher: 'unknown',
    lastChecked: null,
  });
  const [expanded, setExpanded] = useState(false);

  // -----------------------------------------------------------------------
  // Health polling
  // -----------------------------------------------------------------------

  const pollHealth = useCallback(async () => {
    try {
      const health: HealthResponse = await apiClient.healthCheck();
      setServices({
        kadiBroker: health.kadiBroker,
        fileWatcher: health.fileWatcher,
        lastChecked: health.timestamp,
      });
    } catch {
      setServices((prev) => ({
        ...prev,
        kadiBroker: 'unknown',
        fileWatcher: 'unknown',
      }));
    }
  }, []);

  useEffect(() => {
    pollHealth();
    const interval = setInterval(pollHealth, HEALTH_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [pollHealth]);

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------

  /** Overall health: green if WS + broker both connected, yellow if partial, red if both down. */
  const overallStatus: 'healthy' | 'degraded' | 'down' = (() => {
    const wsOk = wsStatus === 'connected';
    const brokerOk = services.kadiBroker === 'connected';
    if (wsOk && brokerOk) return 'healthy';
    if (wsOk || brokerOk) return 'degraded';
    return 'down';
  })();

  const overallDot =
    overallStatus === 'healthy'
      ? 'bg-green-500'
      : overallStatus === 'degraded'
      ? 'bg-yellow-500'
      : 'bg-red-500';

  const overallLabel =
    overallStatus === 'healthy'
      ? 'All Systems OK'
      : overallStatus === 'degraded'
      ? 'Partial Connectivity'
      : 'Systems Down';

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="relative">
      {/* Compact indicator (always visible) */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
        title={overallLabel}
      >
        <span className={`w-2 h-2 rounded-full ${overallDot}`} />
        <span className="hidden sm:inline">{overallLabel}</span>
      </button>

      {/* Expanded dropdown */}
      {expanded && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setExpanded(false)}
          />

          {/* Dropdown panel */}
          <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-lg shadow-lg border border-gray-200 z-50 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              System Status
            </h3>

            {/* WebSocket */}
            <StatusRow
              label="WebSocket"
              status={wsStatus}
              dotColor={DOT_COLORS[wsStatus]}
              statusLabel={STATUS_LABELS[wsStatus]}
            />

            {/* KĀDI Broker */}
            <StatusRow
              label="KĀDI Broker"
              status={services.kadiBroker}
              dotColor={DOT_COLORS[services.kadiBroker]}
              statusLabel={STATUS_LABELS[services.kadiBroker]}
            />

            {/* File Watcher */}
            <StatusRow
              label="File Watcher"
              status={services.fileWatcher}
              dotColor={DOT_COLORS[services.fileWatcher]}
              statusLabel={STATUS_LABELS[services.fileWatcher]}
            />

            {/* Last checked */}
            {services.lastChecked && (
              <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400">
                Last checked:{' '}
                {new Date(services.lastChecked).toLocaleTimeString()}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusRow({
  label,
  dotColor,
  statusLabel,
}: {
  label: string;
  status: string;
  dotColor: string;
  statusLabel: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-gray-700">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        <span className="text-xs text-gray-500">{statusLabel}</span>
      </div>
    </div>
  );
}
