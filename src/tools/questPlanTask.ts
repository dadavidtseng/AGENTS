/**
 * quest_plan_task Tool
 * Step 1 of four-step workflow: plan → analyze → reflect → split
 * Returns structured planning prompt with quest context
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { QuestModel } from '../models/questModel.js';

// Zod schema for validation
const InputSchema = z.object({
  questId: z.string().uuid().describe('Quest identifier'),
  description: z
    .string()
    .min(10)
    .describe('Brief description of what needs to be planned'),
});

type Input = z.infer<typeof InputSchema>;

export const questPlanTaskTool: Tool = {
  name: 'quest_plan_task',
  description: `Generate structured planning prompt for task breakdown (Step 1 of workflow).

**Purpose:**
Provides comprehensive planning context including quest requirements, design specifications, and task breakdown guidelines to help LLM generate well-structured task plans.

**Four-Step Workflow:**
1. **quest_plan_task** ← You are here (Get planning prompt)
2. quest_analyze_task (Deep technical analysis)
3. quest_reflect_task (Critical review and improvements)
4. quest_split_tasks (Create final task list)

**When to Use:**
- At the start of task generation workflow
- Before analyzing specific task requirements
- To get quest context for planning
- To understand requirements and design constraints

**Returns:**
Structured prompt containing:
- Quest name and description
- Full requirements document
- Full design document
- Task breakdown guidelines
- Best practices for task creation

**Example Use Cases:**
- "Get planning prompt for quest abc-123"
- "Start task planning for authentication quest"
- "Generate planning context for new feature"

**Next Steps:**
After receiving the planning prompt:
1. Use LLM to analyze and create initial task breakdown
2. Call quest_analyze_task for each task
3. Call quest_reflect_task to review approach
4. Call quest_split_tasks to finalize tasks`,
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest identifier (UUID)',
      },
      description: {
        type: 'string',
        description: 'Brief description of what needs to be planned (min 10 chars)',
      },
    },
    required: ['questId', 'description'],
  },
};

export async function handleQuestPlanTask(args: unknown) {
  // Validate input
  const input = InputSchema.parse(args) as Input;

  // Load quest
  const quest = await QuestModel.load(input.questId);

  // Verify quest is approved
  if (quest.status !== 'approved') {
    throw new Error(
      `Quest must be approved before planning tasks. Current status: ${quest.status}`
    );
  }

  // Generate structured planning prompt
  const planningPrompt = `# Task Planning Context

## Quest Information
**Quest Name:** ${quest.questName}
**Quest ID:** ${quest.questId}
**Description:** ${quest.description}
**Status:** ${quest.status}
**Planning Goal:** ${input.description}

---

## Requirements Document

${quest.requirements}

---

## Design Document

${quest.design}

---

## Task Breakdown Guidelines

### Task Structure Requirements

Each task should include:

1. **Task Name** (clear, concise, action-oriented)
2. **Description** (detailed explanation of what needs to be done)
3. **Implementation Guide** (specific instructions, role, restrictions, success criteria)
4. **Verification Criteria** (how to verify task completion)
5. **Dependencies** (array of task IDs this task depends on)
6. **Related Files** (files to modify, reference, or create)

### Task Granularity

- **Minimum Viable Task:** Completable by one developer in 1-2 working days (8-16 hours)
- **Maximum Complexity:** Single task should not span multiple technical domains (frontend + backend + database)
- **Recommended Count:** 6-10 tasks per quest (avoid over-splitting)
- **Depth Limitation:** Task tree should not exceed 3 levels

### Implementation Guide Format

Use this format for implementationGuide field:
\`\`\`
Role: [Specific role like "Backend Developer with TypeScript expertise"]
Task: [Clear task description with specific requirements]
Restrictions: [What NOT to do, constraints, patterns to follow]
Success: [Clear success criteria, what "done" looks like]
\`\`\`

### Related Files Format

For each related file, specify:
- **path:** Absolute or relative file path
- **type:** TO_MODIFY | REFERENCE | CREATE | DEPENDENCY | OTHER
- **description:** Why this file is related
- **lineStart/lineEnd:** (optional) Specific line range

### Dependencies

- Mark dependencies clearly using task IDs
- Ensure no circular dependencies
- Tasks with unresolved dependencies cannot be assigned
- Consider parallel execution opportunities

### Best Practices

1. **Atomic Tasks:** Each task should be independently testable
2. **Clear Interfaces:** Define interfaces between tasks explicitly
3. **Encapsulation:** Tasks should not need to know each other's implementation
4. **Progressive Complexity:** Start with foundation tasks, build up
5. **Error Handling:** Consider error scenarios in task planning
6. **Documentation:** Include documentation tasks where needed

### Example Task Structure

\`\`\`json
{
  "name": "Create user authentication API endpoint",
  "description": "Implement POST /api/auth/login endpoint with JWT token generation",
  "implementationGuide": "Role: Backend Developer with Express.js and JWT expertise | Task: Create login endpoint following REST conventions, implement JWT token generation with 24h expiry, add rate limiting (5 attempts per minute) | Restrictions: Must use existing auth middleware patterns, do not store passwords in plain text, follow project error handling conventions | Success: Endpoint returns JWT token on valid credentials, returns 401 on invalid credentials, rate limiting works, all tests pass",
  "verificationCriteria": "1. Endpoint responds to POST /api/auth/login\\n2. Valid credentials return 200 with JWT token\\n3. Invalid credentials return 401\\n4. Rate limiting blocks after 5 attempts\\n5. Unit tests pass with >80% coverage",
  "dependencies": [],
  "relatedFiles": [
    {
      "path": "src/routes/auth.ts",
      "type": "CREATE",
      "description": "New authentication routes file"
    },
    {
      "path": "src/middleware/auth.ts",
      "type": "REFERENCE",
      "description": "Existing auth middleware patterns to follow"
    }
  ]
}
\`\`\`

---

## Your Task

Based on the requirements and design documents above, create a comprehensive task breakdown for: **${input.description}**

Consider:
1. What are the major components needed?
2. What are the dependencies between components?
3. What is the logical order of implementation?
4. What files need to be created or modified?
5. What are the testing requirements?
6. What are the integration points?

Generate a structured task list following the guidelines above.`;

  // Return planning prompt
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            questId: quest.questId,
            questName: quest.questName,
            planningGoal: input.description,
            prompt: planningPrompt,
            nextSteps: [
              '1. Use LLM to analyze the planning prompt and create initial task breakdown',
              '2. For each task, call quest_analyze_task to perform deep technical analysis',
              '3. Call quest_reflect_task to critically review the approach',
              '4. Call quest_split_tasks with final task array to create tasks in the system',
            ],
            message: `Planning prompt generated for quest "${quest.questName}". Use this prompt with LLM to create structured task breakdown, then proceed with analyze → reflect → split workflow.`,
          },
          null,
          2
        ),
      },
    ],
  };
}
