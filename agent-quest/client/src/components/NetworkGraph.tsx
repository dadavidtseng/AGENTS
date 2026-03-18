/**
 * NetworkGraph — D3 force-directed graph of KĀDI network topology.
 *
 * Node kinds: agent (circle), mcp-client (rounded-rect), mcp-server (diamond), network (hexagon).
 * Features: zoom/pan, click-to-select detail panel, floating legend, smart labels.
 * D3 handles simulation + zoom; React renders SVG.
 */

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import type { ObserverAgent, ObserverNetwork } from '../services/ObserverService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NodeKind = 'agent' | 'mcp-client' | 'mcp-server' | 'network';

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  /** Short display label inside the node shape */
  shortLabel: string;
  kind: NodeKind;
  status: string;
  toolCount?: number;
  networks?: string[];
  /** Brokers this node is connected to (multi-broker support) */
  brokerNames?: string[];
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  id: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KIND_META: Record<NodeKind, { shape: string; hue: number; label: string }> = {
  agent:        { shape: 'circle',       hue: 210, label: 'Agent' },
  'mcp-client': { shape: 'rounded-rect', hue: 160, label: 'MCP Client' },
  'mcp-server': { shape: 'diamond',      hue: 30,  label: 'MCP Server' },
  network:      { shape: 'hexagon',      hue: 270, label: 'Network' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic hue from string (for per-node color variation). */
function hashHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

/** Hexagon points for a given radius centered at 0,0. */
function hexPoints(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    pts.push(`${r * Math.cos(angle)},${r * Math.sin(angle)}`);
  }
  return pts.join(' ');
}

/** Diamond points for a given radius. */
function diamondPoints(r: number): string {
  return `0,${-r} ${r},0 0,${r} ${-r},0`;
}

/** Infer NodeKind from agent type or name. */
function inferKind(agent: ObserverAgent): NodeKind {
  const t = agent.type?.toLowerCase() ?? '';
  if (t.includes('mcp-client') || t.includes('mcp_client')) return 'mcp-client';
  if (t.includes('mcp-server') || t.includes('mcp_server')) return 'mcp-server';
  if (t === 'agent' || t === '') {
    // Fallback: infer from name
    const n = agent.name.toLowerCase();
    if (n.startsWith('mcp-client') || n.startsWith('mcp_client')) return 'mcp-client';
    if (n.startsWith('mcp-server') || n.startsWith('mcp_server')) return 'mcp-server';
  }
  return 'agent';
}

/** Strip common prefixes to get a meaningful short label. */
function shortLabel(name: string, kind: NodeKind): string {
  let clean = name;
  if (kind === 'mcp-client') clean = name.replace(/^mcp[-_]client[-_]/i, '');
  else if (kind === 'mcp-server') clean = name.replace(/^mcp[-_]server[-_]/i, '');
  else if (kind === 'network') clean = name; // keep as-is
  else clean = name.replace(/^agent[-_]/i, '');
  // Capitalize first letter, no truncation — let the shape accommodate
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function buildGraph(
  agents: ObserverAgent[],
  networks: ObserverNetwork[],
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const nodeIds = new Set<string>();

  // Network nodes
  for (const net of networks) {
    if (!nodeIds.has(net.id)) {
      nodes.push({
        id: net.id,
        label: net.name,
        shortLabel: shortLabel(net.name, 'network'),
        kind: 'network',
        status: net.status,
      });
      nodeIds.add(net.id);
    }
  }

  // Agent/MCP nodes + links to their networks
  for (const agent of agents) {
    if (!nodeIds.has(agent.id)) {
      const kind = inferKind(agent);
      nodes.push({
        id: agent.id,
        label: agent.name,
        shortLabel: shortLabel(agent.name, kind),
        kind,
        status: agent.status,
        toolCount: agent.tools.length,
        networks: agent.networks,
        brokerNames: agent.brokerNames,
      });
      nodeIds.add(agent.id);
    }

    for (const netId of agent.networks) {
      if (!nodeIds.has(netId)) {
        nodes.push({
          id: netId,
          label: netId,
          shortLabel: shortLabel(netId, 'network'),
          kind: 'network',
          status: 'active',
        });
        nodeIds.add(netId);
      }
      links.push({ id: `${agent.id}-${netId}`, source: agent.id, target: netId });
    }
  }

  return { nodes, links };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface NetworkGraphProps {
  agents: ObserverAgent[];
  networks: ObserverNetwork[];
  className?: string;
}

export function NetworkGraph({ agents, networks, className = '' }: NetworkGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const simRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);

  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [transform, setTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity);

  // Responsive sizing
  useEffect(() => {
    const container = svgRef.current?.parentElement;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width: Math.max(width, 300), height: Math.max(height, 300) });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Build graph data from observer state
  const graph = useMemo(() => buildGraph(agents, networks), [agents, networks]);

  // D3 zoom
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => setTransform(event.transform));
    svg.call(zoom);
    return () => { svg.on('.zoom', null); };
  }, []);

  // Run D3 force simulation
  useEffect(() => {
    const { width, height } = dimensions;

    // Reuse existing positions
    const prevMap = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      if (n.x !== undefined && n.y !== undefined) prevMap.set(n.id, { x: n.x, y: n.y });
    }

    const simNodes = graph.nodes.map((n) => {
      const prev = prevMap.get(n.id);
      return {
        ...n,
        x: prev?.x ?? width / 2 + (Math.random() - 0.5) * 100,
        y: prev?.y ?? height / 2 + (Math.random() - 0.5) * 100,
      };
    });
    const simLinks = graph.links.map((l) => ({ ...l }));

    simRef.current?.stop();

    const sim = d3.forceSimulation<GraphNode>(simNodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(simLinks).id((d) => d.id).distance(180).strength(0.6))
      .force('charge', d3.forceManyBody().strength(-500))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(55))
      .alphaDecay(0.02)
      .on('tick', () => {
        setNodes([...simNodes]);
        setLinks([...simLinks]);
      });

    simRef.current = sim;
    return () => { sim.stop(); };
  }, [graph, dimensions]);

  // Click handler — select node (no navigation)
  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode((prev) => (prev?.id === node.id ? null : node));
  }, []);

  // Drag handlers
  const dragRef = useRef<{ nodeId: string; sim: d3.Simulation<GraphNode, GraphLink> } | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent, node: GraphNode) => {
    e.preventDefault();
    e.stopPropagation();
    if (!simRef.current) return;
    dragRef.current = { nodeId: node.id, sim: simRef.current };
    simRef.current.alphaTarget(0.3).restart();
    const n = nodes.find((nd) => nd.id === node.id);
    if (n) { n.fx = n.x; n.fy = n.y; }
  }, [nodes]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      // Account for zoom transform
      const x = (e.clientX - rect.left - transform.x) / transform.k;
      const y = (e.clientY - rect.top - transform.y) / transform.k;
      const n = nodes.find((nd) => nd.id === dragRef.current!.nodeId);
      if (n) { n.fx = x; n.fy = y; }
    };
    const onMouseUp = () => {
      if (!dragRef.current) return;
      dragRef.current.sim.alphaTarget(0);
      const n = nodes.find((nd) => nd.id === dragRef.current!.nodeId);
      if (n) { n.fx = null; n.fy = null; }
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [nodes, transform]);

  const { width, height } = dimensions;

  return (
    <div className={`relative w-full h-full min-h-[400px] ${className}`}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="w-full h-full"
        viewBox={`0 0 ${width} ${height}`}
      >
        <g ref={gRef} transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {/* Links */}
          {links.map((link) => {
            const s = link.source as GraphNode;
            const t = link.target as GraphNode;
            if (!s.x || !s.y || !t.x || !t.y) return null;
            const isHovered = hoveredId === s.id || hoveredId === t.id;
            const isSelected = selectedNode?.id === s.id || selectedNode?.id === t.id;
            return (
              <line
                key={link.id}
                x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                stroke={isSelected ? 'rgba(96,165,250,0.7)' : isHovered ? 'rgba(96,165,250,0.4)' : 'rgba(255,255,255,0.08)'}
                strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 1}
                className="transition-all duration-200"
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            if (node.x === undefined || node.y === undefined) return null;
            const isHovered = hoveredId === node.id;
            const isSelected = selectedNode?.id === node.id;
            const isActive = node.status === 'active';
            const meta = KIND_META[node.kind];
            // All nodes of the same kind share the same hue for visual consistency.
            const hue = meta.hue;

            return (
              <g
                key={node.id}
                transform={`translate(${node.x},${node.y})`}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() => setHoveredId(null)}
                onMouseDown={(e) => onMouseDown(e, node)}
                onClick={() => handleNodeClick(node)}
                tabIndex={0}
                role="button"
                aria-label={`${meta.label}: ${node.label}`}
                onKeyDown={(e) => { if (e.key === 'Enter') handleNodeClick(node); }}
              >
                <NodeShape
                  kind={node.kind}
                  hue={hue}
                  isActive={isActive}
                  isHovered={isHovered}
                  isSelected={isSelected}
                />

                {/* Inner label */}
                <text
                  textAnchor="middle"
                  dy="0.35em"
                  className="text-[0.5rem] font-semibold fill-text-primary pointer-events-none select-none"
                >
                  {node.shortLabel}
                </text>

                {/* Hover label below */}
                {(isHovered || isSelected) && (
                  <text
                    textAnchor="middle"
                    y={node.kind === 'network' ? 46 : node.kind === 'mcp-server' ? 42 : 40}
                    className="text-[0.6rem] fill-text-secondary pointer-events-none select-none"
                  >
                    {node.label}
                    {node.toolCount ? ` (${node.toolCount} tools)` : ''}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Legend */}
      <Legend kinds={useMemo(() => [...new Set(nodes.map((n) => n.kind))], [nodes])} />

      {/* Detail panel */}
      {selectedNode && (
        <DetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
      )}

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-text-tertiary text-sm">No agents or networks connected</p>
        </div>
      )}

      {/* Zoom hint */}
      {nodes.length > 0 && (
        <div className="absolute bottom-3 left-3 text-[0.6rem] text-text-tertiary select-none">
          Scroll to zoom · Drag to pan
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NodeShape — renders the correct SVG shape per kind
// ---------------------------------------------------------------------------

function NodeShape({
  kind, hue, isActive, isHovered, isSelected,
}: {
  kind: NodeKind; hue: number; isActive: boolean; isHovered: boolean; isSelected: boolean;
}) {
  const fill = isActive ? `hsla(${hue}, 45%, 25%, 0.7)` : 'rgba(255,255,255,0.05)';
  const stroke = isSelected
    ? `hsla(${hue}, 70%, 60%, 0.9)`
    : isActive ? `hsla(${hue}, 55%, 50%, 0.5)` : 'rgba(255,255,255,0.1)';
  const sw = isSelected ? 2.5 : isHovered ? 2 : 1;

  switch (kind) {
    case 'network':
      return (
        <polygon
          points={hexPoints(isHovered ? 36 : 32)}
          fill={fill} stroke={stroke} strokeWidth={sw}
          className="transition-all duration-200"
        />
      );

    case 'mcp-client':
      return (
        <rect
          x={isHovered ? -36 : -32} y={isHovered ? -20 : -17}
          width={isHovered ? 72 : 64} height={isHovered ? 40 : 34}
          rx={6} fill={fill} stroke={stroke} strokeWidth={sw}
          className="transition-all duration-200"
        />
      );

    case 'mcp-server':
      return (
        <polygon
          points={diamondPoints(isHovered ? 32 : 28)}
          fill={fill} stroke={stroke} strokeWidth={sw}
          className="transition-all duration-200"
        />
      );

    default: // agent
      return (
        <>
          <circle
            r={isHovered ? 28 : 24}
            fill={fill} stroke={stroke} strokeWidth={sw}
            className="transition-all duration-200"
          />
          {isActive && (
            <circle
              r={24} fill="none"
              stroke={`hsla(${hue}, 55%, 50%, 0.3)`}
              strokeWidth={1}
              className="animate-ping"
              style={{ animationDuration: '3s' }}
            />
          )}
        </>
      );
  }
}

// ---------------------------------------------------------------------------
// Legend — floating bottom-right
// ---------------------------------------------------------------------------

function Legend({ kinds }: { kinds: NodeKind[] }) {
  if (kinds.length === 0) return null;

  return (
    <div className="absolute top-3 right-3 bg-bg-card/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2 flex flex-col gap-1.5">
      {kinds.map((kind) => {
        const meta = KIND_META[kind];
        return (
          <div key={kind} className="flex items-center gap-2 text-[0.65rem] text-text-secondary">
            <LegendIcon kind={kind} hue={meta.hue} />
            <span>{meta.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function LegendIcon({ kind, hue }: { kind: NodeKind; hue: number }) {
  const fill = `hsla(${hue}, 45%, 35%, 0.7)`;
  const stroke = `hsla(${hue}, 55%, 50%, 0.6)`;
  const size = 14;

  return (
    <svg width={size} height={size} viewBox="-8 -8 16 16">
      {kind === 'network' && <polygon points={hexPoints(7)} fill={fill} stroke={stroke} strokeWidth={1} />}
      {kind === 'mcp-client' && <rect x={-7} y={-5} width={14} height={10} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />}
      {kind === 'mcp-server' && <polygon points={diamondPoints(7)} fill={fill} stroke={stroke} strokeWidth={1} />}
      {kind === 'agent' && <circle r={6} fill={fill} stroke={stroke} strokeWidth={1} />}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// DetailPanel — shows info about the selected node
// ---------------------------------------------------------------------------

function DetailPanel({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  const meta = KIND_META[node.kind];

  return (
    <div className="absolute top-3 left-3 w-64 bg-bg-card/95 backdrop-blur-sm border border-border rounded-xl p-4 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[0.65rem] uppercase tracking-widest text-text-tertiary">
          {meta.label}
        </span>
        <button
          onClick={onClose}
          className="w-5 h-5 flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary text-xs"
          aria-label="Close detail"
        >
          ✕
        </button>
      </div>

      <h3 className="text-sm font-medium text-text-primary truncate mb-2">
        {node.label}
      </h3>

      <div className="space-y-1.5 text-xs text-text-secondary">
        <div className="flex justify-between">
          <span>Status</span>
          <span className={node.status === 'active' ? 'text-green' : 'text-text-tertiary'}>
            {node.status}
          </span>
        </div>

        {node.toolCount !== undefined && (
          <div className="flex justify-between">
            <span>Tools</span>
            <span className="font-mono">{node.toolCount}</span>
          </div>
        )}

        {node.networks && node.networks.length > 0 && (
          <div>
            <span className="block mb-1">Networks</span>
            <div className="flex flex-wrap gap-1">
              {node.networks.map((n) => (
                <span key={n} className="px-1.5 py-0.5 rounded bg-bg-elevated text-[0.6rem] text-text-tertiary">
                  {n}
                </span>
              ))}
            </div>
          </div>
        )}

        {node.brokerNames && node.brokerNames.length > 0 && (
          <div>
            <span className="block mb-1">Brokers</span>
            <div className="flex flex-wrap gap-1">
              {node.brokerNames.map((b) => (
                <span key={b} className="px-1.5 py-0.5 rounded bg-blue/10 text-[0.6rem] text-blue">
                  {b}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-between">
          <span>ID</span>
          <span className="font-mono text-text-tertiary truncate ml-2 max-w-[140px]">
            {node.id}
          </span>
        </div>
      </div>
    </div>
  );
}
