/**
 * RoleLoader and RoleValidator — Configuration management for KĀDI worker agents
 *
 * Loads role configuration JSON files from config/roles/ and validates all sections
 * using Zod schemas. Returns typed RoleConfig objects or descriptive error messages.
 *
 * @module roles/RoleLoader
 */

import { z } from 'zod';
import fs from 'fs';
import path from 'path';

// ============================================================================
// Zod Schemas
// ============================================================================

/** Provider configuration schema */
const ProviderConfigSchema = z.object({
  model: z.string().min(1, 'Provider model name is required'),
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
  worktreePath: z.string().min(1, 'worktreePath is required'),
  eventTopic: z.string().min(1, 'eventTopic is required'),
  commitFormat: z.string().min(1, 'commitFormat is required'),
  provider: ProviderConfigSchema.optional(),
  memory: MemoryConfigSchema.optional(),
  tools: z.array(z.string().min(1, 'Tool prefix must be non-empty')).optional(),
});

// ============================================================================
// Types
// ============================================================================

/** Provider configuration for LLM access */
export interface ProviderConfig {
  model: string;
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
  worktreePath: string;
  eventTopic: string;
  commitFormat: string;
  provider?: ProviderConfig;
  memory?: MemoryConfig;
  tools?: string[];
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
 *
 * Returns a ValidationResult with descriptive error messages for each
 * validation failure. All fields are checked — both required and optional.
 */
export class RoleValidator {
  /**
   * Validate a raw configuration object.
   *
   * @param config - Raw parsed JSON object
   * @returns ValidationResult with `valid` flag and `errors` array
   */
  validate(config: unknown): ValidationResult {
    const result = RoleConfigSchema.safeParse(config);

    if (result.success) {
      return { valid: true, errors: [] };
    }

    // Map Zod issues to human-readable error messages
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

  /**
   * @param projectRoot - Absolute path to the agent project root (e.g., 'C:/GitHub/agent-worker')
   */
  constructor(projectRoot: string) {
    this.configDir = path.join(projectRoot, 'config', 'roles');
    this.validator = new RoleValidator();
  }

  /**
   * Load and validate a role configuration by name.
   *
   * @param roleName - Role identifier (e.g., 'artist', 'programmer', 'designer')
   * @returns Validated RoleConfig object
   * @throws {RoleConfigError} If file not found, JSON parse fails, or validation fails
   */
  loadRole(roleName: string): RoleConfig {
    const filePath = path.join(this.configDir, `${roleName}.json`);

    // Step 1: Check file exists
    if (!fs.existsSync(filePath)) {
      throw new RoleConfigError(
        `Role configuration file not found: ${filePath}`,
        roleName,
        'FILE_NOT_FOUND',
      );
    }

    // Step 2: Read and parse JSON
    let rawConfig: unknown;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      rawConfig = JSON.parse(content);
    } catch (error: any) {
      throw new RoleConfigError(
        `Failed to parse role configuration: ${error.message}`,
        roleName,
        'PARSE_ERROR',
      );
    }

    // Step 3: Validate
    const result = this.validator.validate(rawConfig);
    if (!result.valid) {
      throw new RoleConfigError(
        `Invalid role configuration for '${roleName}':\n  - ${result.errors.join('\n  - ')}`,
        roleName,
        'VALIDATION_ERROR',
        result.errors,
      );
    }

    return rawConfig as RoleConfig;
  }

  /**
   * List all available role names by scanning the config directory.
   *
   * @returns Array of role names (without .json extension)
   */
  listRoles(): string[] {
    if (!fs.existsSync(this.configDir)) {
      return [];
    }

    return fs
      .readdirSync(this.configDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
  }
}

// ============================================================================
// Error Class
// ============================================================================

/**
 * Typed error for role configuration failures.
 * Includes the role name and error code for programmatic handling.
 */
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
