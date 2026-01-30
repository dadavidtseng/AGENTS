/**
 * quest_analyze_task Tool
 * Deep analysis of task requirements before execution
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { QuestModel } from '../models/questModel.js';
import type { TaskAnalysis } from '../types/index.js';
import { commitQuestChanges } from '../utils/git.js';
import { config } from '../utils/config.js';
import { broadcastQuestUpdated } from '../dashboard/events.js';

// Zod schemas for validation
const FeasibilitySchema = z.object({
  rating: z.number().min(1).max(5).describe('Feasibility rating (1-5, 5 being most feasible)'),
  explanation: z.string().min(20).describe('Feasibility explanation'),
  risks: z.array(z.string()).describe('Identified risks and challenges'),
  mitigations: z.array(z.string()).describe('Mitigation strategies'),
});

const TechnicalAnalysisSchema = z.object({
  architecture: z.string().min(20).describe('Architectural approach'),
  keyDecisions: z.array(z.string()).describe('Key technical decisions'),
  dependencies: z.array(z.string()).describe('Dependencies and prerequisites'),
  pseudocode: z.string().optional().describe('Pseudocode or high-level logic flow'),
});

const ImplementationStrategySchema = z.object({
  steps: z.array(z.string()).min(1).describe('Step-by-step approach'),
  complexity: z.enum(['low', 'medium', 'high']).describe('Estimated complexity'),
  testingApproach: z.string().min(20).describe('Testing strategy'),
});

const InputSchema = z.object({
  questId: z.string().uuid().describe('Quest identifier'),
  taskId: z.string().uuid().describe('Task identifier'),
  summary: z
    .string()
    .min(10)
    .describe('Structured task summary including objectives, scope and key technical challenges'),
  initialConcept: z
    .string()
    .min(50)
    .describe(
      'Initial solution concept including technical solution, architectural design and implementation strategy. Use pseudocode format for high-level logic flow, avoiding complete code.'
    ),
  feasibility: FeasibilitySchema.describe('Technical feasibility assessment'),
  technicalAnalysis: TechnicalAnalysisSchema.describe('Structured technical analysis'),
  implementationStrategy: ImplementationStrategySchema.describe('Implementation strategy'),
  previousAnalysis: z
    .string()
    .optional()
    .describe('Previous iteration analysis results for continuous improvement (only when re-analyzing)'),
  analyzedBy: z.string().optional().describe('Agent or user who performed analysis'),
});

type Input = z.infer<typeof InputSchema>;

export const questAnalyzeTaskTool: Tool = {
  name: 'quest_analyze_task',
  description: `Perform deep analysis of task requirements before execution.

**Purpose:**
Provides technical feasibility assessment and structured analysis to ensure task is well-understood before implementation begins.

**When to Use:**
- Before starting task implementation
- When task requirements are complex or unclear
- To identify technical risks and challenges
- To plan implementation strategy
- For iterative refinement of approach

**Analysis Components:**

1. **Summary** (min 10 chars):
   - Task objectives and scope
   - Key technical challenges

2. **Initial Concept** (min 50 chars):
   - Technical solution approach
   - Architectural design
   - Implementation strategy
   - Use pseudocode for high-level logic (not complete code)

3. **Feasibility Assessment**:
   - Rating (1-5, 5 = most feasible)
   - Explanation of feasibility
   - Identified risks and challenges
   - Mitigation strategies

4. **Technical Analysis**:
   - Architectural approach
   - Key technical decisions
   - Dependencies and prerequisites
   - Pseudocode or high-level logic flow

5. **Implementation Strategy**:
   - Step-by-step approach
   - Complexity estimate (low/medium/high)
   - Testing strategy

**Iterative Refinement:**
- Provide previousAnalysis to refine existing analysis
- Supports continuous improvement of approach
- Builds on previous insights

**Storage:**
- Analysis stored in task.analysis field
- Persisted to quest data
- Committed to Git for version control

**Example Use Cases:**
- "Analyze task abc-123 before implementation"
- "Refine analysis for complex authentication task"
- "Assess feasibility of real-time sync feature"`,
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest identifier (UUID)',
      },
      taskId: {
        type: 'string',
        description: 'Task identifier (UUID)',
      },
      summary: {
        type: 'string',
        description: 'Structured task summary (min 10 chars)',
      },
      initialConcept: {
        type: 'string',
        description: 'Initial solution concept (min 50 chars, use pseudocode)',
      },
      feasibility: {
        type: 'object',
        description: 'Technical feasibility assessment',
        properties: {
          rating: { type: 'number', minimum: 1, maximum: 5 },
          explanation: { type: 'string' },
          risks: { type: 'array', items: { type: 'string' } },
          mitigations: { type: 'array', items: { type: 'string' } },
        },
        required: ['rating', 'explanation', 'risks', 'mitigations'],
      },
      technicalAnalysis: {
        type: 'object',
        description: 'Structured technical analysis',
        properties: {
          architecture: { type: 'string' },
          keyDecisions: { type: 'array', items: { type: 'string' } },
          dependencies: { type: 'array', items: { type: 'string' } },
          pseudocode: { type: 'string' },
        },
        required: ['architecture', 'keyDecisions', 'dependencies'],
      },
      implementationStrategy: {
        type: 'object',
        description: 'Implementation strategy',
        properties: {
          steps: { type: 'array', items: { type: 'string' } },
          complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
          testingApproach: { type: 'string' },
        },
        required: ['steps', 'complexity', 'testingApproach'],
      },
      previousAnalysis: {
        type: 'string',
        description: 'Previous analysis for iterative refinement (optional)',
      },
      analyzedBy: {
        type: 'string',
        description: 'Agent or user who performed analysis (optional)',
      },
    },
    required: [
      'questId',
      'taskId',
      'summary',
      'initialConcept',
      'feasibility',
      'technicalAnalysis',
      'implementationStrategy',
    ],
  },
};

export async function handleQuestAnalyzeTask(args: unknown) {
  // Validate input
  const input = InputSchema.parse(args) as Input;

  // Load quest
  const quest = await QuestModel.load(input.questId);

  // Find task
  const task = quest.tasks.find((t) => t.id === input.taskId);
  if (!task) {
    throw new Error(`Task ${input.taskId} not found in quest ${input.questId}`);
  }

  // Create analysis
  const analysis: TaskAnalysis = {
    analysisId: randomUUID(),
    taskId: input.taskId,
    summary: input.summary,
    initialConcept: input.initialConcept,
    feasibility: input.feasibility,
    technicalAnalysis: input.technicalAnalysis,
    implementationStrategy: input.implementationStrategy,
    previousAnalysis: input.previousAnalysis,
    timestamp: new Date(),
    analyzedBy: input.analyzedBy,
  };

  // Store analysis in task
  task.analysis = analysis;
  task.updatedAt = new Date();

  // Save quest
  await QuestModel.save(quest);

  // Commit to git
  const commitMessage = `docs: analyze task ${task.name} (${input.implementationStrategy.complexity} complexity)`;
  await commitQuestChanges(config.questDataDir, commitMessage);

  // Broadcast update
  await broadcastQuestUpdated(quest.questId, quest.status);

  // Return success
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            questId: quest.questId,
            taskId: task.id,
            taskName: task.name,
            analysis: {
              analysisId: analysis.analysisId,
              summary: analysis.summary,
              feasibility: {
                rating: analysis.feasibility.rating,
                explanation: analysis.feasibility.explanation,
                riskCount: analysis.feasibility.risks.length,
                mitigationCount: analysis.feasibility.mitigations.length,
              },
              complexity: analysis.implementationStrategy.complexity,
              stepCount: analysis.implementationStrategy.steps.length,
              hasPseudocode: !!analysis.technicalAnalysis.pseudocode,
              isRefinement: !!analysis.previousAnalysis,
              timestamp: analysis.timestamp,
            },
            message: `Task "${task.name}" analyzed successfully. Feasibility: ${analysis.feasibility.rating}/5, Complexity: ${analysis.implementationStrategy.complexity}, ${analysis.implementationStrategy.steps.length} implementation steps identified.`,
          },
          null,
          2
        ),
      },
    ],
  };
}
