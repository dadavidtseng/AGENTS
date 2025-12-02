#!/usr/bin/env python3
"""
Apply corrections to design.md based on approval feedback
Uses absolute Windows paths to avoid file modification bugs
"""

input_path = r'C:\p4\Personal\SD\AGENTS\.spec-workflow\specs\simple-multi-agents-orchestration\design.md'
output_path = r'C:\p4\Personal\SD\AGENTS\.spec-workflow\specs\simple-multi-agents-orchestration\design.md'

# Read current file
with open(input_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Correction 1: Update project structure to show correct hierarchy
old_structure = '''**Expected Structure:**
```
AGENTS/
├── agent-producer/          # Orchestrator agent
├── agent-artist/            # Worker agent (art/design)
├── agent-designer/          # Worker agent (documentation)
├── agent-programmer/        # Worker agent (code)
├── shadow-agent-artist/     # Shadow monitor for artist
├── shadow-agent-designer/   # Shadow monitor for designer
├── shadow-agent-programmer/ # Shadow monitor for programmer
└── shared/                  # Shared utilities (BaseBot)
```'''

new_structure = '''**Expected Structure:**
```
C:\\p4\\Personal\\SD\\
├── AGENTS/                  # Submodules only (not real projects)
├── agent-producer/          # Real project - Orchestrator agent
├── agent-artist/            # Real project - Worker agent (art/design)
├── agent-designer/          # Real project - Worker agent (documentation)
├── agent-programmer/        # Real project - Worker agent (code)
├── shadow-agent-artist/     # Real project - Shadow monitor for artist
├── shadow-agent-designer/   # Real project - Shadow monitor for designer
├── shadow-agent-programmer/ # Real project - Shadow monitor for programmer
└── shared/                  # Real project - Shared utilities (BaseBot)
```

**Important:** The AGENTS/ directory contains git submodules pointing to the actual projects. All real development happens in the sibling directories at the same hierarchy level.'''

content = content.replace(old_structure, new_structure)

# Correction 2: Update all "Shadow Repo" references to explicit names
# Find and replace all instances

# Update shadow repository configuration section
old_shadow_config = '''**Shadow Repository Configuration:**
```
shadow-agent-artist:
  - Local: C:\\\\p4\\\\Personal\\\\SD\\\\agent-playground-artist (shares with worker)
  - Remote: github.com/user/project-shadow-artist

shadow-agent-designer:
  - Local: C:\\\\p4\\\\Personal\\\\SD\\\\agent-playground-designer (shares with worker)
  - Remote: github.com/user/project-shadow-designer

shadow-agent-programmer:
  - Local: C:\\\\p4\\\\Personal\\\\SD\\\\agent-playground-programmer (shares with worker)
  - Remote: github.com/user/project-shadow-programmer
```'''

new_shadow_config = '''**Shadow Repository Configuration:**

Each shadow agent monitors its corresponding worker agent and commits/pushes to a dedicated remote repository:

**shadow-agent-artist:**
  - Local worktree: `C:\\\\p4\\\\Personal\\\\SD\\\\agent-playground-artist` (shared with agent-artist)
  - Remote repository: `github.com/user/shadow-agent-artist`
  - Purpose: Track all file operations from agent-artist for rollback capability

**shadow-agent-designer:**
  - Local worktree: `C:\\\\p4\\\\Personal\\\\SD\\\\agent-playground-designer` (shared with agent-designer)
  - Remote repository: `github.com/user/shadow-agent-designer`
  - Purpose: Track all file operations from agent-designer for rollback capability

**shadow-agent-programmer:**
  - Local worktree: `C:\\\\p4\\\\Personal\\\\SD\\\\agent-playground-programmer` (shared with agent-programmer)
  - Remote repository: `github.com/user/shadow-agent-programmer`
  - Purpose: Track all file operations from agent-programmer for rollback capability'''

content = content.replace(old_shadow_config, new_shadow_config)

# Update git remote repositories section
old_git_remotes = '''**Git Remote Repositories:**
- **Main repo**: agent-producer pushes after user approval
- **Shadow repos**: 3 separate repositories (one per shadow agent)
  - `github.com/user/project-shadow-artist`
  - `github.com/user/project-shadow-designer`
  - `github.com/user/project-shadow-programmer`'''

new_git_remotes = '''**Git Remote Repositories:**
- **Main repo**: agent-producer pushes after user approval
  - `github.com/user/agent-playground` (or your actual main project repo)
- **Shadow agent repositories** (3 separate repos, one per shadow agent):
  - **shadow-agent-artist**: `github.com/user/shadow-agent-artist`
  - **shadow-agent-designer**: `github.com/user/shadow-agent-designer`
  - **shadow-agent-programmer**: `github.com/user/shadow-agent-programmer`'''

content = content.replace(old_git_remotes, new_git_remotes)

# Add clarification about repository structure in Implementation Notes
implementation_notes_addition = '''

### Repository Architecture Clarification

**Directory Structure:**
- **C:\\\\p4\\\\Personal\\\\SD\\\\AGENTS\\\\**: Git submodules only (points to actual project repos)
- **C:\\\\p4\\\\Personal\\\\SD\\\\{project-name}\\\\**: Actual project repositories

**Example:**
```
AGENTS/agent-producer  → submodule pointing to C:\\\\p4\\\\Personal\\\\SD\\\\agent-producer
AGENTS/shadow-agent-artist → submodule pointing to C:\\\\p4\\\\Personal\\\\SD\\\\shadow-agent-artist
```

**Why this structure:**
- Centralizes all agent projects in AGENTS/ for easy discovery
- Keeps actual development in separate git repositories
- Allows independent version control for each agent
- Simplifies CI/CD and deployment pipelines

'''

# Insert before "### Git Worktree Paths" section
git_worktree_marker = '### Git Worktree Paths'
insertion_point = content.find(git_worktree_marker)
if insertion_point != -1:
    content = content[:insertion_point] + implementation_notes_addition + content[insertion_point:]

# Write updated file
with open(output_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("[SUCCESS] Applied design corrections")
print(f"Location: {output_path}")
print("")
print("Corrections Applied:")
print("  1. [OK] Project structure updated - real projects at same hierarchy as AGENTS/")
print("  2. [OK] Shadow repository names explicitly specified:")
print("      - shadow-agent-artist")
print("      - shadow-agent-designer")
print("      - shadow-agent-programmer")
print("  3. [OK] Added repository architecture clarification")
