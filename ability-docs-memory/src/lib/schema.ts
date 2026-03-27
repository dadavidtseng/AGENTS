/**
 * Schema definitions for ability-docs-memory.
 *
 * Pure data definitions — no side effects, no KadiClient, no vault loading.
 */

import type {
  SchemaDefinition,
  VertexTypeDef,
  EdgeTypeDef,
} from './graph-types.js';

import {
  TOPIC_VERTEX,
  ENTITY_VERTEX,
  COMMON_EDGE_TYPES,
  DEFAULT_ENTITY_TYPES,
} from './graph-types.js';

// ── Vertex Types ──────────────────────────────────────────────────────

export const DOCNODE_VERTEX: VertexTypeDef = {
  name: 'DocNode',
  properties: {
    content: 'STRING',
    source: 'STRING',
    title: 'STRING',
    slug: 'STRING',
    pageUrl: 'STRING',
    collection: 'STRING',
    chunkIndex: 'INTEGER',
    totalChunks: 'INTEGER',
    embedding: 'LIST',
    importance: 'DOUBLE',
    tokens: 'INTEGER',
    metadata: 'MAP',
    indexedAt: 'DATETIME',
  },
  indexes: [
    { property: 'content', type: 'FULL_TEXT' },
    { property: 'slug', type: 'NOTUNIQUE' },
    { property: 'collection', type: 'NOTUNIQUE' },
    { property: 'source', type: 'NOTUNIQUE' },
  ],
};

// ── Edge Types ────────────────────────────────────────────────────────

export const NEXT_SECTION_EDGE: EdgeTypeDef = {
  name: 'NextSection',
  properties: {},
};

export const REFERENCES_EDGE: EdgeTypeDef = {
  name: 'References',
  properties: { linkText: 'STRING', sourceSlug: 'STRING' },
};

// ── Composite Schema ──────────────────────────────────────────────────

export const DOCNODE_SCHEMA: SchemaDefinition = {
  name: 'docs',
  vertexTypes: [DOCNODE_VERTEX, TOPIC_VERTEX, ENTITY_VERTEX],
  edgeTypes: [...COMMON_EDGE_TYPES, NEXT_SECTION_EDGE, REFERENCES_EDGE],
  entityTypes: DEFAULT_ENTITY_TYPES,
};
