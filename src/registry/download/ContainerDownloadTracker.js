/**
 * ContainerDownloadTracker — core data model (no I/O, no registry access).
 *
 * Purpose:
 * - Maintain container-level state for a pull: components (manifest/config/layers),
 *   status for each component, overall progress, and summaries.
 * - Provide fast lookups (downloadId → container, containerId → state).
 *
 * Relationship to the Manager:
 * - The Manager (ContainerDownloadTrackerManager) listens to registry events,
 *   detects which component a file belongs to, and calls into this tracker to
 *   update state. This file is intentionally “dumb” storage + bookkeeping.
 */

/**
 * Container download state tracking
 * Manages download progress across all container components
 */
export class ContainerDownloadTracker {
  constructor() {
    this.containerDownloads = new Map(); // containerId -> ContainerDownloadState
    this.fileToContainer = new Map();    // downloadId -> containerId
  }

  /**
   * Start tracking a new container download
   * @param {string} containerId - Container identifier
   * @param {string} containerName - Container display name
   * @param {Array} components - Array of expected components
   * @returns {ContainerDownloadState} - Container download state
   */
  startContainerDownload(containerId, containerName, components = []) {
    if (this.containerDownloads.has(containerId)) {
      throw new Error(`Container ${containerId} is already being tracked`);
    }

    const containerState = new ContainerDownloadState(containerId, containerName, components);
    this.containerDownloads.set(containerId, containerState);
    
    return containerState;
  }

  /**
   * Add a component to an existing container download
   * @param {string} containerId - Container identifier
   * @param {ComponentDownloadInfo} component - Component information
   */
  addComponent(containerId, component) {
    const containerState = this.containerDownloads.get(containerId);
    if (!containerState) {
      throw new Error(`Container ${containerId} is not being tracked`);
    }

    containerState.addComponent(component);
    
    // Map file download ID to container
    if (component.downloadId) {
      this.fileToContainer.set(component.downloadId, containerId);
    }
  }

  /**
   * Find component by download ID
   * @param {string} downloadId - File download identifier
   * @returns {ComponentDownloadInfo|null} - Component information or null
   */
  findComponentByDownloadId(downloadId) {
    const containerId = this.fileToContainer.get(downloadId);
    if (!containerId) {
      return null;
    }

    const containerState = this.containerDownloads.get(containerId);
    if (!containerState) {
      return null;
    }

    return containerState.findComponentByDownloadId(downloadId);
  }

  /**
   * Update component status
   * @param {string} downloadId - File download identifier
   * @param {string} status - New status
   * @param {Object} updateData - Additional update data
   */
  updateComponentStatus(downloadId, status, updateData = {}) {
    const component = this.findComponentByDownloadId(downloadId);
    if (!component) {
      return false;
    }

    component.updateStatus(status, updateData);
    return true;
  }

  /**
   * Get container download state
   * @param {string} containerId - Container identifier
   * @returns {ContainerDownloadState|null} - Container state or null
   */
  getContainerState(containerId) {
    return this.containerDownloads.get(containerId) || null;
  }

  /**
   * Get all active container downloads
   * @returns {Array<ContainerDownloadState>} - Array of active container states
   */
  getActiveDownloads() {
    return Array.from(this.containerDownloads.values())
      .filter(state => state.status === 'downloading');
  }

  /**
   * Complete container download
   * @param {string} containerId - Container identifier
   */
  completeContainer(containerId) {
    const containerState = this.containerDownloads.get(containerId);
    if (containerState) {
      containerState.complete();
    }
  }

  /**
   * Fail container download
   * @param {string} containerId - Container identifier
   * @param {string} error - Error message
   */
  failContainer(containerId, error) {
    const containerState = this.containerDownloads.get(containerId);
    if (containerState) {
      containerState.fail(error);
    }
  }

  /**
   * Clean up completed or failed downloads
   * @param {number} maxAge - Maximum age in milliseconds
   */
  cleanup(maxAge = 24 * 60 * 60 * 1000) { // 24 hours default
    const now = Date.now();
    const toRemove = [];

    for (const [containerId, state] of this.containerDownloads.entries()) {
      if (state.status === 'completed' || state.status === 'failed') {
        const age = now - state.startTime;
        if (age > maxAge) {
          toRemove.push(containerId);
        }
      }
    }

    // Remove old entries
    for (const containerId of toRemove) {
      const state = this.containerDownloads.get(containerId);
      
      // Clean up file mappings
      for (const component of state.components.values()) {
        if (component.downloadId) {
          this.fileToContainer.delete(component.downloadId);
        }
      }
      
      this.containerDownloads.delete(containerId);
    }

    return toRemove.length;
  }

  /**
   * Get tracker statistics
   * @returns {Object} - Tracker statistics
   */
  getStatistics() {
    const states = Array.from(this.containerDownloads.values());
    
    return {
      totalContainers: states.length,
      downloading: states.filter(s => s.status === 'downloading').length,
      completed: states.filter(s => s.status === 'completed').length,
      failed: states.filter(s => s.status === 'failed').length,
      pending: states.filter(s => s.status === 'pending').length,
      totalComponents: states.reduce((sum, s) => sum + s.totalComponents, 0),
      completedComponents: states.reduce((sum, s) => sum + s.completedComponents, 0),
      failedComponents: states.reduce((sum, s) => sum + s.failedComponents, 0)
    };
  }
}

/**
 * Container download state object
 * Tracks the overall state of a container download including all components
 */
export class ContainerDownloadState {
  constructor(containerId, containerName, components = []) {
    this.containerId = containerId;
    this.containerName = containerName;
    this.totalComponents = components.length;
    this.completedComponents = 0;
    this.failedComponents = 0;
    this.startTime = Date.now();
    this.completedTime = null;
    this.components = new Map(); // componentId -> ComponentDownloadInfo
    this.status = 'pending'; // 'pending', 'downloading', 'completed', 'failed'
    this.error = null;
    
    // Initialize components
    for (const componentSpec of components) {
      const component = new ComponentDownloadInfo(
        componentSpec.type,
        componentSpec.downloadId,
        componentSpec.size,
        componentSpec.layerIndex,
        containerId,  // Pass the container ID to the component
        componentSpec.digest  // Pass the digest to the component
      );
      this.components.set(component.componentId, component);
    }
  }

  /**
   * Add a component to the container
   * @param {ComponentDownloadInfo} component - Component to add
   */
  addComponent(component) {
    if (this.components.has(component.componentId)) {
      throw new Error(`Component ${component.componentId} already exists`);
    }
    
    // Set the container ID on the component
    component.containerId = this.containerId;
    
    this.components.set(component.componentId, component);
    this.totalComponents++;
  }

  /**
   * Find component by download ID
   * @param {string} downloadId - Download identifier
   * @returns {ComponentDownloadInfo|null} - Component or null
   */
  findComponentByDownloadId(downloadId) {
    for (const component of this.components.values()) {
      if (component.downloadId === downloadId) {
        return component;
      }
    }
    return null;
  }

  /**
   * Update container status based on component changes
   */
  updateStatus() {
    const allComponents = Array.from(this.components.values());
    
    if (allComponents.length === 0) {
      return;
    }

    // Update component counts
    this.completedComponents = allComponents.filter(c => c.status === 'completed').length;
    this.failedComponents = allComponents.filter(c => c.status === 'failed').length;

    // Check if any component is downloading
    if (allComponents.some(c => c.status === 'downloading')) {
      this.status = 'downloading';
      return;
    }

    // Check if all components are completed
    if (allComponents.every(c => c.status === 'completed')) {
      this.complete();
      return;
    }

    // Check if any component failed
    if (allComponents.some(c => c.status === 'failed')) {
      const failedComponent = allComponents.find(c => c.status === 'failed');
      this.fail(failedComponent.error || 'Component download failed');
      return;
    }

    // Check if any component started
    if (allComponents.some(c => c.status !== 'pending')) {
      this.status = 'downloading';
    }
  }

  /**
   * Complete the container download
   */
  complete() {
    this.status = 'completed';
    this.completedTime = Date.now();
    this.completedComponents = Array.from(this.components.values())
      .filter(c => c.status === 'completed').length;
  }

  /**
   * Fail the container download
   * @param {string} error - Error message
   */
  fail(error) {
    this.status = 'failed';
    this.completedTime = Date.now();
    this.error = error;
    this.failedComponents = Array.from(this.components.values())
      .filter(c => c.status === 'failed').length;
  }

  /**
   * Get completion progress (0-100)
   * @returns {number} - Completion percentage
   */
  getProgress() {
    if (this.totalComponents === 0) {
      return 0;
    }
    
    const completed = Array.from(this.components.values())
      .filter(c => c.status === 'completed').length;
    
    return Math.round((completed / this.totalComponents) * 100);
  }

  /**
   * Get components by type
   * @param {string} type - Component type ('manifest', 'config', 'layer')
   * @returns {Array<ComponentDownloadInfo>} - Components of specified type
   */
  getComponentsByType(type) {
    return Array.from(this.components.values())
      .filter(c => c.type === type);
  }

  /**
   * Get layers in order
   * @returns {Array<ComponentDownloadInfo>} - Layer components sorted by index
   */
  getLayersInOrder() {
    return this.getComponentsByType('layer')
      .sort((a, b) => (a.layerIndex || 0) - (b.layerIndex || 0));
  }

  /**
   * Check if all layers are completed
   * @returns {boolean} - True if all layers are completed
   */
  areAllLayersCompleted() {
    const layers = this.getComponentsByType('layer');
    return layers.length > 0 && layers.every(layer => layer.status === 'completed');
  }

  /**
   * Get container download summary
   * @returns {Object} - Download summary
   */
  getSummary() {
    const components = Array.from(this.components.values());
    
    return {
      containerId: this.containerId,
      containerName: this.containerName,
      status: this.status,
      progress: this.getProgress(),
      totalComponents: this.totalComponents,
      completedComponents: components.filter(c => c.status === 'completed').length,
      failedComponents: components.filter(c => c.status === 'failed').length,
      downloadingComponents: components.filter(c => c.status === 'downloading').length,
      startTime: this.startTime,
      completedTime: this.completedTime,
      error: this.error,
      components: components.map(c => c.getSummary())
    };
  }
}

/**
 * Component download information
 * Tracks individual component (manifest, config, layer) download state
 */
export class ComponentDownloadInfo {
  constructor(type, downloadId, size, layerIndex = null, containerId = null, digest = null) {
    this.type = type; // 'manifest', 'config', 'layer'
    this.downloadId = downloadId;
    this.size = size || 0;
    this.layerIndex = layerIndex; // For layers: 0, 1, 2, etc. null for manifest/config
    this.componentId = layerIndex !== null ? `layer-${layerIndex}` : type;
    this.containerId = containerId; // Reference to the container this component belongs to
    this.digest = digest; // SHA256 digest for matching with real downloads
    this.status = 'pending'; // 'pending', 'downloading', 'completed', 'failed'
    this.startTime = null;
    this.completedTime = null;
    this.error = null;
    this.progress = 0; // 0-100 for individual component progress
    this.bytesTransferred = 0;
    this.speed = 0; // Bytes per second
    this.eta = null; // Estimated time to completion
  }

  /**
   * Update component status
   * @param {string} status - New status
   * @param {Object} updateData - Additional update data
   */
  updateStatus(status, updateData = {}) {
    const oldStatus = this.status;
    this.status = status;

    switch (status) {
      case 'downloading':
        if (oldStatus === 'pending') {
          this.startTime = Date.now();
        }
        this.updateProgress(updateData);
        break;
        
      case 'completed':
        this.completedTime = Date.now();
        this.progress = 100;
        this.bytesTransferred = this.size;
        break;
        
      case 'failed':
        this.completedTime = Date.now();
        this.error = updateData.error || 'Download failed';
        break;
    }
  }

  /**
   * Update download progress
   * @param {Object} progressData - Progress update data
   */
  updateProgress(progressData = {}) {
    if (progressData.bytesTransferred !== undefined) {
      this.bytesTransferred = progressData.bytesTransferred;
    }
    
    if (progressData.totalBytes !== undefined && progressData.totalBytes > 0) {
      this.size = progressData.totalBytes;
    }
    
    if (this.size > 0) {
      this.progress = Math.round((this.bytesTransferred / this.size) * 100);
    }
    
    if (progressData.speed !== undefined) {
      this.speed = progressData.speed;
    }
    
    if (progressData.eta !== undefined) {
      this.eta = progressData.eta;
    }
  }

  /**
   * Get download duration in milliseconds
   * @returns {number} - Duration or 0 if not started
   */
  getDuration() {
    if (!this.startTime) {
      return 0;
    }
    
    const endTime = this.completedTime || Date.now();
    return endTime - this.startTime;
  }

  /**
   * Get average download speed
   * @returns {number} - Bytes per second
   */
  getAverageSpeed() {
    const duration = this.getDuration();
    if (duration === 0) {
      return 0;
    }
    
    return Math.round((this.bytesTransferred / duration) * 1000);
  }

  /**
   * Check if component is a layer
   * @returns {boolean} - True if component is a layer
   */
  isLayer() {
    return this.type === 'layer' && this.layerIndex !== null;
  }

  /**
   * Get component summary
   * @returns {Object} - Component summary
   */
  getSummary() {
    return {
      componentId: this.componentId,
      type: this.type,
      layerIndex: this.layerIndex,
      status: this.status,
      progress: this.progress,
      size: this.size,
      bytesTransferred: this.bytesTransferred,
      speed: this.speed,
      averageSpeed: this.getAverageSpeed(),
      duration: this.getDuration(),
      startTime: this.startTime,
      completedTime: this.completedTime,
      error: this.error,
      downloadId: this.downloadId
    };
  }
}
