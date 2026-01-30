/**
 * quest_log_implementation Tool
 * Records comprehensive implementation details for completed tasks
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ImplementationLogModel } from '../models/implementationLogModel.js';
import { QuestModel } from '../models/questModel.js';
import { commitQuestChanges } from '../utils/git.js';
import { config } from '../utils/config.js';
import { broadcastQuestUpdated } from '../dashboard/events.js';

// Zod schemas for validation
const ApiEndpointSchema = z.object({
  method: z.string().describe('HTTP method (GET, POST, PUT, DELETE, etc.)'),
  path: z.string().describe('API endpoint path (e.g., /api/quests/:id)'),
  purpose: z.string().describe('What this endpoint does'),
  requestFormat: z.string().describe('Request body/params format (JSON schema or description)'),
  responseFormat: z.string().describe('Response format (JSON schema or description)'),
  location: z.string().describe('File path and line number (e.g., src/server.ts:245)'),
});

const ComponentSchema = z.object({
  name: z.string().describe('Component name'),
  type: z.string().describe('Component type (React, Vue, Svelte, etc.)'),
  purpose: z.string().describe('What this component does'),
  location: z.string().describe('File path (e.g., src/components/QuestCard.tsx)'),
  props: z.string().describe('Props interface or description'),
  exports: z.array(z.string()).describe('Exported names from this file'),
});

const FunctionSchema = z.object({
  name: z.string().describe('Function name'),
  purpose: z.string().describe('What this function does'),
  location: z.string().describe('File path and line number (e.g., src/utils/validation.ts:42)'),
  signature: z.string().describe('Function signature with types'),
  isExported: z.boolean().describe('Whether this function is exported'),
});

const ClassSchema = z.object({
  name: z.string().describe('Class name'),
  purpose: z.string().describe('What this class does'),
  location: z.string().describe('File path and line number (e.g., src/models/QuestModel.ts:15)'),
  methods: z.array(z.string()).describe('Public method names'),
  isExported: z.boolean().describe('Whether this class is exported'),
});

const IntegrationSchema = z.object({
  description: z.string().describe('What this integration connects'),
  frontendComponent: z.string().describe('Frontend component involved'),
  backendEndpoint: z.string().describe('Backend endpoint involved'),
  dataFlow: z.string().describe('How data flows between frontend and backend'),
});

const ArtifactsSchema = z.object({
  apiEndpoints: z.array(ApiEndpointSchema).optional(),
  components: z.array(ComponentSchema).optional(),
  functions: z.array(FunctionSchema).optional(),
  classes: z.array(ClassSchema).optional(),
  integrations: z.array(IntegrationSchema).optional(),
});

const InputSchema = z.object({
  questId: z.string().uuid().describe('Quest identifier'),
  taskId: z.string().uuid().describe('Task identifier'),
  summary: z.string().min(10).describe('Brief summary of what was implemented (1-2 sentences)'),
  details: z
    .string()
    .min(50)
    .describe(
      'Detailed implementation notes: approach taken, key decisions, code structure, testing performed'
    ),
  artifacts: ArtifactsSchema.describe(
    'REQUIRED: Structured artifacts (API endpoints, components, functions, classes, integrations)'
  ),
  challenges: z.string().optional().describe('Challenges encountered during implementation'),
  solutions: z.string().optional().describe('Solutions applied to overcome challenges'),
  lessonsLearned: z.string().optional().describe('Lessons learned for future reference'),
  implementedBy: z.string().optional().describe('Agent or user who implemented the task'),
});

type Input = z.infer<typeof InputSchema>;

export const questLogImplementationTool: Tool = {
  name: 'quest_log_implementation',
  description: `Record comprehensive implementation details for a completed task.

⚠️ CRITICAL: Artifacts are REQUIRED. This creates a searchable knowledge base that future AI agents use to discover existing code and avoid duplication.

# WHY DETAILED LOGGING MATTERS

Future AI agents (and future you) will use grep/ripgrep to search implementation logs before implementing new tasks. Complete logs prevent:
- ❌ Creating duplicate API endpoints
- ❌ Reimplementing existing components
- ❌ Duplicating utility functions and business logic
- ❌ Breaking established integration patterns

# WHEN TO USE THIS TOOL

Call this tool AFTER completing a task to document:
- What was implemented
- Where the code lives (file paths and line numbers)
- How components integrate with each other
- Challenges faced and solutions applied
- Lessons learned for future tasks

# ARTIFACTS ARE MANDATORY

You MUST provide at least one artifact type. Choose the relevant ones:

## API Endpoints
Document any REST/GraphQL endpoints created or modified:
\`\`\`json
{
  "method": "POST",
  "path": "/api/quests/:questId/tasks",
  "purpose": "Create a new task within a quest",
  "requestFormat": "{ taskName: string, description: string, dependencies: string[] }",
  "responseFormat": "{ taskId: string, status: string, message: string }",
  "location": "src/server.ts:245"
}
\`\`\`

## Components
Document UI components created:
\`\`\`json
{
  "name": "QuestCard",
  "type": "React",
  "purpose": "Display quest summary with status badge and action buttons",
  "location": "src/components/QuestCard.tsx",
  "props": "{ quest: Quest, onSelect: (id: string) => void }",
  "exports": ["QuestCard", "QuestCardSkeleton"]
}
\`\`\`

## Functions
Document utility functions and business logic:
\`\`\`json
{
  "name": "validateQuestStatus",
  "purpose": "Validate quest status transitions according to workflow rules",
  "location": "src/utils/validation.ts:42",
  "signature": "validateQuestStatus(currentStatus: QuestStatus, newStatus: QuestStatus): boolean",
  "isExported": true
}
\`\`\`

## Classes
Document classes and models:
\`\`\`json
{
  "name": "QuestModel",
  "purpose": "CRUD operations for quest persistence",
  "location": "src/models/questModel.ts:15",
  "methods": ["save", "load", "list", "delete"],
  "isExported": true
}
\`\`\`

## Integrations
Document frontend-backend integrations:
\`\`\`json
{
  "description": "Quest creation flow from Discord to dashboard",
  "frontendComponent": "QuestForm (src/components/QuestForm.tsx)",
  "backendEndpoint": "POST /api/quests (src/server.ts:180)",
  "dataFlow": "User submits form → POST request → QuestModel.save() → WebSocket broadcast → Dashboard updates"
}
\`\`\`

# GOOD VS BAD EXAMPLES

❌ BAD (too vague, no artifacts):
\`\`\`json
{
  "summary": "Added quest cancellation",
  "details": "Implemented the cancel feature",
  "artifacts": {}
}
\`\`\`

✅ GOOD (specific, searchable, complete):
\`\`\`json
{
  "summary": "Implemented quest_cancel_quest tool with status validation and metadata tracking",
  "details": "Created questCancelQuest.ts tool that validates quest status before cancellation. Only allows cancelling draft/pending_approval/approved/in_progress quests. Prevents duplicate cancellation. Stores cancellation metadata (reason, timestamp, previous status) in quest.metadata.cancellation. Broadcasts updates via WebSocket. Commits changes to git.",
  "artifacts": {
    "functions": [{
      "name": "handleQuestCancel",
      "purpose": "Handle quest cancellation with validation and metadata tracking",
      "location": "src/tools/questCancelQuest.ts:45",
      "signature": "handleQuestCancel(args: { questId: string, reason?: string }): Promise<ToolResponse>",
      "isExported": true
    }],
    "integrations": [{
      "description": "Quest cancellation flow",
      "frontendComponent": "QuestActions (src/components/QuestActions.tsx)",
      "backendEndpoint": "quest_cancel_quest MCP tool",
      "dataFlow": "User clicks cancel → MCP tool call → Status validation → Metadata update → QuestModel.save() → Git commit → WebSocket broadcast"
    }]
  },
  "challenges": "Needed to prevent cancelling completed quests while allowing cancellation of in_progress quests",
  "solutions": "Added status validation that blocks completed quests but allows all other statuses. Stores previous status in metadata for audit trail.",
  "lessonsLearned": "Always store metadata for state transitions to enable audit trails and potential rollback"
}
\`\`\`

# PARAMETERS

- questId (required): Quest identifier
- taskId (required): Task identifier
- summary (required): Brief summary (1-2 sentences)
- details (required): Detailed implementation notes (minimum 50 characters)
- artifacts (required): At least one artifact type (apiEndpoints, components, functions, classes, or integrations)
- challenges (optional): Challenges encountered
- solutions (optional): Solutions applied
- lessonsLearned (optional): Lessons learned
- implementedBy (optional): Agent or user who implemented

# RETURNS

Success message with log ID and confirmation that the implementation was recorded.`,
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest identifier',
      },
      taskId: {
        type: 'string',
        description: 'Task identifier',
      },
      summary: {
        type: 'string',
        description: 'Brief summary of what was implemented (1-2 sentences)',
      },
      details: {
        type: 'string',
        description:
          'Detailed implementation notes: approach taken, key decisions, code structure, testing performed',
      },
      artifacts: {
        type: 'object',
        description:
          'REQUIRED: Structured artifacts (API endpoints, components, functions, classes, integrations)',
        properties: {
          apiEndpoints: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                method: { type: 'string' },
                path: { type: 'string' },
                purpose: { type: 'string' },
                requestFormat: { type: 'string' },
                responseFormat: { type: 'string' },
                location: { type: 'string' },
              },
              required: ['method', 'path', 'purpose', 'requestFormat', 'responseFormat', 'location'],
            },
          },
          components: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                type: { type: 'string' },
                purpose: { type: 'string' },
                location: { type: 'string' },
                props: { type: 'string' },
                exports: { type: 'array', items: { type: 'string' } },
              },
              required: ['name', 'type', 'purpose', 'location', 'props', 'exports'],
            },
          },
          functions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                purpose: { type: 'string' },
                location: { type: 'string' },
                signature: { type: 'string' },
                isExported: { type: 'boolean' },
              },
              required: ['name', 'purpose', 'location', 'signature', 'isExported'],
            },
          },
          classes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                purpose: { type: 'string' },
                location: { type: 'string' },
                methods: { type: 'array', items: { type: 'string' } },
                isExported: { type: 'boolean' },
              },
              required: ['name', 'purpose', 'location', 'methods', 'isExported'],
            },
          },
          integrations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string' },
                frontendComponent: { type: 'string' },
                backendEndpoint: { type: 'string' },
                dataFlow: { type: 'string' },
              },
              required: ['description', 'frontendComponent', 'backendEndpoint', 'dataFlow'],
            },
          },
        },
      },
      challenges: {
        type: 'string',
        description: 'Challenges encountered during implementation',
      },
      solutions: {
        type: 'string',
        description: 'Solutions applied to overcome challenges',
      },
      lessonsLearned: {
        type: 'string',
        description: 'Lessons learned for future reference',
      },
      implementedBy: {
        type: 'string',
        description: 'Agent or user who implemented the task',
      },
    },
    required: ['questId', 'taskId', 'summary', 'details', 'artifacts'],
  },
};

export async function handleQuestLogImplementation(args: unknown) {
  // Validate input
  const input = InputSchema.parse(args) as Input;

  // Validate that at least one artifact type is provided
  const hasArtifacts =
    (input.artifacts.apiEndpoints && input.artifacts.apiEndpoints.length > 0) ||
    (input.artifacts.components && input.artifacts.components.length > 0) ||
    (input.artifacts.functions && input.artifacts.functions.length > 0) ||
    (input.artifacts.classes && input.artifacts.classes.length > 0) ||
    (input.artifacts.integrations && input.artifacts.integrations.length > 0);

  if (!hasArtifacts) {
    throw new Error(
      'At least one artifact type is required (apiEndpoints, components, functions, classes, or integrations). ' +
        'Artifacts create a searchable knowledge base that prevents code duplication.'
    );
  }

  // Load quest to verify it exists
  const quest = await QuestModel.load(input.questId);

  // Find the task
  const task = quest.tasks.find((t) => t.id === input.taskId);
  if (!task) {
    throw new Error(`Task ${input.taskId} not found in quest ${input.questId}`);
  }

  // Create implementation log entry
  const logEntry = ImplementationLogModel.create({
    questId: input.questId,
    taskId: input.taskId,
    taskName: task.name,
    summary: input.summary,
    details: input.details,
    artifacts: input.artifacts,
    challenges: input.challenges,
    solutions: input.solutions,
    lessonsLearned: input.lessonsLearned,
    implementedBy: input.implementedBy,
  });

  // Save log entry
  await ImplementationLogModel.save(logEntry);

  // Update task with artifacts (for quick reference)
  task.artifacts = input.artifacts;
  await QuestModel.save(quest);

  // Commit to git
  const commitMessage = `docs: log implementation for task ${task.name}`;
  await commitQuestChanges(config.questDataDir, commitMessage);

  // Broadcast update
  await broadcastQuestUpdated(quest.questId, quest.status);

  // Count artifacts for summary
  const artifactCounts = {
    apiEndpoints: input.artifacts.apiEndpoints?.length || 0,
    components: input.artifacts.components?.length || 0,
    functions: input.artifacts.functions?.length || 0,
    classes: input.artifacts.classes?.length || 0,
    integrations: input.artifacts.integrations?.length || 0,
  };

  const totalArtifacts = Object.values(artifactCounts).reduce((sum, count) => sum + count, 0);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            logId: logEntry.logId,
            questId: input.questId,
            taskId: input.taskId,
            taskName: task.name,
            artifactCounts,
            totalArtifacts,
            message: `Implementation log created successfully. Recorded ${totalArtifacts} artifacts for task "${task.name}". This log is now searchable for future reference.`,
          },
          null,
          2
        ),
      },
    ],
  };
}
