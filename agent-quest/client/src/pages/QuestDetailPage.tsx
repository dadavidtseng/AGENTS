/**
 * Quest Detail Page - Detailed view of a single quest
 * Shows requirements, design, task list, and approval controls
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiClient } from '../api/client';
import { useWebSocket, useWsEvent } from '../hooks/useWebSocket';
import { ApprovalPanel } from '../components/ApprovalPanel';
import type { Quest, Task } from '../types';

/**
 * Status badge color mapping
 */
const STATUS_COLORS: Record<string, { dot: string; text: string }> = {
  draft: { dot: 'bg-text-tertiary', text: 'Draft' },
  pending: { dot: 'bg-text-tertiary', text: 'Pending' },
  pending_approval: { dot: 'bg-yellow animate-pulse-dot', text: 'Pending Approval' },
  approved: { dot: 'bg-green', text: 'Approved' },
  rejected: { dot: 'bg-red', text: 'Rejected' },
  in_progress: { dot: 'bg-blue animate-pulse-dot', text: 'In Progress' },
  completed: { dot: 'bg-green', text: 'Completed' },
  failed: { dot: 'bg-red', text: 'Failed' },
  blocked: { dot: 'bg-orange', text: 'Blocked' },
  cancelled: { dot: 'bg-text-tertiary', text: 'Cancelled' },
};

/**
 * Task status badge
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
 * Task card component
 */
function TaskCard({ task, onClick }: { task: Task; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="group bg-bg-elevated p-8 cursor-pointer transition-colors duration-300 hover:bg-bg-card card-hover-gradient"
    >
      <div className="flex justify-between items-start mb-3">
        <h3 className="text-lg font-medium tracking-tight text-text-primary">{task.name}</h3>
        <TaskStatusBadge status={task.status} />
      </div>

      <p className="text-sm font-light leading-relaxed text-text-secondary mb-4 line-clamp-2">{task.description}</p>

      <div className="flex flex-col gap-2 text-[0.7rem] font-mono tracking-wide text-text-tertiary">
        {task.assignedAgent && (
          <div className="flex items-center gap-2">
            <span className="font-medium">Agent:</span>
            <span>{task.assignedAgent}</span>
          </div>
        )}

        {task.dependencies.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="font-medium">Dependencies:</span>
            <span>{task.dependencies.length} task(s)</span>
          </div>
        )}

        {task.startedAt && (
          <div className="flex items-center gap-2">
            <span className="font-medium">Started:</span>
            <span>{new Date(task.startedAt).toLocaleDateString()}</span>
          </div>
        )}

        {task.completedAt && (
          <div className="flex items-center gap-2">
            <span className="font-medium">Completed:</span>
            <span>{new Date(task.completedAt).toLocaleDateString()}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Progress overview for quest tasks
 */
function ProgressOverview({ tasks }: { tasks: Task[] }) {
  const total = tasks.length;
  if (total === 0) return null;

  const completed = tasks.filter((t) => t.status === 'completed').length;
  const inProgress = tasks.filter(
    (t) => t.status === 'in_progress' || t.status === 'pending_approval',
  ).length;
  const failed = tasks.filter((t) => t.status === 'failed').length;
  const pending = tasks.filter((t) => t.status === 'pending').length;
  const percent = Math.round((completed / total) * 100);

  return (
    <div className="bg-bg-card rounded-lg border border-border mb-6 p-6">
      <h2 className="text-lg font-semibold text-text-primary mb-4">Progress</h2>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-sm text-text-secondary mb-2">
          <span>{completed} of {total} tasks completed</span>
          <span className="font-medium">{percent}%</span>
        </div>
        <div className="w-full bg-border rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all ${
              percent >= 100
                ? 'bg-green'
                : percent >= 60
                ? 'bg-blue'
                : percent >= 30
                ? 'bg-yellow'
                : 'bg-text-tertiary'
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {/* Status breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center p-3 bg-bg-elevated rounded-lg">
          <div className="text-2xl font-bold text-text-tertiary">{pending}</div>
          <div className="text-xs text-text-tertiary">Pending</div>
        </div>
        <div className="text-center p-3 bg-blue/10 rounded-lg">
          <div className="text-2xl font-bold text-blue">{inProgress}</div>
          <div className="text-xs text-blue">Active</div>
        </div>
        <div className="text-center p-3 bg-green/10 rounded-lg">
          <div className="text-2xl font-bold text-green">{completed}</div>
          <div className="text-xs text-green">Completed</div>
        </div>
        <div className="text-center p-3 bg-red/10 rounded-lg">
          <div className="text-2xl font-bold text-red">{failed}</div>
          <div className="text-xs text-red">Failed</div>
        </div>
      </div>
    </div>
  );
}



/**
 * Quest Detail Page Component
 */
export function QuestDetailPage() {
  const { questId } = useParams<{ questId: string }>();
  const navigate = useNavigate();

  const [quest, setQuest] = useState<Quest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Load quest details
   */
  const loadQuest = async () => {
    if (!questId) return;

    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.getQuestDetails(questId);
      setQuest(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load quest details');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Initialize and load quest
   */
  useEffect(() => {
    loadQuest();
  }, [questId]);

  // WebSocket connection
  useWebSocket();

  // Real-time quest updates
  useWsEvent('quest.updated', useCallback((data: unknown) => {
    const update = data as { questId: string; status: string };
    if (update.questId === questId) {
      loadQuest();
    }
  }, [questId]));

  // Real-time task status changes
  useWsEvent('task.completed', useCallback((data: unknown) => {
    const update = data as { taskId: string; status: string };
    setQuest((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tasks: (prev.tasks ?? []).map((task) =>
          task.id === update.taskId ? { ...task, status: update.status as any } : task
        ),
      };
    });
  }, []));

  /**
   * Loading state
   */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue mx-auto mb-4"></div>
          <p className="text-text-secondary">Loading quest details...</p>
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
          <h2 className="text-xl font-semibold tracking-tight text-text-primary mb-2">Error Loading Quest</h2>
          <p className="text-sm font-light text-text-secondary mb-6">{error}</p>
          <button
            onClick={() => navigate('/quests')}
            className="text-[0.85rem] font-medium text-bg bg-text-primary px-7 py-3 rounded-lg hover:opacity-85 hover:-translate-y-px transition-all"
          >
            Back to Quest List
          </button>
        </div>
      </div>
    );
  }

  /**
   * Quest not found
   */
  if (!quest) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center">
          <p className="text-text-secondary">Quest not found</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Back Button */}
        <button
          onClick={() => navigate('/quests')}
          className="mb-8 text-sm text-text-secondary hover:text-text-primary transition-colors flex items-center gap-2"
        >
          ← Back to Quest List
        </button>

        {/* Quest Header */}
        <div className="bg-bg-card rounded-xl border border-border mb-8 p-8">
          <div className="flex justify-between items-start mb-5">
            <div>
              <p className="font-mono text-[0.65rem] tracking-[0.15em] uppercase text-blue mb-3">Quest</p>
              <h1 className="text-[2rem] font-semibold tracking-tight text-text-primary mb-2">{quest.questName}</h1>
              <p className="font-mono text-[0.7rem] tracking-wide text-text-tertiary">{quest.questId}</p>
            </div>
            <TaskStatusBadge status={quest.status} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm font-light text-text-secondary">
            <div>
              <span className="font-medium">Created:</span>{' '}
              {new Date(quest.createdAt).toLocaleDateString()}
            </div>
            <div>
              <span className="font-medium">Updated:</span>{' '}
              {new Date(quest.updatedAt).toLocaleDateString()}
            </div>
            <div>
              <span className="font-medium">Tasks:</span> {(quest.tasks ?? []).length}
            </div>
          </div>
        </div>

        {/* Progress Overview */}
        <ProgressOverview tasks={quest.tasks ?? []} />

        {/* Approval Section */}
        {quest.status === 'pending_approval' && (
          <div className="mb-6">
            <ApprovalPanel
              entityType="quest"
              onSubmit={async (decision, feedback) => {
                switch (decision) {
                  case 'approved':
                    await apiClient.approveQuest(quest.questId, feedback);
                    break;
                  case 'revision_requested':
                    await apiClient.reviseQuest(quest.questId, feedback!);
                    break;
                  case 'rejected':
                    await apiClient.rejectQuest(quest.questId, feedback!);
                    break;
                }
                loadQuest();
              }}
            />
          </div>
        )}

        {/* Requirements Section */}
        <div className="bg-bg-card rounded-xl border border-border mb-8 p-8">
          <h2 className="text-xl font-semibold tracking-tight text-text-primary mb-5">Requirements</h2>
          <div className="prose max-w-none overflow-auto max-h-96">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {quest.requirements}
            </ReactMarkdown>
          </div>
        </div>

        {/* Design Section */}
        <div className="bg-bg-card rounded-xl border border-border mb-8 p-8">
          <h2 className="text-xl font-semibold tracking-tight text-text-primary mb-5">Design</h2>
          <div className="prose max-w-none overflow-auto max-h-96">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {quest.design}
            </ReactMarkdown>
          </div>
        </div>

        {/* Tasks Section */}
        {(quest.tasks ?? []).length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold tracking-tight text-text-primary mb-5">
              Tasks ({(quest.tasks ?? []).length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border rounded-xl overflow-hidden">
              {(quest.tasks ?? []).map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onClick={() => navigate(`/tasks/${task.id}?questId=${quest.questId}`)}
                />
              ))}
            </div>
          </div>
        )}

        {/* No Tasks */}
        {(quest.tasks ?? []).length === 0 && (
          <div className="bg-bg-card rounded-xl border border-border p-8 text-center">
            <p className="text-sm font-light text-text-secondary">No tasks yet. Split this quest to create tasks.</p>
          </div>
        )}

    </>
  );
}
