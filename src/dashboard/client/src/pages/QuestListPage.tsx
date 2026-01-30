/**
 * Quest List Page - Main dashboard showing all quests
 * Features: status filtering, real-time WebSocket updates, navigation
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import type { Quest, QuestStatus } from '../types';

/**
 * Status badge colors for visual distinction
 */
const STATUS_COLORS: Record<QuestStatus, string> = {
  draft: 'bg-gray-200 text-gray-700',
  pending_approval: 'bg-yellow-200 text-yellow-800',
  approved: 'bg-green-200 text-green-800',
  rejected: 'bg-red-200 text-red-800',
  in_progress: 'bg-blue-200 text-blue-800',
  completed: 'bg-purple-200 text-purple-800',
  cancelled: 'bg-gray-300 text-gray-600',
};

/**
 * Status display labels
 */
const STATUS_LABELS: Record<QuestStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/**
 * Filter tab configuration
 */
const FILTER_TABS: Array<{ label: string; value: QuestStatus | 'all' }> = [
  { label: 'All', value: 'all' },
  { label: 'Draft', value: 'draft' },
  { label: 'Pending', value: 'pending_approval' },
  { label: 'Approved', value: 'approved' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Completed', value: 'completed' },
];

/**
 * Quest Card Component
 */
interface QuestCardProps {
  quest: Quest;
  onClick: () => void;
}

function QuestCard({ quest, onClick }: QuestCardProps) {
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow cursor-pointer p-6 border border-gray-200"
    >
      {/* Header: Title and Status */}
      <div className="flex items-start justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 flex-1">
          {quest.questName}
        </h3>
        <span
          className={`px-3 py-1 rounded-full text-xs font-medium ${
            STATUS_COLORS[quest.status]
          }`}
        >
          {STATUS_LABELS[quest.status]}
        </span>
      </div>

      {/* Description */}
      <p className="text-gray-600 text-sm mb-4 line-clamp-2">
        {quest.description}
      </p>

      {/* Metadata */}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <div className="flex items-center gap-4">
          <span>
            📅 {new Date(quest.createdAt).toLocaleDateString()}
          </span>
        </div>
        <span className="text-xs">
          ID: {quest.questId.slice(0, 8)}...
        </span>
      </div>
    </div>
  );
}

/**
 * Quest List Page Component
 */
export function QuestListPage() {
  const navigate = useNavigate();
  const [quests, setQuests] = useState<Quest[]>([]);
  const [filteredQuests, setFilteredQuests] = useState<Quest[]>([]);
  const [filter, setFilter] = useState<QuestStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Load quests from API
   */
  const loadQuests = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.getQuests();
      setQuests(data);
      console.log(`[QuestList] Loaded ${data.length} quests`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load quests';
      setError(errorMessage);
      console.error('[QuestList] Load error:', err);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Filter quests by status
   */
  useEffect(() => {
    if (filter === 'all') {
      setFilteredQuests(quests);
    } else {
      setFilteredQuests(quests.filter((q) => q.status === filter));
    }
  }, [quests, filter]);

  /**
   * Initialize: load quests and setup WebSocket
   */
  useEffect(() => {
    // Load initial data
    loadQuests();

    // Connect to WebSocket for real-time updates
    apiClient.connect();

    // Subscribe to quest events
    const handleQuestCreated = (data: { questId: string; questName: string; status: QuestStatus }) => {
      console.log('[QuestList] Quest created:', data);
      // Reload to get full quest data
      loadQuests();
    };

    const handleQuestUpdated = (data: { questId: string; status: QuestStatus }) => {
      console.log('[QuestList] Quest updated:', data);
      // Update quest in list
      setQuests((prevQuests) =>
        prevQuests.map((q) =>
          q.questId === data.questId
            ? { ...q, status: data.status, updatedAt: new Date().toISOString() }
            : q
        )
      );
    };

    apiClient.on('quest_created', handleQuestCreated);
    apiClient.on('quest_updated', handleQuestUpdated);

    // Cleanup: unsubscribe from WebSocket events
    return () => {
      apiClient.off('quest_created', handleQuestCreated);
      apiClient.off('quest_updated', handleQuestUpdated);
    };
  }, []);

  /**
   * Navigate to quest detail page
   */
  const handleQuestClick = (questId: string) => {
    navigate(`/quests/${questId}`);
  };

  /**
   * Render loading state
   */
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading quests...</p>
        </div>
      </div>
    );
  }

  /**
   * Render error state
   */
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow p-8 max-w-md">
          <div className="text-red-600 text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Failed to Load Quests
          </h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={loadQuests}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  /**
   * Render empty state
   */
  if (quests.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Quest Dashboard</h1>
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-6xl mb-4">📋</div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">
              No Quests Yet
            </h2>
            <p className="text-gray-600 mb-6">
              Create your first quest to get started
            </p>
          </div>
        </div>
      </div>
    );
  }

  /**
   * Render quest list
   */
  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Quest Dashboard</h1>
        <p className="text-gray-600">
          {filteredQuests.length} {filteredQuests.length === 1 ? 'quest' : 'quests'}
          {filter !== 'all' && ` (${STATUS_LABELS[filter as QuestStatus]})`}
        </p>
      </div>

      {/* Filter Tabs */}
      <div className="bg-white rounded-lg shadow mb-6 p-2 flex gap-2 overflow-x-auto">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
              filter === tab.value
                ? 'bg-blue-600 text-white'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Quest Grid */}
      {filteredQuests.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <div className="text-4xl mb-4">🔍</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            No {filter !== 'all' && STATUS_LABELS[filter as QuestStatus]} Quests
          </h2>
          <p className="text-gray-600">
            Try selecting a different filter
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredQuests.map((quest) => (
            <QuestCard
              key={quest.questId}
              quest={quest}
              onClick={() => handleQuestClick(quest.questId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
