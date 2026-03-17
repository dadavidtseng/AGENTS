# KĀDI Quest Workflow v1

1. HUMAN: I want to have a ball bouncing in the scene.
2. agent-producer uses LLM to think about what to do.
3. agent-producer calls mcp-server-quest's quest_list_quest to get all the quests.
4. If agent-producer found that this quest is not created yet, agent-producer will call mcp-server-quest's tool quest_create_quest to create a quest for HUMAN's request, which will include requirements.md and design.md.
5. agent-producer notifies the HUMAN in Discord.
6. HUMAN sees the Discord message and the created quest in mcp-client-quest's frontend.
7. agent-producer calls mcp-server-quest's quest_request_quest_approval to ask for approval for the created quest.
8. HUMAN sees the approval request in mcp-client-quest's frontend.
9. HUMAN approves, requests revision, or rejects the quest approval in mcp-client-quest's frontend by adding comments and pressing a button.
    1. If HUMAN selected approve, the button in mcp-client-quest will call agent-producer's quest_approve tool. Then agent-producer will call mcp-server-quest's four-step task creation tools: quest_plan_task, quest_analyze_task, quest_reflect_task, quest_split_task.
    2. If HUMAN selected request revision, the button in mcp-client-quest will call agent-producer's quest_request_revision tool. Then agent-producer will call mcp-server-quest's quest_update_quest tool after using LLM to come up with a better quest. Then the step repeats from step 5.
    3. If HUMAN selected reject, the button in mcp-client-quest will call agent-producer's quest_reject tool. Then agent-producer will call mcp-server-quest's quest_delete_quest to delete the created quest.
10. HUMAN sees the created tasks in mcp-client-quest's frontend.
11. agent-producer asks HUMAN if he wants to execute the task in Discord.
12. HUMAN says yes in Discord.
13. agent-producer uses LLM to think about which task to assign to which agent, then agent-producer will call mcp-server-quest's quest_assign_task tool.
14. agent-producer publishes a KADI event (task.assigned) to agent-worker (agent-artist/designer/programmer).
15. agent-worker starts executing the task.
16. After agent-worker finishes the task, it calls mcp-server-git's tool to commit to its git worktree.
17. agent-worker publishes a KADI event (task.completed) to agent-producer.
18. agent-producer receives the event, then calls mcp-server-quest's quest_verify_task tool to verify the task.
    1. If the score is too low, agent-producer publishes a KADI event (task.failed) to agent-worker. Agent-worker receives the event with failure reason, then repeats from step 15.
    2. If the score is high enough, agent-producer calls mcp-server-quest's quest_update_task tool to update the task's status to completed.
19. agent-producer tells HUMAN that the task in the quest is completed in Discord.
20. agent-producer calls mcp-server-quest's quest_request_task_approval to ask for approval for the completed task.
21. HUMAN sees the approval request in mcp-client-quest's frontend.
22. HUMAN approves, requests revision, or rejects the task approval in mcp-client-quest's frontend by adding comments and pressing a button.
    1. If HUMAN selected approve, the button in mcp-client-quest will call agent-producer's task_approve tool. Then agent-producer will call mcp-server-quest's quest_query_quest tool to see if all tasks in a quest are completed. If so, agent-producer will call mcp-server-git's tool to do git merge and git push.
    2. If HUMAN selected request revision, the button in mcp-client-quest will call agent-producer's task_request_revision tool. Then agent-producer will call mcp-server-quest's quest_update_task tool after using LLM to come up with a better task. Then the step repeats from step 14.
    3. If HUMAN selected reject, the button in mcp-client-quest will call agent-producer's quest_reject tool. Then agent-producer will call mcp-server-quest's quest_delete_task to delete the task. Then agent-producer will ask HUMAN what to do for the quest/task in Discord.
