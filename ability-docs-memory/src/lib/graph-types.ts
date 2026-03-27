/**
 * Local type definitions and convenience constants from graph-ability.
 *
 * Inlined so this ability compiles without an npm dependency on graph-ability.
 * At runtime, graph-ability is loaded as a kadi ability (via loadNative).
 */

// ── Schema Registry Types ─────────────────────────────────────────────

export interface SchemaDefinition {
  name: string;
  database?: string;
  vertexTypes: VertexTypeDef[];
  edgeTypes: EdgeTypeDef[];
  entityTypes?: string[];
}

export interface VertexTypeDef {
  name: string;
  properties: Record<string, string>;
  indexes?: IndexDef[];
}

export interface EdgeTypeDef {
  name: string;
  properties?: Record<string, string>;
}

export interface IndexDef {
  property: string;
  type: 'UNIQUE' | 'NOTUNIQUE' | 'FULL_TEXT';
}

// ── Signal System Types ───────────────────────────────────────────────

export interface SignalAbilities {
  invoke<T = unknown>(tool: string, params: Record<string, unknown>): Promise<T>;
}

// ── Convenience Constants ─────────────────────────────────────────────

export const TOPIC_VERTEX: VertexTypeDef = {
  name: 'Topic',
  properties: {
    name: 'STRING',
    description: 'STRING',
    firstSeen: 'DATETIME',
    lastSeen: 'DATETIME',
    frequency: 'INTEGER',
  },
  indexes: [{ property: 'name', type: 'UNIQUE' }],
};

export const ENTITY_VERTEX: VertexTypeDef = {
  name: 'Entity',
  properties: {
    name: 'STRING',
    type: 'STRING',
    description: 'STRING',
    firstSeen: 'DATETIME',
    lastSeen: 'DATETIME',
  },
  indexes: [{ property: 'name,type', type: 'UNIQUE' }],
};

export const COMMON_EDGE_TYPES: EdgeTypeDef[] = [
  { name: 'HasTopic', properties: { weight: 'DOUBLE' } },
  { name: 'Mentions', properties: { context: 'STRING' } },
  { name: 'RelatedTo', properties: { type: 'STRING', weight: 'DOUBLE', createdAt: 'DATETIME' } },
];

export const DEFAULT_ENTITY_TYPES: string[] = ['person', 'project', 'tool', 'company', 'concept'];
