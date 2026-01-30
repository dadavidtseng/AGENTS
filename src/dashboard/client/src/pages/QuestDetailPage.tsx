/**
 * Quest Detail Page - Detailed view of a single quest
 * Shows requirements, design, task list, and approval controls
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiClient } from '../api/client';
import { ApprovalForm } from '../components/ApprovalForm';
import type { Quest, Task } from '../types';

/**
 * Status badge color mapping
 */
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  pending_approval: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-purple-100 text-purple-800',
  failed: 'bg-red-100 text-red-800',
  blocked: 'bg-orange-100 text-orange-800',
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
 * Quest Detail Page Component
 */
export function QuestDetailPage() {
  const { questId } = useParams<{ questId: string }>();
  const navigate = useNavigate();

  const [quest, setQuest] = useState<Quest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showApprovalForm, setShowApprovalForm] = useState(false);

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
   * Initialize WebSocket and load quest
   */
  useEffect(() => {
    loadQuest();
    apiClient.connect();

    // Subscribe to quest updates
    const handleQuestUpdated = (data: { questId: string; status: string }) => {
      if (data.questId === questId) {
        loadQuest();
      }
    };

    // Subscribe to task status changes
    const handleTaskStatusChanged = (data: { taskId: string; status: string }) => {
      if (quest) {
        setQuest((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            tasks: prev.tasks.map((task) =>
              task.id === data.taskId ? { ...task, status: data.status as any } : task
            ),
          };
        });
      }
    };

    apiClient.on('quest_updated', handleQuestUpdated);
    apiClient.on('task_status_changed', handleTaskStatusChanged);

    return () => {
      apiClient.off('quest_updated', handleQuestUpdated);
      apiClient.off('task_status_changed', handleTaskStatusChanged);
    };
  }, [questId]);

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
              <span className="font-medium">Tasks:</span> {quest.tasks.length}
            </div>
          </div>
        </div>

        {/* Approval Section */}
        {quest.status === 'pending_approval' && !showApprovalForm && (
          <div className="mb-6">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-yellow-900 mb-4">Approval Required</h3>
              <p className="text-yellow-800 mb-6">
                This quest is pending approval. Review the requirements and design documents, then submit your decision.
              </p>
              <button
                onClick={() => setShowApprovalForm(true)}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Submit Approval Decision
              </button>
            </div>
          </div>
        )}

        {/* Approval Form */}
        {quest.status === 'pending_approval' && showApprovalForm && (
          <div className="mb-6">
            <ApprovalForm
              questId={quest.questId}
              onSubmit={() => {
                setShowApprovalForm(false);
                loadQuest();
              }}
              onCancel={() => setShowApprovalForm(false)}
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
        {quest.tasks.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Tasks ({quest.tasks.length})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {quest.tasks.map((task) => (
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
        {quest.tasks.length === 0 && (
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <p className="text-gray-600">No tasks yet. Split this quest to create tasks.</p>
          </div>
        )}
      </div>


    </div>
  );
}
