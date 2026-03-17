// TypeScript definitions for tunneled-container-registry

export interface TunnelOptions {
  subdomain?: string;
  region?: string;
  authtoken?: string;
  host?: string;
  port?: number;
}

export interface TunnelInfo {
  service: string;
  url: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  subdomain?: string;
  region?: string;
  pid?: number;
  startTime?: string;
}

export interface RegistryUrls {
  localUrl: string;
  localDomain: string;
  tunnelUrl: string | null;
  tunnelDomain: string | null;
  preferredUrl: string;
  preferredDomain: string;
}

export interface CredentialOptions {
  expiry?: number;
  permissions?: string[];
  customKey?: string;
  customSecret?: string;
}

export interface ShutdownOptions {
  onCompletion?: boolean;
  completionDelay?: number;
  maxIdleTime?: number;
  maxTotalTime?: number;
}

export interface MonitoringOptions {
  updateInterval?: number;
  enableDashboard?: boolean;
  enableLogging?: boolean;
}

export interface EngineOptions {
  dockerSocket?: string;
  podmanSocket?: string;
}

export interface RegistryOptions {
  enableCatalog?: boolean;
  enableHealthCheck?: boolean;
  customHeaders?: object;
}

export interface TunneledContainerRegistryOptions {
  port?: number;
  serverName?: string;
  tunnelService?: string;
  tunnelOptions?: TunnelOptions;
  credentials?: CredentialOptions;
  autoShutdown?: boolean;
  shutdownOptions?: ShutdownOptions;
  enableMonitoring?: boolean;
  monitoringOptions?: MonitoringOptions;
  preferredEngine?: string;
  engineOptions?: EngineOptions;
  registryOptions?: RegistryOptions;
}

export interface Credentials {
  accessKey: string;
  secretKey: string;
  expiry: Date;
}

export interface Container {
  id: string;
  name: string;
  alias?: string;
  tags: string[];
  size: number;
  addedAt: Date;
}

export interface RegistryInfo {
  status: string;
  serverId: string;
  localUrl: string;
  tunnelUrl: string | null;
  credentials: Credentials;
  startTime: Date;
  containers: Container[];
}

export interface ContainerSpec {
  source: 'docker' | 'podman' | 'tar' | 'mock';
  name: string;
  path?: string;
  alias?: string;
  tags?: string[];
  layerSize?: number;
  description?: string;
}

export interface ContainerInfo {
  id: string;
  name: string;
  alias?: string;
  tags: string[];
  size: number;
  addedAt: Date;
  source: string;
}

export declare class RegistryError extends Error {
  code: string;
  details: object;
  constructor(message: string, code: string, details?: object);
  toJSON(): object;
}

export interface RegistryStats {
  uptime: number;
  containers: {
    total: number;
    bySource: {
      docker: number;
      podman: number;
      tar: number;
      mock: number;
    };
  };
  downloads: {
    total: number;
    active: number;
    completed: number;
    failed: number;
    totalBytes: number;
    averageSpeed: number;
  };
  tunnel: {
    status: string;
    uptime: number;
    reconnections: number;
  };
  server: {
    requests: number;
    errors: number;
    averageResponseTime: number;
  };
}

export interface ContainerStats {
  id: string;
  name: string;
  downloads: {
    total: number;
    manifest: number;
    config: number;
    layers: number;
    totalBytes: number;
  };
  firstDownload: Date | null;
  lastDownload: Date | null;
  averageDownloadTime: number;
  popularLayers: Array<{
    digest: string;
    downloads: number;
  }>;
}

export interface DiscoveryOptions {
  engines?: Array<'docker' | 'podman'>;
  filters?: {
    labels?: { [key: string]: string };
    names?: string[];
    tags?: string[];
  };
  limit?: number;
  addToRegistry?: boolean;
}

export interface HealthStatus {
  healthy: boolean;
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    server: {
      status: 'pass' | 'fail';
      responseTime: number;
    };
    tunnel: {
      status: 'pass' | 'fail' | 'unavailable';
      responseTime: number;
    };
    containers: {
      status: 'pass' | 'warn' | 'fail';
      available: number;
      errors: string[];
    };
    credentials: {
      status: 'pass' | 'warn' | 'fail';
      timeRemaining: number;
    };
  };
  timestamp: Date;
}

export interface RegistryConfig {
  version: string;
  created: Date;
  containers: Array<{
    source: string;
    name: string;
    alias?: string;
    tags: string[];
  }>;
  configuration: {
    tunnelService: string;
    credentials: {
      expiry: number;
      permissions: string[];
    };
    autoShutdown: boolean;
  };
}

export declare class TunneledContainerRegistry {
  constructor(options?: TunneledContainerRegistryOptions);
  
  // Core lifecycle methods
  start(): Promise<RegistryInfo>;
  stop(): Promise<void>;
  
  // Container management methods
  addContainer(containerSpec: ContainerSpec): Promise<ContainerInfo>;
  addContainers(containerSpecs: ContainerSpec[]): Promise<ContainerInfo[]>;
  removeContainer(nameOrId: string): Promise<void>;
  listContainers(): Container[];
  
  // Information methods
  getRegistryInfo(): object;
  getRegistryUrls(): Promise<RegistryUrls>;
  getAccessCredentials(): Promise<object>;
  getDockerCommands(containerName?: string): Promise<object>;
  getPodmanCommands(containerName?: string): Promise<object>;
  getContainerCommands(containerName?: string): Promise<object>;
  generateCommandHelp(): Promise<string>;
  
  // Statistics and monitoring methods
  getStats(): RegistryStats;
  getRegistryStats(): object;
  getPerformanceMetrics(): object;
  getUsageStatistics(): object;
  getHealthMetrics(): object;
  getContainerStats(nameOrId: string): ContainerStats | null;
  
  // Configuration management methods
  updateConfig(newConfig: Partial<TunneledContainerRegistryOptions>): Promise<void>;
  refreshCredentials(options?: { expiry?: number }): Promise<Credentials>;
  
  // Utility methods
  healthCheck(): Promise<HealthStatus>;
  autoDiscoverContainers(options?: DiscoveryOptions): Promise<ContainerInfo[]>;
  exportRegistryConfig(): Promise<RegistryConfig>;
  importRegistryConfig(config: RegistryConfig): Promise<void>;
  
  // Internal methods
  validateAndMergeOptions(options: TunneledContainerRegistryOptions): TunneledContainerRegistryOptions;
  generateCredentials(options?: CredentialOptions): Credentials;
  
  // Event emitter methods
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  emit(event: string, ...args: any[]): boolean;
}
