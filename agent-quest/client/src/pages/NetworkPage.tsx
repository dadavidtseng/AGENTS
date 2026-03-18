/**
 * NetworkPage — Visual network topology view.
 *
 * Shows D3 force-directed graph of agents and networks from ObserverContext.
 * Real-time updates as agents connect/disconnect.
 * Supports multi-broker filtering and fullscreen mode.
 */

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useObserverContext } from '../contexts/ObserverContext';
import { NetworkGraph } from '../components/NetworkGraph';

// ---------------------------------------------------------------------------
// Fullscreen hook
// ---------------------------------------------------------------------------

function useFullscreen(ref: React.RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const enter = useCallback(() => {
    ref.current?.requestFullscreen?.().catch(() => {});
  }, [ref]);

  const exit = useCallback(() => {
    document.exitFullscreen?.().catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    isFullscreen ? exit() : enter();
  }, [isFullscreen, enter, exit]);

  return { isFullscreen, toggle };
}

// ---------------------------------------------------------------------------
// Icons (inline SVG — no extra dependencies)
// ---------------------------------------------------------------------------

function ExpandIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="10 2 14 2 14 6" />
      <polyline points="6 14 2 14 2 10" />
      <line x1="14" y1="2" x2="9.5" y2="6.5" />
      <line x1="2" y1="14" x2="6.5" y2="9.5" />
    </svg>
  );
}

function CompressIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 10 0 14" />
      <polyline points="12 6 16 2" />
      <polyline points="10 6 14 6 14 2" />
      <polyline points="6 10 2 10 2 14" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// NetworkPage
// ---------------------------------------------------------------------------

export function NetworkPage() {
  const { agents, networks, status } = useObserverContext();
  const [selectedBroker, setSelectedBroker] = useState<string>('all');
  const containerRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(containerRef);

  // Extract unique broker names from agents
  const brokerNames = useMemo(() => {
    const names = new Set<string>();
    for (const agent of agents) {
      if (agent.brokerNames && agent.brokerNames.length > 0) {
        for (const name of agent.brokerNames) {
          names.add(name);
        }
      } else if (agent.brokerName) {
        names.add(agent.brokerName);
      }
    }
    return ['all', ...Array.from(names).sort()];
  }, [agents]);

  // Filter agents by selected broker
  const filteredAgents = useMemo(() => {
    if (selectedBroker === 'all') return agents;
    return agents
      .filter((agent) => {
        if (agent.brokerNames && agent.brokerNames.length > 0) {
          return agent.brokerNames.includes(selectedBroker);
        }
        return agent.brokerName === selectedBroker;
      })
      .map((agent) => {
        // Scope networks to only those from the selected broker
        const brokerNets = agent.brokerNetworkMap?.[selectedBroker];
        if (brokerNets) {
          return { ...agent, networks: brokerNets };
        }
        return agent;
      });
  }, [agents, selectedBroker]);

  // Filter networks by agents in selected broker
  const filteredNetworks = useMemo(() => {
    if (selectedBroker === 'all') return networks;
    // Use per-broker network map to get only networks from the selected broker
    const networkNames = new Set<string>();
    for (const agent of filteredAgents) {
      const brokerNets = agent.brokerNetworkMap?.[selectedBroker];
      if (brokerNets) {
        for (const n of brokerNets) networkNames.add(n);
      } else {
        // Fallback: use agent.networks if no brokerNetworkMap
        for (const n of agent.networks) networkNames.add(n);
      }
    }
    return networks.filter((network) => networkNames.has(network.name));
  }, [networks, filteredAgents, selectedBroker]);

  const filteredAgentCount = filteredAgents.filter((a) => a.status === 'active').length;
  const filteredNetworkCount = filteredNetworks.length;

  return (
    <div
      ref={containerRef}
      className={isFullscreen ? 'w-screen h-screen bg-bg-primary' : 'h-[calc(100vh-8rem)]'}
    >
      {/* Header — compact bar in fullscreen, full header otherwise */}
      {isFullscreen ? (
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-2 bg-bg-primary/80 backdrop-blur-sm border-b border-border/50">
          <div className="flex items-center gap-4 text-sm text-text-tertiary">
            {brokerNames.length > 1 && (
              <select
                value={selectedBroker}
                onChange={(e) => setSelectedBroker(e.target.value)}
                className="px-3 py-1 rounded-lg border border-border bg-bg-elevated/40 text-sm text-text-secondary focus:outline-none focus:border-blue/40 transition-colors cursor-pointer"
              >
                {brokerNames.map((name) => (
                  <option key={name} value={name}>
                    {name === 'all' ? 'All Brokers' : `Broker: ${name}`}
                  </option>
                ))}
              </select>
            )}
            <span className="font-mono">{filteredAgentCount} agent{filteredAgentCount !== 1 ? 's' : ''}</span>
            <span className="font-mono">{filteredNetworkCount} network{filteredNetworkCount !== 1 ? 's' : ''}</span>
            <span className={`inline-flex items-center gap-1.5 ${
              status === 'connected' ? 'text-green' : 'text-text-tertiary'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                status === 'connected' ? 'bg-green animate-pulse-dot' : 'bg-text-tertiary'
              }`} />
              {status}
            </span>
          </div>
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated/60 transition-colors"
            aria-label="Exit fullscreen"
            title="Exit fullscreen (ESC)"
          >
            <CompressIcon />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-text-primary">Network</h1>
            <p className="text-sm text-text-tertiary mt-0.5">
              KADI network topology — agents, networks, and connections
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm text-text-tertiary">
            {brokerNames.length > 1 && (
              <select
                value={selectedBroker}
                onChange={(e) => setSelectedBroker(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-border bg-bg-elevated/40 text-sm text-text-secondary focus:outline-none focus:border-blue/40 transition-colors cursor-pointer"
              >
                {brokerNames.map((name) => (
                  <option key={name} value={name}>
                    {name === 'all' ? 'All Brokers' : `Broker: ${name}`}
                  </option>
                ))}
              </select>
            )}
            <span className="font-mono">{filteredAgentCount} agent{filteredAgentCount !== 1 ? 's' : ''}</span>
            <span className="font-mono">{filteredNetworkCount} network{filteredNetworkCount !== 1 ? 's' : ''}</span>
            <span className={`inline-flex items-center gap-1.5 ${
              status === 'connected' ? 'text-green' : 'text-text-tertiary'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                status === 'connected' ? 'bg-green animate-pulse-dot' : 'bg-text-tertiary'
              }`} />
              {status}
            </span>
            <button
              onClick={toggleFullscreen}
              className="p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated/60 transition-colors"
              aria-label="Enter fullscreen"
              title="Fullscreen"
            >
              <ExpandIcon />
            </button>
          </div>
        </div>
      )}

      {/* Graph */}
      <div className={
        isFullscreen
          ? 'w-full h-full'
          : 'rounded-xl border border-border bg-bg-card overflow-hidden h-[calc(100%-4rem)]'
      }>
        <NetworkGraph agents={filteredAgents} networks={filteredNetworks} />
      </div>
    </div>
  );
}
