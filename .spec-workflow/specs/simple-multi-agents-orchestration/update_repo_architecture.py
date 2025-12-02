#!/usr/bin/env python3
"""
Update design.md with improved repository architecture pattern
Separates agent code repos from playground (work product) repos
Uses absolute Windows paths to avoid file modification bugs
"""

input_path = r'C:\p4\Personal\SD\AGENTS\.spec-workflow\specs\simple-multi-agents-orchestration\design.md'
output_path = r'C:\p4\Personal\SD\AGENTS\.spec-workflow\specs\simple-multi-agents-orchestration\design.md'

# Read current file
with open(input_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Update 1: Rename shadow remote repos to shadow-agent-playground-{role}
content = content.replace(
    'github.com/user/shadow-agent-artist',
    'github.com/user/shadow-agent-playground-artist'
)
content = content.replace(
    'github.com/user/shadow-agent-designer',
    'github.com/user/shadow-agent-playground-designer'
)
content = content.replace(
    'github.com/user/shadow-agent-programmer',
    'github.com/user/shadow-agent-playground-programmer'
)

# Update 2: Add repository architecture explanation section
old_shadow_config = '''**Shadow Repository Configuration:**

Each shadow agent monitors its corresponding worker agent and commits/pushes to a dedicated remote repository:

**shadow-agent-artist:**
  - Local worktree: `C:\\\\p4\\\\Personal\\\\SD\\\\agent-playground-artist` (shared with agent-artist)
  - Remote repository: `github.com/user/shadow-agent-playground-artist`
  - Purpose: Track all file operations from agent-artist for rollback capability

**shadow-agent-designer:**
  - Local worktree: `C:\\\\p4\\\\Personal\\\\SD\\\\agent-playground-designer` (shared with agent-designer)
  - Remote repository: `github.com/user/shadow-agent-playground-designer`
  - Purpose: Track all file operations from agent-designer for rollback capability

**shadow-agent-programmer:**
  - Local worktree: `C:\\\\p4\\\\Personal\\\\SD\\\\agent-playground-programmer` (shared with agent-programmer)
  - Remote repository: `github.com/user/shadow-agent-playground-programmer`
  - Purpose: Track all file operations from agent-programmer for rollback capability'''

new_shadow_config = '''**Repository Architecture Pattern:**

The system uses a clear separation between **agent code repositories** (TypeScript implementations) and **playground repositories** (work product artifacts):

**Agent Code Repositories** (TypeScript projects):
- `agent-artist` - Artist agent implementation
- `agent-designer` - Designer agent implementation
- `agent-programmer` - Programmer agent implementation
- `shadow-agent-artist` - Shadow monitor for artist
- `shadow-agent-designer` - Shadow monitor for designer
- `shadow-agent-programmer` - Shadow monitor for programmer

**Playground Repositories** (Work artifacts):
- `agent-playground-artist` - Work produced by agent-artist (main)
- `agent-playground-designer` - Work produced by agent-designer (main)
- `agent-playground-programmer` - Work produced by agent-programmer (main)
- `shadow-agent-playground-artist` - Backup copy for rollback (shadow)
- `shadow-agent-playground-designer` - Backup copy for rollback (shadow)
- `shadow-agent-playground-programmer` - Backup copy for rollback (shadow)

**Shadow Repository Configuration:**

Each shadow agent monitors its corresponding worker agent and commits/pushes to a dedicated shadow playground repository:

**shadow-agent-artist:**
  - **Agent Code**: `C:\\\\p4\\\\Personal\\\\SD\\\\shadow-agent-artist` (TypeScript project)
  - **Monitors Worktree**: `C:\\\\p4\\\\Personal\\\\SD\\\\agent-playground-artist` (READ-ONLY monitoring)
  - **Pushes Backups To**: `github.com/user/shadow-agent-playground-artist`
  - **Purpose**: Continuous backup of agent-artist's work for rollback capability

**shadow-agent-designer:**
  - **Agent Code**: `C:\\\\p4\\\\Personal\\\\SD\\\\shadow-agent-designer` (TypeScript project)
  - **Monitors Worktree**: `C:\\\\p4\\\\Personal\\\\SD\\\\agent-playground-designer` (READ-ONLY monitoring)
  - **Pushes Backups To**: `github.com/user/shadow-agent-playground-designer`
  - **Purpose**: Continuous backup of agent-designer's work for rollback capability

**shadow-agent-programmer:**
  - **Agent Code**: `C:\\\\p4\\\\Personal\\\\SD\\\\shadow-agent-programmer` (TypeScript project)
  - **Monitors Worktree**: `C:\\\\p4\\\\Personal\\\\SD\\\\agent-playground-programmer` (READ-ONLY monitoring)
  - **Pushes Backups To**: `github.com/user/shadow-agent-playground-programmer`
  - **Purpose**: Continuous backup of agent-programmer's work for rollback capability'''

content = content.replace(old_shadow_config, new_shadow_config)

# Update 3: Clarify git remote repositories section
old_git_remotes = '''**Git Remote Repositories:**
- **Main repo**: agent-producer pushes after user approval
  - `github.com/user/agent-playground` (or your actual main project repo)
- **Shadow agent repositories** (3 separate repos, one per shadow agent):
  - **shadow-agent-artist**: `github.com/user/shadow-agent-playground-artist`
  - **shadow-agent-designer**: `github.com/user/shadow-agent-playground-designer`
  - **shadow-agent-programmer**: `github.com/user/shadow-agent-playground-programmer`'''

new_git_remotes = '''**Git Remote Repositories:**

**Agent Code Repositories** (TypeScript implementations):
- `github.com/user/agent-producer` - Orchestrator agent code
- `github.com/user/agent-artist` - Artist agent code
- `github.com/user/agent-designer` - Designer agent code
- `github.com/user/agent-programmer` - Programmer agent code
- `github.com/user/shadow-agent-artist` - Shadow artist agent code
- `github.com/user/shadow-agent-designer` - Shadow designer agent code
- `github.com/user/shadow-agent-programmer` - Shadow programmer agent code

**Playground Repositories** (Work artifacts):

**Main Playground** (agent-producer pushes after user approval):
- `github.com/user/agent-playground` - Base playground directory merged work

**Worker Playgrounds** (worker agents push their work):
- `github.com/user/agent-playground-artist` - Artist's work artifacts
- `github.com/user/agent-playground-designer` - Designer's work artifacts
- `github.com/user/agent-playground-programmer` - Programmer's work artifacts

**Shadow Playgrounds** (shadow agents push backups for rollback):
- `github.com/user/shadow-agent-playground-artist` - Artist work backup
- `github.com/user/shadow-agent-playground-designer` - Designer work backup
- `github.com/user/shadow-agent-playground-programmer` - Programmer work backup'''

content = content.replace(old_git_remotes, new_git_remotes)

# Update 4: Add workflow diagram showing the pattern
workflow_diagram = '''

### Repository Workflow Pattern

**For each worker agent (using artist as example):**

```
┌─────────────────────────────────────────────────────────────────┐
│ Agent Code Repositories (TypeScript Projects)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  agent-artist/                 shadow-agent-artist/            │
│  ├── src/                      ├── src/                        │
│  ├── package.json              ├── package.json                │
│  └── tsconfig.json             └── tsconfig.json               │
│        │                              │                         │
│        │ executes in                  │ monitors (READ-ONLY)   │
│        ↓                              ↓                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Local Worktree (Git Working Directory)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  C:\\p4\\Personal\\SD\\agent-playground-artist/                  │
│  ├── src/                      ← agent-artist writes here      │
│  ├── assets/                   ← shadow-agent-artist reads     │
│  └── README.md                                                  │
│        │                              │                         │
│        │ pushes to                    │ pushes to              │
│        ↓                              ↓                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Remote Repositories (GitHub/GitLab/etc)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  agent-playground-artist       shadow-agent-playground-artist  │
│  (main work)                   (backup for rollback)           │
│  github.com/user/              github.com/user/                │
│  agent-playground-artist       shadow-agent-playground-artist  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key Points:**
- **Agent code** and **work product** are in separate repositories
- Worker agents write; shadow agents read (passive monitoring)
- Shadow agents push every file operation to separate remote for rollback
- Main playground repos contain official work; shadow repos are backups
'''

# Insert workflow diagram after Shadow Repository Configuration
shadow_config_end = content.find('**shadow-agent-programmer:**\n  - **Agent Code**:')
if shadow_config_end != -1:
    # Find the end of this section (next ### heading)
    next_section = content.find('\n### ', shadow_config_end + 100)
    if next_section != -1:
        content = content[:next_section] + workflow_diagram + content[next_section:]

# Write updated file
with open(output_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("[SUCCESS] Updated design.md with improved repository architecture")
print(f"Location: {output_path}")
print("")
print("Architectural Improvements:")
print("  1. [OK] Separated agent code repos from playground repos")
print("  2. [OK] Renamed shadow remotes to shadow-agent-playground-{role}")
print("  3. [OK] Added Repository Architecture Pattern section")
print("  4. [OK] Clarified agent code vs work product distinction")
print("  5. [OK] Added workflow diagram showing the complete pattern")
print("")
print("Repository Pattern:")
print("  - Agent Code: agent-{role}, shadow-agent-{role}")
print("  - Work Product: agent-playground-{role}, shadow-agent-playground-{role}")
