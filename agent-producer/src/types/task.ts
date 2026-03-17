/**
 * Task management type definitions
 *
 * These types define the data structures for task coordination
 * between agent-producer and worker agents.
 */

/**
 * Worker agent roles
 */
export type WorkerRole = 'artist' | 'designer' | 'programmer';

/**
 * Task execution status
 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'approved';

/**
 * Task record stored by agent-producer
 */
export interface Task {
  /** Unique task identifier */
  id: string;

  /** Task description and requirements */
  description: string;

  /** Worker agent role assigned to this task */
  role: WorkerRole;

  /** Current task status */
  status: TaskStatus;

  /** Timestamp when task was created */
  createdAt: Date;

  /** Timestamp when task was last updated */
  updatedAt: Date;

  /** Timestamp when task was completed (if applicable) */
  completedAt?: Date;

  /** Worker agent progress details */
  progress?: {
    /** Files created in playground */
    filesCreated?: string[];

    /** Files modified in playground */
    filesModified?: string[];

    /** Git commit SHA */
    commitSha?: string;

    /** Error message (if failed) */
    errorMessage?: string;
  };
}

/**
 * KĀDI event payload for task assignment
 * Published to '{role}.task.assigned' topic
 */
export interface TaskAssignedEvent {
  /** Task ID */
  taskId: string;

  /** Task description */
  description: string;

  /** Context files (if any) */
  contextFiles?: string[];

  /** Assigned worker role */
  role: WorkerRole;
}

/**
 * KĀDI event payload for task completion
 * Published to '{role}.task.completed' topic
 */
export interface TaskCompletedEvent {
  /** Task ID */
  taskId: string;

  /** Worker agent role */
  role: WorkerRole;

  /** Files created */
  filesCreated: string[];

  /** Files modified */
  filesModified: string[];

  /** Git commit SHA */
  commitSha: string;

  /** Success summary */
  summary: string;
}

/**
 * KĀDI event payload for task failure
 * Published to '{role}.task.failed' topic
 */
export interface TaskFailedEvent {
  /** Task ID */
  taskId: string;

  /** Worker agent role */
  role: WorkerRole;

  /** Error message */
  errorMessage: string;

  /** Error stack trace */
  errorStack?: string;
}
