/**
 * quest_analyze_task Tool
 * Deep analysis of task concepts before creating tasks (Step 2 of workflow)
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

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
  description: `Perform deep analysis of task concepts before creating tasks (Step 2 of workflow).

**Purpose:**
Provides technical feasibility assessment and structured analysis for task concepts BEFORE tasks are created in the system.

**Four-Step Workflow:**
1. quest_plan_task (Get planning prompt)
2. **quest_analyze_task** ← You are here (Analyze task concepts)
3. quest_reflect_task (Critical review)
4. quest_split_task (Create tasks with analysis)

**When to Use:**
- After quest_plan_task returns planning prompt
- Before tasks are created in the system
- To analyze task concepts and approaches
- To identify technical risks and challenges
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

**Next Steps:**
After analysis, you MUST call quest_reflect_task with:
- summary: Same summary from this analysis
- analysis: Complete analysis results (combine all fields into text)

**Example Use Cases:**
- "Analyze authentication task concept before creating tasks"
- "Refine analysis for complex real-time sync feature"
- "Assess feasibility of microservices architecture"`,
  inputSchema: {
    type: 'object',
    properties: {
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

  // Create analysis object (not stored yet - tasks don't exist)
  const analysisData = {
    summary: input.summary,
    initialConcept: input.initialConcept,
    feasibility: input.feasibility,
    technicalAnalysis: input.technicalAnalysis,
    implementationStrategy: input.implementationStrategy,
    previousAnalysis: input.previousAnalysis,
    analyzedBy: input.analyzedBy,
    timestamp: new Date().toISOString(),
  };

  // Generate prompt for next step (quest_reflect_task)
  const reflectionPrompt = `# Task Analysis Complete

## Analysis Summary

**Task Summary:** ${input.summary}

**Feasibility Rating:** ${input.feasibility.rating}/5
**Complexity:** ${input.implementationStrategy.complexity}
**Implementation Steps:** ${input.implementationStrategy.steps.length}

## Detailed Analysis

### Initial Concept
${input.initialConcept}

### Feasibility Assessment
- **Rating:** ${input.feasibility.rating}/5
- **Explanation:** ${input.feasibility.explanation}
- **Risks Identified:** ${input.feasibility.risks.length}
${input.feasibility.risks.map((r, i) => `  ${i + 1}. ${r}`).join('\n')}
- **Mitigations:** ${input.feasibility.mitigations.length}
${input.feasibility.mitigations.map((m, i) => `  ${i + 1}. ${m}`).join('\n')}

### Technical Analysis
- **Architecture:** ${input.technicalAnalysis.architecture}
- **Key Decisions:**
${input.technicalAnalysis.keyDecisions.map((d, i) => `  ${i + 1}. ${d}`).join('\n')}
- **Dependencies:**
${input.technicalAnalysis.dependencies.map((d, i) => `  ${i + 1}. ${d}`).join('\n')}
${input.technicalAnalysis.pseudocode ? `\n**Pseudocode:**\n\`\`\`\n${input.technicalAnalysis.pseudocode}\n\`\`\`` : ''}

### Implementation Strategy
- **Complexity:** ${input.implementationStrategy.complexity}
- **Steps:**
${input.implementationStrategy.steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}
- **Testing Approach:** ${input.implementationStrategy.testingApproach}

---

## Next Step: Critical Reflection

Now you MUST call **quest_reflect_task** with:
- **summary:** "${input.summary}"
- **analysis:** Complete analysis text (combine all sections above)
- **qualityAssessment:** Rate completeness, code quality, best practices (1-5 each)
- **strengths:** List identified strengths
- **weaknesses:** List identified weaknesses
- **improvements:** List concrete improvement suggestions

This reflection step ensures the approach is sound before creating tasks.`;

  // Return analysis results and prompt for reflection
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            analysis: analysisData,
            prompt: reflectionPrompt,
            nextStep: 'quest_reflect_task',
            message: `Analysis complete. Feasibility: ${input.feasibility.rating}/5, Complexity: ${input.implementationStrategy.complexity}. Now call quest_reflect_task to review this analysis.`,
          },
          null,
          2
        ),
      },
    ],
  };
}
