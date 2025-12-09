#!/usr/bin/env python3
"""
Apply 5 revisions to tasks.md based on user feedback
Uses absolute Windows paths to avoid file modification bugs
"""

input_path = r'C:\p4\Personal\SD\AGENTS\.spec-workflow\specs\simple-multi-agents-orchestration\tasks.md'
output_path = r'C:\p4\Personal\SD\AGENTS\.spec-workflow\specs\simple-multi-agents-orchestration\tasks.md'

# Read current file
with open(input_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Revision 1: Update KĀDI broker config file path
content = content.replace(
    '- File: kadi-broker config (location TBD based on KĀDI broker documentation)',
    '- File: C:\\p4\\Personal\\SD\\kadi\\kadi-broker\\config\\mcp-upstreams.json'
)

# Revision 2: Remove mcp-spec-workflow from MCP server registration (only use mcp-shrimp-task-manager)
content = content.replace(
    '- Register MCP servers: mcp-shrimp-task-manager, mcp-spec-workflow',
    '- Register MCP server: mcp-shrimp-task-manager'
)
content = content.replace(
    'Configure KĀDI broker to register mcp-shrimp-task-manager and mcp-spec-workflow as upstreams following requirements 2.1.1 and 2.1.2',
    'Configure KĀDI broker to register mcp-shrimp-task-manager as upstream following requirements 2.1.1 and 2.1.2'
)

# Revision 3: Remove git-worktree utilities from agent-producer (move to worker agents only)
# Find and remove task 1.3
task_1_3_start = content.find('- [ ] 1.3 Set up git worktree management utilities')
if task_1_3_start != -1:
    # Find the end of this task (next task starts with "- [ ] ")
    next_task = content.find('\n- [ ] ', task_1_3_start + 10)
    if next_task != -1:
        # Remove the entire task
        content = content[:task_1_3_start] + content[next_task+1:]

# Update Phase 1 task count in comment
content = content.replace(
    '## Phase 1: Project Setup and Configuration (3 tasks)',
    '## Phase 1: Project Setup and Configuration (2 tasks)'
)

# Revision 4: Update worker agent tasks to leverage existing slack-bot/discord-bot from template
# Update task 3.1 (agent-artist scaffold)
old_task_3_1 = '''- [ ] 3.1 Scaffold agent-artist project
  - File: C:\\p4\\Personal\\SD\\agent-artist/package.json, tsconfig.json, src/index.ts, src/artist-bot.ts
  - Create TypeScript project extending BaseBot
  - Set up KĀDI client connection
  - Initialize git worktree for agent-playground-artist
  - Purpose: Create artist agent foundation
  - _Leverage: C:\\p4\\Personal\\SD\\AGENTS\\shared\\base-bot.ts_
  - _Requirements: 1.1, 3.1.1_
  - _Prompt: Role: TypeScript Developer specializing in agent architectures and OOP inheritance | Task: Scaffold agent-artist project following requirements 1.1 and 3.1.1, creating TypeScript project that extends BaseBot with KĀDI client integration and git worktree initialization for agent-playground-artist | Restrictions: Must extend BaseBot (not copy), initialize KĀDI client with artist network assignment, use git worktree utilities from agent-producer pattern, do not hard-code paths (use environment variables) | Success: Project structure is clean and follows BaseBot pattern, KĀDI client connects successfully, git worktree initialized at C:\\p4\\Personal\\SD\\agent-playground-artist, TypeScript compiles without errors_'''

new_task_3_1 = '''- [ ] 3.1 Scaffold agent-artist project from template
  - File: Clone from C:\\p4\\Personal\\SD\\template-agent-typescript to C:\\p4\\Personal\\SD\\agent-artist
  - Customize package.json, update project name and description
  - Configure git worktree for agent-playground-artist
  - Leverage existing slack-bot.ts and discord-bot.ts from template
  - Purpose: Create artist agent foundation with pre-built channel integrations
  - _Leverage: C:\\p4\\Personal\\SD\\template-agent-typescript (slack-bot, discord-bot), C:\\p4\\Personal\\SD\\AGENTS\\shared\\base-bot.ts_
  - _Requirements: 1.1, 3.1.1_
  - _Prompt: Role: TypeScript Developer specializing in agent architectures and template customization | Task: Clone template-agent-typescript to create agent-artist following requirements 1.1 and 3.1.1, customizing project metadata, configuring git worktree for agent-playground-artist, and leveraging existing slack-bot/discord-bot implementations from template | Restrictions: Must reuse template's slack-bot and discord-bot (not rewrite), configure KĀDI client with artist network assignment, initialize git worktree at C:\\p4\\Personal\\SD\\agent-playground-artist, update all template placeholders with artist-specific values | Success: Project cloned and customized successfully, slack-bot/discord-bot configured for artist role, git worktree initialized correctly, KĀDI client connects to artist network, TypeScript compiles without errors_'''

content = content.replace(old_task_3_1, new_task_3_1)

# Update task 3.4 (agent-designer scaffold)
old_task_3_4 = '''- [ ] 3.4 Scaffold agent-designer project
  - File: C:\\p4\\Personal\\SD\\agent-designer/package.json, tsconfig.json, src/index.ts, src/designer-bot.ts
  - Create TypeScript project extending BaseBot
  - Set up KĀDI client connection (designer network)
  - Initialize git worktree for agent-playground-designer
  - Purpose: Create designer agent foundation
  - _Leverage: C:\\p4\\Personal\\SD\\AGENTS\\shared\\base-bot.ts, agent-artist patterns_
  - _Requirements: 1.1, 3.1.1_
  - _Prompt: Role: TypeScript Developer with expertise in code reuse and architectural patterns | Task: Scaffold agent-designer project following requirements 1.1 and 3.1.1, mirroring agent-artist structure but for designer role (documentation/design work), extending BaseBot with designer network KĀDI client and agent-playground-designer worktree | Restrictions: Must reuse patterns from agent-artist (not copy-paste), configure for designer network in KĀDI, initialize worktree at C:\\p4\\Personal\\SD\\agent-playground-designer, use environment variables for configuration | Success: Project structure matches agent-artist pattern, KĀDI client connects to designer network, git worktree initialized correctly, code reuse is evident (shared utilities), TypeScript compiles_'''

new_task_3_4 = '''- [ ] 3.4 Scaffold agent-designer project from template
  - File: Clone from C:\\p4\\Personal\\SD\\template-agent-typescript to C:\\p4\\Personal\\SD\\agent-designer
  - Customize package.json for designer role
  - Configure git worktree for agent-playground-designer
  - Leverage existing slack-bot.ts and discord-bot.ts from template
  - Purpose: Create designer agent foundation with pre-built channel integrations
  - _Leverage: C:\\p4\\Personal\\SD\\template-agent-typescript, agent-artist customization patterns_
  - _Requirements: 1.1, 3.1.1_
  - _Prompt: Role: TypeScript Developer with expertise in template customization and consistency | Task: Clone template-agent-typescript to create agent-designer following requirements 1.1 and 3.1.1, mirroring agent-artist customization approach for designer role (documentation/design work), configuring git worktree for agent-playground-designer | Restrictions: Must follow agent-artist customization pattern, reuse template's slack-bot/discord-bot, configure KĀDI client for designer network, initialize worktree at C:\\p4\\Personal\\SD\\agent-playground-designer, maintain consistency with agent-artist setup | Success: Project cloned and customized consistently with agent-artist, slack-bot/discord-bot configured for designer role, git worktree initialized correctly, KĀDI client connects to designer network, TypeScript compiles_'''

content = content.replace(old_task_3_4, new_task_3_4)

# Update task 3.7 (agent-programmer scaffold)
old_task_3_7 = '''- [ ] 3.7 Scaffold agent-programmer project
  - File: C:\\p4\\Personal\\SD\\agent-programmer/package.json, tsconfig.json, src/index.ts, src/programmer-bot.ts
  - Create TypeScript project extending BaseBot
  - Set up KĀDI client connection (programmer network)
  - Initialize git worktree for agent-playground-programmer
  - Purpose: Create programmer agent foundation
  - _Leverage: C:\\p4\\Personal\\SD\\AGENTS\\shared\\base-bot.ts, agent-artist/designer patterns_
  - _Requirements: 1.1, 3.1.1_
  - _Prompt: Role: TypeScript Developer with focus on architectural consistency | Task: Scaffold agent-programmer project following requirements 1.1 and 3.1.1, following established pattern from agent-artist/designer for programmer role (code implementation), extending BaseBot with programmer network and agent-playground-programmer worktree | Restrictions: Must maintain architectural consistency with other worker agents, configure for programmer network, initialize worktree at C:\\p4\\Personal\\SD\\agent-playground-programmer, reuse utilities from other agents | Success: Project structure consistent with artist/designer, KĀDI client connects to programmer network, git worktree initialized, code follows established patterns, TypeScript compiles_'''

new_task_3_7 = '''- [ ] 3.7 Scaffold agent-programmer project from template
  - File: Clone from C:\\p4\\Personal\\SD\\template-agent-typescript to C:\\p4\\Personal\\SD\\agent-programmer
  - Customize package.json for programmer role
  - Configure git worktree for agent-playground-programmer
  - Leverage existing slack-bot.ts and discord-bot.ts from template
  - Purpose: Create programmer agent foundation with pre-built channel integrations
  - _Leverage: C:\\p4\\Personal\\SD\\template-agent-typescript, agent-artist/designer customization patterns_
  - _Requirements: 1.1, 3.1.1_
  - _Prompt: Role: TypeScript Developer with focus on architectural consistency and template reuse | Task: Clone template-agent-typescript to create agent-programmer following requirements 1.1 and 3.1.1, maintaining consistency with agent-artist/designer customization patterns for programmer role (code implementation), configuring git worktree for agent-playground-programmer | Restrictions: Must maintain consistency with artist/designer setup, reuse template's slack-bot/discord-bot, configure KĀDI client for programmer network, initialize worktree at C:\\p4\\Personal\\SD\\agent-playground-programmer, follow established customization pattern | Success: Project cloned and customized consistently with artist/designer, slack-bot/discord-bot configured for programmer role, git worktree initialized correctly, KĀDI client connects to programmer network, TypeScript compiles_'''

content = content.replace(old_task_3_7, new_task_3_7)

# Revision 5: Update shadow agent tasks to clarify shared worktree with different git remotes
# Update task 4.1 (shadow-agent-artist scaffold)
old_task_4_1 = '''- [ ] 4.1 Scaffold shadow-agent-artist project
  - File: C:\\p4\\Personal\\SD\\shadow-agent-artist/package.json, tsconfig.json, src/index.ts, src/shadow-artist-bot.ts
  - Create TypeScript project extending BaseBot (READ-ONLY monitoring mode)
  - Set up KĀDI client connection (artist network, monitoring)
  - Configure git remote: shadow-agent-playground-artist
  - Purpose: Create shadow monitoring agent for artist rollback capability
  - _Leverage: C:\\p4\\Personal\\SD\\AGENTS\\shared\\base-bot.ts, worker agent patterns_
  - _Requirements: 1.1, 4.1, 4.2_
  - _Prompt: Role: TypeScript Developer specializing in monitoring systems and git architecture | Task: Scaffold shadow-agent-artist project following requirements 1.1, 4.1, and 4.2, creating passive monitoring agent that extends BaseBot, subscribes to artist file events without writing to worktree, and configures git remote to shadow-agent-playground-artist for backup pushes | Restrictions: Must operate in READ-ONLY mode (never write to agent-playground-artist), subscribe only to artist.file.* events, configure separate git remote (not origin), do not interfere with worker agent operations, initialize in shadow mode (no task execution) | Success: Shadow agent connects to KĀDI artist network, subscribes to file events correctly, git remote points to shadow-agent-playground-artist, READ-ONLY mode enforced, TypeScript compiles_'''

new_task_4_1 = '''- [ ] 4.1 Scaffold shadow-agent-artist project from template
  - File: Clone from C:\\p4\\Personal\\SD\\template-agent-typescript to C:\\p4\\Personal\\SD\\shadow-agent-artist
  - Customize package.json for shadow-artist monitoring role
  - Configure to use agent-playground-artist worktree (shared with agent-artist)
  - Add git remote for shadow-agent-playground-artist backup repository
  - Purpose: Create shadow monitoring agent for artist rollback capability
  - _Leverage: C:\\p4\\Personal\\SD\\template-agent-typescript, agent-artist patterns_
  - _Requirements: 1.1, 4.1, 4.2_
  - _Prompt: Role: TypeScript Developer specializing in monitoring systems and git multi-remote architecture | Task: Clone template-agent-typescript to create shadow-agent-artist following requirements 1.1, 4.1, and 4.2, customizing for passive monitoring role, configuring to use shared agent-playground-artist worktree (same as agent-artist), and adding shadow-agent-playground-artist as additional git remote for backup pushes | Restrictions: Must operate in READ-ONLY mode (never write files, only read and commit/push via git), subscribe only to artist.file.* events, configure shadow-agent-playground-artist as separate git remote (not replacing origin), do not interfere with agent-artist's git operations, share worktree at C:\\p4\\Personal\\SD\\agent-playground-artist | Success: Shadow agent cloned and customized successfully, uses shared worktree with agent-artist, shadow-agent-playground-artist remote configured correctly, READ-ONLY file operations enforced, KĀDI client connects to artist network, TypeScript compiles_'''

content = content.replace(old_task_4_1, new_task_4_1)

# Update task 4.2 (shadow-agent-artist monitoring)
old_task_4_2 = '''- [ ] 4.2 Implement shadow-agent-artist file monitoring
  - File: C:\\p4\\Personal\\SD\\shadow-agent-artist/src/shadow-artist-bot.ts
  - Subscribe to artist.file.created, artist.file.modified, artist.file.deleted events
  - Read file state from agent-playground-artist worktree (READ-ONLY)
  - Create backup commits to shadow-agent-playground-artist
  - Push continuously to shadow remote
  - Purpose: Provide continuous backup of artist work for rollback
  - _Leverage: KĀDI event subscriptions, git utilities_
  - _Requirements: 4.2, 4.3_
  - _Prompt: Role: Backup Systems Engineer with expertise in event-driven monitoring and git workflows | Task: Implement file monitoring for shadow-agent-artist following requirements 4.2 and 4.3, subscribing to all artist file events, reading file state from agent-playground-artist worktree (READ-ONLY), creating backup commits, and pushing continuously to shadow-agent-playground-artist remote | Restrictions: Must never write to agent-playground-artist worktree (READ-ONLY), commit on every file event (not batched), push immediately after commit, handle file deletion events correctly, maintain chronological backup history, do not interfere with worker agent's git operations | Success: Shadow agent receives all file events, backup commits created for each operation, pushes to shadow remote reliably, READ-ONLY guarantee maintained, rollback capability verified by restoring from shadow repo_'''

new_task_4_2 = '''- [ ] 4.2 Implement shadow-agent-artist file monitoring with shared worktree
  - File: C:\\p4\\Personal\\SD\\shadow-agent-artist/src/shadow-artist-bot.ts
  - Subscribe to artist.file.created, artist.file.modified, artist.file.deleted events
  - On each file event, create backup commit in shared agent-playground-artist worktree
  - Push backup commits to shadow-agent-playground-artist remote (separate from agent-artist's pushes)
  - Purpose: Provide continuous backup of artist work for rollback using shared worktree with different remote
  - _Leverage: KĀDI event subscriptions, git multi-remote utilities, agent-artist worktree_
  - _Requirements: 4.2, 4.3_
  - _Prompt: Role: Backup Systems Engineer with expertise in git multi-remote workflows and event-driven monitoring | Task: Implement file monitoring for shadow-agent-artist following requirements 4.2 and 4.3, subscribing to artist file events, creating backup commits in shared agent-playground-artist worktree, and pushing to shadow-agent-playground-artist remote (while agent-artist pushes same worktree to agent-playground-artist remote) | Restrictions: Must use shared worktree at C:\\p4\\Personal\\SD\\agent-playground-artist, create backup commits on every file event, push to shadow-agent-playground-artist remote only (not agent-playground-artist remote), coordinate with agent-artist's git operations (avoid conflicts), maintain chronological backup history, ensure both remotes stay synchronized with worktree state | Success: Shadow agent receives all file events, backup commits created in shared worktree, pushes to shadow-agent-playground-artist remote successfully, no conflicts with agent-artist's pushes to agent-playground-artist remote, rollback capability verified, shared worktree workflow validated_'''

content = content.replace(old_task_4_2, new_task_4_2)

# Update task 4.4 (shadow-agent-designer scaffold)
old_task_4_4 = '''- [ ] 4.4 Scaffold shadow-agent-designer project
  - File: C:\\p4\\Personal\\SD\\shadow-agent-designer/package.json, tsconfig.json, src/index.ts, src/shadow-designer-bot.ts
  - Create TypeScript project extending BaseBot (READ-ONLY monitoring)
  - Set up KĀDI client connection (designer network, monitoring)
  - Configure git remote: shadow-agent-playground-designer
  - Purpose: Create shadow monitoring agent for designer rollback
  - _Leverage: shadow-agent-artist patterns_
  - _Requirements: 1.1, 4.1, 4.2_
  - _Prompt: Role: TypeScript Developer with focus on architectural consistency and monitoring patterns | Task: Scaffold shadow-agent-designer project following requirements 1.1, 4.1, and 4.2, mirroring shadow-agent-artist structure for designer role, extending BaseBot in READ-ONLY mode, connecting to designer network, and configuring shadow-agent-playground-designer remote | Restrictions: Must follow shadow-agent-artist pattern exactly (role-adapted), operate in READ-ONLY mode, configure designer network, set git remote to shadow-agent-playground-designer, do not interfere with agent-designer operations | Success: Project structure matches shadow-agent-artist, KĀDI client connects to designer network, git remote configured correctly, READ-ONLY mode enforced, pattern consistency maintained_'''

new_task_4_4 = '''- [ ] 4.4 Scaffold shadow-agent-designer project from template
  - File: Clone from C:\\p4\\Personal\\SD\\template-agent-typescript to C:\\p4\\Personal\\SD\\shadow-agent-designer
  - Customize package.json for shadow-designer monitoring role
  - Configure to use agent-playground-designer worktree (shared with agent-designer)
  - Add git remote for shadow-agent-playground-designer backup repository
  - Purpose: Create shadow monitoring agent for designer rollback
  - _Leverage: C:\\p4\\Personal\\SD\\template-agent-typescript, shadow-agent-artist patterns_
  - _Requirements: 1.1, 4.1, 4.2_
  - _Prompt: Role: TypeScript Developer with focus on architectural consistency and template reuse | Task: Clone template-agent-typescript to create shadow-agent-designer following requirements 1.1, 4.1, and 4.2, mirroring shadow-agent-artist setup for designer role, configuring shared agent-playground-designer worktree, and adding shadow-agent-playground-designer git remote | Restrictions: Must follow shadow-agent-artist pattern exactly (role-adapted), operate in READ-ONLY mode (no file writes), configure designer network, share worktree at C:\\p4\\Personal\\SD\\agent-playground-designer, add shadow-agent-playground-designer as separate git remote, maintain consistency with shadow-agent-artist setup | Success: Project cloned and customized consistently with shadow-agent-artist, uses shared worktree with agent-designer, shadow-agent-playground-designer remote configured correctly, READ-ONLY mode enforced, KĀDI client connects to designer network, TypeScript compiles_'''

content = content.replace(old_task_4_4, new_task_4_4)

# Update task 4.5 (shadow-agent-designer monitoring)
old_task_4_5 = '''- [ ] 4.5 Implement shadow-agent-designer file monitoring
  - File: C:\\p4\\Personal\\SD\\shadow-agent-designer/src/shadow-designer-bot.ts
  - Subscribe to designer.file.* events
  - Read from agent-playground-designer worktree (READ-ONLY)
  - Create backup commits to shadow-agent-playground-designer
  - Purpose: Provide continuous backup of designer work
  - _Leverage: shadow-agent-artist monitoring pattern_
  - _Requirements: 4.2, 4.3_
  - _Prompt: Role: Backup Systems Engineer focused on consistency and pattern reuse | Task: Implement file monitoring for shadow-agent-designer following requirements 4.2 and 4.3, adapting shadow-agent-artist monitoring pattern for designer file events, reading from agent-playground-designer worktree, and backing up to shadow-agent-playground-designer remote | Restrictions: Must mirror shadow-agent-artist monitoring logic, maintain READ-ONLY guarantee, commit on every file event, push immediately, handle designer-specific file types correctly, maintain backup chronology | Success: Designer shadow agent matches artist shadow behavior, backup operations work reliably, READ-ONLY mode maintained, pattern consistency across shadow agents_'''

new_task_4_5 = '''- [ ] 4.5 Implement shadow-agent-designer file monitoring with shared worktree
  - File: C:\\p4\\Personal\\SD\\shadow-agent-designer/src/shadow-designer-bot.ts
  - Subscribe to designer.file.* events
  - Create backup commits in shared agent-playground-designer worktree
  - Push backup commits to shadow-agent-playground-designer remote
  - Purpose: Provide continuous backup of designer work using shared worktree
  - _Leverage: shadow-agent-artist monitoring pattern, agent-designer worktree_
  - _Requirements: 4.2, 4.3_
  - _Prompt: Role: Backup Systems Engineer focused on consistency and multi-remote git workflows | Task: Implement file monitoring for shadow-agent-designer following requirements 4.2 and 4.3, mirroring shadow-agent-artist pattern for designer file events, creating backup commits in shared agent-playground-designer worktree, and pushing to shadow-agent-playground-designer remote | Restrictions: Must follow shadow-agent-artist monitoring pattern exactly, use shared worktree at C:\\p4\\Personal\\SD\\agent-playground-designer, create commits on every file event, push to shadow-agent-playground-designer remote only, coordinate with agent-designer's git operations, maintain pattern consistency with shadow-agent-artist | Success: Designer shadow agent matches artist shadow behavior, backup commits created in shared worktree, pushes to shadow-agent-playground-designer remote successfully, no conflicts with agent-designer's pushes, shared worktree workflow consistent across shadow agents_'''

content = content.replace(old_task_4_5, new_task_4_5)

# Update task 4.7 (shadow-agent-programmer scaffold)
old_task_4_7 = '''- [ ] 4.7 Scaffold shadow-agent-programmer project
  - File: C:\\p4\\Personal\\SD\\shadow-agent-programmer/package.json, tsconfig.json, src/index.ts, src/shadow-programmer-bot.ts
  - Create TypeScript project extending BaseBot (READ-ONLY monitoring)
  - Set up KĀDI client connection (programmer network, monitoring)
  - Configure git remote: shadow-agent-playground-programmer
  - Purpose: Create shadow monitoring agent for programmer rollback
  - _Leverage: shadow-agent-artist/designer patterns_
  - _Requirements: 1.1, 4.1, 4.2_
  - _Prompt: Role: TypeScript Developer ensuring architectural consistency across all shadow agents | Task: Scaffold shadow-agent-programmer project following requirements 1.1, 4.1, and 4.2, following established shadow agent pattern for programmer role, extending BaseBot in READ-ONLY mode, connecting to programmer network, and configuring shadow-agent-playground-programmer remote | Restrictions: Must maintain consistency with other shadow agents, operate in READ-ONLY mode, configure programmer network, set git remote to shadow-agent-playground-programmer, reuse shadow agent utilities | Success: Project structure consistent with other shadows, KĀDI client connects to programmer network, git remote configured correctly, READ-ONLY mode enforced, architectural consistency maintained_'''

new_task_4_7 = '''- [ ] 4.7 Scaffold shadow-agent-programmer project from template
  - File: Clone from C:\\p4\\Personal\\SD\\template-agent-typescript to C:\\p4\\Personal\\SD\\shadow-agent-programmer
  - Customize package.json for shadow-programmer monitoring role
  - Configure to use agent-playground-programmer worktree (shared with agent-programmer)
  - Add git remote for shadow-agent-playground-programmer backup repository
  - Purpose: Create shadow monitoring agent for programmer rollback
  - _Leverage: C:\\p4\\Personal\\SD\\template-agent-typescript, shadow-agent-artist/designer patterns_
  - _Requirements: 1.1, 4.1, 4.2_
  - _Prompt: Role: TypeScript Developer ensuring architectural consistency across all shadow agents | Task: Clone template-agent-typescript to create shadow-agent-programmer following requirements 1.1, 4.1, and 4.2, maintaining consistency with shadow-agent-artist/designer setup for programmer role, configuring shared agent-playground-programmer worktree, and adding shadow-agent-playground-programmer git remote | Restrictions: Must maintain consistency with other shadow agents, operate in READ-ONLY mode (no file writes), configure programmer network, share worktree at C:\\p4\\Personal\\SD\\agent-playground-programmer, add shadow-agent-playground-programmer as separate git remote, follow established shadow agent pattern | Success: Project cloned and customized consistently with other shadows, uses shared worktree with agent-programmer, shadow-agent-playground-programmer remote configured correctly, READ-ONLY mode enforced, KĀDI client connects to programmer network, TypeScript compiles_'''

content = content.replace(old_task_4_7, new_task_4_7)

# Update task 4.8 (shadow-agent-programmer monitoring)
old_task_4_8 = '''- [ ] 4.8 Implement shadow-agent-programmer file monitoring
  - File: C:\\p4\\Personal\\SD\\shadow-agent-programmer/src/shadow-programmer-bot.ts
  - Subscribe to programmer.file.* events
  - Read from agent-playground-programmer worktree (READ-ONLY)
  - Create backup commits to shadow-agent-playground-programmer
  - Purpose: Provide continuous backup of programmer work
  - _Leverage: shadow-agent-artist/designer monitoring patterns_
  - _Requirements: 4.2, 4.3_
  - _Prompt: Role: Backup Systems Engineer with expertise in code backup and versioning | Task: Implement file monitoring for shadow-agent-programmer following requirements 4.2 and 4.3, adapting shadow agent monitoring pattern for programmer file events, reading from agent-playground-programmer worktree, and backing up to shadow-agent-programmer remote | Restrictions: Must follow established shadow monitoring pattern, maintain READ-ONLY guarantee, commit on every file event, push immediately, handle code file backups correctly (preserve syntax), maintain chronological backup history | Success: Programmer shadow agent matches other shadows, backup operations reliable, READ-ONLY mode guaranteed, code files backed up correctly with syntax preservation_'''

new_task_4_8 = '''- [ ] 4.8 Implement shadow-agent-programmer file monitoring with shared worktree
  - File: C:\\p4\\Personal\\SD\\shadow-agent-programmer/src/shadow-programmer-bot.ts
  - Subscribe to programmer.file.* events
  - Create backup commits in shared agent-playground-programmer worktree
  - Push backup commits to shadow-agent-playground-programmer remote
  - Purpose: Provide continuous backup of programmer work using shared worktree
  - _Leverage: shadow-agent-artist/designer monitoring patterns, agent-programmer worktree_
  - _Requirements: 4.2, 4.3_
  - _Prompt: Role: Backup Systems Engineer with expertise in code versioning and multi-remote git workflows | Task: Implement file monitoring for shadow-agent-programmer following requirements 4.2 and 4.3, maintaining consistency with other shadow agents for programmer file events, creating backup commits in shared agent-playground-programmer worktree, and pushing to shadow-agent-playground-programmer remote | Restrictions: Must follow established shadow monitoring pattern exactly, use shared worktree at C:\\p4\\Personal\\SD\\agent-playground-programmer, create commits on every file event, push to shadow-agent-playground-programmer remote only, coordinate with agent-programmer's git operations, maintain pattern consistency across all shadow agents | Success: Programmer shadow agent matches other shadows exactly, backup commits created in shared worktree, pushes to shadow-agent-playground-programmer remote successfully, no conflicts with agent-programmer's pushes, code files backed up correctly, shared worktree workflow consistent across all shadow agents_'''

content = content.replace(old_task_4_8, new_task_4_8)

# Write updated file
with open(output_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("[SUCCESS] Applied all 5 revisions to tasks.md")
print(f"Location: {output_path}")
print("")
print("Revisions Applied:")
print("  1. [OK] Updated KADI broker config path to C:\\p4\\Personal\\SD\\kadi\\kadi-broker\\config\\mcp-upstreams.json")
print("  2. [OK] Removed mcp-spec-workflow, only using mcp-shrimp-task-manager")
print("  3. [OK] Removed git-worktree utilities from agent-producer (Phase 1 now has 2 tasks)")
print("  4. [OK] Updated worker agent tasks (3.1, 3.4, 3.7) to clone from template-agent-typescript")
print("  5. [OK] Updated shadow agent tasks (4.1, 4.2, 4.4, 4.5, 4.7, 4.8) to use shared worktree with separate git remotes")
print("")
print("Key Architecture Changes:")
print("  - Worker agents: Clone template-agent-typescript, leverage existing slack-bot/discord-bot")
print("  - Shadow agents: Clone template-agent-typescript, use shared worktree with worker agents")
print("  - Git workflow: Worker pushes to agent-playground-{role}, Shadow pushes to shadow-agent-playground-{role}")
print("  - Both use same worktree: C:\\p4\\Personal\\SD\\agent-playground-{role}")
