# Agent-Lead Extraction Plan

## Overview

Extract orchestration logic from `agent-producer` into a new `agent-lead` agent. After extraction, agent-producer becomes a slim HUMAN interaction layer; agent-lead becomes the orchestration brain.

## Code Movement Map

### MOVES TO agent-lead

| Source File | Functions/Exports | New Location |
|-------------|-------------------|--------------|
| `handlers/task-completion.ts` | `setupTaskCompletionHandler`, `handleTaskCompletedEvent`, `verifyTaskCompletion`, `recordTaskVerification`, `createQuestPullRequest`, `checkAllTasksCompleteAndRequestApproval` | `agent-lead/src/handlers/task-verification.ts` |
| `handlers/task-approval.ts` | `handleTaskApproval`, `approveTask`, `rejectTask`, `requestChanges`, `triggerGitWorkflow` | `agent-lead/src/handlers/task-approval.ts` |
| `tools/task-execution.ts` | `registerTaskExecutionTool`, `publishTaskAssignedEvent`, `subscribeToTaskRejections` | `agent-lead/src/handlers/task-assignment.ts` |
| `tools/quest-approval.ts` | `registerQuestApproveTool`, `registerQuestRequestRevisionTool`, `registerQuestRejectTool` | `agent-lead/src/tools/quest-approval.ts` |
| `tools/task-approval.ts` | `registerTaskApproveTool`, `registerTaskRequestRevisionTool`, `registerTaskRejectTool` | `agent-lead/src/tools/task-approval.ts` |

### STAYS IN agent-producer

| File | Purpose |
|------|---------|
| `bot/discord-bot.ts` | Discord HUMAN conversation |
| `bot/slack-bot.ts` | Slack HUMAN conversation |
| `handlers/task-failure.ts` | Task failure → HUMAN notification + retry/skip/abort |
| `handlers/task-completion-notifier.ts` | Status relay to HUMAN |
| `prompts/quest-workflow.ts` | System prompt for HUMAN interaction |
| `services/llm-orchestrator.ts` | LLM tool calling loop (shared utility) |
| `tools/echo.ts`, `tools/list-tools.ts` | Utility tools |
| `index.ts` | Entry point (simplified) |

## agent-lead Project Structure

```
agent-lead/
├── src/
│   ├── handlers/
│   │   ├── task-assignment.ts      # Subscribe quest.tasks_ready → query tasks → publish task.assigned
│   │   ├── task-verification.ts    # Subscribe task.validated → merge to staging → publish task.verified
│   │   ├── task-approval.ts        # Approve/reject/request changes on tasks
│   │   └── pr-lifecycle.ts         # Create quest PR, handle pr.changes_requested, quest.merged
│   ├── services/
│   │   ├── dependency-resolver.ts  # Determine which tasks are unblocked when a task completes
│   │   ├── staging-branch.ts       # Create/merge/delete quest/{quest-id} staging branch
│   │   └── llm-verifier.ts        # LLM-based task verification with scoring
│   ├── tools/
│   │   ├── quest-approval.ts       # quest_approve, quest_request_revision, quest_reject
│   │   └── task-approval.ts        # task_approve, task_request_revision, task_reject
│   ├── types/
│   │   └── index.ts
│   └── index.ts                    # Entry point, broker connection, role-based startup
├── package.json
├── tsconfig.json
└── agent.json
```

## Event Subscriptions

### agent-lead subscribes to:
- `quest.tasks_ready` → query tasks from mcp-server-quest, resolve dependencies, assign
- `task.validated` → merge worker branch to staging, publish task.verified
- `task.rejected_by_worker` → reassign to another worker
- `pr.changes_requested` → rework tasks based on PR review
- `quest.merged` → cleanup staging branch, publish quest.completed

### agent-lead publishes:
- `task.assigned` → worker picks up task
- `task.failed` → max retries exceeded, escalate to agent-producer
- `task.verified` → task merged to staging
- `quest.pr_created` → PR ready for HUMAN review
- `quest.completed` → all done

## Interface Changes to agent-producer

After extraction, agent-producer's `index.ts` removes:
1. `setupTaskCompletionHandler()` call
2. `handleTaskApproval` Discord command handler
3. `registerTaskExecutionTool()` call
4. `registerQuestApproveTool/RejectTool/RevisionTool()` calls
5. `registerTaskApproveTool/RejectTool/RevisionTool()` calls

agent-producer adds:
1. Subscribe to `task.verified` → relay status to HUMAN
2. Subscribe to `quest.pr_created` → notify HUMAN
3. Subscribe to `quest.completed` → notify HUMAN
4. Publish `quest.tasks_ready` after task planning completes

## Role-Based Startup

agent-lead uses `AGENT_ROLE` env var (same pattern as agent-worker):
- `agent-lead-artist` → networks: producer, artist, git, qa
- `agent-lead-designer` → networks: producer, designer, git, qa
- `agent-lead-programmer` → networks: producer, programmer, git, qa, deploy

```bash
# package.json scripts
"start:artist": "AGENT_ROLE=artist node dist/index.js",
"start:designer": "AGENT_ROLE=designer node dist/index.js",
"start:programmer": "AGENT_ROLE=programmer node dist/index.js"
```

## Dependencies

```json
{
  "@kadi.build/core": "^0.9.0",
  "agents-library": "^0.1.0",
  "@anthropic-ai/sdk": "^0.32.1",
  "dotenv": "^16.4.5",
  "zod": "^4.1.5"
}
```

Broker tools used (via network):
- `quest_query_quest`, `quest_assign_task`, `quest_verify_task`, `quest_update_task` (mcp-server-quest)
- `git_create_branch`, `git_delete_branch`, `git_worktree_remove`, `git_merge` (mcp-server-git)
- `github_create_pr` (mcp-server-github)
