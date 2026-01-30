/**
 * quest_reflect_task MCP Tool
 * Critical review of task analysis before creating tasks (Step 3 of workflow)
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

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
 * Tool definition for MCP protocol
 */
export const questReflectTaskTool: Tool = {
  name: 'quest_reflect_task',
  description: `Critically review task analysis before creating tasks (Step 3 of workflow).

**Purpose:**
Provides quality assessment and improvement suggestions for task concepts BEFORE tasks are created in the system.

**Four-Step Workflow:**
1. quest_plan_task (Get planning prompt)
2. quest_analyze_task (Analyze task concepts)
3. **quest_reflect_task** ← You are here (Critical review)
4. quest_split_tasks (Create tasks with analysis)

**When to Use:**
- After quest_analyze_task returns analysis results
- Before tasks are created in the system
- To critically review the approach
- To identify strengths, weaknesses, and improvements
- To ensure quality before implementation

**Reflection Components:**

1. **Summary** (min 10 chars):
   - Task objectives and current approach
   - Should match summary from quest_analyze_task

2. **Analysis** (min 100 chars):
   - Complete analysis text from quest_analyze_task
   - Combine all analysis sections into text

3. **Quality Assessment**:
   - Completeness rating (1-5)
   - Code quality rating (1-5)
   - Best practices rating (1-5)
   - Overall assessment notes

4. **Strengths** (min 1):
   - Identified strengths in current approach

5. **Weaknesses** (min 1):
   - Identified weaknesses or concerns

6. **Improvements** (min 1):
   - Concrete improvement suggestions

7. **Alternatives** (optional):
   - Alternative approaches to consider

**Next Steps:**
After reflection, you MUST call quest_split_tasks with:
- tasks: Array of task objects with all details
- globalAnalysisResult: Combined analysis and reflection results

**Example Use Cases:**
- "Review authentication task analysis for quality"
- "Reflect on microservices architecture approach"
- "Assess real-time sync feature design"`,
  inputSchema: {
    type: 'object',
    properties: {
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
    required: ['summary', 'analysis', 'qualityAssessment', 'strengths', 'weaknesses', 'improvements'],
  },
};

/**
 * Generate improvement insights based on reflection
 */
function generateInsights(input: QuestReflectTaskInput): string[] {
  const avgQuality = (
    input.qualityAssessment.completeness +
    input.qualityAssessment.codeQuality +
    input.qualityAssessment.bestPractices
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
  if (input.qualityAssessment.completeness < 3) {
    insights.push('📋 Completeness concern - ensure all requirements are addressed');
  }
  if (input.qualityAssessment.codeQuality < 3) {
    insights.push('🔧 Code quality concern - review architecture and design patterns');
  }
  if (input.qualityAssessment.bestPractices < 3) {
    insights.push('📚 Best practices concern - align with industry standards');
  }

  // Strength/weakness balance
  const strengthCount = input.strengths.length;
  const weaknessCount = input.weaknesses.length;
  if (weaknessCount > strengthCount * 2) {
    insights.push('⚖️ Weakness-heavy - consider alternative approaches');
  } else if (strengthCount > weaknessCount * 2) {
    insights.push('💪 Strength-heavy - approach is solid, focus on minor refinements');
  }

  // Improvement priority
  if (input.improvements.length > 5) {
    insights.push('🎯 Many improvements identified - prioritize critical items first');
  }

  return insights;
}

/**
 * Handle quest_reflect_task tool call
 */
export async function handleQuestReflectTask(args: unknown) {
  // Validate input
  const input = InputSchema.parse(args);

  // Calculate quality metrics
  const avgQuality = (
    input.qualityAssessment.completeness +
    input.qualityAssessment.codeQuality +
    input.qualityAssessment.bestPractices
  ) / 3;

  // Generate insights
  const insights = generateInsights(input);

  // Create reflection data (not stored yet - tasks don't exist)
  const reflectionData = {
    summary: input.summary,
    analysis: input.analysis,
    qualityAssessment: input.qualityAssessment,
    strengths: input.strengths,
    weaknesses: input.weaknesses,
    improvements: input.improvements,
    alternatives: input.alternatives,
    reflectedBy: input.reflectedBy,
    timestamp: new Date().toISOString(),
    avgQuality,
    insights,
  };

  // Generate prompt for next step (quest_split_tasks)
  const splitTasksPrompt = `# Task Reflection Complete

## Reflection Summary

**Task Summary:** ${input.summary}

**Quality Assessment:**
- Completeness: ${input.qualityAssessment.completeness}/5
- Code Quality: ${input.qualityAssessment.codeQuality}/5
- Best Practices: ${input.qualityAssessment.bestPractices}/5
- **Average Quality: ${avgQuality.toFixed(1)}/5**

**Assessment Notes:** ${input.qualityAssessment.notes}

## Strengths (${input.strengths.length})
${input.strengths.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Weaknesses (${input.weaknesses.length})
${input.weaknesses.map((w, i) => `${i + 1}. ${w}`).join('\n')}

## Improvements (${input.improvements.length})
${input.improvements.map((imp, i) => `${i + 1}. ${imp}`).join('\n')}

${input.alternatives && input.alternatives.length > 0 ? `## Alternative Approaches (${input.alternatives.length})\n${input.alternatives.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n` : ''}

## Insights
${insights.join('\n')}

## Recommendation
${avgQuality >= 3.5
  ? '✅ **Proceed with implementation** - Address suggested improvements during task execution'
  : '⚠️ **Revise approach before implementation** - Quality score below threshold (3.5/5)'}

---

## Next Step: Create Tasks

Now you MUST call **quest_split_tasks** with:
- **questId:** The quest ID from quest_plan_task
- **tasks:** Array of task objects with complete details:
  - name, description, implementationGuide, verificationCriteria
  - dependencies (array of task names)
  - relatedFiles (array with path, type, description)
  - notes (optional)
- **globalAnalysisResult:** Combined analysis and reflection text (include all sections above)
- **updateMode:** "clearAllTasks" (or appropriate mode)

The globalAnalysisResult will be stored in each task's analysis field for reference during execution.`;

  // Return reflection results and prompt for task splitting
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            reflection: reflectionData,
            prompt: splitTasksPrompt,
            nextStep: 'quest_split_tasks',
            recommendation: avgQuality >= 3.5
              ? 'Proceed with implementation, addressing suggested improvements'
              : 'Revise approach before implementation',
            message: `Reflection complete. Quality: ${avgQuality.toFixed(1)}/5. ${avgQuality >= 3.5 ? 'Ready to create tasks.' : 'Consider revisions before creating tasks.'}`,
          },
          null,
          2
        ),
      },
    ],
  };
}
