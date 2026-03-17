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
 * - backup.completed / backup.failed
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
// Generic Event Wrapper
// ============================================================================

/**
 * Generic KĀDI event envelope wrapping all inter-agent events.
 * Every event published to the broker is wrapped in this structure.
 *
 * @template T - Event-specific payload type
 */
export interface KadiEvent<T = unknown> {
  /** Event type identifier (e.g., 'quest.approved', 'task.assigned') */
  type: string;
  /** Quest ID this event relates to */
  questId: string;
  /** Task ID (present for task-level events) */
  taskId?: string;
  /** Event-specific payload */
  payload: T;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Publishing agent ID */
  source: string;
}

export const KadiEventSchema = z.object({
  type: z.string().min(1),
  questId: z.string().min(1),
  taskId: z.string().optional(),
  payload: z.unknown(),
  timestamp: z.string().datetime(),
  source: z.string().min(1),
});

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

  /** Quest ID this task belongs to (optional for backward compatibility) */
  questId?: string;

  /** Agent role assigned to this task */
  role: string;

  /** Human-readable task description */
  description: string;

  /** Detailed requirements or specifications */
  requirements: string;

  /** ISO 8601 timestamp when task was assigned */
  timestamp: string;

  /** User or agent that assigned this task (optional) */
  assignedBy?: string;

  /** Feedback from previous verification failure (present on retry) */
  feedback?: string;

  /** Retry attempt number (0 = first attempt, 1+ = retry) */
  retryAttempt?: number;
}

/**
 * Zod schema for TaskAssignedEvent runtime validation
 */
export const TaskAssignedEventSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  questId: z.string().optional(),
  role: z.string().min(1, 'Role is required'),
  description: z.string().min(1, 'Description is required'),
  requirements: z.string(),
  timestamp: z.string().datetime('Invalid ISO 8601 timestamp'),
  assignedBy: z.string().optional(),
  feedback: z.string().optional(),
  retryAttempt: z.number().optional()
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

  /** Quest ID this task belongs to (optional for backward compatibility) */
  questId?: string;

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

  /** Truncated summary of generated content for verification (optional) */
  contentSummary?: string;

  /** Absolute path to the git worktree where the worker executed (for independent verification) */
  worktreePath?: string;
}

/**
 * Zod schema for TaskCompletedEvent runtime validation
 */
export const TaskCompletedEventSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  questId: z.string().optional(),
  role: z.string().min(1, 'Role is required'),
  status: z.literal('completed'),
  filesCreated: z.array(z.string()),
  filesModified: z.array(z.string()),
  commitSha: z.string().min(1, 'Commit SHA is required'),
  timestamp: z.string().datetime('Invalid ISO 8601 timestamp'),
  agent: z.string().min(1, 'Agent identifier is required'),
  contentSummary: z.string().optional(),
  worktreePath: z.string().optional()
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

  /** Quest identifier this task belongs to */
  questId: string;

  /** Agent role that attempted this task */
  role: string;

  /** Error message describing the failure */
  error: string;

  /** ISO 8601 timestamp when task failed */
  timestamp: string;

  /** Agent identifier (e.g., 'agent-artist', 'agent-designer') */
  agent: string;

  /** Retry attempt number carried from the original task.assigned (0 = first attempt) */
  retryAttempt?: number;
}

/**
 * Zod schema for TaskFailedEvent runtime validation
 */
export const TaskFailedEventSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  questId: z.string().min(1, 'Quest ID is required'),
  role: z.string().min(1, 'Role is required'),
  error: z.string().min(1, 'Error message is required'),
  timestamp: z.string().datetime('Invalid ISO 8601 timestamp'),
  agent: z.string().min(1, 'Agent identifier is required'),
  retryAttempt: z.number().optional()
});

// ============================================================================
// Task Rejection Event
// ============================================================================

/**
 * Event published when a worker agent rejects a task due to capability mismatch
 *
 * Topic Pattern: task.rejected
 *
 * Worker agents validate incoming tasks against their capabilities before execution.
 * If the task description doesn't match the agent's skill set, the agent publishes
 * this event instead of attempting execution.
 *
 * @example
 * ```typescript
 * const event: TaskRejectedEvent = {
 *   taskId: 'task-123',
 *   questId: 'quest-456',
 *   role: 'artist',
 *   reason: 'Task requires database/backend skills, not artistic capabilities',
 *   timestamp: '2025-12-04T10:45:00.000Z',
 *   agent: 'agent-artist'
 * };
 * ```
 */
export interface TaskRejectedEvent {
  /** Unique task identifier */
  taskId: string;

  /** Quest identifier (optional, for quest-based workflows) */
  questId?: string;

  /** Agent role that rejected this task */
  role: string;

  /** Reason for rejection (capability mismatch explanation) */
  reason: string;

  /** ISO 8601 timestamp when task was rejected */
  timestamp: string;

  /** Agent identifier (e.g., 'agent-artist', 'agent-designer') */
  agent: string;
}

/**
 * Zod schema for TaskRejectedEvent runtime validation
 */
export const TaskRejectedEventSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  questId: z.string().optional(),
  role: z.string().min(1, 'Role is required'),
  reason: z.string().min(1, 'Rejection reason is required'),
  timestamp: z.string().datetime('Invalid ISO 8601 timestamp'),
  agent: z.string().min(1, 'Agent identifier is required')
});

// ============================================================================
// Backup Event (Shadow Agent)
// ============================================================================

/**
 * Event published when a shadow agent completes a backup operation
 *
 * Topic Pattern: backup.{completed|failed}
 * Agent identity is carried in the payload `agent` field (e.g., 'shadow-agent-artist').
 *
 * Shadow agents watch worker worktrees and create mirror commits in shadow worktrees.
 *
 * @example
 * ```typescript
 * const event: BackupEvent = {
 *   agent: 'shadow-agent-artist',
 *   role: 'artist',
 *   operation: 'mirror-commit',
 *   status: 'success',
 *   filesBackedUp: ['artwork-hero-banner.png', 'artwork-logo.svg'],
 *   timestamp: '2025-12-04T10:46:00.000Z'
 * };
 * ```
 */
export interface BackupEvent {
  /** Agent identifier (e.g., 'shadow-agent-artist', 'shadow-agent-designer') */
  agent: string;

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
  agent: z.string().min(1, 'Agent identifier is required'),
  role: z.string().min(1, 'Role is required'),
  operation: z.string().min(1, 'Operation type is required'),
  status: z.enum(['success', 'failure']),
  filesBackedUp: z.array(z.string()),
  error: z.string().optional(),
  timestamp: z.string().datetime('Invalid ISO 8601 timestamp')
});

// ============================================================================
// Quest Lifecycle Events (M4)
// ============================================================================

/** Payload for quest.approved event — HUMAN approves quest via agent-quest */
export interface QuestApprovedPayload {
  questId: string;
}
export const QuestApprovedPayloadSchema = z.object({
  questId: z.string().min(1),
});

/** Payload for quest.revision_requested — HUMAN requests changes */
export interface QuestRevisionRequestedPayload {
  questId: string;
  comments: string;
}
export const QuestRevisionRequestedPayloadSchema = z.object({
  questId: z.string().min(1),
  comments: z.string().min(1),
});

/** Payload for quest.rejected — HUMAN rejects quest */
export interface QuestRejectedPayload {
  questId: string;
}
export const QuestRejectedPayloadSchema = z.object({
  questId: z.string().min(1),
});

/** Payload for quest.tasks_ready — agent-producer finished planning */
export interface QuestTasksReadyPayload {
  questId: string;
}
export const QuestTasksReadyPayloadSchema = z.object({
  questId: z.string().min(1),
});

/** Payload for quest.pr_created — agent-lead created PR */
export interface QuestPrCreatedPayload {
  questId: string;
  prUrl: string;
}
export const QuestPrCreatedPayloadSchema = z.object({
  questId: z.string().min(1),
  prUrl: z.string().min(1),
});

/** Payload for quest.merged — HUMAN merged PR on GitHub */
export interface QuestMergedPayload {
  questId: string;
  prId: string;
}
export const QuestMergedPayloadSchema = z.object({
  questId: z.string().min(1),
  prId: z.string().min(1),
});

/** Payload for quest.pr_rejected — HUMAN closed PR without merge */
export interface QuestPrRejectedPayload {
  questId: string;
  prId: string;
}
export const QuestPrRejectedPayloadSchema = z.object({
  questId: z.string().min(1),
  prId: z.string().min(1),
});

/** Payload for quest.completed — all tasks verified, PR merged */
export interface QuestCompletedPayload {
  questId: string;
}
export const QuestCompletedPayloadSchema = z.object({
  questId: z.string().min(1),
});

// ============================================================================
// Task Pipeline Events (M4)
// ============================================================================

/** Payload for task.review_requested — worker submits to QA */
export interface TaskReviewRequestedPayload {
  taskId: string;
  questId: string;
  branch: string;
  commitHash: string;
  revisionCount?: number;
  /**
   * Optional screenshot URI for visual validation.
   * Supported formats:
   *   - Local path: "C:/path/to/screenshot.png" or "/path/to/screenshot.png"
   *   - Remote: "remote://host/path/to/screenshot.png"
   *   - Cloud: "cloud://dropbox/path/to/screenshot.png"
   *   - Data URI: "data:image/png;base64,..."
   *   - HTTP URL: "https://example.com/screenshot.png"
   */
  screenshotUri?: string;
}
export const TaskReviewRequestedPayloadSchema = z.object({
  taskId: z.string().min(1),
  questId: z.string().min(1),
  branch: z.string().min(1),
  commitHash: z.string().min(1),
  revisionCount: z.number().optional(),
  screenshotUri: z.string().optional(),
});

/** Payload for task.revision_needed — QA rejects, worker must retry */
export interface TaskRevisionNeededPayload {
  taskId: string;
  questId: string;
  score: number;
  feedback: string;
  revisionCount: number;
}
export const TaskRevisionNeededPayloadSchema = z.object({
  taskId: z.string().min(1),
  questId: z.string().min(1),
  score: z.number(),
  feedback: z.string().min(1),
  revisionCount: z.number(),
});

/** Payload for task.validated — QA passes, sent to agent-lead */
export interface TaskValidatedPayload {
  taskId: string;
  questId: string;
  score: number;
  severity: 'PASS' | 'WARN' | 'FAIL';
  feedback: string;
}
export const TaskValidatedPayloadSchema = z.object({
  taskId: z.string().min(1),
  questId: z.string().min(1),
  score: z.number(),
  severity: z.enum(['PASS', 'WARN', 'FAIL']),
  feedback: z.string(),
});

/** Payload for task.verified — agent-lead confirms and merges to staging */
export interface TaskVerifiedPayload {
  taskId: string;
  questId: string;
  isQuestComplete: boolean;
}
export const TaskVerifiedPayloadSchema = z.object({
  taskId: z.string().min(1),
  questId: z.string().min(1),
  isQuestComplete: z.boolean(),
});

/** Payload for pr.changes_requested — GitHub PR review requests changes */
export interface PrChangesRequestedPayload {
  questId: string;
  prId: string;
  comments: string;
}
export const PrChangesRequestedPayloadSchema = z.object({
  questId: z.string().min(1),
  prId: z.string().min(1),
  comments: z.string().min(1),
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

/**
 * Type guard to check if an object is a valid TaskRejectedEvent
 *
 * @param obj - Object to validate
 * @returns True if obj matches TaskRejectedEvent schema
 */
export function isTaskRejectedEvent(obj: unknown): obj is TaskRejectedEvent {
  return TaskRejectedEventSchema.safeParse(obj).success;
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

/**
 * Validate and parse TaskRejectedEvent with detailed error messages
 *
 * @param obj - Object to validate
 * @returns Parsed TaskRejectedEvent
 * @throws ZodError with detailed validation errors
 */
export function parseTaskRejectedEvent(obj: unknown): TaskRejectedEvent {
  return TaskRejectedEventSchema.parse(obj);
}
