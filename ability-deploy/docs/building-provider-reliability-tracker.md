# Building a Provider Reliability Tracker for Akash Network

> **Purpose:** A comprehensive guide to building your own provider monitoring and reliability tracking service for the Akash Network.
>
> **Author:** KADI Infrastructure Team
> **Last Updated:** 2025-10-15
> **Difficulty:** Intermediate
> **Estimated Time:** 1-2 weeks for full implementation

---

## Table of Contents

1. [Introduction](#introduction)
2. [Understanding the Components](#understanding-the-components)
3. [Architecture Overview](#architecture-overview)
4. [Prerequisites](#prerequisites)
5. [Implementation Guide](#implementation-guide)
6. [Deployment](#deployment)
7. [Maintenance](#maintenance)
8. [Advanced Features](#advanced-features)

---

## Introduction

### What is a Provider Reliability Tracker?

A provider reliability tracker is a service that continuously monitors Akash Network providers to:
- Track uptime/downtime over time (1 day, 7 days, 30 days)
- Monitor response times and availability
- Aggregate provider metadata (location, version, capabilities)
- Provide an API for querying provider statistics

This data helps users make informed decisions when selecting providers for their deployments.

### What is a Blockchain Indexer?

A **blockchain indexer** is a service that:
1. **Monitors blockchain events** - Watches for new blocks and transactions
2. **Extracts relevant data** - Parses transactions to find specific information
3. **Stores data in a queryable format** - Saves to a database for fast access
4. **Provides fast lookups** - Offers API endpoints to query historical data

**Why do we need it?**

The Akash blockchain stores provider information, but querying it directly is:
- **Slow** - Each query requires RPC calls to blockchain nodes
- **Limited** - You can only query current state, not historical trends
- **Resource-intensive** - Repeated queries burden the network

An indexer solves this by:
- **Pre-fetching data** - Queries blockchain once, stores results
- **Enabling historical queries** - Tracks changes over time
- **Fast API responses** - Returns data from local database (milliseconds vs seconds)

**Example:**
- Without indexer: "Is this provider online right now?" → Query blockchain → 2-5 seconds
- With indexer: "What was this provider's uptime last month?" → Query local DB → 10-50ms

### What Problem Are We Solving?

When deploying to Akash, you receive multiple provider bids. But without reliability data:
- ❌ You can't tell which providers are reliable
- ❌ You don't know historical uptime
- ❌ You can't identify providers that frequently go offline
- ❌ You're choosing blindly based only on price

With a reliability tracker:
- ✅ See provider uptime percentages (99.8% vs 85%)
- ✅ Filter out unreliable providers
- ✅ Make data-driven deployment decisions
- ✅ Track provider performance over time

### Existing Solutions

**Cloudmos (formerly Akash Console)** runs their own tracker:
- API: `https://api.cloudmos.io/v1/providers`
- Indexes 100+ providers
- Tracks uptime, location, versions
- Free to use BUT:
  - Closed source
  - Centralized (single point of failure)
  - May have rate limits or access restrictions

**Building your own gives you:**
- Full control over data collection
- Customizable metrics
- No rate limits
- Can add custom features
- Own your infrastructure

---

## Understanding the Components

Before building, let's understand each component:

### 1. Blockchain Indexer

**Purpose:** Discover and track providers registered on Akash Network

**What it does:**
```
Every 10-30 minutes:
  ↓
Query blockchain for all providers
  ↓
Check for new providers or updates
  ↓
Store in database
  ↓
Update provider metadata
```

**Key data collected:**
- Provider address (unique identifier)
- Host URI (provider's API endpoint)
- Attributes (audited-by, region, capabilities)
- Registration height (when they joined)

### 2. Health Checker

**Purpose:** Continuously ping providers to check if they're online

**What it does:**
```
Every 5-10 minutes:
  ↓
For each known provider:
  ↓
Send HTTP request to /status endpoint
  ↓
Record: online/offline, response time
  ↓
Store result in time-series database
```

**Key metrics collected:**
- Is online? (boolean)
- Response time (milliseconds)
- Error message (if offline)
- Timestamp

### 3. Metrics Calculator

**Purpose:** Aggregate health check data into uptime percentages

**What it does:**
```
Every 1 hour:
  ↓
For each provider:
  ↓
Calculate uptime for 1d, 7d, 30d periods
  ↓
Update provider_metrics table
  ↓
Calculate averages, percentages
```

**Calculations:**
```
uptime_7d = (successful_checks / total_checks) over last 7 days

Example:
- 2016 checks in 7 days (144 checks/day × 7 days, checking every 10 minutes)
- 2010 successful, 6 failed
- Uptime = 2010/2016 = 99.7%
```

### 4. API Server

**Purpose:** Serve provider data to your applications

**What it provides:**
```
GET /v1/providers
  → Returns all providers with uptime stats

GET /v1/providers/:address
  → Returns detailed info for one provider

GET /v1/providers/:address/history
  → Returns historical uptime data
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Akash Network Blockchain                      │
│  (Source of truth for provider registrations)                   │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     │ RPC Queries (every 10-30 min)
                     │
                     ▼
          ┌──────────────────────┐
          │  Blockchain Indexer  │
          │  Discovers providers │
          └──────────┬───────────┘
                     │
                     │ Stores provider info
                     │
                     ▼
          ┌──────────────────────┐
          │  PostgreSQL Database │◄───────────┐
          │  (Provider registry) │            │
          └──────────┬───────────┘            │
                     │                        │
                     │ Reads provider list    │ Stores health checks
                     │                        │
                     ▼                        │
          ┌──────────────────────┐            │
          │   Health Checker     │────────────┘
          │ Pings all providers  │
          │  every 5-10 minutes  │
          └──────────────────────┘
                     │
                     │ Triggers every hour
                     │
                     ▼
          ┌──────────────────────┐
          │  Metrics Calculator  │
          │ Computes uptime %    │
          └──────────┬───────────┘
                     │
                     │ Updates metrics
                     │
                     ▼
          ┌──────────────────────┐
          │  PostgreSQL Database │
          │  (Metrics table)     │
          └──────────┬───────────┘
                     │
                     │ Queries data
                     │
                     ▼
          ┌──────────────────────┐
          │     API Server       │
          │  Express/Fastify     │
          └──────────┬───────────┘
                     │
                     │ HTTP/JSON
                     │
                     ▼
          ┌──────────────────────┐
          │  Your Applications   │
          │  (kadi-deploy, etc)  │
          └──────────────────────┘
```

### Data Flow Example

**Scenario:** A new provider joins Akash Network

```
1. Provider registers on blockchain
   ↓
2. Indexer detects new provider (within 30 min)
   ↓
3. Indexer stores provider in database
   ↓
4. Health Checker sees new provider in database
   ↓
5. Health Checker starts pinging provider every 10 min
   ↓
6. After 24 hours, enough data exists
   ↓
7. Metrics Calculator computes uptime_1d
   ↓
8. API serves provider data with uptime stats
   ↓
9. Your deployment tool uses data to filter providers
```

---

## Prerequisites

### Knowledge Requirements

- **TypeScript/Node.js** - Core implementation language
- **SQL/PostgreSQL** - Database queries and schema design
- **REST APIs** - Building and consuming HTTP APIs
- **Async Programming** - Handling concurrent operations
- **Blockchain basics** - Understanding RPC, queries, addresses

### System Requirements

**Development:**
- Node.js 18+ or Bun
- PostgreSQL 14+ (or Docker with PostgreSQL image)
- 4GB RAM minimum
- 10GB storage

**Production:**
- VPS or cloud instance (2-4GB RAM recommended)
- PostgreSQL with TimescaleDB extension (optional but recommended)
- 50GB+ storage (for historical data)
- Reliable network connection

### Dependencies

```json
{
  "dependencies": {
    "@akashnetwork/akashjs": "^0.7.0",
    "@akashnetwork/akash-api": "^1.0.0",
    "pg": "^8.11.0",
    "express": "^4.18.2",
    "node-cron": "^3.0.2",
    "axios": "^1.6.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/pg": "^8.10.0",
    "@types/express": "^4.17.17",
    "typescript": "^5.2.0",
    "tsx": "^4.7.0"
  }
}
```

---

## Implementation Guide

### Step 1: Project Setup

Create the project structure:

```bash
mkdir akash-provider-tracker
cd akash-provider-tracker
npm init -y

# Install dependencies
npm install @akashnetwork/akashjs @akashnetwork/akash-api pg express node-cron axios
npm install -D @types/node @types/pg @types/express typescript tsx

# Initialize TypeScript
npx tsc --init --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop true --outDir dist
```

Project structure:
```
akash-provider-tracker/
├── src/
│   ├── indexer/
│   │   └── blockchain-indexer.ts
│   ├── health/
│   │   └── health-checker.ts
│   ├── metrics/
│   │   └── metrics-calculator.ts
│   ├── api/
│   │   └── server.ts
│   ├── database/
│   │   ├── client.ts
│   │   └── schema.sql
│   ├── types/
│   │   └── index.ts
│   └── index.ts
├── package.json
├── tsconfig.json
└── README.md
```

### Step 2: Database Schema

Create `src/database/schema.sql`:

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Providers table
-- Stores basic information about each provider
CREATE TABLE providers (
  -- Primary key: provider's blockchain address
  address TEXT PRIMARY KEY,

  -- Provider's API endpoint (e.g., https://provider.example.com:8443)
  host_uri TEXT NOT NULL,

  -- Optional human-readable name
  name TEXT,

  -- Blockchain height when provider was registered
  created_height BIGINT,

  -- Whether provider is audited by at least one auditor
  is_audited BOOLEAN DEFAULT FALSE,

  -- Provider attributes as JSON (flexible storage)
  attributes JSONB DEFAULT '[]'::jsonb,

  -- Metadata timestamps
  first_seen_at TIMESTAMP DEFAULT NOW(),
  last_updated_at TIMESTAMP DEFAULT NOW(),

  -- Indexes for fast queries
  CONSTRAINT valid_host_uri CHECK (host_uri ~ '^https?://')
);

CREATE INDEX idx_providers_is_audited ON providers(is_audited);
CREATE INDEX idx_providers_created_height ON providers(created_height);

-- Health checks table
-- Time-series data: one row per check per provider
CREATE TABLE health_checks (
  -- Unique ID for each check
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Which provider was checked
  provider_address TEXT NOT NULL REFERENCES providers(address) ON DELETE CASCADE,

  -- When the check was performed
  checked_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Result: was the provider online?
  is_online BOOLEAN NOT NULL,

  -- How long did the provider take to respond (NULL if offline)
  response_time_ms INTEGER,

  -- HTTP status code (200, 404, 500, etc)
  http_status INTEGER,

  -- Error message if check failed
  error_message TEXT,

  -- Additional metadata from /status endpoint
  metadata JSONB
);

-- Indexes for fast time-series queries
CREATE INDEX idx_health_checks_provider ON health_checks(provider_address, checked_at DESC);
CREATE INDEX idx_health_checks_time ON health_checks(checked_at DESC);

-- Optional: Convert to TimescaleDB hypertable for better performance
-- Requires TimescaleDB extension
-- SELECT create_hypertable('health_checks', 'checked_at');

-- Provider metrics table
-- Aggregated statistics, updated hourly
CREATE TABLE provider_metrics (
  -- One row per provider
  provider_address TEXT PRIMARY KEY REFERENCES providers(address) ON DELETE CASCADE,

  -- Uptime percentages (0.0 to 1.0)
  uptime_1d DECIMAL(5,4),   -- Last 24 hours
  uptime_7d DECIMAL(5,4),   -- Last 7 days
  uptime_30d DECIMAL(5,4),  -- Last 30 days

  -- Current status
  is_currently_online BOOLEAN,
  last_online_at TIMESTAMP,
  last_offline_at TIMESTAMP,

  -- Response time statistics (milliseconds)
  avg_response_time_1d INTEGER,
  avg_response_time_7d INTEGER,
  avg_response_time_30d INTEGER,

  -- Count of checks performed
  total_checks_1d INTEGER DEFAULT 0,
  total_checks_7d INTEGER DEFAULT 0,
  total_checks_30d INTEGER DEFAULT 0,

  -- Metadata
  last_calculated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_metrics_uptime_7d ON provider_metrics(uptime_7d DESC);
CREATE INDEX idx_metrics_currently_online ON provider_metrics(is_currently_online);

-- Provider locations table (optional)
-- IP geolocation data
CREATE TABLE provider_locations (
  provider_address TEXT PRIMARY KEY REFERENCES providers(address) ON DELETE CASCADE,

  -- Geographic data
  country TEXT,
  country_code TEXT,
  region TEXT,
  region_code TEXT,
  city TEXT,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  timezone TEXT,

  -- IP information
  ip_address TEXT,

  -- When location was determined
  detected_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_locations_country ON provider_locations(country_code);

-- Provider versions table
-- Track provider software versions over time
CREATE TABLE provider_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_address TEXT NOT NULL REFERENCES providers(address) ON DELETE CASCADE,

  -- Version information
  akash_version TEXT,
  cosmos_sdk_version TEXT,

  -- Kubernetes version (from /version endpoint)
  k8s_version TEXT,

  -- When this version was detected
  detected_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_versions_provider ON provider_versions(provider_address, detected_at DESC);

-- Create view for easy querying
CREATE VIEW provider_details AS
SELECT
  p.address,
  p.host_uri,
  p.name,
  p.is_audited,
  p.created_height,
  p.first_seen_at,
  m.uptime_1d,
  m.uptime_7d,
  m.uptime_30d,
  m.is_currently_online,
  m.last_online_at,
  m.avg_response_time_7d,
  l.country,
  l.country_code,
  l.region,
  l.city,
  l.latitude,
  l.longitude
FROM providers p
LEFT JOIN provider_metrics m ON p.address = m.provider_address
LEFT JOIN provider_locations l ON p.address = l.provider_address;
```

### Step 3: Database Client

Create `src/database/client.ts`:

```typescript
import pg from 'pg';
const { Pool } = pg;

/**
 * Database configuration
 */
interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/**
 * Database client singleton
 */
class DatabaseClient {
  private static instance: DatabaseClient;
  private pool: pg.Pool;

  private constructor(config: DatabaseConfig) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: 20, // Maximum number of connections
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Handle pool errors
    this.pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
    });
  }

  /**
   * Get database client instance (singleton)
   */
  static getInstance(config?: DatabaseConfig): DatabaseClient {
    if (!DatabaseClient.instance) {
      if (!config) {
        throw new Error('Database config required for first initialization');
      }
      DatabaseClient.instance = new DatabaseClient(config);
    }
    return DatabaseClient.instance;
  }

  /**
   * Execute a query
   */
  async query<T = any>(text: string, params?: any[]): Promise<pg.QueryResult<T>> {
    const start = Date.now();
    try {
      const result = await this.pool.query<T>(text, params);
      const duration = Date.now() - start;

      // Log slow queries (> 1 second)
      if (duration > 1000) {
        console.warn(`Slow query (${duration}ms):`, text);
      }

      return result;
    } catch (error) {
      console.error('Database query error:', error);
      console.error('Query:', text);
      console.error('Params:', params);
      throw error;
    }
  }

  /**
   * Execute multiple queries in a transaction
   */
  async transaction<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Close database connection pool
   */
  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Check if database is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch (error) {
      console.error('Database health check failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const getDatabaseClient = (config?: DatabaseConfig) => {
  return DatabaseClient.getInstance(config);
};

export default DatabaseClient;
```

### Step 4: Type Definitions

Create `src/types/index.ts`:

```typescript
/**
 * Provider information from blockchain
 */
export interface Provider {
  address: string;
  hostUri: string;
  name?: string;
  createdHeight: number;
  isAudited: boolean;
  attributes: ProviderAttribute[];
}

/**
 * Provider attribute (key-value pair with auditor info)
 */
export interface ProviderAttribute {
  key: string;
  value: string;
  auditedBy?: string[];
}

/**
 * Health check result
 */
export interface HealthCheck {
  id?: string;
  providerAddress: string;
  checkedAt: Date;
  isOnline: boolean;
  responseTimeMs?: number;
  httpStatus?: number;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

/**
 * Provider metrics (aggregated statistics)
 */
export interface ProviderMetrics {
  providerAddress: string;
  uptime1d?: number;  // 0.0 to 1.0
  uptime7d?: number;
  uptime30d?: number;
  isCurrentlyOnline: boolean;
  lastOnlineAt?: Date;
  lastOfflineAt?: Date;
  avgResponseTime1d?: number;
  avgResponseTime7d?: number;
  avgResponseTime30d?: number;
  totalChecks1d: number;
  totalChecks7d: number;
  totalChecks30d: number;
  lastCalculatedAt: Date;
}

/**
 * Provider location data
 */
export interface ProviderLocation {
  providerAddress: string;
  country?: string;
  countryCode?: string;
  region?: string;
  regionCode?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  ipAddress?: string;
}

/**
 * Provider status endpoint response
 * (what we get from https://provider.example.com/status)
 */
export interface ProviderStatus {
  cluster: {
    leases: number;
    inventory: {
      error?: string;
      active: ResourceUsage[];
      pending: ResourceUsage[];
      available: {
        nodes: ResourceCapacity[];
      };
    };
  };
  bidengine: {
    orders: number;
  };
  manifest: {
    deployments: number;
  };
  cluster_public_hostname?: string;
  address: string;
}

export interface ResourceUsage {
  cpu: number;
  gpu: number;
  memory: number;
  storage_ephemeral: number;
}

export interface ResourceCapacity {
  cpu: number;
  gpu: number;
  memory: number;
  storage_ephemeral: number;
}

/**
 * Provider version endpoint response
 * (what we get from https://provider.example.com/version)
 */
export interface ProviderVersion {
  akash: {
    version: string;
    commit: string;
    buildTags: string;
    go: string;
    cosmosSdkVersion: string;
  };
  kube: {
    major: string;
    minor: string;
    gitVersion: string;
    gitCommit: string;
    gitTreeState: string;
    buildDate: string;
    goVersion: string;
    compiler: string;
    platform: string;
  };
}

/**
 * Complete provider details (for API responses)
 */
export interface ProviderDetails {
  address: string;
  hostUri: string;
  name?: string;
  isAudited: boolean;
  createdHeight: number;
  firstSeenAt: Date;

  // Metrics
  uptime1d?: number;
  uptime7d?: number;
  uptime30d?: number;
  isCurrentlyOnline: boolean;
  lastOnlineAt?: Date;
  avgResponseTime7d?: number;

  // Location
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;

  // Additional
  attributes: ProviderAttribute[];
}
```

### Step 5: Blockchain Indexer

Create `src/indexer/blockchain-indexer.ts`:

```typescript
import { getRpc } from '@akashnetwork/akashjs/build/rpc';
import { QueryClientImpl as QueryProviderClient } from '@akashnetwork/akash-api/akash/provider/v1beta3';
import { getDatabaseClient } from '../database/client.js';
import type { Provider, ProviderAttribute } from '../types/index.js';

/**
 * Blockchain Indexer
 *
 * Discovers providers registered on Akash blockchain and stores them in database.
 * Runs periodically to catch new providers and updates.
 */
export class BlockchainIndexer {
  private rpcEndpoint: string;
  private db: ReturnType<typeof getDatabaseClient>;
  private isRunning = false;

  constructor(rpcEndpoint: string = 'https://rpc.akashnet.net:443') {
    this.rpcEndpoint = rpcEndpoint;
    this.db = getDatabaseClient();
  }

  /**
   * Start the indexer (runs in background)
   */
  async start(intervalMinutes: number = 30): Promise<void> {
    console.log('🔍 Starting blockchain indexer...');
    console.log(`   RPC: ${this.rpcEndpoint}`);
    console.log(`   Interval: ${intervalMinutes} minutes`);

    // Initial run
    await this.indexProviders();

    // Schedule periodic runs
    setInterval(async () => {
      if (!this.isRunning) {
        await this.indexProviders();
      }
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Main indexing logic
   */
  private async indexProviders(): Promise<void> {
    if (this.isRunning) {
      console.log('⏩ Indexer already running, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      console.log('🔄 Fetching providers from blockchain...');

      // Step 1: Connect to Akash RPC
      const rpc = await getRpc(this.rpcEndpoint);
      const queryClient = new QueryProviderClient(rpc);

      // Step 2: Query all providers
      // Note: This returns paginated results, we need to fetch all pages
      let allProviders: any[] = [];
      let nextKey: Uint8Array | undefined = undefined;

      do {
        const response = await queryClient.Providers({
          pagination: {
            key: nextKey || new Uint8Array(),
            offset: 0n,
            limit: 100n,
            countTotal: true,
            reverse: false,
          },
        });

        if (response.providers) {
          allProviders = allProviders.concat(response.providers);
        }

        nextKey = response.pagination?.nextKey;
      } while (nextKey && nextKey.length > 0);

      console.log(`   Found ${allProviders.length} providers on blockchain`);

      // Step 3: Process each provider
      let newProviders = 0;
      let updatedProviders = 0;

      for (const provider of allProviders) {
        const transformed = this.transformProvider(provider);
        const exists = await this.providerExists(transformed.address);

        if (exists) {
          await this.updateProvider(transformed);
          updatedProviders++;
        } else {
          await this.insertProvider(transformed);
          newProviders++;
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ Indexing complete in ${duration}s`);
      console.log(`   New providers: ${newProviders}`);
      console.log(`   Updated providers: ${updatedProviders}`);
      console.log(`   Total in database: ${allProviders.length}`);

    } catch (error) {
      console.error('❌ Indexer error:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Transform blockchain provider data to our format
   */
  private transformProvider(provider: any): Provider {
    // Extract attributes
    const attributes: ProviderAttribute[] = (provider.attributes || []).map((attr: any) => ({
      key: attr.key || '',
      value: attr.value || '',
      auditedBy: attr.auditedBy || [],
    }));

    // Check if provider is audited (has "audited-by" attribute)
    const isAudited = attributes.some(attr => attr.key === 'audited-by' && attr.value);

    return {
      address: provider.owner || '',
      hostUri: provider.hostUri || '',
      name: undefined, // Will be populated from /status endpoint by health checker
      createdHeight: Number(provider.createdHeight || 0),
      isAudited,
      attributes,
    };
  }

  /**
   * Check if provider exists in database
   */
  private async providerExists(address: string): Promise<boolean> {
    const result = await this.db.query(
      'SELECT address FROM providers WHERE address = $1',
      [address]
    );
    return result.rows.length > 0;
  }

  /**
   * Insert new provider into database
   */
  private async insertProvider(provider: Provider): Promise<void> {
    await this.db.query(
      `INSERT INTO providers
       (address, host_uri, name, created_height, is_audited, attributes, first_seen_at, last_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [
        provider.address,
        provider.hostUri,
        provider.name,
        provider.createdHeight,
        provider.isAudited,
        JSON.stringify(provider.attributes),
      ]
    );
  }

  /**
   * Update existing provider in database
   */
  private async updateProvider(provider: Provider): Promise<void> {
    await this.db.query(
      `UPDATE providers
       SET host_uri = $2,
           is_audited = $3,
           attributes = $4,
           last_updated_at = NOW()
       WHERE address = $1`,
      [
        provider.address,
        provider.hostUri,
        provider.isAudited,
        JSON.stringify(provider.attributes),
      ]
    );
  }

  /**
   * Get count of providers in database
   */
  async getProviderCount(): Promise<number> {
    const result = await this.db.query('SELECT COUNT(*) as count FROM providers');
    return parseInt(result.rows[0].count);
  }
}
```

### Step 6: Health Checker

Create `src/health/health-checker.ts`:

```typescript
import axios from 'axios';
import { getDatabaseClient } from '../database/client.js';
import type { HealthCheck, ProviderStatus, ProviderVersion } from '../types/index.js';

/**
 * Health Checker
 *
 * Continuously pings all providers to check if they're online.
 * Records results in time-series database for uptime calculations.
 */
export class HealthChecker {
  private db: ReturnType<typeof getDatabaseClient>;
  private isRunning = false;
  private checkTimeout: number;
  private userAgent: string;

  constructor(checkTimeoutMs: number = 5000) {
    this.db = getDatabaseClient();
    this.checkTimeout = checkTimeoutMs;
    this.userAgent = 'KADI-Provider-Tracker/1.0';
  }

  /**
   * Start the health checker (runs in background)
   */
  async start(intervalMinutes: number = 10): Promise<void> {
    console.log('🏥 Starting health checker...');
    console.log(`   Check timeout: ${this.checkTimeout}ms`);
    console.log(`   Interval: ${intervalMinutes} minutes`);

    // Initial run
    await this.checkAllProviders();

    // Schedule periodic checks
    setInterval(async () => {
      if (!this.isRunning) {
        await this.checkAllProviders();
      }
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Check all providers
   */
  private async checkAllProviders(): Promise<void> {
    if (this.isRunning) {
      console.log('⏩ Health checker already running, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      // Fetch all providers from database
      const result = await this.db.query<{ address: string; host_uri: string }>(
        'SELECT address, host_uri FROM providers'
      );

      const providers = result.rows;
      console.log(`🔍 Checking health of ${providers.length} providers...`);

      // Check all providers in parallel (with concurrency limit)
      const concurrencyLimit = 10; // Check 10 providers at once
      const results: HealthCheck[] = [];

      for (let i = 0; i < providers.length; i += concurrencyLimit) {
        const batch = providers.slice(i, i + concurrencyLimit);
        const batchResults = await Promise.all(
          batch.map(provider => this.checkProvider(provider.address, provider.host_uri))
        );
        results.push(...batchResults);
      }

      // Store all results in database
      await this.storeHealthChecks(results);

      // Calculate summary
      const onlineCount = results.filter(r => r.isOnline).length;
      const offlineCount = results.length - onlineCount;
      const avgResponseTime = results
        .filter(r => r.responseTimeMs)
        .reduce((sum, r) => sum + (r.responseTimeMs || 0), 0) / onlineCount;

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ Health check complete in ${duration}s`);
      console.log(`   Online: ${onlineCount} (${((onlineCount / results.length) * 100).toFixed(1)}%)`);
      console.log(`   Offline: ${offlineCount}`);
      console.log(`   Avg response time: ${avgResponseTime.toFixed(0)}ms`);

    } catch (error) {
      console.error('❌ Health checker error:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Check a single provider's health
   */
  private async checkProvider(address: string, hostUri: string): Promise<HealthCheck> {
    const checkedAt = new Date();

    try {
      // Ping provider's /status endpoint
      const startTime = Date.now();

      const response = await axios.get<ProviderStatus>(`${hostUri}/status`, {
        timeout: this.checkTimeout,
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json',
        },
        validateStatus: () => true, // Don't throw on non-200 status
      });

      const responseTimeMs = Date.now() - startTime;
      const isOnline = response.status === 200;

      // Try to get provider name from status response
      if (isOnline && response.data.address) {
        await this.updateProviderName(address, response.data.cluster_public_hostname);
      }

      return {
        providerAddress: address,
        checkedAt,
        isOnline,
        responseTimeMs,
        httpStatus: response.status,
        errorMessage: isOnline ? undefined : `HTTP ${response.status}`,
        metadata: isOnline ? {
          leases: response.data.cluster?.leases,
          deployments: response.data.manifest?.deployments,
        } : undefined,
      };

    } catch (error) {
      // Provider is offline or unreachable
      let errorMessage = 'Unknown error';

      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED') {
          errorMessage = 'Connection refused';
        } else if (error.code === 'ETIMEDOUT') {
          errorMessage = 'Timeout';
        } else if (error.code === 'ENOTFOUND') {
          errorMessage = 'DNS resolution failed';
        } else if (error.code === 'ECONNRESET') {
          errorMessage = 'Connection reset';
        } else {
          errorMessage = error.message;
        }
      }

      return {
        providerAddress: address,
        checkedAt,
        isOnline: false,
        errorMessage,
      };
    }
  }

  /**
   * Update provider name in database (if we discovered it from /status)
   */
  private async updateProviderName(address: string, name?: string): Promise<void> {
    if (!name) return;

    await this.db.query(
      'UPDATE providers SET name = $2 WHERE address = $1 AND name IS NULL',
      [address, name]
    );
  }

  /**
   * Store health check results in database
   */
  private async storeHealthChecks(checks: HealthCheck[]): Promise<void> {
    if (checks.length === 0) return;

    // Build bulk insert query
    const values: any[] = [];
    const placeholders: string[] = [];

    checks.forEach((check, index) => {
      const offset = index * 7;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`
      );
      values.push(
        check.providerAddress,
        check.checkedAt,
        check.isOnline,
        check.responseTimeMs || null,
        check.httpStatus || null,
        check.errorMessage || null,
        check.metadata ? JSON.stringify(check.metadata) : null
      );
    });

    const query = `
      INSERT INTO health_checks
        (provider_address, checked_at, is_online, response_time_ms, http_status, error_message, metadata)
      VALUES ${placeholders.join(', ')}
    `;

    await this.db.query(query, values);
  }

  /**
   * Get recent health checks for a provider
   */
  async getRecentChecks(providerAddress: string, limit: number = 100): Promise<HealthCheck[]> {
    const result = await this.db.query<HealthCheck>(
      `SELECT * FROM health_checks
       WHERE provider_address = $1
       ORDER BY checked_at DESC
       LIMIT $2`,
      [providerAddress, limit]
    );

    return result.rows;
  }
}
```

### Step 7: Metrics Calculator

Create `src/metrics/metrics-calculator.ts`:

```typescript
import { getDatabaseClient } from '../database/client.js';
import type { ProviderMetrics } from '../types/index.js';

/**
 * Metrics Calculator
 *
 * Aggregates health check data into uptime percentages and other statistics.
 * Runs hourly to keep metrics up to date.
 */
export class MetricsCalculator {
  private db: ReturnType<typeof getDatabaseClient>;
  private isRunning = false;

  constructor() {
    this.db = getDatabaseClient();
  }

  /**
   * Start the metrics calculator (runs in background)
   */
  async start(intervalMinutes: number = 60): Promise<void> {
    console.log('📊 Starting metrics calculator...');
    console.log(`   Interval: ${intervalMinutes} minutes`);

    // Initial run
    await this.calculateAllMetrics();

    // Schedule periodic calculations
    setInterval(async () => {
      if (!this.isRunning) {
        await this.calculateAllMetrics();
      }
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Calculate metrics for all providers
   */
  private async calculateAllMetrics(): Promise<void> {
    if (this.isRunning) {
      console.log('⏩ Metrics calculator already running, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      console.log('🔄 Calculating provider metrics...');

      // Get all provider addresses
      const result = await this.db.query<{ address: string }>(
        'SELECT address FROM providers'
      );

      const providers = result.rows;
      console.log(`   Processing ${providers.length} providers...`);

      // Calculate metrics for each provider
      for (const provider of providers) {
        await this.calculateProviderMetrics(provider.address);
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ Metrics calculation complete in ${duration}s`);

    } catch (error) {
      console.error('❌ Metrics calculator error:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Calculate metrics for a single provider
   */
  private async calculateProviderMetrics(providerAddress: string): Promise<void> {
    // Calculate uptime for different time periods
    const uptime1d = await this.calculateUptime(providerAddress, 1);
    const uptime7d = await this.calculateUptime(providerAddress, 7);
    const uptime30d = await this.calculateUptime(providerAddress, 30);

    // Calculate average response times
    const avgResponseTime1d = await this.calculateAvgResponseTime(providerAddress, 1);
    const avgResponseTime7d = await this.calculateAvgResponseTime(providerAddress, 7);
    const avgResponseTime30d = await this.calculateAvgResponseTime(providerAddress, 30);

    // Get check counts
    const totalChecks1d = await this.getCheckCount(providerAddress, 1);
    const totalChecks7d = await this.getCheckCount(providerAddress, 7);
    const totalChecks30d = await this.getCheckCount(providerAddress, 30);

    // Get current status
    const currentStatus = await this.getCurrentStatus(providerAddress);

    // Build metrics object
    const metrics: ProviderMetrics = {
      providerAddress,
      uptime1d,
      uptime7d,
      uptime30d,
      isCurrentlyOnline: currentStatus.isCurrentlyOnline,
      lastOnlineAt: currentStatus.lastOnlineAt,
      lastOfflineAt: currentStatus.lastOfflineAt,
      avgResponseTime1d,
      avgResponseTime7d,
      avgResponseTime30d,
      totalChecks1d,
      totalChecks7d,
      totalChecks30d,
      lastCalculatedAt: new Date(),
    };

    // Upsert metrics into database
    await this.upsertMetrics(metrics);
  }

  /**
   * Calculate uptime percentage for a time period
   */
  private async calculateUptime(providerAddress: string, days: number): Promise<number | undefined> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await this.db.query<{ online_count: string; total_count: string }>(
      `SELECT
         COUNT(CASE WHEN is_online THEN 1 END) as online_count,
         COUNT(*) as total_count
       FROM health_checks
       WHERE provider_address = $1
         AND checked_at >= $2`,
      [providerAddress, startDate]
    );

    const row = result.rows[0];
    if (!row || parseInt(row.total_count) === 0) {
      return undefined; // Not enough data
    }

    const onlineCount = parseInt(row.online_count);
    const totalCount = parseInt(row.total_count);

    return onlineCount / totalCount;
  }

  /**
   * Calculate average response time for a time period (in milliseconds)
   */
  private async calculateAvgResponseTime(
    providerAddress: string,
    days: number
  ): Promise<number | undefined> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await this.db.query<{ avg_response_time: string }>(
      `SELECT AVG(response_time_ms)::INTEGER as avg_response_time
       FROM health_checks
       WHERE provider_address = $1
         AND checked_at >= $2
         AND is_online = TRUE
         AND response_time_ms IS NOT NULL`,
      [providerAddress, startDate]
    );

    const avgTime = result.rows[0]?.avg_response_time;
    return avgTime ? parseInt(avgTime) : undefined;
  }

  /**
   * Get total number of checks performed in a time period
   */
  private async getCheckCount(providerAddress: string, days: number): Promise<number> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM health_checks
       WHERE provider_address = $1
         AND checked_at >= $2`,
      [providerAddress, startDate]
    );

    return parseInt(result.rows[0]?.count || '0');
  }

  /**
   * Get current online/offline status
   */
  private async getCurrentStatus(
    providerAddress: string
  ): Promise<{
    isCurrentlyOnline: boolean;
    lastOnlineAt?: Date;
    lastOfflineAt?: Date;
  }> {
    // Get most recent check
    const recentCheck = await this.db.query<{ is_online: boolean; checked_at: Date }>(
      `SELECT is_online, checked_at
       FROM health_checks
       WHERE provider_address = $1
       ORDER BY checked_at DESC
       LIMIT 1`,
      [providerAddress]
    );

    const isCurrentlyOnline = recentCheck.rows[0]?.is_online || false;

    // Get last time provider was online
    const lastOnlineResult = await this.db.query<{ checked_at: Date }>(
      `SELECT checked_at
       FROM health_checks
       WHERE provider_address = $1
         AND is_online = TRUE
       ORDER BY checked_at DESC
       LIMIT 1`,
      [providerAddress]
    );

    // Get last time provider was offline
    const lastOfflineResult = await this.db.query<{ checked_at: Date }>(
      `SELECT checked_at
       FROM health_checks
       WHERE provider_address = $1
         AND is_online = FALSE
       ORDER BY checked_at DESC
       LIMIT 1`,
      [providerAddress]
    );

    return {
      isCurrentlyOnline,
      lastOnlineAt: lastOnlineResult.rows[0]?.checked_at,
      lastOfflineAt: lastOfflineResult.rows[0]?.checked_at,
    };
  }

  /**
   * Insert or update provider metrics
   */
  private async upsertMetrics(metrics: ProviderMetrics): Promise<void> {
    await this.db.query(
      `INSERT INTO provider_metrics (
         provider_address,
         uptime_1d, uptime_7d, uptime_30d,
         is_currently_online, last_online_at, last_offline_at,
         avg_response_time_1d, avg_response_time_7d, avg_response_time_30d,
         total_checks_1d, total_checks_7d, total_checks_30d,
         last_calculated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (provider_address) DO UPDATE SET
         uptime_1d = EXCLUDED.uptime_1d,
         uptime_7d = EXCLUDED.uptime_7d,
         uptime_30d = EXCLUDED.uptime_30d,
         is_currently_online = EXCLUDED.is_currently_online,
         last_online_at = EXCLUDED.last_online_at,
         last_offline_at = EXCLUDED.last_offline_at,
         avg_response_time_1d = EXCLUDED.avg_response_time_1d,
         avg_response_time_7d = EXCLUDED.avg_response_time_7d,
         avg_response_time_30d = EXCLUDED.avg_response_time_30d,
         total_checks_1d = EXCLUDED.total_checks_1d,
         total_checks_7d = EXCLUDED.total_checks_7d,
         total_checks_30d = EXCLUDED.total_checks_30d,
         last_calculated_at = EXCLUDED.last_calculated_at`,
      [
        metrics.providerAddress,
        metrics.uptime1d,
        metrics.uptime7d,
        metrics.uptime30d,
        metrics.isCurrentlyOnline,
        metrics.lastOnlineAt,
        metrics.lastOfflineAt,
        metrics.avgResponseTime1d,
        metrics.avgResponseTime7d,
        metrics.avgResponseTime30d,
        metrics.totalChecks1d,
        metrics.totalChecks7d,
        metrics.totalChecks30d,
        metrics.lastCalculatedAt,
      ]
    );
  }

  /**
   * Get metrics for a specific provider
   */
  async getProviderMetrics(providerAddress: string): Promise<ProviderMetrics | null> {
    const result = await this.db.query<ProviderMetrics>(
      'SELECT * FROM provider_metrics WHERE provider_address = $1',
      [providerAddress]
    );

    return result.rows[0] || null;
  }
}
```

### Step 8: API Server

Create `src/api/server.ts`:

```typescript
import express from 'express';
import type { Request, Response } from 'express';
import { getDatabaseClient } from '../database/client.js';
import type { ProviderDetails } from '../types/index.js';

/**
 * API Server
 *
 * Exposes provider data via REST API endpoints.
 */
export class ApiServer {
  private app: express.Application;
  private db: ReturnType<typeof getDatabaseClient>;
  private port: number;

  constructor(port: number = 3000) {
    this.app = express();
    this.db = getDatabaseClient();
    this.port = port;

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // CORS headers
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      next();
    });

    // JSON parsing
    this.app.use(express.json());

    // Request logging
    this.app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
      });
      next();
    });
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Get all providers
    this.app.get('/v1/providers', this.getAllProviders.bind(this));

    // Get single provider by address
    this.app.get('/v1/providers/:address', this.getProviderByAddress.bind(this));

    // Get provider history
    this.app.get('/v1/providers/:address/history', this.getProviderHistory.bind(this));

    // Get provider statistics
    this.app.get('/v1/stats', this.getStats.bind(this));

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });

    // Error handler
    this.app.use((err: Error, req: Request, res: Response, next: any) => {
      console.error('API error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  /**
   * GET /v1/providers
   * Returns all providers with their metrics
   */
  private async getAllProviders(req: Request, res: Response): Promise<void> {
    try {
      const result = await this.db.query<ProviderDetails>(
        `SELECT * FROM provider_details ORDER BY uptime_7d DESC NULLS LAST`
      );

      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching providers:', error);
      res.status(500).json({ error: 'Failed to fetch providers' });
    }
  }

  /**
   * GET /v1/providers/:address
   * Returns detailed information for a specific provider
   */
  private async getProviderByAddress(req: Request, res: Response): Promise<void> {
    try {
      const { address } = req.params;

      const result = await this.db.query<ProviderDetails>(
        `SELECT * FROM provider_details WHERE address = $1`,
        [address]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Provider not found' });
        return;
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error fetching provider:', error);
      res.status(500).json({ error: 'Failed to fetch provider' });
    }
  }

  /**
   * GET /v1/providers/:address/history
   * Returns historical health check data for a provider
   */
  private async getProviderHistory(req: Request, res: Response): Promise<void> {
    try {
      const { address } = req.params;
      const days = parseInt(req.query.days as string) || 7;
      const limit = Math.min(parseInt(req.query.limit as string) || 1000, 10000);

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const result = await this.db.query(
        `SELECT
           checked_at,
           is_online,
           response_time_ms,
           error_message
         FROM health_checks
         WHERE provider_address = $1
           AND checked_at >= $2
         ORDER BY checked_at DESC
         LIMIT $3`,
        [address, startDate, limit]
      );

      res.json({
        provider: address,
        days,
        dataPoints: result.rows.length,
        history: result.rows,
      });
    } catch (error) {
      console.error('Error fetching provider history:', error);
      res.status(500).json({ error: 'Failed to fetch provider history' });
    }
  }

  /**
   * GET /v1/stats
   * Returns overall statistics about the tracker
   */
  private async getStats(req: Request, res: Response): Promise<void> {
    try {
      // Total providers
      const totalResult = await this.db.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM providers'
      );
      const totalProviders = parseInt(totalResult.rows[0]?.count || '0');

      // Online providers
      const onlineResult = await this.db.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM provider_metrics WHERE is_currently_online = TRUE'
      );
      const onlineProviders = parseInt(onlineResult.rows[0]?.count || '0');

      // Average uptime
      const avgUptimeResult = await this.db.query<{ avg_uptime: string }>(
        `SELECT AVG(uptime_7d)::DECIMAL(5,4) as avg_uptime
         FROM provider_metrics
         WHERE uptime_7d IS NOT NULL`
      );
      const avgUptime = parseFloat(avgUptimeResult.rows[0]?.avg_uptime || '0');

      // Total health checks performed
      const checksResult = await this.db.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM health_checks'
      );
      const totalChecks = parseInt(checksResult.rows[0]?.count || '0');

      res.json({
        totalProviders,
        onlineProviders,
        offlineProviders: totalProviders - onlineProviders,
        avgUptime7d: avgUptime,
        totalHealthChecks: totalChecks,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  }

  /**
   * Start the API server
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(this.port, () => {
        console.log(`🚀 API server running on http://localhost:${this.port}`);
        console.log(`   Health: http://localhost:${this.port}/health`);
        console.log(`   Providers: http://localhost:${this.port}/v1/providers`);
        resolve();
      });
    });
  }
}
```

### Step 9: Main Application

Create `src/index.ts`:

```typescript
import { getDatabaseClient } from './database/client.js';
import { BlockchainIndexer } from './indexer/blockchain-indexer.js';
import { HealthChecker } from './health/health-checker.js';
import { MetricsCalculator } from './metrics/metrics-calculator.js';
import { ApiServer } from './api/server.js';

/**
 * Configuration from environment variables
 */
const config = {
  // Database configuration
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'akash_tracker',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },

  // Akash RPC endpoint
  rpcEndpoint: process.env.AKASH_RPC || 'https://rpc.akashnet.net:443',

  // Intervals (in minutes)
  indexerInterval: parseInt(process.env.INDEXER_INTERVAL || '30'),
  healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '10'),
  metricsInterval: parseInt(process.env.METRICS_INTERVAL || '60'),

  // API server port
  apiPort: parseInt(process.env.API_PORT || '3000'),

  // Health check timeout
  checkTimeout: parseInt(process.env.CHECK_TIMEOUT || '5000'),
};

/**
 * Main application
 */
async function main() {
  console.log('🚀 Starting Akash Provider Tracker');
  console.log('');
  console.log('Configuration:');
  console.log(`  Database: ${config.database.host}:${config.database.port}/${config.database.database}`);
  console.log(`  RPC: ${config.rpcEndpoint}`);
  console.log(`  Indexer interval: ${config.indexerInterval} minutes`);
  console.log(`  Health check interval: ${config.healthCheckInterval} minutes`);
  console.log(`  Metrics interval: ${config.metricsInterval} minutes`);
  console.log(`  API port: ${config.apiPort}`);
  console.log('');

  // Initialize database client
  const db = getDatabaseClient(config.database);

  // Check database connection
  console.log('📊 Checking database connection...');
  const isHealthy = await db.healthCheck();
  if (!isHealthy) {
    console.error('❌ Database connection failed');
    process.exit(1);
  }
  console.log('✅ Database connection successful');
  console.log('');

  // Initialize components
  const indexer = new BlockchainIndexer(config.rpcEndpoint);
  const healthChecker = new HealthChecker(config.checkTimeout);
  const metricsCalculator = new MetricsCalculator();
  const apiServer = new ApiServer(config.apiPort);

  // Start all components
  await Promise.all([
    indexer.start(config.indexerInterval),
    healthChecker.start(config.healthCheckInterval),
    metricsCalculator.start(config.metricsInterval),
    apiServer.start(),
  ]);

  console.log('');
  console.log('✅ All systems operational');
  console.log('');

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('');
    console.log('🛑 Shutting down...');
    await db.close();
    process.exit(0);
  });
}

// Run the application
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
```

### Step 10: Environment Configuration

Create `.env.example`:

```bash
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=akash_tracker
DB_USER=postgres
DB_PASSWORD=postgres

# Akash Configuration
AKASH_RPC=https://rpc.akashnet.net:443

# Intervals (in minutes)
INDEXER_INTERVAL=30      # How often to check blockchain for new providers
HEALTH_CHECK_INTERVAL=10 # How often to ping providers
METRICS_INTERVAL=60      # How often to calculate uptime metrics

# API Configuration
API_PORT=3000

# Health Check Configuration
CHECK_TIMEOUT=5000  # Timeout in milliseconds
```

### Step 11: Package Scripts

Update `package.json`:

```json
{
  "name": "akash-provider-tracker",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "db:setup": "psql -U postgres -f src/database/schema.sql",
    "db:reset": "dropdb akash_tracker && createdb akash_tracker && npm run db:setup"
  }
}
```

---

## Deployment

### Option 1: Local Development

```bash
# 1. Install PostgreSQL
brew install postgresql  # macOS
# or
sudo apt install postgresql  # Ubuntu

# 2. Create database
createdb akash_tracker

# 3. Initialize schema
psql -U postgres -d akash_tracker -f src/database/schema.sql

# 4. Create .env file
cp .env.example .env
# Edit .env with your configuration

# 5. Install dependencies
npm install

# 6. Run in development mode
npm run dev
```

### Option 2: Docker

Create `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --production

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Run application
CMD ["npm", "start"]
```

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: akash_tracker
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./src/database/schema.sql:/docker-entrypoint-initdb.d/schema.sql
    ports:
      - "5432:5432"

  tracker:
    build: .
    depends_on:
      - postgres
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: akash_tracker
      DB_USER: postgres
      DB_PASSWORD: postgres
      AKASH_RPC: https://rpc.akashnet.net:443
      INDEXER_INTERVAL: 30
      HEALTH_CHECK_INTERVAL: 10
      METRICS_INTERVAL: 60
      API_PORT: 3000
    ports:
      - "3000:3000"

volumes:
  postgres_data:
```

Run with Docker:

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f tracker

# Stop
docker-compose down
```

### Option 3: Deploy to VPS

```bash
# 1. SSH to your server
ssh user@your-server.com

# 2. Install Node.js and PostgreSQL
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs postgresql

# 3. Clone your repository
git clone https://github.com/your-repo/akash-provider-tracker.git
cd akash-provider-tracker

# 4. Setup database
sudo -u postgres createdb akash_tracker
sudo -u postgres psql -d akash_tracker -f src/database/schema.sql

# 5. Install dependencies and build
npm install
npm run build

# 6. Setup systemd service
sudo nano /etc/systemd/system/akash-tracker.service
```

Create systemd service file:

```ini
[Unit]
Description=Akash Provider Tracker
After=network.target postgresql.service

[Service]
Type=simple
User=your-user
WorkingDirectory=/home/your-user/akash-provider-tracker
Environment="NODE_ENV=production"
Environment="DB_HOST=localhost"
Environment="DB_PORT=5432"
Environment="DB_NAME=akash_tracker"
Environment="DB_USER=postgres"
Environment="DB_PASSWORD=your-password"
ExecStart=/usr/bin/node dist/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

Start the service:

```bash
# Enable and start
sudo systemctl enable akash-tracker
sudo systemctl start akash-tracker

# Check status
sudo systemctl status akash-tracker

# View logs
sudo journalctl -u akash-tracker -f
```

### Option 4: Deploy to Akash Network

Create `deploy.yaml` for Akash:

```yaml
---
version: "2.0"

services:
  tracker:
    image: your-docker-hub/akash-tracker:latest
    env:
      - DB_HOST=postgres
      - DB_NAME=akash_tracker
      - DB_USER=postgres
      - DB_PASSWORD=postgres
      - AKASH_RPC=https://rpc.akashnet.net:443
    expose:
      - port: 3000
        as: 80
        to:
          - global: true

  postgres:
    image: postgres:15-alpine
    env:
      - POSTGRES_DB=akash_tracker
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
    expose:
      - port: 5432
        to:
          - service: tracker

profiles:
  compute:
    tracker:
      resources:
        cpu:
          units: 1
        memory:
          size: 2Gi
        storage:
          size: 10Gi
    postgres:
      resources:
        cpu:
          units: 1
        memory:
          size: 2Gi
        storage:
          size: 50Gi

  placement:
    akash:
      pricing:
        tracker:
          denom: uakt
          amount: 1000
        postgres:
          denom: uakt
          amount: 1000

deployment:
  tracker:
    akash:
      profile: tracker
      count: 1
  postgres:
    akash:
      profile: postgres
      count: 1
```

---

## Maintenance

### Daily Tasks

**Monitor System Health:**

```bash
# Check if all services are running
systemctl status akash-tracker  # or docker-compose ps

# Check recent logs for errors
tail -n 100 /var/log/akash-tracker.log

# Check database size
psql -U postgres -d akash_tracker -c "
  SELECT
    pg_size_pretty(pg_database_size('akash_tracker')) as size;
"
```

**Monitor Metrics:**

```bash
# Check API health
curl http://localhost:3000/health

# Get current stats
curl http://localhost:3000/v1/stats

# Check specific provider
curl http://localhost:3000/v1/providers/akash1...
```

### Weekly Tasks

**Database Maintenance:**

```sql
-- Vacuum database (reclaim storage)
VACUUM ANALYZE health_checks;
VACUUM ANALYZE provider_metrics;

-- Check table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check index usage
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;
```

**Backup Database:**

```bash
# Create backup
pg_dump -U postgres akash_tracker > backup_$(date +%Y%m%d).sql

# Compress backup
gzip backup_$(date +%Y%m%d).sql

# Upload to S3 (optional)
aws s3 cp backup_$(date +%Y%m%d).sql.gz s3://your-bucket/backups/
```

### Monthly Tasks

**Archive Old Data:**

```sql
-- Archive health checks older than 60 days
CREATE TABLE health_checks_archive (LIKE health_checks INCLUDING ALL);

INSERT INTO health_checks_archive
SELECT * FROM health_checks
WHERE checked_at < NOW() - INTERVAL '60 days';

DELETE FROM health_checks
WHERE checked_at < NOW() - INTERVAL '60 days';
```

**Review Performance:**

```sql
-- Find slow queries
SELECT
  calls,
  total_time,
  mean_time,
  query
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- Check for missing indexes
SELECT
  schemaname,
  tablename,
  attname,
  n_distinct,
  correlation
FROM pg_stats
WHERE schemaname = 'public'
  AND n_distinct > 100
ORDER BY abs(correlation) ASC
LIMIT 20;
```

### Troubleshooting

**Problem: High Memory Usage**

```bash
# Check Node.js memory usage
ps aux | grep node

# If memory is high, restart service
sudo systemctl restart akash-tracker

# Increase Node.js memory limit (in systemd service file)
Environment="NODE_OPTIONS=--max-old-space-size=4096"
```

**Problem: Database Growing Too Large**

```bash
# Check table sizes
psql -U postgres -d akash_tracker -c "
  SELECT
    pg_size_pretty(pg_table_size('health_checks')) as health_checks_size,
    pg_size_pretty(pg_table_size('provider_metrics')) as metrics_size;
"

# Archive old data (see Monthly Tasks)
# Or reduce retention period in health checker
```

**Problem: Providers Not Being Discovered**

```bash
# Check indexer logs
journalctl -u akash-tracker | grep "Indexer"

# Manually trigger indexer (if you add a CLI command)
node dist/index.js --index-now

# Check RPC connectivity
curl https://rpc.akashnet.net:443/status
```

**Problem: API Slow Response Times**

```sql
-- Add missing indexes
CREATE INDEX CONCURRENTLY idx_health_checks_provider_time
  ON health_checks(provider_address, checked_at DESC);

-- Analyze query performance
EXPLAIN ANALYZE
SELECT * FROM provider_details;

-- Update statistics
ANALYZE;
```

---

## Advanced Features

### Feature 1: IP Geolocation

Add IP geolocation to track provider locations:

```typescript
import axios from 'axios';

/**
 * Get IP geolocation using ipapi.co (free tier: 1000 requests/day)
 */
async function getProviderLocation(hostUri: string): Promise<ProviderLocation | null> {
  try {
    // Extract hostname from URI
    const hostname = new URL(hostUri).hostname;

    // Query ipapi.co
    const response = await axios.get(`https://ipapi.co/${hostname}/json/`);
    const data = response.data;

    return {
      providerAddress: '', // Set by caller
      country: data.country_name,
      countryCode: data.country_code,
      region: data.region,
      regionCode: data.region_code,
      city: data.city,
      latitude: data.latitude,
      longitude: data.longitude,
      timezone: data.timezone,
      ipAddress: data.ip,
    };
  } catch (error) {
    console.error('Failed to get geolocation:', error);
    return null;
  }
}

// Use in health checker after detecting new provider
```

### Feature 2: Alerting System

Add Slack/Discord alerts for provider downtime:

```typescript
import axios from 'axios';

class AlertManager {
  private webhookUrl: string;
  private alertedProviders = new Set<string>();

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async sendAlert(provider: string, message: string): Promise<void> {
    // Avoid duplicate alerts
    if (this.alertedProviders.has(provider)) return;

    try {
      await axios.post(this.webhookUrl, {
        text: `🚨 Provider Alert: ${message}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Provider:* ${provider}\n*Alert:* ${message}`,
            },
          },
        ],
      });

      this.alertedProviders.add(provider);

      // Clear alert after 1 hour
      setTimeout(() => {
        this.alertedProviders.delete(provider);
      }, 60 * 60 * 1000);

    } catch (error) {
      console.error('Failed to send alert:', error);
    }
  }
}

// Use in health checker when provider goes down
```

### Feature 3: Historical Charts

Generate uptime charts using Chart.js or similar:

```typescript
// API endpoint: GET /v1/providers/:address/chart
async getProviderChart(req: Request, res: Response): Promise<void> {
  const { address } = req.params;
  const days = parseInt(req.query.days as string) || 7;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Get hourly uptime data
  const result = await this.db.query(`
    SELECT
      date_trunc('hour', checked_at) as hour,
      AVG(CASE WHEN is_online THEN 1.0 ELSE 0.0 END) as uptime
    FROM health_checks
    WHERE provider_address = $1
      AND checked_at >= $2
    GROUP BY hour
    ORDER BY hour ASC
  `, [address, startDate]);

  const data = {
    labels: result.rows.map(r => r.hour),
    datasets: [{
      label: 'Uptime',
      data: result.rows.map(r => (r.uptime * 100).toFixed(2)),
    }],
  };

  res.json(data);
}
```

### Feature 4: Provider Comparison

Compare multiple providers side-by-side:

```typescript
// API endpoint: GET /v1/compare?providers=addr1,addr2,addr3
async compareProviders(req: Request, res: Response): Promise<void> {
  const addresses = (req.query.providers as string).split(',');

  const result = await this.db.query(`
    SELECT * FROM provider_details
    WHERE address = ANY($1)
  `, [addresses]);

  // Calculate comparison metrics
  const comparison = result.rows.map(provider => ({
    address: provider.address,
    name: provider.name,
    uptime7d: provider.uptime_7d,
    avgResponseTime: provider.avg_response_time_7d,
    isOnline: provider.is_currently_online,
    isAudited: provider.is_audited,
    location: `${provider.city}, ${provider.country}`,
  }));

  res.json({
    providers: comparison,
    winner: comparison.sort((a, b) => b.uptime7d - a.uptime7d)[0],
  });
}
```

---

## Conclusion

You now have a complete guide to building your own provider reliability tracker for Akash Network. This system will:

- ✅ Automatically discover providers from the blockchain
- ✅ Continuously monitor provider health
- ✅ Calculate uptime percentages over time
- ✅ Provide a REST API for your applications
- ✅ Track provider metadata and performance

### Next Steps

1. **Deploy the tracker** to a VPS or Akash itself
2. **Integrate with kadi-deploy** to use reliability data when selecting providers
3. **Add more features** like alerting, geolocation, and historical charts
4. **Monitor and maintain** the system to ensure data quality

### Resources

- **Akash Network Docs:** https://docs.akash.network/
- **AkashJS Library:** https://github.com/akash-network/akashjs
- **PostgreSQL TimescaleDB:** https://www.timescale.com/ (for time-series optimization)
- **KADI Infrastructure:** https://github.com/kadi-build

---

**Happy tracking! 🚀**
