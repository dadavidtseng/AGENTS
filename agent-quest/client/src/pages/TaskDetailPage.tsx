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
}

/**
 * Status badge color mapping
 */
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  pending_approval: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
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
 * File type badge color mapping
 */
const FILE_TYPE_COLORS: Record<string, string> = {
  TO_MODIFY: 'bg-yellow-100 text-yellow-800',
  REFERENCE: 'bg-blue-100 text-blue-800',
  CREATE: 'bg-green-100 text-green-800',
  DEPENDENCY: 'bg-purple-100 text-purple-800',
  OTHER: 'bg-gray-100 text-gray-700',
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading task details...</p>
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
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Error Loading Task</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => navigate(questId ? `/quests/${questId}` : '/quests')}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Task not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back Button */}
        <button
          onClick={() => navigate(questId ? `/quests/${questId}` : '/quests')}
          className="mb-6 text-blue-600 hover:text-blue-800 flex items-center gap-2"
        >
          ← Back to Quest
        </button>

        {/* Task Header */}
        <div className="bg-white rounded-lg shadow mb-6 p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">{task.name}</h1>
              <p className="text-gray-600">Task ID: {task.id}</p>
            </div>
            <TaskStatusBadge status={task.status} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm text-gray-600">
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
            <div className="mt-4 text-sm text-gray-600">
              <span className="font-medium">Started:</span>{' '}
              {new Date(task.startedAt).toLocaleString()}
            </div>
          )}

          {task.completedAt && (
            <div className="mt-2 text-sm text-gray-600">
              <span className="font-medium">Completed:</span>{' '}
              {new Date(task.completedAt).toLocaleString()}
            </div>
          )}
        </div>

        {/* Description Section */}
        <div className="bg-white rounded-lg shadow mb-6 p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Description</h2>
          <div className="prose max-w-none">
            <p className="text-gray-700 whitespace-pre-wrap">{task.description}</p>
          </div>
        </div>

        {/* Implementation Guide Section */}
        {task.implementationGuide && (
          <div className="bg-white rounded-lg shadow mb-6 p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Implementation Guide</h2>
            <div className="prose max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {task.implementationGuide}
              </ReactMarkdown>
            </div>
          </div>
        )}

        {/* Verification Criteria Section */}
        {task.verificationCriteria && (
          <div className="bg-white rounded-lg shadow mb-6 p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Verification Criteria</h2>
            <div className="prose max-w-none">
              <p className="text-gray-700 whitespace-pre-wrap">{task.verificationCriteria}</p>
            </div>
          </div>
        )}

        {/* Dependencies Section */}
        {task.dependencies.length > 0 && (
          <div className="bg-white rounded-lg shadow mb-6 p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Dependencies ({task.dependencies.length})
            </h2>
            <div className="space-y-2">
              {task.dependencies.map((depId) => (
                <div
                  key={depId}
                  className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                  onClick={() => navigate(`/tasks/${depId}?questId=${questId}`)}
                >
                  <span className="text-gray-700 font-medium">{depId}</span>
                  <span className="text-gray-500 text-sm">→ Click to view</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Related Files Section */}
        {task.relatedFiles.length > 0 && (
          <div className="bg-white rounded-lg shadow mb-6 p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Related Files ({task.relatedFiles.length})
            </h2>
            <div className="space-y-3">
              {task.relatedFiles.map((file, index) => (
                <div key={index} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-start justify-between mb-2">
                    <code className="text-sm text-blue-600 font-mono">{file.path}</code>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        FILE_TYPE_COLORS[file.type] || FILE_TYPE_COLORS.OTHER
                      }`}
                    >
                      {file.type}
                    </span>
                  </div>
                  {file.description && (
                    <p className="text-sm text-gray-600 mb-2">{file.description}</p>
                  )}
                  {(file.lineStart || file.lineEnd) && (
                    <p className="text-xs text-gray-500">
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
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Task Result</h2>
            
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Deliverables</h3>
              <ul className="list-disc list-inside space-y-1">
                {task.result.deliverables.map((deliverable, index) => (
                  <li key={index} className="text-gray-700">{deliverable}</li>
                ))}
              </ul>
            </div>

            {task.result.notes && (
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Notes</h3>
                <p className="text-gray-700 whitespace-pre-wrap">{task.result.notes}</p>
              </div>
            )}

            <div className="text-sm text-gray-600">
              <span className="font-medium">Submitted:</span>{' '}
              {new Date(task.result.submittedAt).toLocaleString()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
