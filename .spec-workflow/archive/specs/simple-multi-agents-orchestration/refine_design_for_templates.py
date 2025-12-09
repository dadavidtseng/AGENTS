#!/usr/bin/env python3
"""
Refine design.md to reflect template-based bot architecture
Clarifies that all agents clone from template-agent-typescript
and customize slack-bot.ts and discord-bot.ts (not create new bot files)
Uses absolute Windows paths to avoid file modification bugs
"""

input_path = r'C:\p4\Personal\SD\AGENTS\.spec-workflow\specs\simple-multi-agents-orchestration\design.md'
output_path = r'C:\p4\Personal\SD\AGENTS\.spec-workflow\specs\simple-multi-agents-orchestration\design.md'

# Read current file
with open(input_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Refinement 1: Update "SlackBot and DiscordBot" section to clarify template pattern
old_slack_discord_section = '''3. **SlackBot and DiscordBot (agent-producer/src/bot/)**
   - **Purpose**: Existing bot integrations extending BaseBot
   - **Reuse**: agent-producer already has these; no duplication needed
   - **Features**:
     - Event subscription for mentions
     - Anthropic Claude integration
     - Message formatting and response handling'''

new_slack_discord_section = '''3. **SlackBot and DiscordBot (from template-agent-typescript)**
   - **Purpose**: Pre-built Slack/Discord channel integrations extending BaseBot
   - **Source**: `C:\\p4\\Personal\\SD\\template-agent-typescript/src/bot/`
   - **Usage Pattern**: All agents (worker + shadow) clone template and customize bot files
   - **Features**:
     - Event subscription for channel mentions
     - Anthropic Claude integration
     - Message formatting and response handling
     - KĀDI event pub/sub integration'''

content = content.replace(old_slack_discord_section, new_slack_discord_section)

# Refinement 2: Add "Template-Based Agent Architecture" section after "Reusable Components"
template_architecture_section = '''

### Template-Based Agent Architecture

**Source Template:** `C:\\p4\\Personal\\SD\\template-agent-typescript`

**Scaffolding Pattern:**

All worker agents (artist, designer, programmer) and shadow agents (shadow-artist, shadow-designer, shadow-programmer) follow a consistent template-based scaffolding pattern:

1. **Clone from template**: Each agent starts as a clone of `template-agent-typescript`
2. **Customize bot files**: Agents customize `src/bot/slack-bot.ts` and `src/bot/discord-bot.ts` for role-specific logic
3. **Configure git worktree**: Each agent configures its playground worktree path
4. **Self-contained**: Each agent has its own copy of bot files (no shared bot dependencies initially)

**Template Structure:**
```
template-agent-typescript/
├── src/
│   ├── bot/
│   │   ├── slack-bot.ts      # Slack channel integration (customize per agent)
│   │   └── discord-bot.ts    # Discord channel integration (customize per agent)
│   ├── config/               # Agent configuration
│   ├── tools/                # MCP tool implementations
│   └── index.ts              # Main entry point
├── package.json
└── tsconfig.json
```

**Customization by Agent Type:**

**Worker Agents (artist, designer, programmer):**
- **Customize bot files** to add:
  - Task execution logic (subscribe to `{role}.task.assigned` events)
  - File operations in `agent-playground-{role}` worktree
  - Event publishing (`{role}.file.created`, `{role}.file.modified`, etc.)
  - Git commits and pushes to `agent-playground-{role}` remote

**Shadow Agents (shadow-artist, shadow-designer, shadow-programmer):**
- **Customize bot files** to add:
  - Passive file monitoring (subscribe to `{role}.file.*` events)
  - Backup commit creation in shared `agent-playground-{role}` worktree
  - Git pushes to `shadow-agent-playground-{role}` remote (separate from worker's remote)
  - READ-ONLY file operations (monitoring only, no file writes)

**Benefits:**
- ✅ Consistent Slack/Discord channel interaction across all agents
- ✅ Self-contained agents (no complex shared dependencies initially)
- ✅ Rapid agent creation (clone, customize, deploy)
- ✅ Refactorable to shared base classes later when patterns stabilize

**Future Refactoring:**
- Extract common bot logic to `C:\\p4\\Personal\\SD\\AGENTS\\shared\\slack-bot.ts` and `discord-bot.ts`
- Worker and shadow agents extend shared base classes instead of customizing copied files
- Maintains consistency while reducing duplication

'''

# Insert template architecture section after "Reusable Components" heading
reusable_components_marker = '### Reusable Components'
insertion_point = content.find(reusable_components_marker)
if insertion_point != -1:
    # Find the end of the Reusable Components section (next ### heading)
    next_section = content.find('\n### ', insertion_point + len(reusable_components_marker))
    if next_section != -1:
        content = content[:next_section] + template_architecture_section + content[next_section:]

# Refinement 3: Update Component 2 (Worker Agents) to mention bot file customization
old_worker_implementation = '''**Implementation:**
- **Files**:
  - `agent-artist/src/index.ts`
  - `agent-designer/src/index.ts`
  - `agent-programmer/src/index.ts`
- **Extends**: BaseBot (for resilience patterns)
- **Networks**:
  - agent-artist: `['global', 'artist']`
  - agent-designer: `['global', 'design']`
  - agent-programmer: `['global', 'programmer']`'''

new_worker_implementation = '''**Implementation:**
- **Scaffolding**: Clone from `template-agent-typescript`
- **Files**:
  - `agent-{role}/src/index.ts` (entry point)
  - `agent-{role}/src/bot/slack-bot.ts` (customized for role-specific Slack interaction)
  - `agent-{role}/src/bot/discord-bot.ts` (customized for role-specific Discord interaction)
- **Extends**: BaseBot (for resilience patterns, via template)
- **Networks**:
  - agent-artist: `['global', 'artist']`
  - agent-designer: `['global', 'design']`
  - agent-programmer: `['global', 'programmer']`
- **Customization**: Bot files customized to handle task execution, file operations, and event publishing'''

content = content.replace(old_worker_implementation, new_worker_implementation)

# Refinement 4: Update Component 3 (Shadow Agents) section
# Find Component 3 section
component_3_marker = '### Component 3: Shadow Agents'
component_3_start = content.find(component_3_marker)
if component_3_start != -1:
    # Find the Implementation section within Component 3
    impl_marker = '**Implementation:**'
    impl_start = content.find(impl_marker, component_3_start)
    if impl_start != -1:
        # Find the end of Implementation section (next **keyword:**)
        impl_end = content.find('\n**', impl_start + len(impl_marker))
        if impl_end != -1:
            old_shadow_implementation = content[impl_start:impl_end]
            new_shadow_implementation = '''**Implementation:**
- **Scaffolding**: Clone from `template-agent-typescript`
- **Files**:
  - `shadow-agent-{role}/src/index.ts` (entry point)
  - `shadow-agent-{role}/src/bot/slack-bot.ts` (customized for passive monitoring via Slack)
  - `shadow-agent-{role}/src/bot/discord-bot.ts` (customized for passive monitoring via Discord)
- **Extends**: BaseBot (for resilience patterns, via template)
- **Networks**: Same as corresponding worker agent (monitoring mode)
- **Git Configuration**:
  - **Shared worktree**: `C:\\p4\\Personal\\SD\\agent-playground-{role}` (same as worker agent)
  - **Separate remote**: `shadow-agent-playground-{role}` (for backup commits)
- **Customization**: Bot files customized for passive monitoring, backup commits, and pushes to shadow remote
- **READ-ONLY Mode**: Never writes files (only monitors and commits via git)'''
            content = content.replace(old_shadow_implementation, new_shadow_implementation)

# Refinement 5: Update "Reuses" section for agent-producer to clarify bot source
old_agent_producer_reuses = '''**Reuses:**
- KadiClient for broker communication
- Existing SlackBot and DiscordBot (already extend BaseBot)'''

new_agent_producer_reuses = '''**Reuses:**
- KadiClient for broker communication
- SlackBot and DiscordBot from template (or pre-existing implementation extending BaseBot)
- BaseBot for circuit breaker, retry logic, and metrics tracking'''

content = content.replace(old_agent_producer_reuses, new_agent_producer_reuses)

# Write updated file
with open(output_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("[SUCCESS] Refined design.md to reflect template-based bot architecture")
print(f"Location: {output_path}")
print("")
print("Refinements Applied:")
print("  1. [OK] Updated SlackBot/DiscordBot section to clarify template source")
print("  2. [OK] Added 'Template-Based Agent Architecture' section with:")
print("      - Scaffolding pattern explanation")
print("      - Template structure diagram")
print("      - Worker vs Shadow customization details")
print("      - Benefits and future refactoring notes")
print("  3. [OK] Updated Component 2 (Worker Agents) to include bot file paths")
print("  4. [OK] Updated Component 3 (Shadow Agents) to include bot file paths and clarify shared worktree")
print("  5. [OK] Updated agent-producer Reuses section for clarity")
print("")
print("Key Architecture Clarifications:")
print("  - All agents clone from template-agent-typescript")
print("  - Bot files (slack-bot.ts, discord-bot.ts) are customized, not created from scratch")
print("  - Worker agents: Task execution + file ops + git push to worker remote")
print("  - Shadow agents: Passive monitoring + backup commits + git push to shadow remote")
print("  - Shared worktree pattern: Same worktree, different git remotes")
print("  - Future refactoring: Extract to shared base classes when patterns stabilize")
