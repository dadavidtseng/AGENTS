/**
 * RoleLoader and RoleValidator — Configuration management for KĀDI worker agents
 *
 * Loads role configuration TOML files from config/roles/ and validates all sections
 * using Zod schemas. Returns typed RoleConfig objects or descriptive error messages.
 *
 * @module roles/RoleLoader
 */

import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { readConfigFile } from 'agents-library';

// ============================================================================
// Zod Schemas
// ============================================================================

/** Provider configuration schema */
const ProviderConfigSchema = z.object({
  model: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(65536).optional(),
});

/** Memory configuration schema */
const MemoryConfigSchema = z.object({
  enabled: z.boolean(),
  namespace: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, 'Namespace must be lowercase alphanumeric with hyphens, starting with a letter'),
});

/** Full role configuration schema */
const RoleConfigSchema = z.object({
  role: z.string().min(1, 'Role name is required'),
  capabilities: z.array(z.string().min(1)).min(1, 'At least one capability is required'),
  maxConcurrentTasks: z.number().int().min(1).max(10, 'maxConcurrentTasks must be between 1 and 10'),
  mainRepoPath: z.string().min(1).optional(),
  worktreePath: z.string().min(1).optional(),
  eventTopic: z.string().min(1, 'eventTopic is required'),
  commitFormat: z.string().min(1, 'commitFormat is required'),
  provider: ProviderConfigSchema.optional(),
  memory: MemoryConfigSchema.optional(),
  tools: z.array(z.string().min(1, 'Tool prefix must be non-empty')).optional(),
  networks: z.array(z.string().min(1)).optional(),
});

// ============================================================================
// Types
// ============================================================================

/** Provider configuration for LLM access */
export interface ProviderConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/** Memory service configuration */
export interface MemoryConfig {
  enabled: boolean;
  namespace: string;
}

/** Complete role configuration */
export interface RoleConfig {
  role: string;
  capabilities: string[];
  maxConcurrentTasks: number;
  mainRepoPath?: string;
  worktreePath?: string;
  eventTopic: string;
  commitFormat: string;
  provider?: ProviderConfig;
  memory?: MemoryConfig;
  tools?: string[];
  networks?: string[];
}

/** Validation result with typed errors */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ============================================================================
// RoleValidator
// ============================================================================

/**
 * Validates role configuration objects against the Zod schema.
 */
export class RoleValidator {
  validate(config: unknown): ValidationResult {
    const result = RoleConfigSchema.safeParse(config);

    if (result.success) {
      return { valid: true, errors: [] };
    }

    const errors = result.error.issues.map((issue) => {
      const fieldPath = issue.path.join('.');
      return fieldPath ? `${fieldPath}: ${issue.message}` : issue.message;
    });

    return { valid: false, errors };
  }
}

// ============================================================================
// RoleLoader
// ============================================================================

/**
 * Loads and validates role configuration files from the config/roles/ directory.
 *
 * Usage:
 * ```typescript
 * const loader = new RoleLoader('/path/to/agent-worker');
 * const config = loader.loadRole('artist');
 * ```
 */
export class RoleLoader {
  private readonly configDir: string;
  private readonly validator: RoleValidator;

  constructor(projectRoot: string) {
    this.configDir = path.join(projectRoot, 'config', 'roles');
    this.validator = new RoleValidator();
  }

  /**
   * Load and validate a role configuration by name.
   * Paths (mainRepoPath, worktreePath) are auto-derived from process.cwd()
   * unless explicitly set in the TOML file.
   */
  loadRole(roleName: string): RoleConfig {
    const filePath = path.join(this.configDir, `${roleName}.toml`);

    if (!fs.existsSync(filePath)) {
      throw new RoleConfigError(
        `Role configuration file not found: ${filePath}`,
        roleName,
        'FILE_NOT_FOUND',
      );
    }

    let rawConfig: Record<string, unknown>;
    try {
      const cfg = readConfigFile(filePath);
      rawConfig = {
        role: cfg.string('role'),
        capabilities: cfg.strings('capabilities'),
        maxConcurrentTasks: cfg.number('maxConcurrentTasks'),
        eventTopic: cfg.string('eventTopic'),
        commitFormat: cfg.string('commitFormat'),
        ...(cfg.has('mainRepoPath') && { mainRepoPath: cfg.string('mainRepoPath') }),
        ...(cfg.has('worktreePath') && { worktreePath: cfg.string('worktreePath') }),
        ...(cfg.has('tools') && { tools: cfg.strings('tools') }),
        ...(cfg.has('networks') && { networks: cfg.strings('networks') }),
        ...(cfg.has('provider.model') || cfg.has('provider.temperature') || cfg.has('provider.maxTokens') ? {
          provider: {
            ...(cfg.has('provider.model') && { model: cfg.string('provider.model') }),
            ...(cfg.has('provider.temperature') && { temperature: cfg.number('provider.temperature') }),
            ...(cfg.has('provider.maxTokens') && { maxTokens: cfg.number('provider.maxTokens') }),
          },
        } : {}),
        ...(cfg.has('memory.enabled') && {
          memory: {
            enabled: cfg.bool('memory.enabled'),
            namespace: cfg.string('memory.namespace'),
          },
        }),
      };
    } catch (error: any) {
      throw new RoleConfigError(
        `Failed to parse role configuration: ${error.message}`,
        roleName,
        'PARSE_ERROR',
      );
    }

    const result = this.validator.validate(rawConfig);
    if (!result.valid) {
      throw new RoleConfigError(
        `Invalid role configuration for '${roleName}':\n  - ${result.errors.join('\n  - ')}`,
        roleName,
        'VALIDATION_ERROR',
        result.errors,
      );
    }

    const config = rawConfig as unknown as RoleConfig;

    // Auto-derive playground paths from process.cwd() if not explicitly set.
    // Layout: cwd = .../AGENTS/agent-worker → 2 levels up = common parent
    //   mainRepoPath = <parent>/agent-playground
    //   worktreePath = <parent>/agent-playground-<role>
    if (!config.mainRepoPath || !config.worktreePath) {
      const grandparent = path.resolve(process.cwd(), '..', '..');
      if (!config.mainRepoPath) {
        config.mainRepoPath = path.join(grandparent, 'agent-playground');
      }
      if (!config.worktreePath) {
        config.worktreePath = path.join(grandparent, `agent-playground-${config.role}`);
      }
    }

    return config;
  }

  /**
   * List all available role names by scanning the config directory.
   */
  listRoles(): string[] {
    if (!fs.existsSync(this.configDir)) {
      return [];
    }

    return fs
      .readdirSync(this.configDir)
      .filter((f) => f.endsWith('.toml'))
      .map((f) => f.replace('.toml', ''));
  }
}

// ============================================================================
// Error Class
// ============================================================================

export class RoleConfigError extends Error {
  constructor(
    message: string,
    public readonly roleName: string,
    public readonly code: 'FILE_NOT_FOUND' | 'PARSE_ERROR' | 'VALIDATION_ERROR',
    public readonly validationErrors: string[] = [],
  ) {
    super(message);
    this.name = 'RoleConfigError';
  }
}
