/**
 * Event Schema Type Definitions with Zod Validation
 * ==================================================
 *
 * Standardized event schemas for KĀDI multi-agent orchestration system.
 * Includes TypeScript interfaces and Zod schemas for runtime validation.
 *
 * Event Topic Pattern: {role}.{event_type}
 * - artist.task.assigned
 * - artist.task.completed
 * - artist.task.failed
 * - shadow-artist.backup.completed
 *
 * Design Principles:
 * - All timestamps use ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)
 * - Backward compatible with existing event payloads
 * - Runtime validation via Zod schemas
 * - Type-safe event handling
 *
 * @module event-schemas
 */

import { z } from '@kadi.build/core';

// ============================================================================
// Task Assignment Event
// ============================================================================

/**
 * Event published when a task is assigned to a worker agent
 *
 * Topic Pattern: {role}.task.assigned
 * - artist.task.assigned
 * - designer.task.assigned
 * - programmer.task.assigned
 *
 * @example
 * ```typescript
 * const event: TaskAssignedEvent = {
 *   taskId: 'task-123',
 *   role: 'artist',
 *   description: 'Create hero banner image',
 *   requirements: 'Size: 1920x1080, Format: PNG, Theme: Modern tech',
 *   timestamp: '2025-12-04T10:30:00.000Z'
 * };
 * ```
 */
export interface TaskAssignedEvent {
  /** Unique task identifier */
  taskId: string;

  /** Agent role assigned to this task */
  role: string;

  /** Human-readable task description */
  description: string;

  /** Detailed requirements or specifications */
  requirements: string;

  /** ISO 8601 timestamp when task was assigned */
  timestamp: string;
}

/**
 * Zod schema for TaskAssignedEvent runtime validation
 */
export const TaskAssignedEventSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  role: z.string().min(1, 'Role is required'),
  description: z.string().min(1, 'Description is required'),
  requirements: z.string(),
  timestamp: z.string().datetime('Invalid ISO 8601 timestamp')
});

// ============================================================================
// Task Completion Event
// ============================================================================

/**
 * Event published when a worker agent successfully completes a task
 *
 * Topic Pattern: {role}.task.completed
 * - artist.task.completed
 * - designer.task.completed
 * - programmer.task.completed
 *
 * This schema maintains backward compatibility with existing agent-artist implementation.
 *
 * @example
 * ```typescript
 * const event: TaskCompletedEvent = {
 *   taskId: 'task-123',
 *   role: 'artist',
 *   status: 'completed',
 *   filesCreated: ['artwork-hero-banner.png'],
 *   filesModified: [],
 *   commitSha: 'a1b2c3d4e5f6g7h8i9j0',
 *   timestamp: '2025-12-04T10:45:00.000Z',
 *   agent: 'agent-artist'
 * };
 * ```
 */
export interface TaskCompletedEvent {
  /** Unique task identifier */
  taskId: string;

  /** Agent role that completed this task */
  role: string;

  /** Task completion status (always 'completed') */
  status: 'completed';

  /** Array of file paths created during task execution */
  filesCreated: string[];

  /** Array of file paths modified during task execution */
  filesModified: string[];

  /** Git commit SHA of the commit containing task output */
  commitSha: string;

  /** ISO 8601 timestamp when task was completed */
  timestamp: string;

  /** Agent identifier (e.g., 'agent-artist', 'agent-designer') */
  agent: string;
}

/**
 * Zod schema for TaskCompletedEvent runtime validation
 */
export const TaskCompletedEventSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  role: z.string().min(1, 'Role is required'),
  status: z.literal('completed'),
  filesCreated: z.array(z.string()),
  filesModified: z.array(z.string()),
  commitSha: z.string().min(1, 'Commit SHA is required'),
  timestamp: z.string().datetime('Invalid ISO 8601 timestamp'),
  agent: z.string().min(1, 'Agent identifier is required')
});

// ============================================================================
// Task Failure Event
// ============================================================================

/**
 * Event published when a worker agent fails to complete a task
 *
 * Topic Pattern: {role}.task.failed
 * - artist.task.failed
 * - designer.task.failed
 * - programmer.task.failed
 *
 * This schema maintains backward compatibility with existing agent-artist implementation.
 *
 * @example
 * ```typescript
 * const event: TaskFailedEvent = {
 *   taskId: 'task-123',
 *   role: 'artist',
 *   error: 'Claude API timeout after 60 seconds',
 *   timestamp: '2025-12-04T10:45:00.000Z',
 *   agent: 'agent-artist'
 * };
 * ```
 */
export interface TaskFailedEvent {
  /** Unique task identifier */
  taskId: string;

  /** Agent role that attempted this task */
  role: string;

  /** Error message describing the failure */
  error: string;

  /** ISO 8601 timestamp when task failed */
  timestamp: string;

  /** Agent identifier (e.g., 'agent-artist', 'agent-designer') */
  agent: string;
}

/**
 * Zod schema for TaskFailedEvent runtime validation
 */
export const TaskFailedEventSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  role: z.string().min(1, 'Role is required'),
  error: z.string().min(1, 'Error message is required'),
  timestamp: z.string().datetime('Invalid ISO 8601 timestamp'),
  agent: z.string().min(1, 'Agent identifier is required')
});

// ============================================================================
// Backup Event (Shadow Agent)
// ============================================================================

/**
 * Event published when a shadow agent completes a backup operation
 *
 * Topic Pattern: shadow-{role}.backup.completed
 * - shadow-artist.backup.completed
 * - shadow-designer.backup.completed
 * - shadow-programmer.backup.completed
 *
 * Shadow agents watch worker worktrees and create mirror commits in shadow worktrees.
 *
 * @example
 * ```typescript
 * const event: BackupEvent = {
 *   role: 'artist',
 *   operation: 'mirror-commit',
 *   status: 'success',
 *   filesBackedUp: ['artwork-hero-banner.png', 'artwork-logo.svg'],
 *   timestamp: '2025-12-04T10:46:00.000Z'
 * };
 * ```
 */
export interface BackupEvent {
  /** Agent role being backed up */
  role: string;

  /** Backup operation type (e.g., 'mirror-commit', 'full-sync') */
  operation: string;

  /** Operation status */
  status: 'success' | 'failure';

  /** Array of file paths that were backed up */
  filesBackedUp: string[];

  /** Error message if status is 'failure' (optional) */
  error?: string;

  /** ISO 8601 timestamp when backup operation completed */
  timestamp: string;
}

/**
 * Zod schema for BackupEvent runtime validation
 */
export const BackupEventSchema = z.object({
  role: z.string().min(1, 'Role is required'),
  operation: z.string().min(1, 'Operation type is required'),
  status: z.enum(['success', 'failure']),
  filesBackedUp: z.array(z.string()),
  error: z.string().optional(),
  timestamp: z.string().datetime('Invalid ISO 8601 timestamp')
});

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if an object is a valid TaskAssignedEvent
 *
 * @param obj - Object to validate
 * @returns True if obj matches TaskAssignedEvent schema
 */
export function isTaskAssignedEvent(obj: unknown): obj is TaskAssignedEvent {
  return TaskAssignedEventSchema.safeParse(obj).success;
}

/**
 * Type guard to check if an object is a valid TaskCompletedEvent
 *
 * @param obj - Object to validate
 * @returns True if obj matches TaskCompletedEvent schema
 */
export function isTaskCompletedEvent(obj: unknown): obj is TaskCompletedEvent {
  return TaskCompletedEventSchema.safeParse(obj).success;
}

/**
 * Type guard to check if an object is a valid TaskFailedEvent
 *
 * @param obj - Object to validate
 * @returns True if obj matches TaskFailedEvent schema
 */
export function isTaskFailedEvent(obj: unknown): obj is TaskFailedEvent {
  return TaskFailedEventSchema.safeParse(obj).success;
}

/**
 * Type guard to check if an object is a valid BackupEvent
 *
 * @param obj - Object to validate
 * @returns True if obj matches BackupEvent schema
 */
export function isBackupEvent(obj: unknown): obj is BackupEvent {
  return BackupEventSchema.safeParse(obj).success;
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate and parse TaskAssignedEvent with detailed error messages
 *
 * @param obj - Object to validate
 * @returns Parsed TaskAssignedEvent
 * @throws ZodError with detailed validation errors
 */
export function parseTaskAssignedEvent(obj: unknown): TaskAssignedEvent {
  return TaskAssignedEventSchema.parse(obj);
}

/**
 * Validate and parse TaskCompletedEvent with detailed error messages
 *
 * @param obj - Object to validate
 * @returns Parsed TaskCompletedEvent
 * @throws ZodError with detailed validation errors
 */
export function parseTaskCompletedEvent(obj: unknown): TaskCompletedEvent {
  return TaskCompletedEventSchema.parse(obj);
}

/**
 * Validate and parse TaskFailedEvent with detailed error messages
 *
 * @param obj - Object to validate
 * @returns Parsed TaskFailedEvent
 * @throws ZodError with detailed validation errors
 */
export function parseTaskFailedEvent(obj: unknown): TaskFailedEvent {
  return TaskFailedEventSchema.parse(obj);
}

/**
 * Validate and parse BackupEvent with detailed error messages
 *
 * @param obj - Object to validate
 * @returns Parsed BackupEvent
 * @throws ZodError with detailed validation errors
 */
export function parseBackupEvent(obj: unknown): BackupEvent {
  return BackupEventSchema.parse(obj);
}
