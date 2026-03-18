/**
 * AgentDetailCard — Rich agent information display.
 *
 * Shows agent name, role, status, connected networks, tool count,
 * and an expandable tool list with per-tool network scoping.
 *
 * Uses Card, StatusDot, Badge primitives from the design system.
 */

import { useState, useMemo } from 'react';
import type { ObserverAgent } from '../services/ObserverService';
import { useObserverTools, type ToolEntry } from '../contexts/ObserverContext';
import { Card } from './ui/Card';
import { StatusDot } from './ui/StatusDot';
import { Badge } from './ui/Badge';
import { AgentActivityFeed } from './AgentActivityFeed';

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

const STATUS_MAP = {
  active: { label: 'Online', color: 'green' as const, pulse: true },
  disconnected: { label: 'Offline', color: 'red' as const, pulse: false },
} satisfies Record<ObserverAgent['status'], { label: string; color: 'green' | 'red'; pulse: boolean }>;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AgentDetailCardProps {
  agent: ObserverAgent;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentDetailCard({ agent, className = '' }: AgentDetailCardProps) {
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const allTools = useObserverTools();

  const status = STATUS_MAP[agent.status];

  // Resolve per-tool network scoping — prefer tool-level networks, fallback to agent networks
  const agentTools = useMemo(() => {
    const toolMap = new Map<string, ToolEntry>();
    for (const t of allTools) {
      toolMap.set(t.name, t);
    }
    return agent.tools.map((tool) => ({
      name: tool.name,
      networks: tool.networks.length > 0
        ? tool.networks
        : (toolMap.get(tool.name)?.networks ?? agent.networks),
    }));
  }, [agent.tools, agent.networks, allTools]);

  return (
    <Card
      variant="elevated"
      hoverGradient
      padding="md"
      className={`group ${className}`}
    >
      {/* Header: Name + Status */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-medium tracking-tight text-text-primary truncate">
            {agent.name}
          </h3>
          <span className="font-mono text-[0.65rem] tracking-[0.08em] uppercase text-text-tertiary">
            {agent.type}
          </span>
        </div>
        <Badge
          dot={status.color === 'green' ? 'bg-green' : 'bg-red'}
          pulse={status.pulse}
        >
          {status.label}
        </Badge>
      </div>

      {/* Networks */}
      {agent.networks.length > 0 && (
        <div className="mb-4 pb-4 border-b border-border">
          <p className="font-mono text-[0.6rem] tracking-[0.1em] uppercase text-text-tertiary mb-2">
            Networks
          </p>
          <div className="flex flex-wrap gap-1.5">
            {agent.networks.map((net) => (
              <Badge key={net} dot="bg-blue">
                {net}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Tool count + expand toggle */}
      <button
        type="button"
        onClick={() => setToolsExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-sm cursor-pointer group/tools"
      >
        <span className="text-text-secondary font-light">Tools</span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-text-primary">
            {agent.tools.length}
          </span>
          <svg
            className={`w-3.5 h-3.5 text-text-tertiary transition-transform duration-200 ${
              toolsExpanded ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {/* Expandable tool list */}
      {toolsExpanded && agentTools.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border space-y-2 animate-in">
          {agentTools.map(({ name, networks }) => (
            <div
              key={name}
              className="flex items-center justify-between gap-2 py-1"
            >
              <span className="font-mono text-[0.7rem] text-text-secondary truncate">
                {name}
              </span>
              <div className="flex gap-1 shrink-0">
                {networks.map((net) => (
                  <span
                    key={net}
                    className="font-mono text-[0.55rem] text-text-tertiary bg-bg border border-border px-1.5 py-0.5 rounded"
                  >
                    {net}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Activity feed — collapsible */}
      <div className="mt-4 pt-4 border-t border-border">
        <button
          type="button"
          onClick={() => setActivityExpanded((v) => !v)}
          className="w-full flex items-center justify-between text-sm cursor-pointer"
        >
          <span className="font-mono text-[0.6rem] tracking-[0.1em] uppercase text-text-tertiary">
            Activity
          </span>
          <svg
            className={`w-3.5 h-3.5 text-text-tertiary transition-transform duration-200 ${
              activityExpanded ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {activityExpanded && (
          <div className="mt-2">
            <AgentActivityFeed agentId={agent.id} />
          </div>
        )}
      </div>

      {/* Agent ID */}
      <div className="mt-4 font-mono text-[0.6rem] tracking-wide text-text-tertiary">
        {agent.id.length > 12 ? agent.id.slice(0, 12) : agent.id}
      </div>
    </Card>
  );
}
