/**
 * Assign Task Tool Implementation
 *
 * Assigns tasks to worker agents (artist, designer, programmer) by validating
 * task existence and publishing KĀDI events for worker agent consumption.
 */

import type {KadiClient} from '@kadi.build/core';
import {z} from 'zod';
import {invokeShrimTool, publishToolEvent} from 'agents-library';

// ============================================================================
// Types
// ============================================================================

export const assignTaskInputSchema = z.object({
    taskId: z.string().describe('Task ID to assign'),
    role: z.enum(['artist', 'designer', 'programmer']).optional().describe('Worker role to assign to (auto-detected if not provided)')
});

export const assignTaskOutputSchema = z.object({
    taskId: z.string(),
    role: z.string(),
    message: z.string(),
    status: z.literal('assigned')
});

export type AssignTaskInput = z.infer<typeof assignTaskInputSchema>;
export type AssignTaskOutput = z.infer<typeof assignTaskOutputSchema>;

// ============================================================================
// Assign Task Handler
// ============================================================================

export async function createAssignTaskHandler(
    client: KadiClient
): Promise<(params: AssignTaskInput) => Promise<AssignTaskOutput>> {
    return async (params: AssignTaskInput): Promise<AssignTaskOutput> => {
        console.log(`🎯 Assigning task: ${params.taskId}`);

        try {
            // Step 1: Validate task exists via get_task_status using agents-library
            const protocol = client.getBrokerProtocol();
            const taskStatusResult = await invokeShrimTool(protocol, 'get_task_status', {taskId: params.taskId}, {client});

            if (!taskStatusResult.success) {
                throw new Error(taskStatusResult.error?.message || 'Failed to get task status');
            }

            const taskStatus: any = taskStatusResult.data;

            // Step 2: Determine worker role
            let role = params.role;
            if (!role) {
                // Try to get role from task metadata
                role = taskStatus.role;

                if (!role) {
                    // Fallback: keyword detection in description
                    const desc = taskStatus.description.toLowerCase();
                    if (/design|ui|ux|mockup/.test(desc)) {
                        role = 'designer';
                    } else if (/art|visual|graphics/.test(desc)) {
                        role = 'artist';
                    } else if (/code|implement|program|dev/.test(desc)) {
                        role = 'programmer';
                    } else {
                        // Final fallback: default to programmer for generic tasks
                        role = 'programmer';
                        console.log(`⚠️  No role detected, defaulting to 'programmer' for generic task`);
                    }
                }
            }

            // Step 3: Validate task status (prevent assigning completed tasks)
            if (taskStatus.status === 'completed') {
                throw new Error(`Task ${params.taskId} is already completed`);
            }

            // Step 3.5: Execute task to set status to IN_PROGRESS
            const executeResult = await invokeShrimTool(protocol, 'shrimp_execute_task', {taskId: params.taskId}, {client});

            if (!executeResult.success) {
                throw new Error(executeResult.error?.message || 'Failed to execute task');
            }

            console.log(`✅ Task ${params.taskId} status set to IN_PROGRESS`);

            // Step 4: Publish KĀDI event to 'utility' network so worker agents can receive it
            // Use broker protocol with explicit networkId to route to the correct network
            const brokerProtocol = client.getBrokerProtocol();
            await brokerProtocol.publishEvent({
                channel: `${role}.task.assigned`,
                data: {
                    taskId: params.taskId,
                    role,
                    description: taskStatus.description,
                    requirements: '', // Required field (empty string if no requirements)
                    timestamp: new Date().toISOString() // Must be 'timestamp', not 'assignedAt'
                },
                networkId: 'utility' // Explicitly publish to 'utility' network for worker agents
            });
            console.log(`📤 Published ${role}.task.assigned event to 'utility' network for task ${params.taskId}`);

            // Step 5: Return success response
            return {
                taskId: params.taskId,
                role,
                message: `Task assigned to ${role} agent`,
                status: 'assigned'
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`❌ Failed to assign task: ${errorMsg}`);

            // Publish failure event using publishToolEvent from agents-library
            await publishToolEvent(client, 'failed',
                {error: errorMsg, taskId: params.taskId},
                {toolName: 'assign_task', taskId: params.taskId}
            );

            throw new Error(`Failed to assign task: ${errorMsg}`);
        }
    };
}
