/**
 * Git utility functions for quest data versioning
 * Provides audit trail for quest changes with graceful degradation if git is unavailable
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Git commit metadata
 */
export interface GitCommit {
  /** Commit hash (SHA-1) */
  hash: string;
  /** Author name */
  author: string;
  /** Author email */
  email: string;
  /** Commit timestamp */
  date: Date;
  /** Commit message */
  message: string;
}

/**
 * Check if git is available on the system
 * @returns true if git command is available
 */
function isGitAvailable(): boolean {
  try {
    execSync('git --version', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Initialize Git repository in quest data directory
 * Creates .git directory and initial commit if repo doesn't exist
 *
 * @param dataDir - Path to quest data directory (e.g., .quest-data/)
 * @throws Never throws - logs warnings and continues if git unavailable
 *
 * @example
 * await initQuestDataRepo('C:/GitHub/mcp-server-quest/.quest-data');
 */
export async function initQuestDataRepo(dataDir: string): Promise<void> {
  // Check if git is available
  if (!isGitAvailable()) {
    console.warn('[Git] Git binary not found. Running in degraded mode without version control.');
    return;
  }

  try {
    const gitDir = join(dataDir, '.git');

    // Check if already initialized
    if (existsSync(gitDir)) {
      console.log('[Git] Repository already initialized');
      return;
    }

    // Initialize git repository
    execSync('git init', {
      cwd: dataDir,
      stdio: 'ignore',
    });
    console.log('[Git] Repository initialized');

    // Check if repo is empty (no commits)
    let isEmpty = false;
    try {
      execSync('git rev-parse HEAD', {
        cwd: dataDir,
        stdio: 'ignore',
      });
    } catch {
      isEmpty = true;
    }

    // Create initial commit if empty
    if (isEmpty) {
      try {
        // Create .gitkeep file to ensure directory is tracked
        execSync('echo "# Quest Data Repository" > README.md', {
          cwd: dataDir,
          stdio: 'ignore',
        });

        execSync('git add .', {
          cwd: dataDir,
          stdio: 'ignore',
        });

        execSync('git commit -m "Initial commit: Initialize quest data repository"', {
          cwd: dataDir,
          stdio: 'ignore',
        });
        console.log('[Git] Initial commit created');
      } catch (error) {
        console.warn('[Git] Failed to create initial commit:', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  } catch (error) {
    console.warn('[Git] Failed to initialize repository:', error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Commit changes to quest data repository
 * Stages all changes and creates a commit with the provided message
 *
 * @param dataDir - Path to quest data directory
 * @param message - Commit message (summary line)
 * @param body - Optional commit body with additional details
 * @throws Never throws - logs warnings and continues if git unavailable
 *
 * @example
 * await commitQuestChanges(
 *   'C:/GitHub/mcp-server-quest/.quest-data',
 *   'Create quest: Implement user authentication',
 *   'Added requirements and design documents'
 * );
 */
export async function commitQuestChanges(
  dataDir: string,
  message: string,
  body?: string
): Promise<void> {
  // Check if git is available
  if (!isGitAvailable()) {
    console.warn('[Git] Git not available. Changes will not be versioned.');
    return;
  }

  try {
    // Stage all changes
    execSync('git add .', {
      cwd: dataDir,
      stdio: 'ignore',
    });

    // Check if there are changes to commit
    let hasChanges = false;
    try {
      execSync('git diff --cached --quiet', {
        cwd: dataDir,
        stdio: 'ignore',
      });
    } catch {
      hasChanges = true;
    }

    if (!hasChanges) {
      console.log('[Git] No changes to commit');
      return;
    }

    // Build commit message (escape quotes for shell)
    const fullMessage = body
      ? `${message}\n\n${body}`
      : message;

    // Create commit (use -F - to read from stdin for proper multiline support)
    execSync(`git commit -F -`, {
      cwd: dataDir,
      input: fullMessage,
      stdio: ['pipe', 'ignore', 'ignore'],
    });

    console.log('[Git] Changes committed:', message);
  } catch (error) {
    // Check if error is ENOENT (git not found)
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      console.warn('[Git] Git binary not found. Running in degraded mode.');
    } else {
      console.warn('[Git] Failed to commit changes:', error instanceof Error ? error.message : 'Unknown error');
    }
  }
}

/**
 * Retrieve Git commit history for a specific quest
 * Returns chronological list of commits affecting the quest's directory
 *
 * @param questId - Quest identifier (UUID)
 * @param dataDir - Path to quest data directory
 * @returns Array of git commits, or empty array if git unavailable
 *
 * @example
 * const history = await getQuestHistory(
 *   'abc-123-def',
 *   'C:/GitHub/mcp-server-quest/.quest-data'
 * );
 * console.log(`Quest has ${history.length} revisions`);
 */
export async function getQuestHistory(
  questId: string,
  dataDir: string
): Promise<GitCommit[]> {
  // Check if git is available
  if (!isGitAvailable()) {
    console.warn('[Git] Git not available. Cannot retrieve history.');
    return [];
  }

  try {
    // Get git log for quest directory
    // Format: hash|author|email|iso-date|subject
    const questPath = `quests/${questId}/`;
    const output = execSync(
      `git log --format="%H|%an|%ae|%ai|%s" -- "${questPath}"`,
      {
        cwd: dataDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );

    // Parse output into GitCommit array
    if (!output.trim()) {
      return [];
    }

    const commits = output
      .trim()
      .split('\n')
      .map((line) => {
        const [hash, author, email, dateStr, message] = line.split('|');
        return {
          hash,
          author,
          email,
          date: new Date(dateStr),
          message,
        };
      });

    return commits;
  } catch (error) {
    // Check if error is ENOENT (git not found)
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      console.warn('[Git] Git binary not found. Cannot retrieve history.');
    } else {
      console.warn('[Git] Failed to retrieve history:', error instanceof Error ? error.message : 'Unknown error');
    }
    return [];
  }
}
