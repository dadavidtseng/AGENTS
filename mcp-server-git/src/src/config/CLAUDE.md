# Configuration Module

[Root Directory](../../.claude/CLAUDE.md) > [src](../) > **config**

---

## Module Overview

**Path:** `src/config/`
**Responsibility:** Environment-based configuration validation using Zod schemas
**Entry Point:** `src/config/index.ts`

This module provides centralized, type-safe configuration management for the entire application. All environment variables are validated at startup using Zod schemas, ensuring type safety and correctness before the server starts.

---

## Module Responsibilities

1. **Environment Variable Loading**
   - Loads `.env` file via dotenv (quiet mode)
   - Reads environment variables from process.env
   - Supports alias mappings for common variations

2. **Schema Validation**
   - Defines comprehensive Zod schema for all configuration
   - Validates required fields and types
   - Provides default values for optional settings

3. **Path Expansion**
   - Expands tilde (`~`) to user home directory
   - Handles both `~/path` and `~` alone
   - Validates absolute paths where required

4. **Configuration Export**
   - Exports validated, typed configuration object
   - Throws `McpError` on validation failure
   - Provides type definitions for static analysis

---

## Entry Point and Startup

### File: `src/config/index.ts`

```typescript
// 1. Load environment variables
dotenv.config({ quiet: true });

// 2. Parse and validate configuration
const config = parseConfig();

// 3. Export typed configuration
export type AppConfig = z.infer<typeof ConfigSchema>;
export { config, ConfigSchema, parseConfig };
```

### Startup Flow

```
process.env
    ↓
rawConfig object
    ↓
Zod preprocessing (aliases, coercion, expansion)
    ↓
ConfigSchema.safeParse()
    ↓
✓ Success: Return typed config
✗ Failure: Throw McpError
```

---

## Configuration Categories

### 1. Package Information

```typescript
pkg: {
  name: string;           // From package.json or env
  version: string;        // From package.json or env
  description?: string;   // Optional
}
```

### 2. MCP Server Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mcpServerName` | string | pkg.name | Server identity name |
| `mcpServerVersion` | string | pkg.version | Server version |
| `mcpTransportType` | 'stdio' \| 'http' | 'stdio' | Communication transport |
| `mcpSessionMode` | 'stateless' \| 'stateful' \| 'auto' | 'auto' | HTTP session mode |
| `mcpResponseFormat` | 'json' \| 'markdown' \| 'auto' | 'json' | Output format |
| `mcpResponseVerbosity` | 'minimal' \| 'standard' \| 'full' | 'standard' | Detail level |

### 3. HTTP Transport Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mcpHttpPort` | number | 3015 | HTTP server port |
| `mcpHttpHost` | string | '127.0.0.1' | HTTP server host |
| `mcpHttpEndpointPath` | string | '/mcp' | MCP endpoint path |
| `mcpHttpMaxPortRetries` | number | 15 | Port retry attempts |
| `mcpStatefulSessionStaleTimeoutMs` | number | 1,800,000 | Session timeout (30 min) |

### 4. Authentication Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mcpAuthMode` | 'none' \| 'jwt' \| 'oauth' | 'none' | Auth mode |
| `mcpAuthSecretKey` | string? | undefined | JWT secret (required for jwt mode) |
| `oauthIssuerUrl` | string? | undefined | OAuth issuer (required for oauth) |
| `oauthJwksUri` | string? | undefined | JWKS endpoint |
| `oauthAudience` | string? | undefined | OAuth audience claim |

### 5. Git Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `git.provider` | 'auto' \| 'cli' \| 'isomorphic' | 'auto' | Git provider selection |
| `git.signCommits` | boolean | false | Enable GPG/SSH signing |
| `git.authorName` | string? | undefined | Git author name |
| `git.authorEmail` | string? | undefined | Git author email |
| `git.baseDir` | string? | undefined | Base directory restriction |
| `git.wrapupInstructionsPath` | string? | undefined | Custom workflow instructions |
| `git.maxCommandTimeoutMs` | number | 30000 | Command timeout (30s) |
| `git.maxBufferSizeMb` | number | 10 | Output buffer limit |

**Note:** Git author/email support multiple aliases:
- Author: `GIT_AUTHOR_NAME`, `GIT_USERNAME`, `GIT_USER`
- Email: `GIT_AUTHOR_EMAIL`, `GIT_EMAIL`, `GIT_USER_EMAIL`

### 6. Storage Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `storage.providerType` | 'in-memory' \| 'filesystem' \| 'supabase' \| 'cloudflare-kv' \| 'cloudflare-r2' | 'in-memory' | Storage backend |
| `storage.filesystemPath` | string | './.storage' | Filesystem storage path |

**Aliases:** `mem` → `in-memory`, `fs` → `filesystem`

### 7. Logging Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `logLevel` | 'fatal' \| 'error' \| 'warn' \| 'info' \| 'debug' \| 'trace' \| 'silent' | 'debug' | Log level |
| `logsPath` | string? | 'logs' (Node.js only) | Log output directory |
| `environment` | 'development' \| 'production' \| 'testing' | 'development' | Environment mode |

**Aliases:** `warning` → `warn`, `information` → `info`, `dev` → `development`, `prod` → `production`

### 8. OpenTelemetry Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `openTelemetry.enabled` | boolean | false | Enable telemetry |
| `openTelemetry.serviceName` | string | pkg.name | Service name |
| `openTelemetry.serviceVersion` | string | pkg.version | Service version |
| `openTelemetry.tracesEndpoint` | string? | undefined | OTLP traces endpoint |
| `openTelemetry.metricsEndpoint` | string? | undefined | OTLP metrics endpoint |
| `openTelemetry.samplingRatio` | number | 1.0 | Trace sampling ratio |

---

## Key Features

### Path Expansion with Tilde

The `expandTildePath()` helper automatically expands tilde notation:

```typescript
// Environment variable
GIT_BASE_DIR=~/Developer/projects

// Expanded to (example)
config.git.baseDir = '/Users/username/Developer/projects'

// Also supports:
~/Developer/  → /Users/username/Developer/
~             → /Users/username
/absolute/    → /absolute/ (unchanged)
```

**Used for:**
- `git.baseDir`
- `git.wrapupInstructionsPath`
- `storage.filesystemPath`
- `logsPath`

### Validation and Error Handling

Configuration errors are caught at startup before the server starts:

```typescript
// Invalid configuration
process.env.MCP_AUTH_MODE = 'invalid-mode';

// Result: McpError thrown
{
  code: JsonRpcErrorCode.ConfigurationError,
  message: 'Invalid application configuration.',
  data: {
    validationErrors: {
      mcpAuthMode: ["Invalid enum value..."]
    }
  }
}
```

### Runtime Environment Detection

```typescript
const hasFileSystemAccess =
  typeof process !== 'undefined' &&
  typeof process.versions === 'object' &&
  process.versions !== null &&
  typeof process.versions.node === 'string';
```

Used to:
- Set default `logsPath` only for Node.js environments
- Handle Cloudflare Workers compatibility

---

## Testing

### Unit Tests

**File:** `tests/config/index.test.ts`

Tests validation logic for:
- Schema validation success/failure
- Environment variable aliases
- Path expansion
- Default values
- Type coercion

### Integration Tests

**File:** `tests/config/index.int.test.ts`

Tests full configuration loading with:
- Real environment variables
- Complete validation flow
- Error handling

---

## FAQ

**Q: What happens if required environment variables are missing?**

A: The server exits immediately with a clear error message. For example:
```
❌ Invalid configuration found. Please check your environment variables.
{
  mcpAuthSecretKey: ["Required for jwt auth mode"]
}
```

**Q: Can I use custom environment variable names?**

A: No. The module expects specific variable names. However, aliases are supported for common variations (e.g., `GIT_USERNAME` or `GIT_USER` for author name).

**Q: How do I add a new configuration field?**

A:
1. Add field to `ConfigSchema` Zod object
2. Add to `rawConfig` in `parseConfig()`
3. Map environment variable in `rawConfig`
4. Update TypeScript type (`AppConfig` is inferred)
5. Add tests for validation

**Q: Why is configuration validated with Zod instead of manual checks?**

A: Zod provides:
- Automatic TypeScript type inference
- Runtime validation with clear error messages
- Type coercion and preprocessing
- Reusable validation schemas
- Single source of truth for types

---

## Related Files

- **Entry:** `src/config/index.ts` - Main configuration module
- **Tests:** `tests/config/index.test.ts` - Unit tests
- **Tests:** `tests/config/index.int.test.ts` - Integration tests
- **Example:** `.env.example` - Sample environment configuration

---

## Changelog

### 2025-11-27 - Initial Documentation
- Created module-level documentation
- Documented all configuration categories
- Added path expansion details
- Included testing information
