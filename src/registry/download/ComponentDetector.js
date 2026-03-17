/**
 * Component Detector - Container Component Detection System
 * Phase 1: Detect and classify container components from download paths
 */

/**
 * Component detector for identifying container components from download paths
 * Supports Docker Registry v2 API path patterns and container file structures
 */
export class ComponentDetector {
  
  /**
   * Detect component type and metadata from download path or information
   * @param {string} path - Download path or key
   * @param {Object} downloadInfo - Additional download information
   * @returns {Object|null} - Component information or null if not a container component
   */
  static detectComponent(path, downloadInfo = {}) {
    if (!path || typeof path !== 'string') {
      return null;
    }

    // Try different detection methods
    const component = 
      this.detectRegistryApiComponent(path, downloadInfo) ||
      this.detectFileSystemComponent(path, downloadInfo) ||
      this.detectS3Component(path, downloadInfo) ||
      this.detectManifestComponent(path, downloadInfo);

    if (component) {
      // Add additional metadata
      component.path = path;
      component.detectedAt = Date.now();
      component.downloadInfo = downloadInfo;
    }

    return component;
  }

  /**
   * Detect components from Docker Registry v2 API paths
   * Pattern: /v2/{name}/blobs/{digest} or /v2/{name}/manifests/{tag}
   * @param {string} path - Registry API path
   * @param {Object} downloadInfo - Download information
   * @returns {Object|null} - Component information
   */
  static detectRegistryApiComponent(path, downloadInfo = {}) {
    // Registry manifest request
    const manifestMatch = path.match(/^\/v2\/([^\/]+)\/manifests\/([^\/]+)$/);
    if (manifestMatch) {
      const [, containerName, reference] = manifestMatch;
      return {
        type: 'manifest',
        containerId: this.sanitizeContainerId(containerName),
        containerName: containerName,
        reference: reference,
        componentId: 'manifest'
      };
    }

    // Registry blob request (could be config or layer)
    const blobMatch = path.match(/^\/v2\/([^\/]+)\/blobs\/(sha256:[a-f0-9A-Za-z]+)$/);
    if (blobMatch) {
      const [, containerName, digest] = blobMatch;
      
      // Determine if this is config or layer based on context
      const isConfig = this.isConfigDigest(digest, downloadInfo);
      
      if (isConfig) {
        return {
          type: 'config',
          containerId: this.sanitizeContainerId(containerName),
          containerName: containerName,
          digest: digest,
          componentId: 'config'
        };
      } else {
        // Try to determine layer index from manifest context
        const layerIndex = this.extractLayerIndex(digest, downloadInfo);
        return {
          type: 'layer',
          containerId: this.sanitizeContainerId(containerName),
          containerName: containerName,
          digest: digest,
          layerIndex: layerIndex,
          componentId: layerIndex !== null ? `layer-${layerIndex}` : 'layer-unknown'
        };
      }
    }

    return null;
  }

  /**
   * Detect components from filesystem paths
   * Pattern: /containers/{containerId}/{filename}
   * @param {string} path - Filesystem path
   * @param {Object} downloadInfo - Download information
   * @returns {Object|null} - Component information
   */
  static detectFileSystemComponent(path, downloadInfo = {}) {
    // Extract container directory structure
    const containerMatch = path.match(/\/containers\/([^\/]+)\/(.+)$/);
    if (!containerMatch) {
      return null;
    }

    const [, containerId, filename] = containerMatch;
    
    // Detect manifest files
    if (filename === 'manifest.json' || filename === 'image-manifest.json') {
      return {
        type: 'manifest',
        containerId: containerId,
        containerName: containerId,
        filename: filename,
        componentId: 'manifest'
      };
    }

    // Detect config files
    if (filename === 'config.json' || filename === 'image-config.json') {
      return {
        type: 'config',
        containerId: containerId,
        containerName: containerId,
        filename: filename,
        componentId: 'config'
      };
    }

    // Detect layer files
    const layerMatch = filename.match(/^layer-(\d+)\.tar$/);
    if (layerMatch) {
      const layerIndex = parseInt(layerMatch[1], 10);
      return {
        type: 'layer',
        containerId: containerId,
        containerName: containerId,
        filename: filename,
        layerIndex: layerIndex,
        componentId: `layer-${layerIndex}`
      };
    }

    // Alternative layer patterns
    const altLayerMatch = filename.match(/^(\d+)\.tar$/) || filename.match(/^layer(\d+)\.tar$/);
    if (altLayerMatch) {
      const layerIndex = parseInt(altLayerMatch[1], 10);
      return {
        type: 'layer',
        containerId: containerId,
        containerName: containerId,
        filename: filename,
        layerIndex: layerIndex,
        componentId: `layer-${layerIndex}`
      };
    }

    return null;
  }

  /**
   * Detect components from S3-style paths
   * Pattern: /{bucket}/v2/{name}/... or /{bucket}/containers/{name}/...
   * @param {string} path - S3 path
   * @param {Object} downloadInfo - Download information
   * @returns {Object|null} - Component information
   */
  static detectS3Component(path, downloadInfo = {}) {
    // S3 registry API paths
    const s3RegistryMatch = path.match(/^\/[^\/]+\/v2\/([^\/]+)\/(blobs|manifests)\/(.+)$/);
    if (s3RegistryMatch) {
      const [, containerName, type, identifier] = s3RegistryMatch;
      
      if (type === 'manifests') {
        return {
          type: 'manifest',
          containerId: this.sanitizeContainerId(containerName),
          containerName: containerName,
          reference: identifier,
          componentId: 'manifest'
        };
      } else if (type === 'blobs') {
        // Determine if config or layer
        const isConfig = this.isConfigDigest(identifier, downloadInfo);
        
        if (isConfig) {
          return {
            type: 'config',
            containerId: this.sanitizeContainerId(containerName),
            containerName: containerName,
            digest: identifier,
            componentId: 'config'
          };
        } else {
          const layerIndex = this.extractLayerIndex(identifier, downloadInfo);
          return {
            type: 'layer',
            containerId: this.sanitizeContainerId(containerName),
            containerName: containerName,
            digest: identifier,
            layerIndex: layerIndex,
            componentId: layerIndex !== null ? `layer-${layerIndex}` : 'layer-unknown'
          };
        }
      }
    }

    // S3 container directory paths
    const s3ContainerMatch = path.match(/^\/[^\/]+\/containers\/([^\/]+)\/(.+)$/);
    if (s3ContainerMatch) {
      return this.detectFileSystemComponent(`/containers/${s3ContainerMatch[1]}/${s3ContainerMatch[2]}`, downloadInfo);
    }

    return null;
  }

  /**
   * Detect manifest components based on content analysis
   * @param {string} path - Path being analyzed
   * @param {Object} downloadInfo - Download information including content hints
   * @returns {Object|null} - Component information
   */
  static detectManifestComponent(path, downloadInfo = {}) {
    // Check if this looks like a manifest request by content type
    const contentType = downloadInfo.contentType || downloadInfo.mediaType;
    if (contentType && contentType.includes('manifest')) {
      const containerId = this.extractContainerIdFromPath(path);
      if (containerId) {
        return {
          type: 'manifest',
          containerId: containerId,
          containerName: containerId,
          contentType: contentType,
          componentId: 'manifest'
        };
      }
    }

    // Check if this looks like a config by content type
    if (contentType && contentType.includes('container.image')) {
      const containerId = this.extractContainerIdFromPath(path);
      if (containerId) {
        return {
          type: 'config',
          containerId: containerId,
          containerName: containerId,
          contentType: contentType,
          componentId: 'config'
        };
      }
    }

    return null;
  }

  /**
   * Extract container ID from various path formats
   * @param {string} path - Path to analyze
   * @returns {string|null} - Container ID or null
   */
  static extractContainerIdFromPath(path) {
    // Try different patterns
    const patterns = [
      /\/v2\/([^\/]+)\//,           // Registry API
      /\/containers\/([^\/]+)\//,   // Container directory
      /\/([^\/]+)\/manifests\//,    // Direct manifest access
      /\/([^\/]+)\/blobs\//         // Direct blob access
    ];

    for (const pattern of patterns) {
      const match = path.match(pattern);
      if (match) {
        return this.sanitizeContainerId(match[1]);
      }
    }

    return null;
  }

  /**
   * Get expected components from container manifest
   * @param {Object} manifest - Container manifest object
   * @param {string} containerId - Container identifier
   * @returns {Array} - Array of expected component specifications
   */
  static getExpectedComponents(manifest, containerId) {
    const components = [];

    // Always expect manifest itself
    components.push({
      type: 'manifest',
      componentId: 'manifest',
      size: JSON.stringify(manifest).length,
      mediaType: manifest.mediaType
    });

    // Always expect config
    if (manifest.config) {
      components.push({
        type: 'config',
        componentId: 'config',
        size: manifest.config.size || 0,
        digest: manifest.config.digest,
        mediaType: manifest.config.mediaType
      });
    }

    // Expect each layer
    if (manifest.layers && Array.isArray(manifest.layers)) {
      manifest.layers.forEach((layer, index) => {
        components.push({
          type: 'layer',
          componentId: `layer-${index}`,
          layerIndex: index,
          size: layer.size || 0,
          digest: layer.digest,
          mediaType: layer.mediaType
        });
      });
    }

    // Add container context to each component
    return components.map(comp => ({
      ...comp,
      containerId: containerId,
      expectedAt: Date.now()
    }));
  }

  /**
   * Determine if a digest belongs to a config blob
   * @param {string} digest - Blob digest
   * @param {Object} context - Context information including manifest
   * @returns {boolean} - True if this is a config digest
   */
  static isConfigDigest(digest, context = {}) {
    // Check manifest context if available
    if (context.manifest && context.manifest.config) {
      return context.manifest.config.digest === digest;
    }

    // Check if context explicitly indicates this is config
    if (context.isConfig === true) {
      return true;
    }

    // Check content type hints
    const contentType = context.contentType || context.mediaType;
    if (contentType && contentType.includes('container.image')) {
      return true;
    }

    // Default to false - assume layer
    return false;
  }

  /**
   * Extract layer index from digest using manifest context
   * @param {string} digest - Layer digest
   * @param {Object} context - Context information including manifest
   * @returns {number|null} - Layer index or null
   */
  static extractLayerIndex(digest, context = {}) {
    // Check manifest context for layer index
    if (context.manifest && context.manifest.layers) {
      const layerIndex = context.manifest.layers.findIndex(layer => layer.digest === digest);
      if (layerIndex >= 0) {
        return layerIndex;
      }
    }

    // Check if context explicitly provides layer index
    if (typeof context.layerIndex === 'number') {
      return context.layerIndex;
    }

    // Could not determine layer index
    return null;
  }

  /**
   * Sanitize container ID for consistent tracking
   * @param {string} containerId - Raw container ID
   * @returns {string} - Sanitized container ID
   */
  static sanitizeContainerId(containerId) {
    if (!containerId || typeof containerId !== 'string') {
      return 'unknown';
    }

    // Convert to lowercase and replace special characters
    return containerId
      .toLowerCase()
      .replace(/[^a-z0-9\-_]/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-+/g, '-') || 'unknown';
  }

  /**
   * Validate component detection result
   * @param {Object} component - Detected component
   * @returns {boolean} - True if component is valid
   */
  static validateComponent(component) {
    if (!component || typeof component !== 'object') {
      return false;
    }

    // Required fields
    const requiredFields = ['type', 'containerId', 'componentId'];
    for (const field of requiredFields) {
      if (!component[field]) {
        return false;
      }
    }

    // Valid types
    const validTypes = ['manifest', 'config', 'layer'];
    if (!validTypes.includes(component.type)) {
      return false;
    }

    // Layer-specific validation
    if (component.type === 'layer') {
      if (typeof component.layerIndex !== 'number' || component.layerIndex < 0) {
        return false;
      }
    }

    return true;
  }

  /**
   * Parse container name and tag from registry path
   * @param {string} path - Registry path
   * @returns {Object} - Parsed name and tag
   */
  static parseContainerReference(path) {
    // Extract from registry API path
    const registryMatch = path.match(/\/v2\/([^\/]+)\/(?:manifests|blobs)\/([^\/]+)$/);
    if (registryMatch) {
      const [, name, reference] = registryMatch;
      
      // Check if reference is a tag or digest
      if (reference.startsWith('sha256:')) {
        return {
          name: name,
          tag: 'latest', // Default for digest references
          digest: reference
        };
      } else {
        return {
          name: name,
          tag: reference
        };
      }
    }

    // Extract from filesystem path
    const containerMatch = path.match(/\/containers\/([^\/]+)\//);
    if (containerMatch) {
      const fullName = containerMatch[1];
      
      // Split name and tag if present
      const lastColonIndex = fullName.lastIndexOf(':');
      if (lastColonIndex > 0 && !fullName.substring(lastColonIndex).includes('/')) {
        return {
          name: fullName.substring(0, lastColonIndex),
          tag: fullName.substring(lastColonIndex + 1)
        };
      } else {
        return {
          name: fullName,
          tag: 'latest'
        };
      }
    }

    return {
      name: 'unknown',
      tag: 'latest'
    };
  }

  /**
   * Create component specification for tracking
   * @param {Object} component - Detected component
   * @param {Object} downloadInfo - Download information
   * @returns {Object} - Component specification for tracking
   */
  static createComponentSpec(component, downloadInfo = {}) {
    if (!this.validateComponent(component)) {
      throw new Error('Invalid component for spec creation');
    }

    return {
      type: component.type,
      componentId: component.componentId,
      containerId: component.containerId,
      containerName: component.containerName || component.containerId,
      layerIndex: component.layerIndex || null,
      downloadId: downloadInfo.downloadId || downloadInfo.id || null,
      size: downloadInfo.size || downloadInfo.totalBytes || 0,
      digest: component.digest || null,
      mediaType: component.mediaType || downloadInfo.contentType || null,
      path: component.path || null,
      filename: component.filename || null,
      detectedAt: component.detectedAt || Date.now()
    };
  }
}
