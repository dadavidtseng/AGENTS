#!/usr/bin/env python3
"""
Update tasks.md to reflect customization of existing slack-bot.ts and discord-bot.ts
Instead of creating new artist-bot.ts, designer-bot.ts, programmer-bot.ts files,
we customize the existing bot files from template-agent-typescript
Uses absolute Windows paths to avoid file modification bugs
"""

input_path = r'C:\p4\Personal\SD\AGENTS\.spec-workflow\specs\simple-multi-agents-orchestration\tasks.md'
output_path = r'C:\p4\Personal\SD\AGENTS\.spec-workflow\specs\simple-multi-agents-orchestration\tasks.md'

# Read current file
with open(input_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Update task 3.2 (agent-artist task execution) - customize slack-bot and discord-bot
old_task_3_2 = '''- [ ] 3.2 Implement agent-artist task execution logic
  - File: C:\\p4\\Personal\\SD\\agent-artist/src/artist-bot.ts'''

new_task_3_2 = '''- [ ] 3.2 Implement agent-artist task execution logic
  - File: C:\\p4\\Personal\\SD\\agent-artist/src/bot/slack-bot.ts, src/bot/discord-bot.ts'''

content = content.replace(old_task_3_2, new_task_3_2)

# Update task 3.2 description and prompt
old_task_3_2_desc = '''  - Subscribe to KĀDI events for artist tasks (artist.task.assigned)
  - Implement file operations in agent-playground-artist worktree
  - Publish file operation events (artist.file.created, artist.file.modified)
  - Commit and push changes to agent-playground-artist remote
  - Purpose: Enable artist agent to execute assigned tasks
  - _Leverage: BaseBot event subscription pattern, KĀDI event publishing_
  - _Requirements: 3.1.1, 3.1.2, 4.1_
  - _Prompt: Role: Event-Driven Systems Developer with expertise in pub/sub patterns and git workflows | Task: Implement task execution logic for agent-artist following requirements 3.1.1, 3.1.2, and 4.1, subscribing to task assignment events, performing file operations in worktree, publishing operation events, and committing to agent-playground-artist repo | Restrictions: Must use BaseBot event subscription methods, validate all file paths are within worktree, publish events before and after each operation, use atomic git commits, handle task interruption gracefully | Success: Agent responds to task assignments correctly, file operations work reliably, events published at correct times, git commits are atomic and properly attributed, task status updated correctly_'''

new_task_3_2_desc = '''  - Customize slack-bot.ts and discord-bot.ts to handle artist tasks
  - Subscribe to KĀDI events for artist tasks (artist.task.assigned)
  - Implement file operations in agent-playground-artist worktree
  - Publish file operation events (artist.file.created, artist.file.modified)
  - Commit and push changes to agent-playground-artist remote
  - Purpose: Enable artist agent to execute assigned tasks via Slack/Discord channels
  - _Leverage: Template's existing slack-bot.ts and discord-bot.ts, BaseBot event patterns_
  - _Requirements: 3.1.1, 3.1.2, 4.1_
  - _Prompt: Role: Event-Driven Systems Developer with expertise in Slack/Discord bot customization and git workflows | Task: Customize slack-bot.ts and discord-bot.ts for agent-artist following requirements 3.1.1, 3.1.2, and 4.1, adding artist-specific task execution logic (subscribing to artist.task.assigned events, performing file operations in worktree, publishing file events, committing to agent-playground-artist repo) | Restrictions: Must preserve existing Slack/Discord channel interaction logic from template, add artist-specific logic to task execution methods, validate file paths are within worktree, publish events before/after operations, use atomic git commits, handle task interruption gracefully | Success: Slack and Discord bots handle artist tasks correctly, file operations work reliably in worktree, events published at correct times, git commits are atomic and attributed, existing channel interaction logic preserved_'''

content = content.replace(old_task_3_2_desc, new_task_3_2_desc)

# Update task 3.3 (agent-artist error handling) - reference slack-bot and discord-bot
old_task_3_3 = '''- [ ] 3.3 Add error handling and retry logic to agent-artist
  - File: C:\\p4\\Personal\\SD\\agent-artist/src/artist-bot.ts'''

new_task_3_3 = '''- [ ] 3.3 Add error handling and retry logic to agent-artist
  - File: C:\\p4\\Personal\\SD\\agent-artist/src/bot/slack-bot.ts, src/bot/discord-bot.ts'''

content = content.replace(old_task_3_3, new_task_3_3)

# Update task 3.5 (agent-designer task execution)
old_task_3_5 = '''- [ ] 3.5 Implement agent-designer task execution logic
  - File: C:\\p4\\Personal\\SD\\agent-designer/src/designer-bot.ts
  - Subscribe to designer.task.assigned events
  - Implement documentation/design file operations
  - Publish designer.file.* events
  - Commit and push to agent-playground-designer remote
  - Purpose: Enable designer agent to execute documentation tasks
  - _Leverage: agent-artist task execution pattern, BaseBot event utilities_
  - _Requirements: 3.1.1, 3.1.2, 4.1_
  - _Prompt: Role: Software Engineer with expertise in documentation tooling and event-driven systems | Task: Implement task execution logic for agent-designer following requirements 3.1.1, 3.1.2, and 4.1, adapting agent-artist patterns for documentation/design file operations, subscribing to designer events, and committing to agent-playground-designer repo | Restrictions: Must follow agent-artist event subscription pattern, handle documentation-specific file types (markdown, diagrams), publish events at same granularity as artist, use atomic git operations, maintain task status consistency | Success: Designer agent executes documentation tasks correctly, file operations handle markdown/diagrams properly, events published consistently, git commits work reliably, pattern consistency with agent-artist_'''

new_task_3_5 = '''- [ ] 3.5 Implement agent-designer task execution logic
  - File: C:\\p4\\Personal\\SD\\agent-designer/src/bot/slack-bot.ts, src/bot/discord-bot.ts
  - Customize slack-bot.ts and discord-bot.ts for designer tasks
  - Subscribe to designer.task.assigned events
  - Implement documentation/design file operations
  - Publish designer.file.* events
  - Commit and push to agent-playground-designer remote
  - Purpose: Enable designer agent to execute documentation tasks via Slack/Discord channels
  - _Leverage: agent-artist bot customization pattern, template's slack-bot.ts and discord-bot.ts_
  - _Requirements: 3.1.1, 3.1.2, 4.1_
  - _Prompt: Role: Software Engineer with expertise in documentation tooling and Slack/Discord bot customization | Task: Customize slack-bot.ts and discord-bot.ts for agent-designer following requirements 3.1.1, 3.1.2, and 4.1, adapting agent-artist bot customization patterns for documentation/design file operations (subscribing to designer.task.assigned events, handling markdown/diagrams, publishing designer.file.* events, committing to agent-playground-designer repo) | Restrictions: Must follow agent-artist bot customization pattern exactly, preserve existing Slack/Discord interaction logic, handle documentation-specific file types correctly, publish events at same granularity as artist, use atomic git operations, maintain pattern consistency | Success: Designer bots execute documentation tasks correctly, file operations handle markdown/diagrams properly, events published consistently, git commits work reliably, pattern consistency with agent-artist maintained_'''

content = content.replace(old_task_3_5, new_task_3_5)

# Update task 3.6 (agent-designer error handling)
old_task_3_6 = '''- [ ] 3.6 Add error handling and retry logic to agent-designer
  - File: C:\\p4\\Personal\\SD\\agent-designer/src/designer-bot.ts'''

new_task_3_6 = '''- [ ] 3.6 Add error handling and retry logic to agent-designer
  - File: C:\\p4\\Personal\\SD\\agent-designer/src/bot/slack-bot.ts, src/bot/discord-bot.ts'''

content = content.replace(old_task_3_6, new_task_3_6)

# Update task 3.8 (agent-programmer task execution)
old_task_3_8 = '''- [ ] 3.8 Implement agent-programmer task execution logic
  - File: C:\\p4\\Personal\\SD\\agent-programmer/src/programmer-bot.ts
  - Subscribe to programmer.task.assigned events
  - Implement code file operations with syntax validation
  - Publish programmer.file.* events
  - Run code quality checks before committing
  - Commit and push to agent-playground-programmer remote
  - Purpose: Enable programmer agent to execute coding tasks with quality checks
  - _Leverage: agent-artist/designer task execution patterns, code quality tools (ESLint, Prettier)_
  - _Requirements: 3.1.1, 3.1.2, 4.1_
  - _Prompt: Role: Software Engineer with expertise in code quality automation and CI/CD | Task: Implement task execution logic for agent-programmer following requirements 3.1.1, 3.1.2, and 4.1, adapting worker agent patterns for code file operations with pre-commit syntax validation and quality checks using ESLint/Prettier | Restrictions: Must follow artist/designer event pattern, validate code syntax before committing, run linting and formatting checks, publish events at consistent granularity, fail task on quality check failures, use atomic git operations | Success: Programmer agent executes coding tasks correctly, code quality checks run automatically, invalid code prevents commits, events published consistently, git commits include quality-checked code only_'''

new_task_3_8 = '''- [ ] 3.8 Implement agent-programmer task execution logic
  - File: C:\\p4\\Personal\\SD\\agent-programmer/src/bot/slack-bot.ts, src/bot/discord-bot.ts
  - Customize slack-bot.ts and discord-bot.ts for programmer tasks
  - Subscribe to programmer.task.assigned events
  - Implement code file operations with syntax validation
  - Publish programmer.file.* events
  - Run code quality checks before committing
  - Commit and push to agent-playground-programmer remote
  - Purpose: Enable programmer agent to execute coding tasks with quality checks via Slack/Discord channels
  - _Leverage: agent-artist/designer bot customization patterns, code quality tools (ESLint, Prettier)_
  - _Requirements: 3.1.1, 3.1.2, 4.1_
  - _Prompt: Role: Software Engineer with expertise in code quality automation and Slack/Discord bot customization | Task: Customize slack-bot.ts and discord-bot.ts for agent-programmer following requirements 3.1.1, 3.1.2, and 4.1, adapting worker agent bot patterns for code file operations with pre-commit syntax validation and quality checks using ESLint/Prettier | Restrictions: Must follow artist/designer bot customization pattern exactly, preserve Slack/Discord interaction logic, validate code syntax before committing, run linting/formatting checks, publish events at consistent granularity, fail task on quality check failures, use atomic git operations | Success: Programmer bots execute coding tasks correctly, code quality checks run automatically, invalid code prevents commits, events published consistently, git commits include quality-checked code only, pattern consistency maintained_'''

content = content.replace(old_task_3_8, new_task_3_8)

# Update task 3.9 (agent-programmer error handling)
old_task_3_9 = '''- [ ] 3.9 Add error handling and retry logic to agent-programmer
  - File: C:\\p4\\Personal\\SD\\agent-programmer/src/programmer-bot.ts'''

new_task_3_9 = '''- [ ] 3.9 Add error handling and retry logic to agent-programmer
  - File: C:\\p4\\Personal\\SD\\agent-programmer/src/bot/slack-bot.ts, src/bot/discord-bot.ts'''

content = content.replace(old_task_3_9, new_task_3_9)

# Update Phase 4 shadow agent tasks similarly
# Update task 4.2 (shadow-agent-artist monitoring)
old_task_4_2_file = '''- [ ] 4.2 Implement shadow-agent-artist file monitoring with shared worktree
  - File: C:\\p4\\Personal\\SD\\shadow-agent-artist/src/shadow-artist-bot.ts'''

new_task_4_2_file = '''- [ ] 4.2 Implement shadow-agent-artist file monitoring with shared worktree
  - File: C:\\p4\\Personal\\SD\\shadow-agent-artist/src/bot/slack-bot.ts, src/bot/discord-bot.ts'''

content = content.replace(old_task_4_2_file, new_task_4_2_file)

# Update task 4.2 description
old_task_4_2_prompt = '''  - _Prompt: Role: Backup Systems Engineer with expertise in git multi-remote workflows and event-driven monitoring | Task: Implement file monitoring for shadow-agent-artist following requirements 4.2 and 4.3, subscribing to artist file events, creating backup commits in shared agent-playground-artist worktree, and pushing to shadow-agent-playground-artist remote (while agent-artist pushes same worktree to agent-playground-artist remote) | Restrictions: Must use shared worktree at C:\\p4\\Personal\\SD\\agent-playground-artist, create backup commits on every file event, push to shadow-agent-playground-artist remote only (not agent-playground-artist remote), coordinate with agent-artist's git operations (avoid conflicts), maintain chronological backup history, ensure both remotes stay synchronized with worktree state | Success: Shadow agent receives all file events, backup commits created in shared worktree, pushes to shadow-agent-playground-artist remote successfully, no conflicts with agent-artist's pushes to agent-playground-artist remote, rollback capability verified, shared worktree workflow validated_'''

new_task_4_2_prompt = '''  - _Prompt: Role: Backup Systems Engineer with expertise in git multi-remote workflows and Slack/Discord bot customization | Task: Customize slack-bot.ts and discord-bot.ts for shadow-agent-artist following requirements 4.2 and 4.3, implementing passive monitoring logic (subscribing to artist.file.* events, creating backup commits in shared agent-playground-artist worktree, pushing to shadow-agent-playground-artist remote while agent-artist pushes same worktree to agent-playground-artist remote) | Restrictions: Must preserve Slack/Discord interaction logic from template, use shared worktree at C:\\p4\\Personal\\SD\\agent-playground-artist, create backup commits on every file event, push to shadow-agent-playground-artist remote only, coordinate with agent-artist's git operations (avoid conflicts), maintain chronological backup history | Success: Shadow bots receive all file events via Slack/Discord, backup commits created in shared worktree, pushes to shadow-agent-playground-artist remote successfully, no conflicts with agent-artist's pushes, rollback capability verified, Slack/Discord interaction preserved_'''

content = content.replace(old_task_4_2_prompt, new_task_4_2_prompt)

# Update task 4.3 (shadow-agent-artist error handling)
old_task_4_3 = '''- [ ] 4.3 Add error handling for shadow-agent-artist
  - File: C:\\p4\\Personal\\SD\\shadow-agent-artist/src/shadow-artist-bot.ts'''

new_task_4_3 = '''- [ ] 4.3 Add error handling for shadow-agent-artist
  - File: C:\\p4\\Personal\\SD\\shadow-agent-artist/src/bot/slack-bot.ts, src/bot/discord-bot.ts'''

content = content.replace(old_task_4_3, new_task_4_3)

# Update task 4.5 (shadow-agent-designer monitoring)
old_task_4_5_file = '''- [ ] 4.5 Implement shadow-agent-designer file monitoring with shared worktree
  - File: C:\\p4\\Personal\\SD\\shadow-agent-designer/src/shadow-designer-bot.ts'''

new_task_4_5_file = '''- [ ] 4.5 Implement shadow-agent-designer file monitoring with shared worktree
  - File: C:\\p4\\Personal\\SD\\shadow-agent-designer/src/bot/slack-bot.ts, src/bot/discord-bot.ts'''

content = content.replace(old_task_4_5_file, new_task_4_5_file)

# Update task 4.5 description
old_task_4_5_prompt = '''  - _Prompt: Role: Backup Systems Engineer focused on consistency and multi-remote git workflows | Task: Implement file monitoring for shadow-agent-designer following requirements 4.2 and 4.3, mirroring shadow-agent-artist pattern for designer file events, creating backup commits in shared agent-playground-designer worktree, and pushing to shadow-agent-playground-designer remote | Restrictions: Must follow shadow-agent-artist monitoring pattern exactly, use shared worktree at C:\\p4\\Personal\\SD\\agent-playground-designer, create commits on every file event, push to shadow-agent-playground-designer remote only, coordinate with agent-designer's git operations, maintain pattern consistency with shadow-agent-artist | Success: Designer shadow agent matches artist shadow behavior, backup commits created in shared worktree, pushes to shadow-agent-playground-designer remote successfully, no conflicts with agent-designer's pushes, shared worktree workflow consistent across shadow agents_'''

new_task_4_5_prompt = '''  - _Prompt: Role: Backup Systems Engineer focused on consistency and Slack/Discord bot customization | Task: Customize slack-bot.ts and discord-bot.ts for shadow-agent-designer following requirements 4.2 and 4.3, mirroring shadow-agent-artist bot customization pattern for designer file events (creating backup commits in shared agent-playground-designer worktree, pushing to shadow-agent-playground-designer remote) | Restrictions: Must follow shadow-agent-artist bot customization pattern exactly, preserve Slack/Discord interaction logic, use shared worktree at C:\\p4\\Personal\\SD\\agent-playground-designer, create commits on every file event, push to shadow-agent-playground-designer remote only, coordinate with agent-designer's git operations | Success: Designer shadow bots match artist shadow behavior, backup commits created in shared worktree, pushes to shadow-agent-playground-designer remote successfully, no conflicts with agent-designer's pushes, pattern consistency across shadow agents_'''

content = content.replace(old_task_4_5_prompt, new_task_4_5_prompt)

# Update task 4.6 (shadow-agent-designer error handling)
old_task_4_6 = '''- [ ] 4.6 Add error handling for shadow-agent-designer
  - File: C:\\p4\\Personal\\SD\\shadow-agent-designer/src/shadow-designer-bot.ts'''

new_task_4_6 = '''- [ ] 4.6 Add error handling for shadow-agent-designer
  - File: C:\\p4\\Personal\\SD\\shadow-agent-designer/src/bot/slack-bot.ts, src/bot/discord-bot.ts'''

content = content.replace(old_task_4_6, new_task_4_6)

# Update task 4.8 (shadow-agent-programmer monitoring)
old_task_4_8_file = '''- [ ] 4.8 Implement shadow-agent-programmer file monitoring with shared worktree
  - File: C:\\p4\\Personal\\SD\\shadow-agent-programmer/src/shadow-programmer-bot.ts'''

new_task_4_8_file = '''- [ ] 4.8 Implement shadow-agent-programmer file monitoring with shared worktree
  - File: C:\\p4\\Personal\\SD\\shadow-agent-programmer/src/bot/slack-bot.ts, src/bot/discord-bot.ts'''

content = content.replace(old_task_4_8_file, new_task_4_8_file)

# Update task 4.8 description
old_task_4_8_prompt = '''  - _Prompt: Role: Backup Systems Engineer with expertise in code versioning and multi-remote git workflows | Task: Implement file monitoring for shadow-agent-programmer following requirements 4.2 and 4.3, maintaining consistency with other shadow agents for programmer file events, creating backup commits in shared agent-playground-programmer worktree, and pushing to shadow-agent-playground-programmer remote | Restrictions: Must follow established shadow monitoring pattern exactly, use shared worktree at C:\\p4\\Personal\\SD\\agent-playground-programmer, create commits on every file event, push to shadow-agent-playground-programmer remote only, coordinate with agent-programmer's git operations, maintain pattern consistency across all shadow agents | Success: Programmer shadow agent matches other shadows exactly, backup commits created in shared worktree, pushes to shadow-agent-playground-programmer remote successfully, no conflicts with agent-programmer's pushes, code files backed up correctly, shared worktree workflow consistent across all shadow agents_'''

new_task_4_8_prompt = '''  - _Prompt: Role: Backup Systems Engineer with expertise in code versioning and Slack/Discord bot customization | Task: Customize slack-bot.ts and discord-bot.ts for shadow-agent-programmer following requirements 4.2 and 4.3, maintaining consistency with other shadow agent bot customizations for programmer file events (creating backup commits in shared agent-playground-programmer worktree, pushing to shadow-agent-playground-programmer remote) | Restrictions: Must follow established shadow bot customization pattern exactly, preserve Slack/Discord interaction logic, use shared worktree at C:\\p4\\Personal\\SD\\agent-playground-programmer, create commits on every file event, push to shadow-agent-playground-programmer remote only, coordinate with agent-programmer's git operations | Success: Programmer shadow bots match other shadows exactly, backup commits created in shared worktree, pushes to shadow-agent-playground-programmer remote successfully, no conflicts with agent-programmer's pushes, code files backed up correctly, pattern consistency across all shadow agents_'''

content = content.replace(old_task_4_8_prompt, new_task_4_8_prompt)

# Update task 4.9 (shadow-agent-programmer error handling)
old_task_4_9 = '''- [ ] 4.9 Add error handling for shadow-agent-programmer
  - File: C:\\p4\\Personal\\SD\\shadow-agent-programmer/src/shadow-programmer-bot.ts'''

new_task_4_9 = '''- [ ] 4.9 Add error handling for shadow-agent-programmer
  - File: C:\\p4\\Personal\\SD\\shadow-agent-programmer/src/bot/slack-bot.ts, src/bot/discord-bot.ts'''

content = content.replace(old_task_4_9, new_task_4_9)

# Write updated file
with open(output_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("[SUCCESS] Updated tasks.md to customize slack-bot.ts and discord-bot.ts")
print(f"Location: {output_path}")
print("")
print("Bot File Updates Applied:")
print("  - Worker agents (artist, designer, programmer):")
print("    - Customize src/bot/slack-bot.ts for Slack channel interaction")
print("    - Customize src/bot/discord-bot.ts for Discord channel interaction")
print("    - NO new artist-bot.ts, designer-bot.ts, programmer-bot.ts files")
print("")
print("  - Shadow agents (shadow-artist, shadow-designer, shadow-programmer):")
print("    - Customize src/bot/slack-bot.ts for Slack monitoring")
print("    - Customize src/bot/discord-bot.ts for Discord monitoring")
print("    - NO new shadow-artist-bot.ts, shadow-designer-bot.ts, shadow-programmer-bot.ts files")
print("")
print("Approach: Copy template files and customize (refactor to shared base classes later)")
