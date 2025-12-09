/**
 * Common utility functions
 */

/**
 * Generate a unique ID for messages
 *
 * Format: timestamp-random (e.g., "1701234567890-abc123")
 *
 * @returns Unique identifier string
 */
export function generateId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}
