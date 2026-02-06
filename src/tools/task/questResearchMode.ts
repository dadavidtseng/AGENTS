/**
 * quest_research_mode MCP Tool
 * Systematic technology exploration and solution research
 */

import { randomUUID } from 'node:crypto';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { QuestModel } from '../../models/questModel.js';
import type { ResearchState } from '../../types/index.js';
import { commitQuestChanges } from '../../utils/git.js';
import { config } from '../../utils/config.js';
import { broadcastQuestUpdated } from '../../dashboard/events.js';

/**
 * Tool definition for MCP protocol
 */
export const questResearchModeTool: Tool = {
  name: 'quest_research_mode',
  description: `Systematic technology exploration and solution research for quest implementation.

**Purpose:**
- Explore technology options before implementation
- Research best practices and patterns
- Evaluate alternative approaches
- Build knowledge iteratively
- Document research findings

**Usage:**
- Call when exploring new technologies
- Use for architecture decisions
- Research library/framework options
- Investigate implementation patterns
- Support iterative refinement

**Parameters:**
- questId (required): Quest identifier
- topic (required): Research topic or question
- previousState (optional): Previous research findings (for iteration)
- currentState (required): Current research findings and conclusions
- nextSteps (required): Array of next research steps
- researchedBy (optional): Researcher identifier

**Returns:**
- success: Boolean indicating if research was stored
- researchId: Unique research identifier
- topic: Research topic
- researchCount: Total research states for this quest
- message: Confirmation message`,
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        format: 'uuid',
        description: 'Quest identifier',
      },
      topic: {
        type: 'string',
        description: 'Research topic or question',
      },
      previousState: {
        type: 'string',
        description: 'Previous research findings (optional, for iterative refinement)',
      },
      currentState: {
        type: 'string',
        description: 'Current research findings and conclusions',
      },
      nextSteps: {
        type: 'array',
        items: { type: 'string' },
        description: 'Next steps for continued research',
      },
      researchedBy: {
        type: 'string',
        description: 'Researcher identifier (optional)',
      },
    },
    required: ['questId', 'topic', 'currentState', 'nextSteps'],
  },
};

/**
 * Zod schema for input validation
 */
const InputSchema = z.object({
  questId: z.string().uuid(),
  topic: z.string().min(5, 'Topic must be at least 5 characters'),
  previousState: z.string().optional(),
  currentState: z.string().min(20, 'Current state must be at least 20 characters'),
  nextSteps: z.array(z.string()).min(1, 'At least one next step must be provided'),
  researchedBy: z.string().optional(),
});

type QuestResearchModeInput = z.infer<typeof InputSchema>;

/**
 * Handle quest_research_mode tool call
 */
export async function handleQuestResearchMode(args: unknown) {
  // Validate input
  const input = InputSchema.parse(args);

  // Load quest
  let quest;
  try {
    quest = await QuestModel.load(input.questId);
  } catch (error) {
    throw new Error(`Quest not found: ${input.questId}`);
  }

  // Initialize researchStates array if not exists
  if (!quest.researchStates) {
    quest.researchStates = [];
  }

  // Create research state
  const researchState: ResearchState = {
    researchId: randomUUID(),
    questId: input.questId,
    topic: input.topic,
    previousState: input.previousState,
    currentState: input.currentState,
    nextSteps: input.nextSteps,
    timestamp: new Date(),
    researchedBy: input.researchedBy,
  };

  // Add to quest
  quest.researchStates.push(researchState);
  quest.updatedAt = new Date();

  // Save quest
  await QuestModel.save(quest);

  // Commit to Git
  const commitMessage = `research: explore "${input.topic}" for quest`;
  const commitBody = [
    `Quest: ${quest.questName}`,
    `Topic: ${input.topic}`,
    `Research ID: ${researchState.researchId}`,
    `Next Steps: ${input.nextSteps.length}`,
  ];
  if (input.previousState) {
    commitBody.push('Type: Iterative refinement');
  } else {
    commitBody.push('Type: Initial research');
  }

  await commitQuestChanges(
    config.questDataDir,
    commitMessage,
    commitBody.join('\n')
  );

  // Broadcast WebSocket event
  broadcastQuestUpdated(quest.questId, quest.status);

  // Return success
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            researchId: researchState.researchId,
            questId: input.questId,
            questName: quest.questName,
            topic: input.topic,
            researchCount: quest.researchStates.length,
            nextSteps: input.nextSteps,
            isIterative: !!input.previousState,
            timestamp: researchState.timestamp.toISOString(),
            message: `Research on "${input.topic}" recorded successfully. ${quest.researchStates.length} research state(s) for this quest.`,
          },
          null,
          2
        ),
      },
    ],
  };
}
