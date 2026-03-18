/**
 * Task Detail Page - Detailed view of a single task
 * Shows task information, implementation guide, verification criteria, and related files
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiClient } from '../api/client';
import { useWebSocket, useWsEvent } from '../hooks/useWebSocket';
import { ApprovalPanel } from '../components/ApprovalPanel';
import { TaskTimeline } from '../components/TaskTimeline';

/**
 * Extended Task interface with all fields from backend
 */
interface TaskDetail {
  id: string;
  questId: string;
  name: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'pending_approval';
  implementationGuide?: string;
  verificationCriteria?: string;
  dependencies: string[];
  relatedFiles: Array<{
    path: string;
    type: string;
    description?: string;
    lineStart?: number;
    lineEnd?: number;
  }>;
  assignedAgent?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: {
    deliverables: string[];
    notes?: string;
    submittedAt: string;
  };
  artifacts?: {
    verificationHistory?: Array<{
      score: number;
      summary: string;
      verifiedBy: string;
      timestamp: string;
      passed: boolean;
    }>;
    verified?: boolean;
    verificationScore?: number;
  };
}

/**
 * Status badge color mapping
 */
const STATUS_COLORS: Record<string, { dot: string; text: string }> = {
  pending: { dot: 'bg-text-tertiary', text: 'Pending' },
  pending_approval: { dot: 'bg-yellow animate-pulse-dot', text: 'Pending Approval' },
  in_progress: { dot: 'bg-blue animate-pulse-dot', text: 'In Progress' },
  completed: { dot: 'bg-green', text: 'Completed' },
  failed: { dot: 'bg-red', text: 'Failed' },
};

/**
 * Task status badge — Portfolio-style
 */
function TaskStatusBadge({ status }: { status: string }) {
  const config = STATUS_COLORS[status] || { dot: 'bg-text-tertiary', text: status };

  return (
    <span className="inline-flex items-center gap-2 text-[0.75rem] text-text-secondary border border-border px-3 py-1.5 rounded-full">
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {config.text}
    </span>
  );
}

/**
 * File type badge — Portfolio-style mono tag
 */
const FILE_TYPE_COLORS: Record<string, string> = {
  TO_MODIFY: 'text-yellow',
  REFERENCE: 'text-blue',
  CREATE: 'text-green',
  DEPENDENCY: 'text-[#a855f7]',
  OTHER: 'text-text-tertiary',
};

/**
 * Task Detail Page Component
 */
export function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const [searchParams] = useSearchParams();
  const questId = searchParams.get('questId');
  const navigate = useNavigate();

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Load task details
   */
  const loadTask = async () => {
    if (!taskId || !questId) return;

    try {
      setLoading(true);
      setError(null);
      
      // Fetch task details from API
      const response = await apiClient.getTaskDetails(questId, taskId);
      setTask(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load task details');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Initialize and load task
   */
  useEffect(() => {
    loadTask();
  }, [taskId, questId]);

  // WebSocket connection
  useWebSocket();

  // Real-time task status changes
  useWsEvent('task.completed', useCallback((data: unknown) => {
    const update = data as { taskId: string };
    if (update.taskId === taskId) {
      loadTask();
    }
  }, [taskId]));

  /**
   * Loading state
   */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue mx-auto mb-4"></div>
          <p className="text-text-secondary">Loading task details...</p>
        </div>
      </div>
    );
  }

  /**
   * Error state
   */
  if (error) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center max-w-md">
          <div className="text-red text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold tracking-tight text-text-primary mb-2">Error Loading Task</h2>
          <p className="text-sm font-light text-text-secondary mb-6">{error}</p>
          <button
            onClick={() => navigate(questId ? `/quests/${questId}` : '/quests')}
            className="text-[0.85rem] font-medium text-bg bg-text-primary px-7 py-3 rounded-lg hover:opacity-85 hover:-translate-y-px transition-all"
          >
            Back to Quest
          </button>
        </div>
      </div>
    );
  }

  /**
   * Task not found
   */
  if (!task) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center">
          <p className="text-text-secondary">Task not found</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Back Button */}
        <button
          onClick={() => navigate(questId ? `/quests/${questId}` : '/quests')}
          className="mb-8 text-sm text-text-secondary hover:text-text-primary transition-colors flex items-center gap-2"
        >
          ← Back to Quest
        </button>

        {/* Task Header */}
        <div className="bg-bg-card rounded-xl border border-border mb-8 p-8">
          <div className="flex justify-between items-start mb-5">
            <div>
              <p className="font-mono text-[0.65rem] tracking-[0.15em] uppercase text-blue mb-3">Task</p>
              <h1 className="text-[2rem] font-semibold tracking-tight text-text-primary mb-2">{task.name}</h1>
              <p className="font-mono text-[0.7rem] tracking-wide text-text-tertiary">{task.id}</p>
            </div>
            <TaskStatusBadge status={task.status} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm font-light text-text-secondary">
            <div>
              <span className="font-medium">Created:</span>{' '}
              {new Date(task.createdAt).toLocaleDateString()}
            </div>
            <div>
              <span className="font-medium">Updated:</span>{' '}
              {new Date(task.updatedAt).toLocaleDateString()}
            </div>
            {task.assignedAgent && (
              <div>
                <span className="font-medium">Assigned to:</span> {task.assignedAgent}
              </div>
            )}
            {task.dependencies.length > 0 && (
              <div>
                <span className="font-medium">Dependencies:</span> {task.dependencies.length} task(s)
              </div>
            )}
          </div>

          {task.startedAt && (
            <div className="mt-4 text-sm text-text-secondary">
              <span className="font-medium">Started:</span>{' '}
              {new Date(task.startedAt).toLocaleString()}
            </div>
          )}

          {task.completedAt && (
            <div className="mt-2 text-sm text-text-secondary">
              <span className="font-medium">Completed:</span>{' '}
              {new Date(task.completedAt).toLocaleString()}
            </div>
          )}
        </div>

        {/* Description Section */}
        <div className="bg-bg-card rounded-xl border border-border mb-8 p-8">
          <h2 className="text-xl font-semibold tracking-tight text-text-primary mb-5">Description</h2>
          <div className="prose max-w-none">
            <p className="text-sm font-light leading-relaxed text-text-secondary whitespace-pre-wrap">{task.description}</p>
          </div>
        </div>

        {/* Implementation Guide Section */}
        {task.implementationGuide && (
          <div className="bg-bg-card rounded-xl border border-border mb-8 p-8">
            <h2 className="text-xl font-semibold tracking-tight text-text-primary mb-5">Implementation Guide</h2>
            <div className="prose max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {task.implementationGuide}
              </ReactMarkdown>
            </div>
          </div>
        )}

        {/* Verification Criteria Section */}
        {task.verificationCriteria && (
          <div className="bg-bg-card rounded-xl border border-border mb-8 p-8">
            <h2 className="text-xl font-semibold tracking-tight text-text-primary mb-5">Verification Criteria</h2>
            <div className="prose max-w-none">
              <p className="text-sm font-light leading-relaxed text-text-secondary whitespace-pre-wrap">{task.verificationCriteria}</p>
            </div>
          </div>
        )}

        {/* Dependencies Section */}
        {task.dependencies.length > 0 && (
          <div className="bg-bg-card rounded-xl border border-border mb-8 p-8">
            <h2 className="text-xl font-semibold tracking-tight text-text-primary mb-5">
              Dependencies ({task.dependencies.length})
            </h2>
            <div className="space-y-2">
              {task.dependencies.map((depId) => (
                <div
                  key={depId}
                  className="flex items-center gap-3 p-3 bg-bg-elevated rounded-lg hover:bg-border transition-colors cursor-pointer"
                  onClick={() => navigate(`/tasks/${depId}?questId=${questId}`)}
                >
                  <span className="text-text-primary font-medium">{depId}</span>
                  <span className="text-text-tertiary text-sm">→ Click to view</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Related Files Section */}
        {task.relatedFiles.length > 0 && (
          <div className="bg-bg-card rounded-xl border border-border mb-8 p-8">
            <h2 className="text-xl font-semibold tracking-tight text-text-primary mb-5">
              Related Files ({task.relatedFiles.length})
            </h2>
            <div className="space-y-3">
              {task.relatedFiles.map((file, index) => (
                <div key={index} className="p-5 bg-bg-elevated rounded-lg border border-border">
                  <div className="flex items-start justify-between mb-2">
                    <code className="text-sm text-blue font-mono">{file.path}</code>
                    <span
                      className={`font-mono text-[0.6rem] bg-bg border border-border px-2.5 py-0.5 rounded ${
                        FILE_TYPE_COLORS[file.type] || FILE_TYPE_COLORS.OTHER
                      }`}
                    >
                      {file.type}
                    </span>
                  </div>
                  {file.description && (
                    <p className="text-sm text-text-secondary mb-2">{file.description}</p>
                  )}
                  {(file.lineStart || file.lineEnd) && (
                    <p className="text-xs text-text-tertiary">
                      Lines: {file.lineStart || '?'} - {file.lineEnd || '?'}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Task Approval Section — visible only when pending_approval */}
        {task.status === 'pending_approval' && (
          <div className="mb-6">
            <ApprovalPanel
              entityType="task"
              onSubmit={async (decision, feedback) => {
                switch (decision) {
                  case 'approved':
                    await apiClient.approveTask(task.id, feedback);
                    break;
                  case 'revision_requested':
                    await apiClient.reviseTask(task.id, feedback!);
                    break;
                  case 'rejected':
                    await apiClient.rejectTask(task.id, feedback!);
                    break;
                }
                // Reload task after decision
                loadTask();
              }}
            />
          </div>
        )}

        {/* Task Result Section */}
        {task.result && (
          <div className="bg-bg-card rounded-xl border border-border p-8 mb-8">
            <h2 className="text-xl font-semibold tracking-tight text-text-primary mb-5">Task Result</h2>

            <div className="mb-5">
              <h3 className="text-base font-medium tracking-tight text-text-primary mb-3">Deliverables</h3>
              <ul className="list-disc list-inside space-y-1">
                {task.result.deliverables.map((deliverable, index) => (
                  <li key={index} className="text-text-secondary">{deliverable}</li>
                ))}
              </ul>
            </div>

            {task.result.notes && (
              <div className="mb-4">
                <h3 className="text-base font-medium tracking-tight text-text-primary mb-3">Notes</h3>
                <p className="text-text-secondary whitespace-pre-wrap">{task.result.notes}</p>
              </div>
            )}

            <div className="text-sm text-text-secondary">
              <span className="font-medium">Submitted:</span>{' '}
              {new Date(task.result.submittedAt).toLocaleString()}
            </div>
          </div>
        )}

        {/* Task History Timeline */}
        <div className="bg-bg-card rounded-xl border border-border p-8">
          <h2 className="text-xl font-semibold tracking-tight text-text-primary mb-5">History</h2>
          <TaskTimeline task={task} />
        </div>
    </>
  );
}
