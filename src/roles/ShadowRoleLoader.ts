/**
 * ShadowRoleLoader and ShadowRoleValidator — Configuration management for KĀDI shadow agents
 *
 * Loads shadow role configuration JSON files from config/roles/ and validates all sections
 * using Zod schemas. Includes shadow-specific validation: worktree path existence,
 * git branch name format, and monitoring interval bounds.
 *
 * @module roles/ShadowRoleLoader
 */

import { z } from 'zod';
import fs from 'fs';
import path from 'path';

// ============================================================================
// Zod Schemas
// ============================================================================

/** Provider configuration schema (optional — for future shadow agent intelligence) */
const ProviderConfigSchema = z.object({
  model: z.string().min(1, 'Provider model name is required'),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(65536).optional(),
});

/** Memory configuration schema (optional — for future persistent state) */
const MemoryConfigSchema = z.object({
  enabled: z.boolean(),
  namespace: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, 'Namespace must be lowercase alphanumeric with hyphens, starting with a letter'),
});

/** Full shadow role configuration schema */
const ShadowRoleConfigSchema = z.object({
  role: z.string().min(1, 'Role name is required'),
  mainRepoPath: z.string().min(1).optional(),
  workerWorktreePath: z.string().min(1, 'workerWorktreePath is required'),
  shadowWorktreePath: z.string().min(1, 'shadowWorktreePath is required'),
  workerBranch: z.string().min(1, 'workerBranch is required'),
  shadowBranch: z.string().min(1, 'shadowBranch is required'),
  monitoringInterval: z
    .number()
    .int()
    .min(500, 'monitoringInterval must be at least 500ms')
    .max(60000, 'monitoringInterval must not exceed 60000ms'),
  debounceMs: z
    .number()
    .int()
    .min(100, 'debounceMs must be at least 100ms')
    .max(30000, 'debounceMs must not exceed 30000ms')
    .optional(),
  provider: ProviderConfigSchema.optional(),
  memory: MemoryConfigSchema.optional(),
});

// ============================================================================
// Types
// ============================================================================

/** Provider configuration for LLM access (future shadow intelligence) */
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

/** Complete shadow role configuration */
export interface ShadowRoleConfig {
  role: string;
  workerWorktreePath: string;
  shadowWorktreePath: string;
  workerBranch: string;
  shadowBranch: string;
  monitoringInterval: number;
  debounceMs?: number;
  provider?: ProviderConfig;
  memory?: MemoryConfig;
}

/** Validation result with typed errors */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ============================================================================
// ShadowRoleValidator
// ============================================================================

/**
 * Validates shadow role configuration objects against the Zod schema
 * and performs shadow-specific runtime checks.
 *
 * Validation layers:
 * 1. Zod schema — type safety, required fields, value bounds
 * 2. Worktree paths — directories must exist on disk
 * 3. Branch names — must be valid git branch name format
 */
export class ShadowRoleValidator {
  /**
   * Validate a raw configuration object.
   *
   * @param config - Raw parsed JSON object
   * @returns ValidationResult with `valid` flag and `errors` array
   */
  validate(config: unknown): ValidationResult {
    const errors: string[] = [];

    // Layer 1: Zod schema validation
    const result = ShadowRoleConfigSchema.safeParse(config);

    if (!result.success) {
      const zodErrors = result.error.issues.map((issue) => {
        const fieldPath = issue.path.join('.');
        return fieldPath ? `${fieldPath}: ${issue.message}` : issue.message;
      });
      return { valid: false, errors: zodErrors };
    }

    const parsed = result.data;

    // Layer 2: Worktree path existence checks (skip if mainRepoPath is set — auto-creation will handle it)
    if (!parsed.mainRepoPath) {
      if (!fs.existsSync(parsed.workerWorktreePath)) {
        errors.push(`workerWorktreePath: Directory does not exist: ${parsed.workerWorktreePath}`);
      }
      if (!fs.existsSync(parsed.shadowWorktreePath)) {
        errors.push(`shadowWorktreePath: Directory does not exist: ${parsed.shadowWorktreePath}`);
      }
    }

    // Layer 3: Git branch name format validation
    // Git branch names cannot contain: space, ~, ^, :, ?, *, [, \, ..
    const gitBranchRegex = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;
    if (!gitBranchRegex.test(parsed.workerBranch)) {
      errors.push(`workerBranch: Invalid git branch name format: '${parsed.workerBranch}'`);
    }
    if (!gitBranchRegex.test(parsed.shadowBranch)) {
      errors.push(`shadowBranch: Invalid git branch name format: '${parsed.shadowBranch}'`);
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, errors: [] };
  }
}

// ============================================================================
// ShadowRoleLoader
// ============================================================================

/**
 * Loads and validates shadow role configuration files from the config/roles/ directory.
 *
 * Usage:
 * ```typescript
 * const loader = new ShadowRoleLoader('/path/to/shadow-agent-worker');
 * const config = loader.loadRole('artist');
 * ```
 */
export class ShadowRoleLoader {
  private readonly configDir: string;
  private readonly validator: ShadowRoleValidator;

  /**
   * @param projectRoot - Absolute path to the shadow agent project root
   */
  constructor(projectRoot: string) {
    this.configDir = path.join(projectRoot, 'config', 'roles');
    this.validator = new ShadowRoleValidator();
  }

  /**
   * Load and validate a shadow role configuration by name.
   *
   * @param roleName - Role identifier (e.g., 'artist', 'programmer', 'designer')
   * @returns Validated ShadowRoleConfig object
   * @throws {ShadowRoleConfigError} If file not found, JSON parse fails, or validation fails
   */
  loadRole(roleName: string): ShadowRoleConfig {
    const filePath = path.join(this.configDir, `${roleName}.json`);

    // Step 1: Check file exists
    if (!fs.existsSync(filePath)) {
      throw new ShadowRoleConfigError(
        `Shadow role configuration file not found: ${filePath}`,
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
      throw new ShadowRoleConfigError(
        `Failed to parse shadow role configuration: ${error.message}`,
        roleName,
        'PARSE_ERROR',
      );
    }

    // Step 3: Validate (schema + runtime checks)
    const result = this.validator.validate(rawConfig);
    if (!result.valid) {
      throw new ShadowRoleConfigError(
        `Invalid shadow role configuration for '${roleName}':\n  - ${result.errors.join('\n  - ')}`,
        roleName,
        'VALIDATION_ERROR',
        result.errors,
      );
    }

    return rawConfig as ShadowRoleConfig;
  }

  /**
   * List all available shadow role names by scanning the config directory.
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
 * Typed error for shadow role configuration failures.
 * Includes the role name and error code for programmatic handling.
 */
export class ShadowRoleConfigError extends Error {
  constructor(
    message: string,
    public readonly roleName: string,
    public readonly code: 'FILE_NOT_FOUND' | 'PARSE_ERROR' | 'VALIDATION_ERROR',
    public readonly validationErrors: string[] = [],
  ) {
    super(message);
    this.name = 'ShadowRoleConfigError';
  }
}
