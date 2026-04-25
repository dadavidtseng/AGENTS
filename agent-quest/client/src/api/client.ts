/**
 * API Client for backend REST communication.
 *
 * WebSocket functionality has been extracted to WebSocketService
 * (see client/src/services/WebSocketService.ts).
 */

import type { Quest, Task, Agent } from '../types';

const API_BASE = '/api';
const REQUEST_TIMEOUT = 30_000; // 30 seconds

/**
 * Agent filters for querying
 */
export interface AgentFilters {
  status?: 'available' | 'busy' | 'offline';
  role?: 'artist' | 'designer' | 'programmer';
}

/**
 * Approval decision structure
 */
export interface ApprovalDecision {
  decision: 'approved' | 'revision_requested' | 'rejected';
  approvedBy: string;
  approvedVia: 'discord' | 'slack' | 'dashboard';
  feedback?: string;
}

/**
 * REST-only API Client
 */
export class ApiClient {
  /**
   * Fetch wrapper with timeout and error handling
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      console.log(`[API] ${options.method || 'GET'} ${url}`);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;

        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorJson.message || response.statusText;
        } catch {
          errorMessage = errorText || response.statusText;
        }

        throw new Error(`HTTP ${response.status}: ${errorMessage}`);
      }

      return response;
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('Request timeout after 30 seconds');
        }
        throw error;
      }

      throw new Error('Unknown error occurred');
    }
  }

  /**
   * Parse JSON response with error handling
   */
  private async parseJSON<T>(response: Response): Promise<T> {
    const text = await response.text();

    try {
      return JSON.parse(text);
    } catch (error) {
      console.error('[API] JSON parse error:', error);
      throw new Error('Invalid JSON response from server');
    }
  }

  // -------------------------------------------------------------------------
  // Quest endpoints
  // -------------------------------------------------------------------------

  async getQuests(status?: string): Promise<Quest[]> {
    const url = status
      ? `${API_BASE}/quests?status=${encodeURIComponent(status)}`
      : `${API_BASE}/quests`;

    const response = await this.fetchWithTimeout(url);
    const data = await this.parseJSON<{ success: boolean; data: { quests: Quest[] } }>(response);

    console.log(`[API] Fetched ${data.data.quests.length} quests`);
    return data.data.quests;
  }

  async getQuestDetails(questId: string): Promise<Quest> {
    const response = await this.fetchWithTimeout(`${API_BASE}/quests/${questId}`);
    const data = await this.parseJSON<{ success: boolean; data: Quest }>(response);

    console.log(`[API] Fetched quest: ${questId}`);
    return data.data;
  }

  // -------------------------------------------------------------------------
  // Agent endpoints
  // -------------------------------------------------------------------------

  async getAgents(filters?: AgentFilters): Promise<Agent[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.role) params.append('role', filters.role);

    const url = params.toString()
      ? `${API_BASE}/agents?${params.toString()}`
      : `${API_BASE}/agents`;

    const response = await this.fetchWithTimeout(url);
    const data = await this.parseJSON<{ success: boolean; data: { agents: Agent[] } }>(response);

    console.log(`[API] Fetched ${data.data.agents.length} agents`);
    return data.data.agents;
  }

  // -------------------------------------------------------------------------
  // Approval endpoints
  // -------------------------------------------------------------------------

  async submitApproval(questId: string, decision: ApprovalDecision): Promise<void> {
    const response = await this.fetchWithTimeout(`${API_BASE}/approvals/${questId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decision),
    });

    const data = await this.parseJSON<{ success: boolean }>(response);

    if (!data.success) {
      throw new Error('Approval submission failed');
    }

    console.log(`[API] Submitted approval for quest: ${questId}`);
  }

  // -------------------------------------------------------------------------
  // Task endpoints
  // -------------------------------------------------------------------------

  async getAllTasks(filters?: { questId?: string; status?: string; agentId?: string }): Promise<Task[]> {
    const params = new URLSearchParams();
    if (filters?.questId) params.append('questId', filters.questId);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.agentId) params.append('agentId', filters.agentId);

    const url = params.toString()
      ? `${API_BASE}/tasks?${params.toString()}`
      : `${API_BASE}/tasks`;

    const response = await this.fetchWithTimeout(url);
    const data = await this.parseJSON<{ success: boolean; data: unknown }>(response);

    // Broker may return { tasks: [...] }, [...], or other shapes — normalize
    const raw = data.data as Record<string, unknown>;
    let tasks: Record<string, unknown>[];
    if (Array.isArray(raw)) {
      tasks = raw;
    } else if (raw && Array.isArray(raw.tasks)) {
      tasks = raw.tasks;
    } else {
      tasks = [];
    }

    // Normalize field names (broker may use taskName/taskId instead of name/id)
    const normalized: Task[] = tasks.map((t) => {
      // Broker may omit the "agent-" prefix on agent names
      let agent = (t.assignedAgent ?? t.agentId) as string | undefined;
      if (agent && !agent.startsWith('agent-')) {
        agent = `agent-${agent}`;
      }

      return {
      id: (t.taskId ?? t.id ?? '') as string,
      questId: (t.questId ?? '') as string,
      name: (t.name ?? t.taskName ?? '') as string,
      description: (t.description ?? '') as string,
      status: (t.status ?? 'pending') as Task['status'],
      assignedAgent: agent,
      role: (t.role ?? t.agentRole) as string | undefined,
      dependencies: (t.dependencies ?? []) as string[],
      startedAt: t.startedAt as string | undefined,
      completedAt: t.completedAt as string | undefined,
      createdAt: (t.createdAt ?? t.created_at) as string | undefined,
      updatedAt: (t.updatedAt ?? t.updated_at) as string | undefined,
    };
    });

    console.log(`[API] Fetched ${normalized.length} tasks`);
    return normalized;
  }

  async getTaskDetails(questId: string, taskId: string): Promise<any> {
    const response = await this.fetchWithTimeout(
      `${API_BASE}/tasks/${taskId}?questId=${encodeURIComponent(questId)}`,
    );
    const data = await this.parseJSON<{ success: boolean; data: { task: any } }>(response);

    console.log(`[API] Fetched task: ${taskId}`);
    return data.data.task;
  }

  // -------------------------------------------------------------------------
  // Quest action endpoints (via agent-producer)
  // -------------------------------------------------------------------------

  async approveQuest(questId: string, feedback?: string): Promise<void> {
    await this.fetchWithTimeout(`${API_BASE}/quests/${questId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback }),
    });
    console.log(`[API] Quest approved: ${questId}`);
  }

  async reviseQuest(questId: string, feedback: string): Promise<void> {
    await this.fetchWithTimeout(`${API_BASE}/quests/${questId}/revise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback }),
    });
    console.log(`[API] Quest revision requested: ${questId}`);
  }

  async rejectQuest(questId: string, feedback: string): Promise<void> {
    await this.fetchWithTimeout(`${API_BASE}/quests/${questId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback }),
    });
    console.log(`[API] Quest rejected: ${questId}`);
  }

  // -------------------------------------------------------------------------
  // Task action endpoints (via agent-producer)
  // -------------------------------------------------------------------------

  async approveTask(taskId: string, feedback?: string): Promise<void> {
    await this.fetchWithTimeout(`${API_BASE}/tasks/${taskId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback }),
    });
    console.log(`[API] Task approved: ${taskId}`);
  }

  async reviseTask(taskId: string, feedback: string): Promise<void> {
    await this.fetchWithTimeout(`${API_BASE}/tasks/${taskId}/revise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback }),
    });
    console.log(`[API] Task revision requested: ${taskId}`);
  }

  async rejectTask(taskId: string, feedback: string): Promise<void> {
    await this.fetchWithTimeout(`${API_BASE}/tasks/${taskId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback }),
    });
    console.log(`[API] Task rejected: ${taskId}`);
  }

  // -------------------------------------------------------------------------
  // Event history (ArcadeDB-backed)
  // -------------------------------------------------------------------------

  async getEvents(params?: {
    after?: string;
    before?: string;
    type?: string;
    agent?: string;
    limit?: number;
  }): Promise<{ events: Array<Record<string, unknown>>; count: number; hasMore: boolean }> {
    const qs = new URLSearchParams();
    if (params?.after) qs.append('after', params.after);
    if (params?.before) qs.append('before', params.before);
    if (params?.type) qs.append('type', params.type);
    if (params?.agent) qs.append('agent', params.agent);
    if (params?.limit) qs.append('limit', String(params.limit));

    const url = qs.toString()
      ? `${API_BASE}/events?${qs.toString()}`
      : `${API_BASE}/events`;

    const response = await this.fetchWithTimeout(url);
    return this.parseJSON(response);
  }

  async getAgentLogs(agentId: string, params?: {
    after?: string;
    level?: string;
    limit?: number;
  }): Promise<{ entries: Array<Record<string, unknown>>; count: number; hasMore: boolean }> {
    const qs = new URLSearchParams({ format: 'json' });
    if (params?.after) qs.append('after', params.after);
    if (params?.level) qs.append('level', params.level);
    if (params?.limit) qs.append('limit', String(params.limit));

    const response = await this.fetchWithTimeout(
      `${API_BASE}/agents/${encodeURIComponent(agentId)}/logs?${qs.toString()}`,
    );
    return this.parseJSON(response);
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  async healthCheck(): Promise<HealthResponse> {
    const response = await this.fetchWithTimeout(`${API_BASE}/health`);
    return this.parseJSON(response);
  }

  // -------------------------------------------------------------------------
  // Tool playground
  // -------------------------------------------------------------------------

  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>> {
    const response = await this.fetchWithTimeout(`${API_BASE}/tools`);
    const data = await this.parseJSON<{ tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }>(response);
    return data.tools ?? [];
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetchWithTimeout(`${API_BASE}/tools/${encodeURIComponent(toolName)}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const data = await this.parseJSON<{ success: boolean; result: unknown }>(response);
    return data.result;
  }
}

/**
 * Health endpoint response shape (matches server /api/health)
 */
export interface HealthResponse {
  status: string;
  environment: string;
  wsClients: number;
  kadiBroker: 'connected' | 'disconnected';
  timestamp: string;
}

/**
 * Singleton API client instance
 */
export const apiClient = new ApiClient();
