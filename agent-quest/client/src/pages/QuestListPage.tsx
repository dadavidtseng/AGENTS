/**
 * Quest List Page - Main dashboard showing all quests
 * Features: status filtering, real-time WebSocket updates, navigation
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useWebSocket, useWsEvent } from '../hooks/useWebSocket';
import type { Quest, QuestStatus, TaskStatus } from '../types';

/**
 * Status badge — Portfolio-style border badge with pulse dot
 */
const STATUS_BADGE: Record<QuestStatus, { dot: string; text: string }> = {
  draft: { dot: 'bg-text-tertiary', text: 'Draft' },
  pending_approval: { dot: 'bg-yellow animate-pulse-dot', text: 'Pending' },
  approved: { dot: 'bg-green', text: 'Approved' },
  rejected: { dot: 'bg-red', text: 'Rejected' },
  in_progress: { dot: 'bg-blue animate-pulse-dot', text: 'In Progress' },
  completed: { dot: 'bg-green', text: 'Completed' },
  cancelled: { dot: 'bg-text-tertiary', text: 'Cancelled' },
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
 * Progress bar color based on completion percentage
 */
function getProgressColor(percent: number): string {
  if (percent >= 100) return 'bg-green';
  if (percent >= 60) return 'bg-blue';
  if (percent >= 30) return 'bg-yellow';
  return 'bg-text-tertiary';
}

/**
 * Compute task status counts for a quest.
 * Uses the full tasks array when available (detail response),
 * falls back to taskCount summary field (list response).
 */
function getTaskStats(quest: Quest) {
  if (quest.tasks && quest.tasks.length > 0) {
    const tasks = quest.tasks;
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const failed = tasks.filter((t) => t.status === 'failed').length;
    const inProgress = tasks.filter(
      (t) => t.status === 'in_progress' || t.status === 'pending_approval',
    ).length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, failed, inProgress, percent };
  }
  // List API only provides taskCount — no per-status breakdown available
  const total = quest.taskCount ?? 0;
  return { total, completed: 0, failed: 0, inProgress: 0, percent: 0 };
}

/**
 * Quest Card Component
 */
interface QuestCardProps {
  quest: Quest;
  onClick: () => void;
}

function QuestCard({ quest, onClick }: QuestCardProps) {
  const stats = getTaskStats(quest);
  const badge = STATUS_BADGE[quest.status];

  return (
    <div
      onClick={onClick}
      className="group bg-bg-elevated p-8 cursor-pointer transition-colors duration-300 hover:bg-bg-card card-hover-gradient"
    >
      {/* Header: Title and Status */}
      <div className="flex items-start justify-between mb-4">
        <h3 className="text-lg font-medium tracking-tight text-text-primary flex-1 pr-4">
          {quest.questName}
        </h3>
        <span className="inline-flex items-center gap-2 text-[0.75rem] text-text-secondary border border-border px-3 py-1.5 rounded-full shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
          {badge.text}
        </span>
      </div>

      {/* Description */}
      <p className="text-sm font-light leading-relaxed text-text-secondary mb-5 line-clamp-2">
        {quest.description}
      </p>

      {/* Task Progress */}
      {stats.total > 0 && (
        <div className="mb-5">
          <div className="flex items-center justify-between text-[0.7rem] font-mono tracking-wide text-text-tertiary mb-1.5">
            <span>{stats.completed}/{stats.total} tasks</span>
            <span>{stats.percent}%</span>
          </div>
          <div className="w-full bg-border rounded-full h-1">
            <div
              className={`h-1 rounded-full transition-all ${getProgressColor(stats.percent)}`}
              style={{ width: `${stats.percent}%` }}
            />
          </div>
          {/* Status breakdown */}
          <div className="flex gap-3 mt-2 text-[0.7rem] font-mono text-text-tertiary">
            {stats.inProgress > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue animate-pulse-dot" />
                {stats.inProgress} active
              </span>
            )}
            {stats.failed > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red" />
                {stats.failed} failed
              </span>
            )}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="flex items-center justify-between text-[0.7rem] font-mono tracking-wide text-text-tertiary">
        <span>{new Date(quest.createdAt).toLocaleDateString()}</span>
        <span>{quest.questId.slice(0, 8)}</span>
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
  const [filter, setFilter] = useState<QuestStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Derived: quests filtered by current status selection (synchronous, no lag) */
  const filteredQuests = useMemo(
    () => (filter === 'all' ? quests : quests.filter((q) => q.status === filter)),
    [quests, filter],
  );

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
   * Initialize: load quests and setup WebSocket
   */
  useEffect(() => {
    loadQuests();
  }, []);

  // WebSocket connection
  useWebSocket();

  // Real-time quest events
  useWsEvent('quest.created', useCallback(() => {
    console.log('[QuestList] Quest created, reloading');
    loadQuests();
  }, []));

  useWsEvent('quest.updated', useCallback((data: unknown) => {
    const update = data as { questId: string; status: QuestStatus };
    console.log('[QuestList] Quest updated:', update);
    setQuests((prevQuests) =>
      prevQuests.map((q) =>
        q.questId === update.questId
          ? { ...q, status: update.status, updatedAt: new Date().toISOString() }
          : q
      )
    );
  }, []));

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
      <div className="flex items-center justify-center py-32">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue mx-auto mb-4"></div>
          <p className="text-text-secondary">Loading quests...</p>
        </div>
      </div>
    );
  }

  /**
   * Render error state
   */
  if (error) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="bg-bg-card rounded-lg shadow p-8 max-w-md border border-border">
          <div className="text-red text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold tracking-tight text-text-primary mb-2">
            Failed to Load Quests
          </h2>
          <p className="text-sm font-light text-text-secondary mb-4">{error}</p>
          <button
            onClick={loadQuests}
            className="text-[0.85rem] font-medium text-bg bg-text-primary px-7 py-3 rounded-lg hover:opacity-85 hover:-translate-y-px transition-all"
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
      <>
          <p className="font-mono text-[0.65rem] tracking-[0.15em] uppercase text-blue mb-3">
            Dashboard
          </p>
          <h1 className="text-[2.5rem] font-semibold tracking-tight text-text-primary mb-10">
            Quests
          </h1>
          <div className="bg-bg-card rounded-xl border border-border p-16 text-center">
            <div className="text-6xl mb-4">📋</div>
            <h2 className="text-xl font-medium tracking-tight text-text-primary mb-2">
              No Quests Yet
            </h2>
            <p className="text-sm font-light text-text-secondary mb-6">
              Create your first quest to get started
            </p>
          </div>
      </>
    );
  }

  /**
   * Render quest list
   */
  return (
    <>
      {/* Header */}
      <div className="mb-10">
        <p className="font-mono text-[0.65rem] tracking-[0.15em] uppercase text-blue mb-3">
          Dashboard
        </p>
        <h1 className="text-[2.5rem] font-semibold tracking-tight text-text-primary mb-2">
          Quests
        </h1>
        <p className="text-[0.9rem] font-light leading-relaxed text-text-secondary">
          {filteredQuests.length} {filteredQuests.length === 1 ? 'quest' : 'quests'}
          {filter !== 'all' && ` · ${STATUS_LABELS[filter as QuestStatus]}`}
        </p>
      </div>

      {/* Filter Tabs — Portfolio-style pill tabs */}
      <div className="flex gap-2 mb-8 overflow-x-auto">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`px-4 py-2 rounded-lg text-sm transition-all whitespace-nowrap ${
              filter === tab.value
                ? 'text-text-primary bg-bg-card border border-border-hover'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Quest Grid — Portfolio gap-px technique */}
      {filteredQuests.length === 0 ? (
        <div className="bg-bg-card rounded-xl border border-border p-16 text-center">
          <h2 className="text-xl font-medium tracking-tight text-text-primary mb-2">
            No {filter !== 'all' && STATUS_LABELS[filter as QuestStatus]} Quests
          </h2>
          <p className="text-sm font-light text-text-secondary">
            Try selecting a different filter
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border rounded-xl overflow-hidden">
          {filteredQuests.map((quest) => (
            <QuestCard
              key={quest.questId}
              quest={quest}
              onClick={() => handleQuestClick(quest.questId)}
            />
          ))}
        </div>
      )}
    </>
  );
}
