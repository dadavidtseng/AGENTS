/**
 * DashboardPage — Metrics dashboard with KPI cards and charts.
 *
 * Data sources:
 *  - ObserverContext (agent counts, network info)
 *  - apiClient.getQuests() (quest/task aggregates)
 *
 * Charts powered by recharts.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { apiClient } from '../api/client';
import {
  useObserverContext,
  useActiveAgents,
} from '../contexts/ObserverContext';
import { Card } from '../components/ui/Card';
import { MetricCard } from '../components/MetricCard';
import type { Quest, Task } from '../types';

/* ── Icons (inline SVG to avoid extra deps) ── */

function IconQuest() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="14" height="14" rx="3" />
      <path d="M7 10h6M10 7v6" />
    </svg>
  );
}
function IconTask() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6 10l3 3 5-6" />
      <circle cx="10" cy="10" r="7" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l3 2" />
    </svg>
  );
}
function IconPercent() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="2" />
      <circle cx="13" cy="13" r="2" />
      <path d="M15 5L5 15" />
    </svg>
  );
}
function IconAgent() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="10" cy="7" r="3" />
      <path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    </svg>
  );
}

/* ── Helpers ── */

/** Flatten all tasks from quest details */
function collectTasks(quests: Quest[]): Task[] {
  return quests.flatMap((q) => q.tasks ?? []);
}

/** Average duration in hours for completed tasks that have startedAt */
function avgDurationHours(tasks: Task[]): number {
  const durations = tasks
    .filter((t) => t.status === 'completed' && t.startedAt && t.completedAt)
    .map((t) => {
      const start = new Date(t.startedAt!).getTime();
      const end = new Date(t.completedAt!).getTime();
      return (end - start) / 3_600_000;
    });
  if (durations.length === 0) return 0;
  return durations.reduce((a, b) => a + b, 0) / durations.length;
}

/** Build daily completion counts for the last 7 days */
function completionTimeline(tasks: Task[]) {
  const now = Date.now();
  const days: { day: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 86_400_000);
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayEnd = dayStart + 86_400_000;
    const count = tasks.filter((t) => {
      if (t.status !== 'completed' || !t.completedAt) return false;
      const ts = new Date(t.completedAt).getTime();
      return ts >= dayStart && ts < dayEnd;
    }).length;
    days.push({ day: label, count });
  }
  return days;
}

/* ── Chart theme (matches design tokens) ── */

const CHART_COLORS = {
  blue: '#0070f3',
  green: '#22c55e',
  grid: '#1a1a1a',
  text: '#888888',
  bg: '#111111',
};

const tooltipStyle = {
  contentStyle: {
    background: CHART_COLORS.bg,
    border: `1px solid ${CHART_COLORS.grid}`,
    borderRadius: 8,
    fontSize: 12,
    color: '#ededed',
  },
  itemStyle: { color: '#ededed' },
};

/* ── Component ── */

export default function DashboardPage() {
  const { agentCount, activeAgentCount } = useObserverContext();
  const activeAgents = useActiveAgents();

  const [quests, setQuests] = useState<Quest[]>([]);
  const [detailedQuests, setDetailedQuests] = useState<Quest[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch quests + details for task data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await apiClient.getQuests();
        if (cancelled) return;
        setQuests(list);

        // Fetch details in parallel (for task arrays)
        const details = await Promise.allSettled(
          list.map((q) => apiClient.getQuestDetails(q.questId)),
        );
        if (cancelled) return;
        setDetailedQuests(
          details
            .filter((r): r is PromiseFulfilledResult<Quest> => r.status === 'fulfilled')
            .map((r) => r.value),
        );
      } catch {
        // silent — metrics degrade gracefully
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const allTasks = useMemo(() => collectTasks(detailedQuests), [detailedQuests]);

  // KPI values
  const activeQuests = quests.filter(
    (q) => q.status === 'in_progress' || q.status === 'approved',
  ).length;

  const now24h = Date.now() - 86_400_000;
  const completedRecent = allTasks.filter(
    (t) => t.status === 'completed' && t.completedAt && new Date(t.completedAt).getTime() > now24h,
  ).length;

  const avgDur = avgDurationHours(allTasks);
  const avgDurLabel = avgDur > 0 ? `${avgDur.toFixed(1)}h` : '—';

  const totalFinished = allTasks.filter((t) => t.status === 'completed' || t.status === 'failed').length;
  const successCount = allTasks.filter((t) => t.status === 'completed').length;
  const successRate = totalFinished > 0 ? Math.round((successCount / totalFinished) * 100) : 0;

  // Chart data
  const timeline = useMemo(() => completionTimeline(allTasks), [allTasks]);

  const agentUtil = useMemo(() => {
    const map = new Map<string, { total: number; done: number }>();
    for (const t of allTasks) {
      const name = t.assignedAgent ?? 'unassigned';
      const entry = map.get(name) ?? { total: 0, done: 0 };
      entry.total++;
      if (t.status === 'completed') entry.done++;
      map.set(name, entry);
    }
    return Array.from(map.entries())
      .map(([agent, { total, done }]) => ({
        agent: agent.replace(/^agent-/, ''),
        tasks: total,
        completed: done,
      }))
      .sort((a, b) => b.tasks - a.tasks)
      .slice(0, 8);
  }, [allTasks]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-secondary">
        Loading metrics…
      </div>
    );
  }

  const noData = quests.length === 0;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
        Dashboard
      </h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <MetricCard
          label="Active Quests"
          value={activeQuests}
          icon={<IconQuest />}
        />
        <MetricCard
          label="Tasks (24h)"
          value={completedRecent}
          icon={<IconTask />}
          trend={completedRecent > 0 ? `${completedRecent} completed` : undefined}
          trendDirection={completedRecent > 0 ? 'up' : 'neutral'}
        />
        <MetricCard
          label="Avg Duration"
          value={avgDurLabel}
          icon={<IconClock />}
        />
        <MetricCard
          label="Success Rate"
          value={totalFinished > 0 ? `${successRate}%` : '—'}
          icon={<IconPercent />}
          trend={totalFinished > 0 ? `${successCount}/${totalFinished}` : undefined}
          trendDirection={successRate >= 80 ? 'up' : successRate >= 50 ? 'neutral' : 'down'}
        />
        <MetricCard
          label="Active Agents"
          value={`${activeAgentCount}/${agentCount}`}
          icon={<IconAgent />}
        />
      </div>

      {noData && (
        <Card variant="card" padding="lg" className="text-center text-text-secondary">
          No quest data yet. Metrics will populate as quests and tasks are created.
        </Card>
      )}

      {/* Charts */}
      {!noData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Task Completion Timeline */}
          <Card variant="card" padding="md">
            <h2 className="text-sm font-medium text-text-secondary mb-6 tracking-wide">
              Task Completions (7 days)
            </h2>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={timeline}>
                <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" />
                <XAxis
                  dataKey="day"
                  tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
                  axisLine={{ stroke: CHART_COLORS.grid }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
                  axisLine={{ stroke: CHART_COLORS.grid }}
                  tickLine={false}
                  width={30}
                />
                <Tooltip {...tooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke={CHART_COLORS.blue}
                  strokeWidth={2}
                  dot={{ r: 3, fill: CHART_COLORS.blue }}
                  activeDot={{ r: 5 }}
                  name="Completed"
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          {/* Agent Utilization */}
          <Card variant="card" padding="md">
            <h2 className="text-sm font-medium text-text-secondary mb-6 tracking-wide">
              Agent Utilization
            </h2>
            {agentUtil.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={agentUtil} barGap={4}>
                  <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="agent"
                    tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
                    axisLine={{ stroke: CHART_COLORS.grid }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
                    axisLine={{ stroke: CHART_COLORS.grid }}
                    tickLine={false}
                    width={30}
                  />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="tasks" fill={CHART_COLORS.blue} radius={[4, 4, 0, 0]} name="Total" />
                  <Bar dataKey="completed" fill={CHART_COLORS.green} radius={[4, 4, 0, 0]} name="Completed" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-60 text-text-tertiary text-sm">
                No task assignments yet
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Active agents list */}
      {activeAgents.length > 0 && (
        <Card variant="card" padding="md">
          <h2 className="text-sm font-medium text-text-secondary mb-4 tracking-wide">
            Active Agents
          </h2>
          <div className="flex flex-wrap gap-3">
            {activeAgents.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border text-sm text-text-primary"
              >
                <span className="w-2 h-2 rounded-full bg-green animate-pulse" />
                {a.name.replace(/^agent-/, '')}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
