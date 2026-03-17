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
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  pending: 'bg-gray-100 text-gray-700',
  pending_approval: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-purple-100 text-purple-800',
  failed: 'bg-red-100 text-red-800',
  blocked: 'bg-orange-100 text-orange-800',
  cancelled: 'bg-gray-200 text-gray-600',
};

/**
 * Task status badge
 */
function TaskStatusBadge({ status }: { status: string }) {
  const colorClass = STATUS_COLORS[status] || 'bg-gray-100 text-gray-700';

  return (
    <span className={`px-3 py-1 rounded-full text-sm font-medium ${colorClass}`}>
      {status.replace(/_/g, ' ')}
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
      className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer border border-gray-200"
    >
      <div className="flex justify-between items-start mb-3">
        <h3 className="text-lg font-semibold text-gray-900">{task.name}</h3>
        <TaskStatusBadge status={task.status} />
      </div>

      <p className="text-gray-600 mb-3 line-clamp-2">{task.description}</p>

      <div className="flex flex-col gap-2 text-sm text-gray-500">
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
    <div className="bg-white rounded-lg shadow mb-6 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Progress</h2>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
          <span>{completed} of {total} tasks completed</span>
          <span className="font-medium">{percent}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all ${
              percent >= 100
                ? 'bg-green-500'
                : percent >= 60
                ? 'bg-blue-500'
                : percent >= 30
                ? 'bg-yellow-500'
                : 'bg-gray-400'
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {/* Status breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center p-3 bg-gray-50 rounded-lg">
          <div className="text-2xl font-bold text-gray-500">{pending}</div>
          <div className="text-xs text-gray-500">Pending</div>
        </div>
        <div className="text-center p-3 bg-blue-50 rounded-lg">
          <div className="text-2xl font-bold text-blue-600">{inProgress}</div>
          <div className="text-xs text-blue-600">Active</div>
        </div>
        <div className="text-center p-3 bg-green-50 rounded-lg">
          <div className="text-2xl font-bold text-green-600">{completed}</div>
          <div className="text-xs text-green-600">Completed</div>
        </div>
        <div className="text-center p-3 bg-red-50 rounded-lg">
          <div className="text-2xl font-bold text-red-600">{failed}</div>
          <div className="text-xs text-red-600">Failed</div>
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading quest details...</p>
        </div>
      </div>
    );
  }

  /**
   * Error state
   */
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-red-600 text-5xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Error Loading Quest</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => navigate('/quests')}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Quest not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back Button */}
        <button
          onClick={() => navigate('/quests')}
          className="mb-6 text-blue-600 hover:text-blue-800 flex items-center gap-2"
        >
          ← Back to Quest List
        </button>

        {/* Quest Header */}
        <div className="bg-white rounded-lg shadow mb-6 p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">{quest.questName}</h1>
              <p className="text-gray-600">ID: {quest.questId}</p>
            </div>
            <TaskStatusBadge status={quest.status} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600">
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
        <div className="bg-white rounded-lg shadow mb-6 p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Requirements</h2>
          <div className="prose max-w-none overflow-auto max-h-96">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {quest.requirements}
            </ReactMarkdown>
          </div>
        </div>

        {/* Design Section */}
        <div className="bg-white rounded-lg shadow mb-6 p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Design</h2>
          <div className="prose max-w-none overflow-auto max-h-96">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {quest.design}
            </ReactMarkdown>
          </div>
        </div>

        {/* Tasks Section */}
        {(quest.tasks ?? []).length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Tasks ({(quest.tasks ?? []).length})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <p className="text-gray-600">No tasks yet. Split this quest to create tasks.</p>
          </div>
        )}
      </div>


    </div>
  );
}
