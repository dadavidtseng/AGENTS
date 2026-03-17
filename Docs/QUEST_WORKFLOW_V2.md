# KĀDI Quest Workflow v2

1. HUMAN: I want to have a ball bouncing in the scene.
2. agent-producer uses LLM to think about what to do.
3. agent-producer calls mcp-server-quest's quest_list_quest to get all the quests.
4. If agent-producer found that this quest is not created yet, agent-producer will call mcp-server-quest's tool quest_create_quest to create a quest for HUMAN's request, which will include requirements.md and design.md.
5. agent-producer notifies the HUMAN in Discord.
6. HUMAN sees the Discord message and the created quest in agent-quest's frontend.
7. agent-producer calls mcp-server-quest's quest_request_quest_approval to ask for approval for the created quest.
8. HUMAN sees the approval request in agent-quest's frontend.
9. HUMAN approves, requests revision, or rejects the quest approval in agent-quest's frontend by adding comments and pressing a button.
    1. If HUMAN selected the approve button, agent-quest publishes a KADI event (quest.approved) with the quest ID. agent-producer subscribes to this event and then calls mcp-server-quest's quest_list_agent tool to get every agent's status and information, including what agent is available, what agent is busy, and what capabilities they have, in order to figure out how to create the tasks. Then agent-producer will call mcp-server-quest's four-step task creation tools: quest_plan_task, quest_analyze_task, quest_reflect_task, quest_split_task.
    2. If HUMAN selected request revision, agent-quest publishes a KADI event (quest.revision_requested) with HUMAN's comments. agent-producer subscribes to this event and then calls mcp-server-quest's quest_update_quest tool after using LLM to come up with a better quest. Then the step repeats from step 5.
    3. If HUMAN selected reject, agent-quest publishes a KADI event (quest.rejected). agent-producer subscribes to this event and then calls mcp-server-quest's quest_delete_quest to delete the created quest.
    4. NOTE: agent-quest's frontend should provide a markdown editor for the user to add general comments and highlighted comments when requesting revision.
10. HUMAN sees the created tasks in agent-quest's frontend.
11. agent-producer publishes a KADI event (quest.tasks_ready) with quest ID to notify agent-lead-(artist/designer/programmer). Each agent-lead then calls mcp-server-quest's quest_query_quest to know what tasks are in it. They should only handle the tasks matching their specialization (artist, designer, or programmer).
    1. NOTE: We should refine and test the current tools in mcp-server-quest.
    2. NOTE: This is the additional agent layer that extracts responsibility from agent-producer so that agent-producer can be super reactive to HUMAN.
    3. NOTE: agent-lead uses the same role-based startup pattern as agent-worker. For example, `npm run start:artist` sets AGENT_ROLE=artist. Each agent-lead instance filters tasks by its role.
12. agent-lead creates a staging branch `quest/{quest-id}` from main via mcp-server-git. This branch accumulates all verified task changes throughout the quest lifecycle.
13. agent-lead-(artist/designer/programmer) uses LLM to think about which task to assign to which agent, then each of them will call mcp-server-quest's quest_assign_task tool to assign ALL their tasks at once. However, agent-lead only publishes KADI events (task.assigned) for tasks with NO unmet dependencies. Tasks with dependencies remain assigned but not yet signaled — they will be signaled when their dependencies are verified (see step 17.2).
    1. NOTE: Assigning all tasks at once gives workers visibility into upcoming work. But workers only start when they receive the task.assigned event, which agent-lead controls based on dependency resolution.
14. agent-worker receives the task.assigned event, creates a git worktree from the staging branch `quest/{quest-id}` via mcp-server-git, and starts executing the task in that worktree.
    1. NOTE: The worktree is ephemeral — it is created when the worker starts the task and deleted after the task is verified (see step 17.2). This keeps disk usage minimal and ensures each worker always starts from the latest staging branch, which includes all previously verified work from other workers.
    2. NOTE: agent-worker can reject the task by publishing a KADI event to agent-lead that assigned the task to agent-worker if the task category doesn't match agent-worker's specialization.
15. After agent-worker finishes the task, agent-worker commits changes to its worktree branch via mcp-server-git, then publishes a KADI event (task.review_requested) to notify agent-qa to validate the change.
    1. NOTE: Worker commits BEFORE QA review. This ensures work is not lost if the worker process crashes. QA reviews the committed diff.
16. agent-qa selects a validation strategy based on the task type, then validates the change:
    1. **Code tasks:** agent-qa calls mcp-server-git's git_diff tool to review the committed changes, then uses LLM to check if the implementation matches the task requirements (syntax + semantic validation).
    2. **Art/asset tasks:** agent-qa checks file existence via ability-file-local, then uses ability-vision to visually validate the output against the task requirements.
    3. **Game scene tasks (build tasks):** When the quest involves C++ changes, agent-lead creates a build task (assigned to agent-builder) that depends on the code task. After agent-builder compiles DaemonAgent via MSBuild and publishes task.review_requested, agent-qa validates by running the built executable, taking screenshots via DaemonAgent, and using ability-vision to verify the visual result matches the requirements (e.g., "is there a ball bouncing in the scene?"). This means both agent-worker and agent-builder publish task.review_requested to agent-qa — agent-qa applies a different validation strategy depending on the task type (code review for code tasks, visual/runtime validation for build tasks).
    4. **All tasks:** agent-qa produces a structured validation result with severity (PASS/WARN/FAIL), score, and detailed feedback.
    5. If FAIL → agent-qa publishes a KADI event (task.revision_needed) with specific feedback (what failed, why, suggestions) to agent-worker. Agent-worker receives the feedback and retries from step 14. Max 3 revision cycles before escalating to agent-lead.
    6. If PASS or WARN → agent-qa publishes a KADI event (task.validated) to notify agent-lead that the task passed validation.
    7. NOTE: The validation strategy registry pattern is inspired by mysql-agent's multi-tier validation (syntax → schema → semantic). Each task type maps to a different validation pipeline.
17. agent-lead-(artist/designer/programmer) receives the task.validated event, then calls mcp-server-quest's quest_verify_task tool to do a final verification (cross-task consistency, integration check).
    1. If the score is too low, agent-lead publishes a KADI event (task.failed) to agent-worker with failure reason. Agent-worker receives the event and repeats from step 16.
    2. If the score is high enough, agent-lead merges the worker's branch into the staging branch `quest/{quest-id}` via mcp-server-git. The worker's worktree is then deleted (ephemeral). Agent-lead publishes a KADI event (task.verified) to notify agent-producer and agent-worker that the task has finished. Agent-worker's status is set to idle. Agent-lead then checks if any blocked tasks are now unblocked by this verification — if so, publishes task.assigned events for those newly unblocked tasks (workers create fresh worktrees from the updated staging branch, which now includes the just-merged work).
    3. If ALL tasks in the quest are now verified, the agent-lead that verified the last task queries mcp-server-quest for ALL tasks across all roles. If every task is verified, this agent-lead creates a PR from the staging branch `quest/{quest-id}` → main via mcp-server-github and publishes a KADI event (quest.pr_created) with the PR URL to notify agent-producer.
    4. NOTE: Any agent-lead can trigger the final PR — it's whichever lead verifies the last task. That lead checks all tasks (not just its own role) before creating the PR. No separate merge step is needed — the staging branch already has all verified work integrated.
18. agent-producer receives quest.pr_created event and tells HUMAN in Discord that all tasks in the quest are completed, with the pull request URL.
19. HUMAN clicks the URL to review the pull request on GitHub.
    1. If HUMAN doesn't agree with the PR, HUMAN adds review comments on GitHub requesting changes. agent-quest receives the webhook (pr.changes_requested), publishes a KADI event. agent-lead creates revision tasks for the specific feedback, assigns to workers, and the flow returns to step 13.
    2. NOTE: If HUMAN closes the PR without merging, agent-quest receives the webhook (pr.closed), publishes a KADI event (quest.pr_rejected). agent-lead notifies agent-producer, and agent-producer asks HUMAN in Discord whether to abandon the quest or rework it.
20. HUMAN clicks the merge button in GitHub.
21. agent-quest receives the webhook from GitHub, publishes a KADI event (quest.merged) to notify agent-producer and agent-lead that HUMAN has merged the PR.
    1. agent-producer tells HUMAN in Discord that the merge has been received.
    2. agent-lead deletes the staging branch `quest/{quest-id}` via mcp-server-git (all worktrees were already deleted during task verification).
    3. NOTE: agent-quest needs a public URL for GitHub webhooks. Use ability-tunnel-public to expose agent-quest's webhook endpoint.

## Build & Deploy (Optional — Task-Based)

Build and deploy are NOT a separate post-merge pipeline. They are regular tasks within the quest, assigned by agent-lead when the quest requires them.

- agent-builder and agent-deployer are specialized agent-workers with role "builder" and "deployer" respectively. They use the same role-based startup pattern (e.g., `npm run start:builder`).
- agent-lead includes "build" and "deploy" tasks in the quest plan (during step 9.1) ONLY when the quest requires them. These tasks have dependencies on the code/art tasks — they won't be assigned until their dependencies are verified.
- agent-builder receives task.assigned for build tasks. It pulls the latest code via mcp-server-git, runs MSBuild for DaemonAgent (or npm/cargo for other services), uploads the artifact via ability-file-cloud, and publishes task.review_requested like any other worker.
- agent-deployer receives task.assigned for deploy tasks (depends on build task completion). It uses ability-deploy to push the artifact to the target environment (local/Akash/DigitalOcean) and publishes task.review_requested.
- agent-qa validates build/deploy tasks the same way — checking build output, deployment health, etc.
- Not all quests need build or deploy tasks. A code-only quest might just need code tasks → merge → done.

## Quest Completion

1. agent-lead publishes a KADI event (quest.completed) to notify all agents that the quest is done.
    1. agent-worker receives the event and sets its status to idle.
    2. agent-producer confirms quest completion to HUMAN in Discord.
    3. agent-quest updates the dashboard to show the quest as completed.
