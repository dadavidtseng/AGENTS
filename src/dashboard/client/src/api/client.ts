/**
 * API Client for backend communication
 * Provides REST methods and WebSocket event subscription
 */

import type { Quest, Agent } from '../types';

const API_BASE = '/api';
const WS_URL = import.meta.env.DEV 
  ? 'ws://localhost:8888/ws'  // Direct connection in development
  : `ws://${window.location.host}/ws`;  // Proxy in production
const REQUEST_TIMEOUT = 30000; // 30 seconds

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
 * WebSocket event handler type
 */
type EventHandler = (data: any) => void;

/**
 * API Client class with REST and WebSocket support
 */
export class ApiClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private eventHandlers: Map<string, Set<EventHandler>> = new Map();
  private shouldReconnect = false;

  /**
   * Fetch wrapper with timeout and error handling
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit = {}
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

  /**
   * Get quests with optional status filter
   */
  async getQuests(status?: string): Promise<Quest[]> {
    const url = status 
      ? `${API_BASE}/quests?status=${encodeURIComponent(status)}`
      : `${API_BASE}/quests`;
    
    const response = await this.fetchWithTimeout(url);
    const data = await this.parseJSON<{ success: boolean; data: { quests: Quest[] } }>(response);
    
    console.log(`[API] Fetched ${data.data.quests.length} quests`);
    return data.data.quests;
  }

  /**
   * Get quest details by ID
   */
  async getQuestDetails(questId: string): Promise<Quest> {
    const response = await this.fetchWithTimeout(`${API_BASE}/quests/${questId}`);
    const data = await this.parseJSON<{ success: boolean; data: { quest: Quest } }>(response);
    
    console.log(`[API] Fetched quest: ${questId}`);
    return data.data.quest;
  }

  /**
   * Get agents with optional filters
   */
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

  /**
   * Submit approval decision for a quest
   */
  async submitApproval(questId: string, decision: ApprovalDecision): Promise<void> {
    const response = await this.fetchWithTimeout(`${API_BASE}/approvals/${questId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(decision),
    });

    const data = await this.parseJSON<{ success: boolean }>(response);
    
    if (!data.success) {
      throw new Error('Approval submission failed');
    }
    
    console.log(`[API] Submitted approval for quest: ${questId}`);
  }

  /**
   * Get task details by ID
   */
  async getTaskDetails(questId: string, taskId: string): Promise<any> {
    const response = await this.fetchWithTimeout(
      `${API_BASE}/tasks/${taskId}?questId=${encodeURIComponent(questId)}`
    );
    const data = await this.parseJSON<{ success: boolean; data: { task: any } }>(response);
    
    console.log(`[API] Fetched task: ${taskId}`);
    return data.data.task;
  }

  /**
   * Connect to WebSocket server
   */
  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Already connected');
      return;
    }

    this.shouldReconnect = true;
    this.connectWebSocket();
  }

  /**
   * Internal WebSocket connection logic
   */
  private connectWebSocket(): void {
    try {
      console.log('[WebSocket] Connecting to', WS_URL);
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        console.log('[WebSocket] Connected');
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('[WebSocket] Message:', message);

          const { event: eventName, data } = message;
          
          if (eventName && this.eventHandlers.has(eventName)) {
            const handlers = this.eventHandlers.get(eventName);
            handlers?.forEach((handler) => {
              try {
                handler(data);
              } catch (error) {
                console.error(`[WebSocket] Handler error for event ${eventName}:`, error);
              }
            });
          }
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
      };

      this.ws.onclose = (event) => {
        console.log('[WebSocket] Disconnected:', event.code, event.reason);
        this.ws = null;

        // Auto-reconnect if should reconnect and haven't exceeded max attempts
        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(
            `[WebSocket] Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
          );

          setTimeout(() => {
            this.connectWebSocket();
          }, this.reconnectDelay);

          // Exponential backoff
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
        } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          console.error('[WebSocket] Max reconnect attempts reached');
        }
      };
    } catch (error) {
      console.error('[WebSocket] Connection failed:', error);
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.shouldReconnect = false;
    
    if (this.ws) {
      console.log('[WebSocket] Disconnecting');
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Subscribe to WebSocket event
   */
  on(event: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    
    this.eventHandlers.get(event)!.add(handler);
    console.log(`[WebSocket] Subscribed to event: ${event}`);
  }

  /**
   * Unsubscribe from WebSocket event
   */
  off(event: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event);
    
    if (handlers) {
      handlers.delete(handler);
      
      if (handlers.size === 0) {
        this.eventHandlers.delete(event);
      }
      
      console.log(`[WebSocket] Unsubscribed from event: ${event}`);
    }
  }

  /**
   * Health check endpoint
   */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    const response = await this.fetchWithTimeout(`${API_BASE}/health`);
    const data = await this.parseJSON<{ success: boolean; data: { status: string; timestamp: string } }>(response);
    
    return data.data;
  }
}

/**
 * Singleton API client instance
 */
export const apiClient = new ApiClient();
