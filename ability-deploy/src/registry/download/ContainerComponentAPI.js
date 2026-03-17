/**
 * Container Component Query API - Phase 3 Implementation
 * Provides discovery and status query APIs for container components
 */

/**
 * Container Component Query API
 * Provides methods to discover and query container component information
 */
export class ContainerComponentAPI {
  constructor(registry, downloadManager) {
    this.registry = registry;
    this.downloadManager = downloadManager;
  }

  /**
   * Get comprehensive container component inventory
   * @param {string} containerId - Container identifier
   * @returns {Promise<Object>} - Complete component inventory
   */
  async getContainerComponentInventory(containerId) {
    const container = this.registry.containers.get(containerId);
    if (!container) {
      throw new Error(`Container '${containerId}' not found`);
    }

    try {
      // Load manifest for detailed component information
      const manifest = await this.loadContainerManifest(containerId);
      const config = await this.loadContainerConfig(containerId);
      
      const inventory = {
        containerId,
        containerName: container.originalName || container.alias || containerId,
        manifestInfo: await this.getManifestInfo(containerId, manifest),
        configInfo: await this.getConfigInfo(containerId, config),
        layersInfo: await this.getLayersInfo(containerId, manifest),
        summary: {
          totalComponents: 0,
          totalSize: 0,
          layerCount: 0,
          estimatedDownloadTime: 0
        },
        downloadPaths: this.getDownloadPaths(containerId),
        apiEndpoints: this.getAPIEndpoints(containerId)
      };

      // Calculate summary statistics
      inventory.summary.totalComponents = 2 + (inventory.layersInfo.layers?.length || 0); // manifest + config + layers
      inventory.summary.totalSize = (inventory.manifestInfo.size || 0) + 
                                   (inventory.configInfo.size || 0) + 
                                   (inventory.layersInfo.totalSize || 0);
      inventory.summary.layerCount = inventory.layersInfo.layers?.length || 0;
      inventory.summary.estimatedDownloadTime = this.estimateDownloadTime(inventory.summary.totalSize);

      return inventory;

    } catch (error) {
      throw new Error(`Failed to get component inventory for container '${containerId}': ${error.message}`);
    }
  }

  /**
   * Get lightweight container component list
   * @param {string} containerId - Container identifier
   * @returns {Promise<Object>} - Lightweight component list
   */
  async getContainerComponentList(containerId) {
    const container = this.registry.containers.get(containerId);
    if (!container) {
      throw new Error(`Container '${containerId}' not found`);
    }

    try {
      const manifest = await this.loadContainerManifest(containerId);
      const layerCount = manifest?.layers?.length || 0;
      const layerIndices = Array.from({ length: layerCount }, (_, i) => i);

      return {
        containerId,
        containerName: container.originalName || container.alias || containerId,
        components: {
          manifest: {
            available: true,
            componentId: 'manifest',
            type: 'manifest'
          },
          config: {
            available: true,
            componentId: 'config',
            type: 'config'
          },
          layers: {
            available: layerCount > 0,
            count: layerCount,
            indices: layerIndices,
            maxIndex: Math.max(0, layerCount - 1),
            components: layerIndices.map(index => ({
              componentId: `layer-${index}`,
              type: 'layer',
              layerIndex: index
            }))
          }
        },
        counts: {
          totalComponents: 2 + layerCount,
          manifestComponents: 1,
          configComponents: 1,
          layerComponents: layerCount
        },
        bounds: {
          minLayerIndex: layerCount > 0 ? 0 : null,
          maxLayerIndex: layerCount > 0 ? layerCount - 1 : null
        }
      };

    } catch (error) {
      throw new Error(`Failed to get component list for container '${containerId}': ${error.message}`);
    }
  }

  /**
   * Get specific container component status
   * @param {string} containerId - Container identifier
   * @param {string} componentType - Component type ('manifest', 'config', 'layer')
   * @param {number} [layerIndex] - Layer index (required for layer type)
   * @returns {Promise<Object>} - Component status
   */
  async getContainerComponentStatus(containerId, componentType, layerIndex = null) {
    if (!containerId || !componentType) {
      throw new Error('Container ID and component type are required');
    }

    const validTypes = ['manifest', 'config', 'layer'];
    if (!validTypes.includes(componentType)) {
      throw new Error(`Invalid component type '${componentType}'. Valid types: ${validTypes.join(', ')}`);
    }

    if (componentType === 'layer' && typeof layerIndex !== 'number') {
      throw new Error('Layer index is required for layer component type');
    }

    const container = this.registry.containers.get(containerId);
    if (!container) {
      throw new Error(`Container '${containerId}' not found`);
    }

    try {
      // Get component information from static data
      const componentInfo = await this.getStaticComponentInfo(containerId, componentType, layerIndex);
      
      // Get download status from download manager if available
      const downloadStatus = this.getComponentDownloadStatus(containerId, componentType, layerIndex);
      
      return {
        containerId,
        containerName: container.originalName || container.alias || containerId,
        componentType,
        componentId: layerIndex !== null ? `layer-${layerIndex}` : componentType,
        layerIndex,
        available: componentInfo.available,
        static: componentInfo,
        download: downloadStatus,
        combined: {
          status: downloadStatus.status || (componentInfo.available ? 'available' : 'unavailable'),
          size: downloadStatus.size || componentInfo.size || 0,
          progress: downloadStatus.progress || 0,
          error: downloadStatus.error || null
        }
      };

    } catch (error) {
      throw new Error(`Failed to get component status: ${error.message}`);
    }
  }

  /**
   * Get layer-specific download status summary
   * @param {string} containerId - Container identifier
   * @returns {Promise<Object>} - Layer download status summary
   */
  async getLayerDownloadStatus(containerId) {
    const container = this.registry.containers.get(containerId);
    if (!container) {
      throw new Error(`Container '${containerId}' not found`);
    }

    try {
      const manifest = await this.loadContainerManifest(containerId);
      const layerCount = manifest?.layers?.length || 0;
      
      if (layerCount === 0) {
        return {
          containerId,
          containerName: container.originalName || container.alias || containerId,
          layerCount: 0,
          layers: [],
          summary: {
            totalLayers: 0,
            completedLayers: 0,
            downloadingLayers: 0,
            pendingLayers: 0,
            failedLayers: 0,
            overallProgress: 0,
            totalSize: 0,
            downloadedSize: 0
          }
        };
      }

      const layers = [];
      let totalSize = 0;
      let downloadedSize = 0;
      let completedCount = 0;
      let downloadingCount = 0;
      let failedCount = 0;

      for (let i = 0; i < layerCount; i++) {
        const layerStatus = await this.getContainerComponentStatus(containerId, 'layer', i);
        const layerSize = layerStatus.combined.size || 0;
        const layerProgress = layerStatus.combined.progress || 0;
        
        layers.push({
          layerIndex: i,
          componentId: `layer-${i}`,
          status: layerStatus.combined.status,
          progress: layerProgress,
          size: layerSize,
          downloadedBytes: Math.round((layerSize * layerProgress) / 100),
          available: layerStatus.available,
          error: layerStatus.combined.error,
          digest: layerStatus.static.digest,
          mediaType: layerStatus.static.mediaType
        });

        totalSize += layerSize;
        downloadedSize += Math.round((layerSize * layerProgress) / 100);

        if (layerStatus.combined.status === 'completed') completedCount++;
        else if (layerStatus.combined.status === 'downloading') downloadingCount++;
        else if (layerStatus.combined.status === 'failed') failedCount++;
      }

      const overallProgress = totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0;

      return {
        containerId,
        containerName: container.originalName || container.alias || containerId,
        layerCount,
        layers,
        summary: {
          totalLayers: layerCount,
          completedLayers: completedCount,
          downloadingLayers: downloadingCount,
          pendingLayers: layerCount - completedCount - downloadingCount - failedCount,
          failedLayers: failedCount,
          overallProgress,
          totalSize,
          downloadedSize
        }
      };

    } catch (error) {
      throw new Error(`Failed to get layer download status: ${error.message}`);
    }
  }

  /**
   * Get all container downloads status
   * @returns {Array} - Array of container download states
   */
  getContainerDownloads() {
    return this.downloadManager.getContainerDownloads();
  }

  /**
   * Get specific container download status
   * @param {string} containerId - Container identifier
   * @returns {Object|null} - Container download status or null
   */
  getContainerDownloadStatus(containerId) {
    return this.downloadManager.getContainerDownloadStatus(containerId);
  }

  /**
   * Get active container downloads
   * @returns {Array} - Array of active downloading containers
   */
  getActiveContainerDownloads() {
    return this.downloadManager.getActiveContainerDownloads();
  }

  /**
   * Get container download history
   * @returns {Object} - Download history and statistics
   */
  getContainerDownloadHistory() {
    const downloads = this.getContainerDownloads();
    const completed = downloads.filter(d => d.status === 'completed');
    const failed = downloads.filter(d => d.status === 'failed');
    
    return {
      total: downloads.length,
      completed: completed.length,
      failed: failed.length,
      active: downloads.filter(d => d.status === 'downloading').length,
      downloads: downloads.map(download => ({
        containerId: download.containerId,
        containerName: download.containerName,
        status: download.status,
        progress: download.progress,
        startTime: download.startTime,
        completedTime: download.completedTime,
        duration: download.completedTime ? download.completedTime - download.startTime : null,
        totalComponents: download.totalComponents,
        completedComponents: download.completedComponents,
        error: download.error
      }))
    };
  }

  // ===== PRIVATE HELPER METHODS =====

  /**
   * Load container manifest
   * @private
   */
  async loadContainerManifest(containerId) {
    const container = this.registry.containers.get(containerId);
    if (!container?.exportPath) {
      return null;
    }

    try {
      const manifestPath = path.join(container.exportPath, 'manifest.json');
      if (await fs.pathExists(manifestPath)) {
        const manifestData = await fs.readFile(manifestPath, 'utf8');
        return JSON.parse(manifestData);
      }
    } catch (error) {
      // Return null if manifest can't be loaded
    }
    
    return null;
  }

  /**
   * Load container config
   * @private
   */
  async loadContainerConfig(containerId) {
    const container = this.registry.containers.get(containerId);
    if (!container?.exportPath) {
      return null;
    }

    try {
      const configPath = path.join(container.exportPath, 'config.json');
      if (await fs.pathExists(configPath)) {
        const configData = await fs.readFile(configPath, 'utf8');
        return JSON.parse(configData);
      }
    } catch (error) {
      // Return null if config can't be loaded
    }
    
    return null;
  }

  /**
   * Get manifest information
   * @private
   */
  async getManifestInfo(containerId, manifest) {
    const container = this.registry.containers.get(containerId);
    const manifestJson = JSON.stringify(manifest || {}, null, 2);
    
    return {
      available: manifest !== null,
      size: manifestJson.length,
      mediaType: manifest?.mediaType || 'application/vnd.docker.distribution.manifest.v2+json',
      schemaVersion: manifest?.schemaVersion || 2,
      digest: manifest ? this.calculateDigest(manifestJson) : null,
      filename: 'manifest.json',
      description: 'Container manifest with layer and config references',
      path: container?.exportPath ? path.join(container.exportPath, 'manifest.json') : null
    };
  }

  /**
   * Get config information
   * @private
   */
  async getConfigInfo(containerId, config) {
    const container = this.registry.containers.get(containerId);
    const configJson = JSON.stringify(config || {}, null, 2);
    
    return {
      available: config !== null,
      size: configJson.length,
      mediaType: 'application/vnd.docker.container.image.v1+json',
      digest: config ? this.calculateDigest(configJson) : null,
      filename: 'config.json',
      description: 'Container configuration and metadata',
      architecture: config?.architecture || 'unknown',
      os: config?.os || 'unknown',
      path: container?.exportPath ? path.join(container.exportPath, 'config.json') : null
    };
  }

  /**
   * Get layers information
   * @private
   */
  async getLayersInfo(containerId, manifest) {
    const container = this.registry.containers.get(containerId);
    const layers = manifest?.layers || [];
    
    const layersInfo = {
      available: layers.length > 0,
      count: layers.length,
      totalSize: layers.reduce((sum, layer) => sum + (layer.size || 0), 0),
      layers: []
    };

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const layerFilename = `layer-${i + 1}.tar`;
      const layerPath = container?.exportPath ? path.join(container.exportPath, layerFilename) : null;
      
      // Check if layer file exists
      let fileExists = false;
      let actualSize = layer.size || 0;
      
      if (layerPath) {
        try {
          if (await fs.pathExists(layerPath)) {
            fileExists = true;
            const stats = await fs.stat(layerPath);
            actualSize = stats.size;
          }
        } catch (error) {
          // Ignore stat errors
        }
      }

      layersInfo.layers.push({
        layerIndex: i,
        componentId: `layer-${i}`,
        size: actualSize,
        manifestSize: layer.size || 0,
        mediaType: layer.mediaType || 'application/vnd.docker.image.rootfs.diff.tar',
        digest: layer.digest,
        filename: layerFilename,
        description: `Filesystem layer ${i + 1}`,
        path: layerPath,
        fileExists
      });
    }

    return layersInfo;
  }

  /**
   * Get download paths for container components
   * @private
   */
  getDownloadPaths(containerId) {
    const urls = this.getRegistryUrls();
    
    return {
      manifest: `${urls.preferredUrl}/v2/${containerId}/manifests/latest`,
      config: `${urls.preferredUrl}/v2/${containerId}/blobs/{config-digest}`,
      layers: `${urls.preferredUrl}/v2/${containerId}/blobs/{layer-digest}`,
      baseUrl: urls.preferredUrl,
      registryDomain: urls.preferredDomain
    };
  }

  /**
   * Get API endpoints for container
   * @private
   */
  getAPIEndpoints(containerId) {
    const baseUrl = this.getRegistryUrls().preferredUrl;
    
    return {
      ping: `${baseUrl}/v2/`,
      catalog: `${baseUrl}/v2/_catalog`,
      manifest: `${baseUrl}/v2/${containerId}/manifests/latest`,
      manifestHead: `${baseUrl}/v2/${containerId}/manifests/latest`,
      tags: `${baseUrl}/v2/${containerId}/tags/list`,
      blob: `${baseUrl}/v2/${containerId}/blobs/{digest}`,
      blobHead: `${baseUrl}/v2/${containerId}/blobs/{digest}`
    };
  }

  /**
   * Get static component information
   * @private
   */
  async getStaticComponentInfo(containerId, componentType, layerIndex) {
    const container = this.registry.containers.get(containerId);
    const manifest = await this.loadContainerManifest(containerId);
    
    switch (componentType) {
      case 'manifest':
        return await this.getManifestInfo(containerId, manifest);
        
      case 'config':
        const config = await this.loadContainerConfig(containerId);
        return await this.getConfigInfo(containerId, config);
        
      case 'layer':
        if (typeof layerIndex !== 'number' || layerIndex < 0) {
          throw new Error('Valid layer index required for layer component');
        }
        
        const layers = manifest?.layers || [];
        if (layerIndex >= layers.length) {
          throw new Error(`Layer index ${layerIndex} out of range (max: ${layers.length - 1})`);
        }
        
        const layer = layers[layerIndex];
        const layerFilename = `layer-${layerIndex + 1}.tar`;
        const layerPath = container?.exportPath ? path.join(container.exportPath, layerFilename) : null;
        
        let fileExists = false;
        let actualSize = layer.size || 0;
        
        if (layerPath) {
          try {
            if (await fs.pathExists(layerPath)) {
              fileExists = true;
              const stats = await fs.stat(layerPath);
              actualSize = stats.size;
            }
          } catch (error) {
            // Ignore errors
          }
        }
        
        return {
          available: fileExists,
          size: actualSize,
          manifestSize: layer.size || 0,
          mediaType: layer.mediaType || 'application/vnd.docker.image.rootfs.diff.tar',
          digest: layer.digest,
          filename: layerFilename,
          description: `Filesystem layer ${layerIndex}`,
          path: layerPath,
          fileExists,
          layerIndex
        };
        
      default:
        throw new Error(`Unknown component type: ${componentType}`);
    }
  }

  /**
   * Get component download status from download manager
   * @private
   */
  getComponentDownloadStatus(containerId, componentType, layerIndex) {
    const containerDownload = this.downloadManager.getContainerDownloadStatus(containerId);
    
    if (!containerDownload) {
      return {
        status: null,
        progress: 0,
        size: 0,
        error: null,
        startTime: null,
        completedTime: null
      };
    }

    const componentId = layerIndex !== null ? `layer-${layerIndex}` : componentType;
    const component = containerDownload.components?.find(c => c.componentId === componentId);
    
    if (!component) {
      return {
        status: null,
        progress: 0,
        size: 0,
        error: null,
        startTime: null,
        completedTime: null
      };
    }

    return {
      status: component.status,
      progress: component.progress || 0,
      size: component.size || 0,
      bytesTransferred: component.bytesTransferred || 0,
      speed: component.speed || 0,
      averageSpeed: component.averageSpeed || 0,
      duration: component.duration || 0,
      error: component.error,
      startTime: component.startTime,
      completedTime: component.completedTime
    };
  }

  /**
   * Calculate digest for content
   * @private
   */
  calculateDigest(content) {
    // Use the registry's existing digest calculation method
    return this.registry.calculateDigest(content);
  }

  /**
   * Estimate download time based on size
   * @private
   */
  estimateDownloadTime(totalSize) {
    // Assume average download speed of 1MB/s for estimation
    const avgSpeedBytesPerSecond = 1024 * 1024;
    return Math.ceil(totalSize / avgSpeedBytesPerSecond);
  }

  /**
   * Get registry URLs
   * @private
   */
  getRegistryUrls() {
    try {
      return this.registry.getRegistryUrls();
    } catch (error) {
      return {
        preferredUrl: 'http://localhost:3000',
        preferredDomain: 'localhost:3000'
      };
    }
  }
}

// Required imports
import path from 'path';
import fs from 'fs-extra';
