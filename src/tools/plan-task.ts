/**
 * Plan Task Tool Implementation (Option C: Full Workflow Orchestration)
 *
 * Creates and assigns a task to worker agents using AI-driven workflow orchestration.
 * Orchestrates the complete shrimp workflow: plan → analyze → reflect → split
 * with Claude API calls between each step for intelligent task refinement.
 */

import type { KadiClient } from '@kadi.build/core';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { invokeShrimTool, publishToolEvent, orchestrateWithClaude, type ToolDefinition } from 'agents-library';

// ============================================================================
// Types
// ============================================================================

export const planTaskInputSchema = z.object({
  description: z.string().describe('Detailed task description including objectives and scope'),
  requirements: z.string().optional().describe('Optional technical or business requirements'),
  role: z.enum(['artist', 'designer', 'programmer']).optional().describe('Optional role assignment (artist/designer/programmer)')
});

export const planTaskOutputSchema = z.object({
  taskId: z.string().describe('Unique identifier for the created task'),
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked']).describe('Initial task status (always pending for new tasks)'),
  message: z.string().describe('Formatted message with task details including ID, name, and status')
});

export type PlanTaskInput = z.infer<typeof planTaskInputSchema>;
export type PlanTaskOutput = z.infer<typeof planTaskOutputSchema>;

// ============================================================================
// Plan Task Handler
// ============================================================================

export async function createPlanTaskHandler(
  client: KadiClient,
  anthropic: Anthropic | null
): Promise<(params: PlanTaskInput) => Promise<PlanTaskOutput>> {
  return async (params: PlanTaskInput): Promise<PlanTaskOutput> => {
    console.log(`🎯 [plan_task HANDLER CALLED] Received params:`, JSON.stringify(params).substring(0, 100));
    console.log(`📋 Planning task (Option C): "${params.description.substring(0, 50)}..."`);

    try {
      const protocol = client.getBrokerProtocol();

      // Require Anthropic client for intelligent workflow
      if (!anthropic) {
        throw new Error('Anthropic API client not initialized - set ANTHROPIC_API_KEY environment variable');
      }

      // Option C: Intelligent workflow orchestration with Claude API
      console.log('🤖 Using Option C: AI-driven workflow orchestration');

      // Step 1: Call shrimp_plan_task (returns planning prompt with guidelines)
      console.log('Step 1/2: Calling shrimp_plan_task...');
      const planResult = await invokeShrimTool(protocol, 'shrimp_plan_task', {
        description: params.description,
        requirements: params.requirements,
      });

      if (!planResult.success) {
        throw new Error(planResult.error?.message || 'Failed to invoke shrimp_plan_task');
      }

      // Extract planning prompt from MCP response
      const basePlanPrompt = Array.isArray(planResult.data.content)
        ? planResult.data.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n')
        : String(planResult.data);

      // Step 2: Enhance the prompt with user intent preservation guidelines
      // Extract task count from user's request (e.g., "one task", "2 tasks", "three tasks")
      const taskCountMatch = params.description.match(/\b(one|a|single|1|two|2|three|3|four|4|five|5|six|6|seven|7|eight|8|nine|9|\d+)\s+(task|placeholder)/i);
      const requestedCount = taskCountMatch ? taskCountMatch[1].toLowerCase() : null;

      // Map word numbers to digits
      const numberWords: Record<string, number> = {
        'one': 1, 'a': 1, 'single': 1,
        'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9
      };

      const exactCount = requestedCount
        ? (numberWords[requestedCount] || parseInt(requestedCount, 10))
        : null;

      const enhancedPrompt = `${basePlanPrompt}

## CRITICAL: Task Count and Complexity Rules

The user's original request was: "${params.description}"

${exactCount ? `**EXPLICIT TASK COUNT CONSTRAINT**: The user requested EXACTLY ${exactCount} task(s). You MUST create exactly ${exactCount} task(s), no more, no less.` : ''}

### Task Creation Decision Tree:

1. **Check for Explicit Count Request**:
   - If user said "one task", "a task", "single task", "1 task" → Create EXACTLY 1 task
   - If user said "two tasks", "2 tasks" → Create EXACTLY 2 tasks
   - If user said "{number} tasks" → Create EXACTLY that many tasks
   - **DO NOT split these into subtasks** - respect the explicit count

2. **Evaluate Task Complexity** (only if no explicit count given):
   - **Simple tasks** (placeholder, basic CRUD, single feature):
     - Create 1 task with the user's description as the name
     - DO NOT break down into subtasks
   - **Complex tasks** (multi-step features, system integration, architecture changes):
     - Only split if the task genuinely requires multiple independent work items
     - Each subtask should be a meaningful unit of work (not meta-tasks like "Analyze Architecture")
   - **Avoid meta-tasks**: Do NOT create tasks like "Analyze Existing Architecture", "Design Preliminary Solution" unless the user explicitly asked for them

3. **Implementation Guidelines**:
   - **Preserve original description**: Use the user's exact words as the task name
   - **ALWAYS use "append"** updateMode to add tasks without clearing existing ones
   - **NEVER use "clearAllTasks"** unless user explicitly requests to clear/replace all existing tasks
   - **Call shrimp_split_tasks ONCE only** - the first call is final, do NOT retry
   - When calling shrimp_analyze_task: Ensure 'initialConcept' has AT LEAST 50 meaningful characters

4. **CRITICAL: relatedFiles Field Requirements**:
   When calling shrimp_split_tasks, pay special attention to the relatedFiles array:
   - **lineStart and lineEnd MUST be > 0** (line numbers start at 1, not 0)
   - If you don't know the exact line numbers, **OMIT the lineStart/lineEnd fields entirely**
   - Do NOT set lineStart=0 or lineEnd=0 - this will cause validation errors
   - Valid example: { path: "src/index.ts", type: "TO_MODIFY", description: "Main file", lineStart: 10, lineEnd: 50 }
   - Valid example (no line numbers): { path: "src/index.ts", type: "TO_MODIFY", description: "Main file" }
   - **INVALID**: { path: "src/index.ts", type: "TO_MODIFY", lineStart: 0, lineEnd: 0 } ← This will FAIL validation

### Workflow:
- Call shrimp_analyze_task ONCE
- Call shrimp_reflect_task ONCE
- Call shrimp_split_tasks ONCE with your final decision
- If successful result received, your work is DONE

${exactCount ? `\n**REMINDER**: You must create EXACTLY ${exactCount} task(s) as requested.\n` : ''}
Now proceed: analyze → reflect → split (ONCE) → DONE.`;

      // Define tool definitions for orchestration
      const toolDefinitions: ToolDefinition[] = [
        {
          name: 'shrimp_analyze_task',
          description: 'Analyze task requirements and provide detailed breakdown',
          input_schema: {
            type: 'object',
            properties: {
              initialConcept: { type: 'string', description: 'Initial concept or requirement' }
            },
            required: ['initialConcept']
          }
        },
        {
          name: 'shrimp_reflect_task',
          description: 'Reflect on task analysis and refine approach',
          input_schema: {
            type: 'object',
            properties: {
              analysis: { type: 'string', description: 'Analysis result to reflect on' }
            },
            required: ['analysis']
          }
        },
        {
          name: 'shrimp_split_tasks',
          description: 'Split tasks into actionable subtasks',
          input_schema: {
            type: 'object',
            properties: {
              updateMode: { type: 'string', enum: ['append', 'replace', 'clearAllTasks'] },
              tasksRaw: { type: 'string', description: 'JSON string of task array' },
              globalAnalysisResult: { type: 'string', description: 'Global analysis summary' }
            },
            required: ['updateMode', 'tasksRaw']
          }
        }
      ];

      // Step 2: Call Claude API with enhanced prompt and full tool access
      console.log('Step 2/2: Calling Claude API for autonomous workflow orchestration...');
      await orchestrateWithClaude(
        anthropic,
        protocol,
        enhancedPrompt,
        toolDefinitions,
        { client } // Pass KadiClient for async response handling
      );

      console.log(`✅ Claude API completed autonomous workflow orchestration`);

      // Query all tasks to get complete task list with details
      const listResult = await invokeShrimTool(protocol, 'shrimp_list_tasks', {
        status: 'all',  // Get all tasks to see what was created
      }, { client }); // Pass client for async response handling

      if (!listResult.success) {
        throw new Error(listResult.error?.message || 'Failed to invoke shrimp_list_tasks');
      }

      // The MCP response contains the full task list in text format
      const listContent = Array.isArray(listResult.data.content)
        ? listResult.data.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n')
        : String(listResult.data);

      console.log(`📋 List result preview: ${listContent.substring(0, 500)}...`);
      console.log(`📋 List result (first ### section): ${listContent.substring(listContent.indexOf('###'), listContent.indexOf('###') + 300)}...`);

      // Try multiple regex patterns to match different output formats
      const createdTasks: Array<{number: string, id: string, name: string, status: string}> = [];

      // Try Pattern 1: Task <number>: [<id>] <name> (Status: <status>)
      let taskRegex = /Task (\d+):\s*\[([a-f0-9\-]+)\]\s*(.+?)\s*\(Status:\s*(\w+)\)/gi;
      let match;
      while ((match = taskRegex.exec(listContent)) !== null) {
        createdTasks.push({
          number: match[1],
          id: match[2],
          name: match[3].trim(),
          status: match[4],
        });
      }

      // Try Pattern 2: Markdown format from shrimp_list_tasks
      // Expected format: ### Task Name \n **ID:** `uuid`
      if (createdTasks.length === 0) {
        const taskPattern = /###\s+([^\n]+)\s+\*\*ID:\*\*\s*`?([a-f0-9\-]{36})`?/gi;
        let taskNumber = 0;

        console.log(`🔍 DEBUG: Attempting to match task pattern in content (length: ${listContent.length})`);

        while ((match = taskPattern.exec(listContent)) !== null) {
          taskNumber++;
          const name = match[1].trim();
          const id = match[2];
          const status = 'pending';

          createdTasks.push({
            number: String(taskNumber),
            id: id,
            name: name,
            status: status,
          });

          console.log(`✅ DEBUG: Found task #${taskNumber}: "${name}" (${id})`);
        }

        if (createdTasks.length === 0) {
          console.log(`⚠️  DEBUG: No tasks matched. Sample content:\n${listContent.substring(0, 800)}`);
        }
      }

      console.log(`📋 Tasks parsed: ${createdTasks.length} task(s)`);

      // Format the response message with all task details
      let message = '';
      if (createdTasks.length === 0) {
        message = 'Task creation completed. Please use list_active_tasks to view the created tasks.';
      } else if (createdTasks.length === 1) {
        const task = createdTasks[0];
        message = `Task created successfully:\n\n**Task #${task.number}**\n- ID: ${task.id}\n- Name: ${task.name}\n- Status: ${task.status}\n\n${params.role ? `Will be assigned to ${params.role} after validation. ` : ''}You can review, update, execute, or remove this task using the task ID.`;
      } else {
        message = `${createdTasks.length} tasks created successfully:\n\n`;
        for (const task of createdTasks) {
          message += `**Task #${task.number}**\n- ID: ${task.id}\n- Name: ${task.name}\n- Status: ${task.status}\n\n`;
        }
        message += `${params.role ? `Will be assigned to ${params.role} after validation. ` : ''}You can review, update, execute, or remove these tasks using their task IDs.`;
      }

      return {
        taskId: createdTasks.length > 0 ? createdTasks[0].id : 'unknown',
        status: createdTasks.length > 0 ? createdTasks[0].status as any : 'pending',
        message,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to plan task: ${errorMsg}`);

      // Publish failure event using publishToolEvent from agents-library
      await publishToolEvent(client, 'failed',
        { error: errorMsg, description: params.description },
        { toolName: 'plan_task' }
      );

      throw new Error(`Failed to plan task: ${errorMsg}`);
    }
  };
}
