/**
 * quest_workflow_guide MCP Tool
 * Provides comprehensive quest workflow documentation
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'fs/promises';
import { join } from 'path';

/**
 * Tool definition for MCP protocol
 */
export const questWorkflowGuideTool: Tool = {
  name: 'quest_workflow_guide',
  description: `Get comprehensive quest workflow documentation.

**Purpose:**
- Understand complete quest workflow
- Learn best practices
- View workflow diagrams
- Access dashboard information
- Troubleshoot common issues

**Returns:**
- Complete workflow documentation in markdown format
- Mermaid diagrams for visualization
- Best practices and examples
- Dashboard URL and features
- Troubleshooting guide

**Usage:**
- Call when starting a new quest
- Reference when unsure about workflow
- Share with new team members
- Review best practices

**No parameters required** - returns full documentation`,
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

/**
 * Handle quest_workflow_guide tool call
 */
export async function handleQuestWorkflowGuide() {
  try {
    // Load workflow guide from markdown file
    const guidePath = join(process.cwd(), 'docs', 'workflow-guide.md');
    const guideContent = await readFile(guidePath, 'utf-8');

    // Return formatted guide
    return {
      content: [
        {
          type: 'text',
          text: guideContent,
        },
      ],
    };
  } catch (error) {
    // Fallback if file not found
    const fallbackGuide = `# Quest Workflow Guide

## Quick Start

1. **Create Quest**: Use \`quest_create_quest\` with requirements and design
2. **Request Approval**: Use \`quest_request_quest_approval\`
3. **Split Tasks**: Use \`quest_split_task\` after approval
4. **Assign Tasks**: Use \`quest_assign_task\` to agents
5. **Execute**: Agents update status with \`quest_update_task\`
6. **Verify**: Use \`quest_verify_task\` to confirm completion
7. **Complete**: Quest automatically completes when all tasks done

## Workflow Sequence

\`\`\`
Draft → Pending Approval → Approved → In Progress → Completed
\`\`\`

## Key Tools

- **Creation**: quest_create_quest
- **Approval**: quest_request_quest_approval, quest_submit_approval
- **Tasks**: quest_split_task, quest_assign_task, quest_update_task
- **Verification**: quest_verify_task, quest_log_implementation
- **Monitoring**: quest_query_quest, quest_list_agents

## Dashboard

Access the dashboard at: **http://localhost:3001**

Features:
- Real-time quest status
- Task progress tracking
- Agent availability
- Approval workflow
- WebSocket updates

## Best Practices

✅ Write detailed requirements
✅ Use tools for all approvals (no verbal approvals)
✅ Keep tasks atomic (1-2 days of work)
✅ Update status regularly
✅ Send agent heartbeats every 30 seconds
✅ Document implementation decisions

## Common Issues

**Quest stuck in pending approval?**
- Check \`quest_query_approval\`
- Verify approvers are notified

**Task dependencies blocking progress?**
- Review dependency graph
- Check if dependencies are completed

**Agent not receiving tasks?**
- Verify agent is registered: \`quest_list_agents\`
- Check agent status (available vs busy)

## Support

For detailed documentation, ensure the workflow guide file exists at:
\`docs/workflow-guide.md\`

Error loading guide: ${error instanceof Error ? error.message : 'Unknown error'}
`;

    return {
      content: [
        {
          type: 'text',
          text: fallbackGuide,
        },
      ],
    };
  }
}
