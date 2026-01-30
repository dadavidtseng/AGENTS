/**
 * quest_reflect_task MCP Tool
 * Critical review and improvement suggestions for task approach
 */

import { randomUUID } from 'node:crypto';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { QuestModel } from '../models/questModel.js';
import type { TaskReflection } from '../types/index.js';
import { commitQuestChanges } from '../utils/git.js';
import { config } from '../utils/config.js';
import { broadcastQuestUpdated } from '../dashboard/events.js';

/**
 * Tool definition for MCP protocol
 */
export const questReflectTaskTool: Tool = {
  name: 'quest_reflect_task',
  description: 'Critically review task analysis and implementation approach. Provides quality assessment, identifies strengths/weaknesses, and suggests improvements. Use after quest_analyze_task to refine the approach.',
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        format: 'uuid',
        description: 'Quest ID containing the task',
      },
      taskId: {
        type: 'string',
        format: 'uuid',
        description: 'Task ID to reflect on',
      },
      summary: {
        type: 'string',
        description: 'Summary of task objectives and current approach (min 10 chars)',
      },
      analysis: {
        type: 'string',
        description: 'Detailed critical analysis of implementation and approach (min 100 chars)',
      },
      qualityAssessment: {
        type: 'object',
        properties: {
          completeness: {
            type: 'number',
            minimum: 1,
            maximum: 5,
            description: 'Completeness rating (1-5, 5 being most complete)',
          },
          codeQuality: {
            type: 'number',
            minimum: 1,
            maximum: 5,
            description: 'Code quality rating (1-5, 5 being highest quality)',
          },
          bestPractices: {
            type: 'number',
            minimum: 1,
            maximum: 5,
            description: 'Adherence to best practices (1-5, 5 being best)',
          },
          notes: {
            type: 'string',
            description: 'Overall assessment notes',
          },
        },
        required: ['completeness', 'codeQuality', 'bestPractices', 'notes'],
      },
      strengths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Identified strengths in current approach',
      },
      weaknesses: {
        type: 'array',
        items: { type: 'string' },
        description: 'Identified weaknesses or concerns',
      },
      improvements: {
        type: 'array',
        items: { type: 'string' },
        description: 'Concrete improvement suggestions',
      },
      alternatives: {
        type: 'array',
        items: { type: 'string' },
        description: 'Alternative approaches to consider (optional)',
      },
      reflectedBy: {
        type: 'string',
        description: 'Agent or user performing reflection (optional)',
      },
    },
    required: ['questId', 'taskId', 'summary', 'analysis', 'qualityAssessment', 'strengths', 'weaknesses', 'improvements'],
  },
};

/**
 * Zod schema for input validation
 */
const QualityAssessmentSchema = z.object({
  completeness: z.number().min(1).max(5),
  codeQuality: z.number().min(1).max(5),
  bestPractices: z.number().min(1).max(5),
  notes: z.string(),
});

const InputSchema = z.object({
  questId: z.string().uuid(),
  taskId: z.string().uuid(),
  summary: z.string().min(10, 'Summary must be at least 10 characters'),
  analysis: z.string().min(100, 'Analysis must be at least 100 characters'),
  qualityAssessment: QualityAssessmentSchema,
  strengths: z.array(z.string()).min(1, 'At least one strength must be identified'),
  weaknesses: z.array(z.string()).min(1, 'At least one weakness must be identified'),
  improvements: z.array(z.string()).min(1, 'At least one improvement must be suggested'),
  alternatives: z.array(z.string()).optional(),
  reflectedBy: z.string().optional(),
});

type QuestReflectTaskInput = z.infer<typeof InputSchema>;

/**
 * Generate improvement insights based on reflection
 */
function generateInsights(reflection: TaskReflection): string {
  const avgQuality = (
    reflection.qualityAssessment.completeness +
    reflection.qualityAssessment.codeQuality +
    reflection.qualityAssessment.bestPractices
  ) / 3;

  const insights: string[] = [];

  // Overall quality assessment
  if (avgQuality >= 4.5) {
    insights.push('✅ Excellent quality - approach is well-designed and ready for implementation');
  } else if (avgQuality >= 3.5) {
    insights.push('✓ Good quality - minor improvements recommended before proceeding');
  } else if (avgQuality >= 2.5) {
    insights.push('⚠️ Moderate quality - significant improvements needed');
  } else {
    insights.push('❌ Low quality - major revisions required before implementation');
  }

  // Specific recommendations
  if (reflection.qualityAssessment.completeness < 3) {
    insights.push('📋 Completeness concern - ensure all requirements are addressed');
  }
  if (reflection.qualityAssessment.codeQuality < 3) {
    insights.push('🔧 Code quality concern - review architecture and design patterns');
  }
  if (reflection.qualityAssessment.bestPractices < 3) {
    insights.push('📚 Best practices concern - align with industry standards');
  }

  // Strength/weakness balance
  const strengthCount = reflection.strengths.length;
  const weaknessCount = reflection.weaknesses.length;
  if (weaknessCount > strengthCount * 2) {
    insights.push('⚖️ Weakness-heavy - consider alternative approaches');
  } else if (strengthCount > weaknessCount * 2) {
    insights.push('💪 Strength-heavy - approach is solid, focus on minor refinements');
  }

  // Improvement priority
  if (reflection.improvements.length > 5) {
    insights.push('🎯 Many improvements identified - prioritize critical items first');
  }

  return insights.join('\n');
}

/**
 * Handle quest_reflect_task tool call
 */
export async function handleQuestReflectTask(args: unknown) {
  // Validate input
  const input = InputSchema.parse(args);

  // Load quest
  let quest;
  try {
    quest = await QuestModel.load(input.questId);
  } catch (error) {
    throw new Error(`Quest not found: ${input.questId}`);
  }

  // Find task
  const task = quest.tasks.find((t) => t.id === input.taskId);
  if (!task) {
    throw new Error(`Task not found: ${input.taskId}`);
  }

  // Check if task has analysis (recommended but not required)
  const hasAnalysis = !!task.analysis;
  if (!hasAnalysis) {
    console.warn(
      `[quest_reflect_task] Task ${input.taskId} has no analysis. ` +
      `Consider running quest_analyze_task first for better reflection context.`
    );
  }

  // Create reflection
  const reflection: TaskReflection = {
    reflectionId: randomUUID(),
    taskId: input.taskId,
    summary: input.summary,
    analysis: input.analysis,
    qualityAssessment: input.qualityAssessment,
    strengths: input.strengths,
    weaknesses: input.weaknesses,
    improvements: input.improvements,
    alternatives: input.alternatives,
    timestamp: new Date(),
    reflectedBy: input.reflectedBy,
  };

  // Store reflection in task
  task.reflection = reflection;
  task.updatedAt = new Date();

  // Save quest
  await QuestModel.save(quest);

  // Generate insights
  const insights = generateInsights(reflection);

  // Commit to Git
  const avgQuality = (
    reflection.qualityAssessment.completeness +
    reflection.qualityAssessment.codeQuality +
    reflection.qualityAssessment.bestPractices
  ) / 3;

  const commitMessage = `reflect: review task "${task.name}" (quality: ${avgQuality.toFixed(1)}/5)`;
  const commitBody = [
    `Quest: ${quest.questName}`,
    `Task ID: ${input.taskId}`,
    `Quality Assessment:`,
    `  - Completeness: ${reflection.qualityAssessment.completeness}/5`,
    `  - Code Quality: ${reflection.qualityAssessment.codeQuality}/5`,
    `  - Best Practices: ${reflection.qualityAssessment.bestPractices}/5`,
    `  - Average: ${avgQuality.toFixed(1)}/5`,
    '',
    `Strengths: ${reflection.strengths.length}`,
    `Weaknesses: ${reflection.weaknesses.length}`,
    `Improvements: ${reflection.improvements.length}`,
  ];

  await commitQuestChanges(
    config.questDataDir,
    commitMessage,
    commitBody.join('\n')
  );

  // Broadcast WebSocket event
  broadcastQuestUpdated(quest.questId, quest.status);

  // Return result with insights
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            questId: input.questId,
            taskId: input.taskId,
            taskName: task.name,
            reflectionId: reflection.reflectionId,
            qualityScore: {
              completeness: reflection.qualityAssessment.completeness,
              codeQuality: reflection.qualityAssessment.codeQuality,
              bestPractices: reflection.qualityAssessment.bestPractices,
              average: avgQuality,
            },
            summary: {
              strengths: reflection.strengths.length,
              weaknesses: reflection.weaknesses.length,
              improvements: reflection.improvements.length,
              alternatives: reflection.alternatives?.length || 0,
            },
            insights,
            recommendation: avgQuality >= 3.5 
              ? 'Proceed with implementation, addressing suggested improvements'
              : 'Revise approach before implementation',
            timestamp: reflection.timestamp.toISOString(),
            message: 'Task reflection completed successfully',
          },
          null,
          2
        ),
      },
    ],
  };
}
