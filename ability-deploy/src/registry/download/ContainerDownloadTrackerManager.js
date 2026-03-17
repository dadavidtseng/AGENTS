/**
 * ContainerDownloadTrackerManager — bridges registry file events → container semantics.
 *
 * Why this exists:
 * - The registry emits file-level events (download:*). A pull is meaningful at
 *   the container level (manifest + config + layers). This manager interprets
 *   file events, detects which component they relate to, and updates the
 *   ContainerDownloadTracker so we can emit container:* completion events.
 *
 * Responsibilities:
 * - Listen to registry download:* and container:accessed events
 * - Use ComponentDetector to map paths like /v2/:name/blobs/:digest → component
 * - Pre-seed expected components from a manifest when available
 * - Maintain container-level progress and emit container:* signals
 */

import { EventEmitter } from 'events';
import { ContainerDownloadTracker } from './ContainerDownloadTracker.js';
import { ComponentDetector } from './ComponentDetector.js';

/**
 * Container Download Tracker Manager
 * Manages download tracking infrastructure and coordinates with the registry's event system
 * Tracks downloads initiated by external tools (Docker/Podman) without controlling the actual download process
 */
export class ContainerDownloadTrackerManager extends EventEmitter {
  constructor(registry) {
    super();
    this.registry = registry;
    this.tracker = new ContainerDownloadTracker();
    this.containerManifests = new Map(); // containerId -> manifest data
    this.setupEventListeners();
  }

  /**
   * Wire registry file-level events to the tracker and prepare manifests on access.
   */
  setupEventListeners() {
    // Wire registry file-level events to component-aware handlers
    this.registry.on('download:started', (info) => this.handleFileDownloadStarted(info));
    this.registry.on('download:progress', (info) => this.handleFileDownloadProgress(info));
    this.registry.on('download:completed', (info) => this.handleFileDownloadCompleted(info));
    this.registry.on('download:failed', (info) => this.handleFileDownloadFailed(info));
    
    // Prepare context (manifests) as soon as a container is accessed
    this.registry.on('container:accessed', (info) => this.handleContainerAccessed(info));
  }

  /**
   * Handle file download start.
   *
   * Two ways a component can be known:
   * - Pre-seeded ("manually tracked"): when manifest access seeded expected
   *   components via setupContainerDownloadTracking().
   * - Detected from the download path using ComponentDetector.
   */
  handleFileDownloadStarted(info) {
    try {
      // First try to match a pre-seeded (manually tracked) component
      let component = this.findManuallyTrackedComponent(info);
      
      if (!component) {
        // Fall back to component detection based on Registry API/S3 path
        const detectedComponent = ComponentDetector.detectComponent(info.path || info.key, info);
        
        if (detectedComponent) {
          // This is a container component - start component tracking
          const componentSpec = ComponentDetector.createComponentSpec(detectedComponent, {
            downloadId: info.downloadId || info.id || info.key,
            size: info.size || info.totalBytes || 0,
            ...info
          });

          this.startComponentDownload(componentSpec);
          component = detectedComponent;
        }
      } else {
        // Update the existing pre-seeded component with runtime info
        // For real downloads, use the digest to anchor the component
        if (info.digest) {
          component.digest = info.digest;
        }
        component.downloadId = info.downloadId || info.id || info.key;
        component.updateStatus('downloading');
        
        // Map download ID to container for quick lookup
        this.tracker.fileToContainer.set(component.downloadId, component.containerId);
      }
      
      if (component) {
        // Emit component-specific started event
        this.emitComponentEvent('started', component, info);
        
        // Track container-level progress
        this.updateContainerProgress(component.containerId, component, 'started', info);
      }
    } catch (error) {
      this.registry.logger?.warn('Error handling file download started:', error.message);
    }
    
    // Always preserve original download:started event - no modification needed
  }

  /**
   * Handle file download progress event
   * Updates component progress and emits container-level progress
   * @param {Object} info - Progress information
   */
  handleFileDownloadProgress(info) {
    try {
      // Handle both downloadId (from simulations) and key (from real downloads)
      let component = this.tracker.findComponentByDownloadId(info.downloadId || info.id || info.key);
      
      // If not found by downloadId and we have container name + digest, try to find by container context
      if (!component && info.key && info.digest) {
        const containerState = this.tracker.getContainerState(info.key);
        if (containerState) {
          // Look for a component in this container that matches the digest
          for (const [componentId, comp] of containerState.components) {
            if (comp.digest === info.digest || 
                (comp.status === 'downloading' && !comp.downloadId)) {
              component = comp;
              break;
            }
          }
        }
      }
      
      // If not found by download ID, try to find by component info
      if (!component && info.containerId && info.componentType) {
        const containerState = this.tracker.getContainerState(info.containerId);
        if (containerState) {
          let componentId;
          if (info.componentType === 'layer' && info.layerIndex !== undefined) {
            componentId = `layer-${info.layerIndex}`;
          } else {
            componentId = info.componentType;
          }
          component = containerState.components.get(componentId);
        }
      }
      
      if (component) {
        // Update component progress
        component.updateProgress({
          bytesTransferred: info.bytesTransferred,
          totalBytes: info.totalBytes || info.size,
          speed: info.speed,
          eta: info.eta
        });

        // Emit component progress event
        this.emitComponentProgressEvent(component, info);
        
        // Update container progress
        this.updateContainerProgress(component.containerId, component, 'progress', info);
      }
    } catch (error) {
      this.registry.logger?.warn('Error handling file download progress:', error.message);
    }
  }

  /**
   * Handle file download completed event
   * Checks for completion milestones and emits container events
   * @param {Object} info - Completion information
   */
  /**
   * Handle file download completed event.
   *
   * Correlates a finished blob to a known component using (in order):
   * - downloadId mapping (simulation path)
   * - container key + digest match (real pull path)
   * When matched, marks the component completed and emits container-level milestones
   * (layers completed, container completed).
   */
  handleFileDownloadCompleted(info) {
    try {
      // Handle both downloadId (from simulations) and key (from real downloads)
      let component = null;
      
      // First try to find by downloadId (for simulations)
      const downloadKey = info.downloadId || info.key;
      component = this.tracker.findComponentByDownloadId(downloadKey);
      
      // If not found and we have a container name + digest, try to find by container and digest
      if (!component && info.key && info.digest) {
        // Find container by the key (container name)
        const containerState = this.tracker.getContainerState(info.key);
        
        // Debug logging
        this.registry.logger?.debug('Looking for component by container + digest:', {
          containerKey: info.key,
          digest: info.digest,
          containerStateFound: !!containerState,
          allTrackedContainers: Array.from(this.tracker.containerDownloads.keys())
        });
        
        if (containerState) {
          // Debug the components in this container
          const allComponents = Array.from(containerState.components.entries());
          this.registry.logger?.debug('Container components:', {
            containerKey: info.key,
            componentCount: allComponents.length,
            components: allComponents.map(([id, comp]) => ({
              id,
              type: comp.type,
              digest: comp.digest,
              status: comp.status,
              downloadId: comp.downloadId
            }))
          });
          
          // Look for a component in this container that matches the digest
          for (const [componentId, comp] of containerState.components) {
            if (comp.digest === info.digest || 
                (comp.status === 'pending' && !comp.digest && !comp.downloadId)) {
              // If no digest match but found a pending component without digest, assign the digest and match
              if (!comp.digest) {
                comp.digest = info.digest;
                this.registry.logger?.debug('Assigned digest to pending component:', { componentId, digest: info.digest });
              }
              component = comp;
              break;
            }
          }
        }
      }
      
      if (!component) {
        this.registry.logger?.warn('No component found for completed download:', downloadKey, 'digest:', info.digest);
        return;
      }
      
      if (component) {
        // Update component status to completed
        component.updateStatus('completed', {
          size: info.size || info.totalBytes,
          completedAt: Date.now()
        });

        // Emit component-specific completion event
        this.emitComponentEvent('completed', component, info);
        
        // Check for completion milestones (all layers/entire container)
        this.checkCompletionMilestones(component.containerId, component);
        
        // Update container progress
        this.updateContainerProgress(component.containerId, component, 'completed', info);
      }
    } catch (error) {
      this.registry.logger?.warn('Error handling file download completed:', error.message);
      this.registry.logger?.warn('DEBUG: Error stack:', error.stack);
    }
  }

  /**
   * Handle file download failed event
   * Updates component status and handles container-level failure
   * @param {Object} info - Failure information
   */
  handleFileDownloadFailed(info) {
    try {
      // Handle both downloadId (from simulations) and key (from real downloads)
      let component = this.tracker.findComponentByDownloadId(info.downloadId || info.id || info.key);
      
      // If not found and we have container name + digest, try to find by container context
      if (!component && info.key && info.digest) {
        const containerState = this.tracker.getContainerState(info.key);
        if (containerState) {
          // Look for a component in this container that matches the digest
          for (const [componentId, comp] of containerState.components) {
            if (comp.digest === info.digest || 
                (comp.status === 'downloading' && !comp.downloadId)) {
              component = comp;
              break;
            }
          }
        }
      }
      
      if (component) {
        // Update component status to failed
        component.updateStatus('failed', {
          error: info.error || 'Download failed',
          failedAt: Date.now()
        });

        // Emit component-specific failure event
        this.emitComponentEvent('failed', component, info);
        
        // Update container progress and check for container failure
        this.updateContainerProgress(component.containerId, component, 'failed', info);
      }
    } catch (error) {
      this.registry.logger?.warn('Error handling file download failed:', error.message);
    }
  }

  /**
   * Handle container accessed event
   * Prepares for potential component downloads by loading manifest
   * @param {Object} info - Container access information
   */
  async handleContainerAccessed(info) {
    try {
      if (info.name && !this.containerManifests.has(info.name)) {
        // Try to load manifest for this container to prepare for component detection
        await this.loadContainerManifest(info.name);
      }
    } catch (error) {
      // Silently fail - manifest loading is optional for detection
      this.registry.logger?.debug('Could not load manifest for container:', info.name, error.message);
    }
  }

  /**
   * Start tracking a component download
   * @param {Object} componentSpec - Component specification
   */
  startComponentDownload(componentSpec) {
    const { containerId, containerName } = componentSpec;
    
    // Ensure container is being tracked
    let containerState = this.tracker.getContainerState(containerId);
    if (!containerState) {
      // Create new container download state
      const components = this.getExpectedComponentsForContainer(containerId);
      containerState = this.tracker.startContainerDownload(containerId, containerName, components);
      
      // Emit container download started event
      this.emitContainerEvent('started', containerState);
    }

    // Add or update component
    try {
      const component = new ComponentDownloadInfo(
        componentSpec.type,
        componentSpec.downloadId,
        componentSpec.size,
        componentSpec.layerIndex,
        containerId  // Pass container ID
      );
      
      this.tracker.addComponent(containerId, component);
    } catch (error) {
      // Component might already exist - update it instead
      const existingComponent = containerState.findComponentByDownloadId(componentSpec.downloadId);
      if (existingComponent) {
        existingComponent.updateStatus('downloading');
      }
    }
  }

  /**
   * Get expected components for a container
   * @param {string} containerId - Container identifier
   * @returns {Array} - Array of expected component specifications
   */
  getExpectedComponentsForContainer(containerId) {
    const manifest = this.containerManifests.get(containerId);
    if (manifest) {
      return ComponentDetector.getExpectedComponents(manifest, containerId);
    }
    
    // Return minimal expected components if no manifest available
    return [
      { type: 'manifest', componentId: 'manifest' },
      { type: 'config', componentId: 'config' }
    ];
  }

  /**
   * Load container manifest for better component detection
   * @param {string} containerId - Container identifier
   */
  async loadContainerManifest(containerId) {
    try {
      // Try to find container in registry
      const container = this.registry.containers.get(containerId);
      if (container && container.exportPath) {
        const manifestPath = path.join(container.exportPath, 'manifest.json');
        if (await fs.pathExists(manifestPath)) {
          const manifestData = await fs.readFile(manifestPath, 'utf8');
          const manifest = JSON.parse(manifestData);
          this.containerManifests.set(containerId, manifest);
          return manifest;
        }
      }
    } catch (error) {
      // Ignore errors - this is best-effort manifest loading
    }
    return null;
  }

  /**
   * Emit component-specific event
   * @param {string} eventType - Event type (started, completed, failed)
   * @param {Object} component - Component information
   * @param {Object} info - Download information
   */
  emitComponentEvent(eventType, component, info) {
    const eventName = `container:${component.type}:${eventType}`;
    const payload = {
      containerId: component.containerId,
      containerName: this.getContainerName(component.containerId),
      componentType: component.type,
      componentId: component.componentId,
      layerIndex: component.layerIndex,
      downloadId: info.downloadId || info.id,
      size: info.size || info.totalBytes || 0,
      startTime: eventType === 'started' ? Date.now() : undefined,
      completedTime: eventType === 'completed' ? Date.now() : undefined,
      error: eventType === 'failed' ? info.error : undefined,
      path: info.path || info.key,
      digest: component.digest
    };

    // Emit only the specific component event as per design spec
    this.registry.emit(eventName, payload);
  }

  /**
   * Emit component progress event
   * @param {Object} component - Component download info
   * @param {Object} info - Progress information
   */
  emitComponentProgressEvent(component, info) {
    const payload = {
      containerId: component.containerId,
      containerName: this.getContainerName(component.containerId),
      componentType: component.type,
      componentId: component.componentId,
      layerIndex: component.layerIndex,
      downloadId: info.downloadId || info.id,
      bytesTransferred: info.bytesTransferred || component.bytesTransferred,
      totalBytes: info.totalBytes || info.size || component.size,
      progress: component.progress,
      speed: info.speed || component.speed,
      eta: info.eta || component.eta,
      timestamp: Date.now()
    };

    this.emit('container:component:progress', payload);
    this.registry.emit('container:component:progress', payload);
  }

  /**
   * Check for completion milestones
   * @param {string} containerId - Container identifier
   * @param {Object} component - Component that was updated
   */
  checkCompletionMilestones(containerId, component) {
    const containerState = this.tracker.getContainerState(containerId);
    if (!containerState) return;

    // Update container status based on components first
    containerState.updateStatus();
    
    // Debug logging
    const allComponents = Array.from(containerState.components.values());
    const completedComponents = allComponents.filter(c => c.status === 'completed');
    
    this.registry.logger?.debug('Checking completion milestones:', {
      containerId,
      componentType: component.type,
      componentId: component.componentId,
      totalComponents: allComponents.length,
      completedComponents: completedComponents.length,
      containerStatus: containerState.status,
      allCompleted: allComponents.every(c => c.status === 'completed')
    });

    // Check if all layers are completed
    if (component.type === 'layer') {
      if (containerState.areAllLayersCompleted()) {
        this.registry.logger?.debug('All layers completed, emitting layers:completed event');
        this.emitAllLayersCompleted(containerId);
      }
    }

    // Check if entire container is completed
    if (containerState.status === 'completed') {
      this.registry.logger?.debug('Container completed, emitting download:completed event');
      this.emitContainerCompleted(containerId);
    } else if (containerState.status === 'failed') {
      this.emitContainerFailed(containerId, containerState.error);
    }
  }

  /**
   * Emit all layers completed event
   * @param {string} containerId - Container identifier
   */
  emitAllLayersCompleted(containerId) {
    const containerState = this.tracker.getContainerState(containerId);
    if (!containerState) return;

    const layers = containerState.getLayersInOrder();
    const totalLayersSize = layers.reduce((sum, layer) => sum + (layer.size || 0), 0);
    
    const payload = {
      containerId,
      containerName: this.getContainerName(containerId),
      totalLayers: layers.length,
      layerSizes: layers.map(layer => layer.size || 0),
      totalLayersSize,
      completedAt: Date.now(),
      layers: layers.map(layer => ({
        layerIndex: layer.layerIndex,
        componentId: layer.componentId,
        size: layer.size,
        duration: layer.getDuration(),
        averageSpeed: layer.getAverageSpeed()
      }))
    };

    this.emit('container:layers:completed', payload);
    this.registry.emit('container:layers:completed', payload);
  }

  /**
   * Emit container completed event
   * @param {string} containerId - Container identifier
   */
  emitContainerCompleted(containerId) {
    const containerState = this.tracker.getContainerState(containerId);
    if (!containerState) return;

    const payload = {
      containerId,
      containerName: this.getContainerName(containerId),
      totalComponents: containerState.totalComponents,
      completedComponents: containerState.completedComponents,
      totalSize: Array.from(containerState.components.values())
        .reduce((sum, comp) => sum + (comp.size || 0), 0),
      startTime: containerState.startTime,
      completedTime: containerState.completedTime,
      duration: containerState.completedTime - containerState.startTime,
      components: Array.from(containerState.components.values()).map(comp => comp.getSummary())
    };

    this.emit('container:download:completed', payload);
    this.registry.emit('container:download:completed', payload);

    // Mark container as completed in tracker
    this.tracker.completeContainer(containerId);
  }

  /**
   * Emit container failed event
   * @param {string} containerId - Container identifier
   * @param {string} error - Error message
   */
  emitContainerFailed(containerId, error) {
    const containerState = this.tracker.getContainerState(containerId);
    if (!containerState) return;

    const payload = {
      containerId,
      containerName: this.getContainerName(containerId),
      error: error || 'Container download failed',
      totalComponents: containerState.totalComponents,
      completedComponents: containerState.completedComponents,
      failedComponents: containerState.failedComponents,
      startTime: containerState.startTime,
      failedTime: containerState.completedTime,
      duration: containerState.completedTime - containerState.startTime,
      components: Array.from(containerState.components.values()).map(comp => comp.getSummary())
    };

    this.emit('container:download:failed', payload);
    this.registry.emit('container:download:failed', payload);

    // Mark container as failed in tracker
    this.tracker.failContainer(containerId, error);
  }

  /**
   * Update container progress and emit progress events
   * @param {string} containerId - Container identifier
   * @param {Object} component - Component information
   * @param {string} eventType - Event type
   * @param {Object} info - Download information
   */
  updateContainerProgress(containerId, component, eventType, info) {
    const containerState = this.tracker.getContainerState(containerId);
    if (!containerState) return;

    // Emit container download started if this is the first component
    if (eventType === 'started' && containerState.status === 'pending') {
      containerState.status = 'downloading';
      this.emitContainerEvent('started', containerState);
    }

    // Update container status
    containerState.updateStatus();

    // Emit container progress event
    const progress = containerState.getProgress();
    const payload = {
      containerId,
      containerName: this.getContainerName(containerId),
      progress,
      totalComponents: containerState.totalComponents,
      completedComponents: Array.from(containerState.components.values())
        .filter(c => c.status === 'completed').length,
      downloadingComponents: Array.from(containerState.components.values())
        .filter(c => c.status === 'downloading').length,
      currentComponent: {
        type: component.type,
        componentId: component.componentId,
        layerIndex: component.layerIndex,
        progress: component.progress
      },
      timestamp: Date.now()
    };

    this.emit('container:download:progress', payload);
    this.registry.emit('container:download:progress', payload);
  }

  /**
   * Emit container event
   * @param {string} eventType - Event type
   * @param {Object} containerState - Container state
   */
  emitContainerEvent(eventType, containerState) {
    const payload = {
      containerId: containerState.containerId,
      containerName: containerState.containerName,
      totalComponents: containerState.totalComponents,
      startTime: containerState.startTime,
      status: containerState.status,
      components: Array.from(containerState.components.values()).map(comp => ({
        type: comp.type,
        componentId: comp.componentId,
        layerIndex: comp.layerIndex,
        status: comp.status
      }))
    };

    const eventName = `container:download:${eventType}`;
    this.emit(eventName, payload);
    this.registry.emit(eventName, payload);
  }

  /**
   * Get container name from ID
   * @param {string} containerId - Container identifier
   * @returns {string} - Container name
   */
  getContainerName(containerId) {
    const container = this.registry.containers.get(containerId);
    return container?.originalName || container?.alias || containerId;
  }

  /**
   * Get container downloads status
   * @returns {Array} - Array of container download states
   */
  getContainerDownloads() {
    return Array.from(this.tracker.containerDownloads.values())
      .map(state => state.getSummary());
  }

  /**
   * Get specific container download status
   * @param {string} containerId - Container identifier
   * @returns {Object|null} - Container download status or null
   */
  getContainerDownloadStatus(containerId) {
    const containerState = this.tracker.getContainerState(containerId);
    return containerState ? containerState.getSummary() : null;
  }

  /**
   * Get active container downloads
   * @returns {Array} - Array of downloading container states
   */
  getActiveContainerDownloads() {
    return this.tracker.getActiveDownloads()
      .map(state => state.getSummary());
  }

  /**
   * Get tracker statistics
   * @returns {Object} - Download tracker statistics
   */
  getTrackerStatistics() {
    return this.tracker.getStatistics();
  }

  /**
   * Cleanup old download records
   * @param {number} maxAge - Maximum age in milliseconds
   * @returns {number} - Number of cleaned up records
   */
  cleanup(maxAge) {
    return this.tracker.cleanup(maxAge);
  }

  /**
   * Set up download tracking for a container's expected components
   * This prepares the tracking system to monitor when external tools download the container
   * @param {string} containerId - Container identifier
   * @param {string} containerName - Container name
   * @param {Array} components - Expected components
   */
  setupContainerDownloadTracking(containerId, containerName, components = []) {
    const containerState = this.tracker.startContainerDownload(containerId, containerName, components);
    this.emitContainerEvent('started', containerState);
    return containerState;
  }

  /**
   * Match a download to a pre-seeded (manually tracked) component.
   *
   * "Manually tracked" means we created component placeholders ahead of time
   * from the image manifest. That gives us componentId/type/layerIndex so we
   * can bind the first actual download to that placeholder and carry its
   * progress/status.
   */
  findManuallyTrackedComponent(info) {
    // Check if download info contains component information
    if (!info.containerId || !info.componentType) {
      return null;
    }
    
    const containerState = this.tracker.getContainerState(info.containerId);
    if (!containerState) {
      return null;
    }
    
    // Find component by type and layer index
    let componentId;
    if (info.componentType === 'layer' && info.layerIndex !== undefined) {
      componentId = `layer-${info.layerIndex}`;
    } else {
      componentId = info.componentType;
    }
    
    const component = containerState.components.get(componentId);
    if (component && component.status === 'pending') {
      return component;
    }
    
    return null;
  }
}

// Import ComponentDownloadInfo for use in this module
import { ComponentDownloadInfo } from './ContainerDownloadTracker.js';
import path from 'path';
import fs from 'fs-extra';
