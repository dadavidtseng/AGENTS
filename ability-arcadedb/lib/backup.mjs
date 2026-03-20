// backup.mjs - ES Module wrapper for CommonJS backup module
import backupRequire from './backup.js';

// The CommonJS module exports the class directly
const BackupManager = backupRequire;

// Re-export as proper ES module
export { BackupManager };
export default BackupManager;