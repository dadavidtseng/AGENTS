/**
 * Random Acknowledgment Messages
 * ===============================
 *
 * Provides varied "thinking" messages so the bot doesn't feel robotic.
 */

const ACKNOWLEDGMENTS = [
  '🤔 Processing your request...',
  '🧠 Thinking about this...',
  '⚡ On it, give me a sec...',
  '🔍 Looking into that...',
  '💭 Let me think about this...',
  '🛠️ Working on it...',
  '📡 Processing...',
  '🎯 Got it, working on a response...',
  '⏳ One moment...',
  '🔧 Let me figure this out...',
  '🤖 Analyzing your request...',
  '💡 Let me check on that...',
];

/**
 * Returns a random acknowledgment message.
 */
export function getRandomAcknowledgment(): string {
  return ACKNOWLEDGMENTS[Math.floor(Math.random() * ACKNOWLEDGMENTS.length)];
}
