"""
Data Processing KĀDI Agent in Python
=====================================

This agent provides data processing and statistical analysis tools
for ProtogameJS3D using the KĀDI protocol.

Features:
- Ed25519 cryptographic authentication
- Pydantic schema validation
- Statistical analysis tools (mean, median, std_dev)
- Data transformation capabilities
- Event pub/sub system
- WebSocket communication with KĀDI broker

Dependencies:
- kadi: KĀDI protocol client library
- pydantic: Schema validation and serialization
- websockets: WebSocket client library

Usage:
    python agent.py

Environment Variables:
    KADI_BROKER_URL: WebSocket URL for KĀDI broker (default: ws://localhost:8080)
    KADI_NETWORK: Network to join (default: global,data)
"""

import asyncio
import os
from kadi import KadiClient
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import statistics
from mcp_clients import GitMCPClient


# ============================================================================
# Tool Schemas (Pydantic Models)
# ============================================================================

class StatisticsInput(BaseModel):
    """Input schema for statistical operations."""
    numbers: List[float] = Field(..., description="List of numbers to analyze")


class MeanOutput(BaseModel):
    """Output schema for mean calculation."""
    result: float = Field(..., description="Arithmetic mean of the numbers")
    count: int = Field(..., description="Number of values analyzed")


class MedianOutput(BaseModel):
    """Output schema for median calculation."""
    result: float = Field(..., description="Median value of the numbers")
    count: int = Field(..., description="Number of values analyzed")


class StdDevOutput(BaseModel):
    """Output schema for standard deviation calculation."""
    result: float = Field(..., description="Standard deviation of the numbers")
    count: int = Field(..., description="Number of values analyzed")
    error: Optional[str] = Field(None, description="Error message if calculation fails")


class MinMaxOutput(BaseModel):
    """Output schema for min/max operations."""
    min: float = Field(..., description="Minimum value")
    max: float = Field(..., description="Maximum value")
    range: float = Field(..., description="Range (max - min)")


class SumOutput(BaseModel):
    """Output schema for sum operation."""
    result: float = Field(..., description="Sum of all numbers")
    count: int = Field(..., description="Number of values summed")


# ============================================================================
# Git Tool Schemas (Pydantic Models)
# ============================================================================

class GitWorktreeAddInput(BaseModel):
    """Input schema for git worktree add operation."""
    repo_path: str = Field(..., description="Path to the main repository")
    worktree_path: str = Field(..., description="Path where the new worktree will be created")
    branch: Optional[str] = Field(None, description="Branch name for the worktree")


class GitWorktreeListInput(BaseModel):
    """Input schema for git worktree list operation."""
    repo_path: str = Field(..., description="Path to the main repository")


class GitWorktreeRemoveInput(BaseModel):
    """Input schema for git worktree remove operation."""
    repo_path: str = Field(..., description="Path to the main repository")
    worktree_path: str = Field(..., description="Path to the worktree to remove")
    force: bool = Field(False, description="Force removal even if worktree is dirty")


class GitWorktreePruneInput(BaseModel):
    """Input schema for git worktree prune operation."""
    repo_path: str = Field(..., description="Path to the main repository")


class GitPushInput(BaseModel):
    """Input schema for git push operation."""
    repo_path: str = Field(..., description="Path to the repository")
    remote: str = Field("origin", description="Remote name to push to")
    branch: Optional[str] = Field(None, description="Branch to push (current branch if not specified)")
    force: bool = Field(False, description="Force push")


class GitStatusInput(BaseModel):
    """Input schema for git status operation."""
    repo_path: str = Field(..., description="Path to the repository")


class GitBranchInput(BaseModel):
    """Input schema for git branch operation."""
    repo_path: str = Field(..., description="Path to the repository")
    action: str = Field("list", description="Action to perform: list, create, delete")
    branch_name: Optional[str] = Field(None, description="Branch name (for create/delete actions)")


class GitCommitInput(BaseModel):
    """Input schema for git commit operation."""
    repo_path: str = Field(..., description="Path to the repository")
    message: str = Field(..., description="Commit message")


class GitOperationOutput(BaseModel):
    """Generic output schema for git operations."""
    success: bool = Field(..., description="Whether the operation succeeded")
    message: Optional[str] = Field(None, description="Status or error message")
    data: Optional[Dict[str, Any]] = Field(None, description="Operation result data")


# ============================================================================
# Data Processing Agent
# ============================================================================

async def main():
    """Main entry point for data processing agent."""

    # Get configuration from environment
    broker_url = os.getenv('KADI_BROKER_URL', 'ws://localhost:8080')
    networks = os.getenv('KADI_NETWORK', 'global,data').split(',')

    # Create KĀDI Client
    client = KadiClient({
        'name': 'data-processor',
        'version': '1.0.0',
        'role': 'agent',
        'broker': broker_url,
        'networks': networks
    })

    # Create and connect Git MCP Client
    git_client = GitMCPClient()
    print("[*] Connecting to Git MCP Server...")
    await git_client.connect()
    print("[OK] Git MCP Server connected")

    # ========================================================================
    # Register Tools Using Decorator Pattern
    # ========================================================================

    @client.tool(description="Calculate arithmetic mean (average) of numbers")
    async def calculate_mean(params: StatisticsInput) -> MeanOutput:
        """
        Calculate the arithmetic mean of a list of numbers.

        Args:
            params: StatisticsInput with numbers field

        Returns:
            MeanOutput with result and count fields

        Events Published:
            data.analysis: Details of the mean calculation
        """
        result = statistics.mean(params.numbers)
        count = len(params.numbers)

        print(f"[DATA] Mean: {result:.4f} (from {count} values)")

        # Publish event when calculation completes
        await client.publish_event('data.analysis', {
            'operation': 'mean',
            'result': result,
            'count': count,
            'agent': 'data-processor-python'
        })

        return MeanOutput(result=result, count=count)

    @client.tool(description="Calculate median value of numbers")
    async def calculate_median(params: StatisticsInput) -> MedianOutput:
        """
        Calculate the median of a list of numbers.

        Args:
            params: StatisticsInput with numbers field

        Returns:
            MedianOutput with result and count fields

        Events Published:
            data.analysis: Details of the median calculation
        """
        result = statistics.median(params.numbers)
        count = len(params.numbers)

        print(f"[DATA] Median: {result:.4f} (from {count} values)")

        await client.publish_event('data.analysis', {
            'operation': 'median',
            'result': result,
            'count': count,
            'agent': 'data-processor-python'
        })

        return MedianOutput(result=result, count=count)

    @client.tool(description="Calculate standard deviation of numbers")
    async def calculate_std_dev(params: StatisticsInput) -> StdDevOutput:
        """
        Calculate the standard deviation of a list of numbers.

        Args:
            params: StatisticsInput with numbers field

        Returns:
            StdDevOutput with result, count, and optional error field

        Events Published:
            data.analysis: Details of the std_dev calculation
            data.error: Error details if insufficient data
        """
        # Check for minimum data requirement
        if len(params.numbers) < 2:
            error_msg = "Standard deviation requires at least 2 values"
            print(f"[ERROR] Std Dev error: {error_msg}")

            await client.publish_event('data.error', {
                'operation': 'std_dev',
                'error': error_msg,
                'count': len(params.numbers),
                'agent': 'data-processor-python'
            })

            return StdDevOutput(result=0.0, count=len(params.numbers), error=error_msg)

        result = statistics.stdev(params.numbers)
        count = len(params.numbers)

        print(f"[DATA] Std Dev: {result:.4f} (from {count} values)")

        await client.publish_event('data.analysis', {
            'operation': 'std_dev',
            'result': result,
            'count': count,
            'agent': 'data-processor-python'
        })

        return StdDevOutput(result=result, count=count, error=None)

    @client.tool(description="Find minimum, maximum, and range of numbers")
    async def find_min_max(params: StatisticsInput) -> MinMaxOutput:
        """
        Find the minimum, maximum, and range of a list of numbers.

        Args:
            params: StatisticsInput with numbers field

        Returns:
            MinMaxOutput with min, max, and range fields

        Events Published:
            data.analysis: Details of the min/max analysis
        """
        min_val = min(params.numbers)
        max_val = max(params.numbers)
        range_val = max_val - min_val

        print(f"[DATA] Min/Max: {min_val:.4f} / {max_val:.4f} (range: {range_val:.4f})")

        await client.publish_event('data.analysis', {
            'operation': 'min_max',
            'min': min_val,
            'max': max_val,
            'range': range_val,
            'agent': 'data-processor-python'
        })

        return MinMaxOutput(min=min_val, max=max_val, range=range_val)

    @client.tool(description="Calculate sum of all numbers")
    async def calculate_sum(params: StatisticsInput) -> SumOutput:
        """
        Calculate the sum of a list of numbers.

        Args:
            params: StatisticsInput with numbers field

        Returns:
            SumOutput with result and count fields

        Events Published:
            data.analysis: Details of the sum calculation
        """
        result = sum(params.numbers)
        count = len(params.numbers)

        print(f"[DATA] Sum: {result:.4f} (from {count} values)")

        await client.publish_event('data.analysis', {
            'operation': 'sum',
            'result': result,
            'count': count,
            'agent': 'data-processor-python'
        })

        return SumOutput(result=result, count=count)

    # ========================================================================
    # Git Tools (Using MCP Client)
    # ========================================================================

    @client.tool(description="Add a new git worktree to a repository")
    async def git_worktree_add(params: GitWorktreeAddInput) -> GitOperationOutput:
        """
        Add a new git worktree to a repository.

        Args:
            params: GitWorktreeAddInput with repo_path, worktree_path, and optional branch

        Returns:
            GitOperationOutput with operation result

        Events Published:
            git.worktree: Details of the worktree operation
        """
        try:
            result = await git_client.git_worktree(
                repo_path=params.repo_path,
                action="add",
                path=params.worktree_path,
                branch=params.branch
            )

            success = result.get('success', False)
            message = result.get('message', 'Worktree added successfully')

            print(f"[OK] Git worktree add: {params.worktree_path}")

            await client.publish_event('git.worktree', {
                'operation': 'add',
                'repo_path': params.repo_path,
                'worktree_path': params.worktree_path,
                'branch': params.branch,
                'success': success,
                'agent': 'data-processor-python'
            })

            return GitOperationOutput(success=success, message=message, data=result)

        except Exception as e:
            error_msg = f"Failed to add worktree: {str(e)}"
            print(f"[ERROR] {error_msg}")

            await client.publish_event('git.error', {
                'operation': 'worktree_add',
                'error': error_msg,
                'repo_path': params.repo_path,
                'agent': 'data-processor-python'
            })

            return GitOperationOutput(success=False, message=error_msg, data=None)

    @client.tool(description="List all git worktrees in a repository")
    async def git_worktree_list(params: GitWorktreeListInput) -> GitOperationOutput:
        """
        List all git worktrees in a repository.

        Args:
            params: GitWorktreeListInput with repo_path

        Returns:
            GitOperationOutput with list of worktrees

        Events Published:
            git.worktree: Details of the worktree operation
        """
        try:
            result = await git_client.git_worktree(
                repo_path=params.repo_path,
                action="list"
            )

            success = result.get('success', False)
            worktrees = result.get('worktrees', [])

            print(f"[OK] Git worktree list: Found {len(worktrees)} worktree(s)")

            await client.publish_event('git.worktree', {
                'operation': 'list',
                'repo_path': params.repo_path,
                'count': len(worktrees),
                'success': success,
                'agent': 'data-processor-python'
            })

            return GitOperationOutput(success=success, message=f"Found {len(worktrees)} worktree(s)", data=result)

        except Exception as e:
            error_msg = f"Failed to list worktrees: {str(e)}"
            print(f"[ERROR] {error_msg}")

            await client.publish_event('git.error', {
                'operation': 'worktree_list',
                'error': error_msg,
                'repo_path': params.repo_path,
                'agent': 'data-processor-python'
            })

            return GitOperationOutput(success=False, message=error_msg, data=None)

    @client.tool(description="Remove a git worktree from a repository")
    async def git_worktree_remove(params: GitWorktreeRemoveInput) -> GitOperationOutput:
        """
        Remove a git worktree from a repository.

        Args:
            params: GitWorktreeRemoveInput with repo_path, worktree_path, and force flag

        Returns:
            GitOperationOutput with operation result

        Events Published:
            git.worktree: Details of the worktree operation
        """
        try:
            result = await git_client.git_worktree(
                repo_path=params.repo_path,
                action="remove",
                path=params.worktree_path,
                force=params.force
            )

            success = result.get('success', False)
            message = result.get('message', 'Worktree removed successfully')

            print(f"[OK] Git worktree remove: {params.worktree_path}")

            await client.publish_event('git.worktree', {
                'operation': 'remove',
                'repo_path': params.repo_path,
                'worktree_path': params.worktree_path,
                'force': params.force,
                'success': success,
                'agent': 'data-processor-python'
            })

            return GitOperationOutput(success=success, message=message, data=result)

        except Exception as e:
            error_msg = f"Failed to remove worktree: {str(e)}"
            print(f"[ERROR] {error_msg}")

            await client.publish_event('git.error', {
                'operation': 'worktree_remove',
                'error': error_msg,
                'repo_path': params.repo_path,
                'agent': 'data-processor-python'
            })

            return GitOperationOutput(success=False, message=error_msg, data=None)

    @client.tool(description="Prune stale git worktree administrative files")
    async def git_worktree_prune(params: GitWorktreePruneInput) -> GitOperationOutput:
        """
        Prune stale git worktree administrative files.

        Args:
            params: GitWorktreePruneInput with repo_path

        Returns:
            GitOperationOutput with operation result

        Events Published:
            git.worktree: Details of the worktree operation
        """
        try:
            result = await git_client.git_worktree(
                repo_path=params.repo_path,
                action="prune"
            )

            success = result.get('success', False)
            message = result.get('message', 'Worktrees pruned successfully')

            print(f"[OK] Git worktree prune: {params.repo_path}")

            await client.publish_event('git.worktree', {
                'operation': 'prune',
                'repo_path': params.repo_path,
                'success': success,
                'agent': 'data-processor-python'
            })

            return GitOperationOutput(success=success, message=message, data=result)

        except Exception as e:
            error_msg = f"Failed to prune worktrees: {str(e)}"
            print(f"[ERROR] {error_msg}")

            await client.publish_event('git.error', {
                'operation': 'worktree_prune',
                'error': error_msg,
                'repo_path': params.repo_path,
                'agent': 'data-processor-python'
            })

            return GitOperationOutput(success=False, message=error_msg, data=None)

    @client.tool(description="Push commits to a remote git repository")
    async def git_push(params: GitPushInput) -> GitOperationOutput:
        """
        Push commits to a remote git repository.

        Args:
            params: GitPushInput with repo_path, remote, branch, and force flag

        Returns:
            GitOperationOutput with operation result

        Events Published:
            git.push: Details of the push operation
        """
        try:
            result = await git_client.git_push(
                repo_path=params.repo_path,
                remote=params.remote,
                branch=params.branch,
                force=params.force
            )

            success = result.get('success', False)
            message = result.get('message', 'Push completed successfully')

            print(f"[OK] Git push: {params.repo_path} -> {params.remote}/{params.branch or 'current'}")

            await client.publish_event('git.push', {
                'operation': 'push',
                'repo_path': params.repo_path,
                'remote': params.remote,
                'branch': params.branch,
                'force': params.force,
                'success': success,
                'agent': 'data-processor-python'
            })

            return GitOperationOutput(success=success, message=message, data=result)

        except Exception as e:
            error_msg = f"Failed to push: {str(e)}"
            print(f"[ERROR] {error_msg}")

            await client.publish_event('git.error', {
                'operation': 'push',
                'error': error_msg,
                'repo_path': params.repo_path,
                'agent': 'data-processor-python'
            })

            return GitOperationOutput(success=False, message=error_msg, data=None)

    @client.tool(description="Get the status of a git repository")
    async def git_status(params: GitStatusInput) -> GitOperationOutput:
        """
        Get the status of a git repository.

        Args:
            params: GitStatusInput with repo_path

        Returns:
            GitOperationOutput with repository status

        Events Published:
            git.status: Details of the status check
        """
        try:
            result = await git_client.git_status(repo_path=params.repo_path)

            success = result.get('success', False)
            is_clean = result.get('isClean', True)
            current_branch = result.get('currentBranch', 'unknown')

            status_msg = f"Branch: {current_branch}, Clean: {is_clean}"
            print(f"[OK] Git status: {status_msg}")

            await client.publish_event('git.status', {
                'operation': 'status',
                'repo_path': params.repo_path,
                'current_branch': current_branch,
                'is_clean': is_clean,
                'success': success,
                'agent': 'data-processor-python'
            })

            return GitOperationOutput(success=success, message=status_msg, data=result)

        except Exception as e:
            error_msg = f"Failed to get status: {str(e)}"
            print(f"[ERROR] {error_msg}")

            await client.publish_event('git.error', {
                'operation': 'status',
                'error': error_msg,
                'repo_path': params.repo_path,
                'agent': 'data-processor-python'
            })

            return GitOperationOutput(success=False, message=error_msg, data=None)

    @client.tool(description="List or manage git branches in a repository")
    async def git_branch(params: GitBranchInput) -> GitOperationOutput:
        """
        List or manage git branches in a repository.

        Args:
            params: GitBranchInput with repo_path, action, and optional branch_name

        Returns:
            GitOperationOutput with branch information

        Events Published:
            git.branch: Details of the branch operation
        """
        try:
            result = await git_client.git_branch(
                repo_path=params.repo_path,
                action=params.action,
                branch_name=params.branch_name
            )

            success = result.get('success', False)
            branches = result.get('branches', [])
            current_branch = result.get('currentBranch', 'unknown')

            message = f"Action: {params.action}, Current: {current_branch}"
            print(f"[OK] Git branch: {message}")

            await client.publish_event('git.branch', {
                'operation': params.action,
                'repo_path': params.repo_path,
                'current_branch': current_branch,
                'branch_count': len(branches),
                'success': success,
                'agent': 'data-processor-python'
            })

            return GitOperationOutput(success=success, message=message, data=result)

        except Exception as e:
            error_msg = f"Failed to manage branches: {str(e)}"
            print(f"[ERROR] {error_msg}")

            await client.publish_event('git.error', {
                'operation': 'branch',
                'error': error_msg,
                'repo_path': params.repo_path,
                'agent': 'data-processor-python'
            })

            return GitOperationOutput(success=False, message=error_msg, data=None)

    @client.tool(description="Create a git commit with staged changes")
    async def git_commit(params: GitCommitInput) -> GitOperationOutput:
        """
        Create a git commit with staged changes.

        Args:
            params: GitCommitInput with repo_path and message

        Returns:
            GitOperationOutput with commit result

        Events Published:
            git.commit: Details of the commit operation
        """
        try:
            result = await git_client.git_commit(
                repo_path=params.repo_path,
                message=params.message
            )

            success = result.get('success', False)
            commit_hash = result.get('commitHash', 'unknown')

            message = f"Commit created: {commit_hash[:8]}"
            print(f"[OK] Git commit: {message}")

            await client.publish_event('git.commit', {
                'operation': 'commit',
                'repo_path': params.repo_path,
                'commit_hash': commit_hash,
                'message': params.message,
                'success': success,
                'agent': 'data-processor-python'
            })

            return GitOperationOutput(success=success, message=message, data=result)

        except Exception as e:
            error_msg = f"Failed to commit: {str(e)}"
            print(f"[ERROR] {error_msg}")

            await client.publish_event('git.error', {
                'operation': 'commit',
                'error': error_msg,
                'repo_path': params.repo_path,
                'agent': 'data-processor-python'
            })

            return GitOperationOutput(success=False, message=error_msg, data=None)

    # ========================================================================
    # Event Subscriptions
    # ========================================================================

    def on_data_analysis(event_data):
        """Handle data analysis events from any agent (including self)."""
        agent = event_data.get('agent', 'unknown')
        operation = event_data.get('operation', 'unknown')
        result = event_data.get('result', 'N/A')

        print(f"[EVENT] [{agent}] Data analysis event: {operation} = {result}")

    def on_error(event_data):
        """Handle error events from any agent."""
        agent = event_data.get('agent', 'unknown')
        operation = event_data.get('operation', 'unknown')
        error = event_data.get('error', 'Unknown error')

        print(f"[WARN] [{agent}] Error in {operation}: {error}")

    def on_agent_connected(event_data):
        """Handle agent connection events."""
        agent_name = event_data.get('name', 'unknown')
        networks = event_data.get('networks', [])

        print(f"[INFO] Agent connected: {agent_name} on networks: {', '.join(networks)}")

    def on_git_event(event_data):
        """Handle git operation events."""
        operation = event_data.get('operation', 'unknown')
        repo_path = event_data.get('repo_path', 'unknown')
        success = event_data.get('success', False)

        status = "OK" if success else "FAILED"
        print(f"[EVENT] Git {operation}: {repo_path} [{status}]")

    # Subscribe to all data events (await required for async API)
    await client.subscribe_to_event('data.analysis', on_data_analysis)
    await client.subscribe_to_event('data.error', on_error)
    await client.subscribe_to_event('agent.connected', on_agent_connected)

    # Subscribe to git events
    await client.subscribe_to_event('git.worktree', on_git_event)
    await client.subscribe_to_event('git.push', on_git_event)
    await client.subscribe_to_event('git.status', on_git_event)
    await client.subscribe_to_event('git.branch', on_git_event)
    await client.subscribe_to_event('git.commit', on_git_event)
    await client.subscribe_to_event('git.error', on_error)

    # ========================================================================
    # Connect and Serve
    # ========================================================================

    print("=" * 60)
    print("[*] Starting Python Data Processing Agent for ProtogameJS3D")
    print("=" * 60)
    print(f"Broker URL: {broker_url}")
    print(f"Networks: {', '.join(networks)}")
    print()

    try:
        # Connect to broker and register agent
        agent_id = await client.connect()

        print(f"[OK] Connected successfully!")
        print(f"Agent ID: {agent_id}")
        print()
        print("Available Tools:")
        print("  [Statistics]")
        print("    - calculate_mean(numbers) - Arithmetic mean")
        print("    - calculate_median(numbers) - Median value")
        print("    - calculate_std_dev(numbers) - Standard deviation")
        print("    - find_min_max(numbers) - Min, max, and range")
        print("    - calculate_sum(numbers) - Sum of values")
        print()
        print("  [Git Operations]")
        print("    - git_worktree_add(repo_path, worktree_path, branch?) - Add worktree")
        print("    - git_worktree_list(repo_path) - List worktrees")
        print("    - git_worktree_remove(repo_path, worktree_path, force?) - Remove worktree")
        print("    - git_worktree_prune(repo_path) - Prune worktrees")
        print("    - git_push(repo_path, remote?, branch?, force?) - Push to remote")
        print("    - git_status(repo_path) - Get repository status")
        print("    - git_branch(repo_path, action?, branch_name?) - Manage branches")
        print("    - git_commit(repo_path, message) - Create commit")
        print()
        print("Subscribed to Events:")
        print("  - data.analysis - All data analysis events")
        print("  - data.error - All error events")
        print("  - agent.connected - Agent connection events")
        print("  - git.* - All git operation events")
        print()
        print("Press Ctrl+C to stop the agent...")
        print("=" * 60)

        # Publish connection event
        await client.publish_event('agent.connected', {
            'name': 'data-processor-python',
            'networks': networks,
            'tools': [
                # Statistics tools
                'calculate_mean', 'calculate_median', 'calculate_std_dev', 'find_min_max', 'calculate_sum',
                # Git tools
                'git_worktree_add', 'git_worktree_list', 'git_worktree_remove', 'git_worktree_prune',
                'git_push', 'git_status', 'git_branch', 'git_commit'
            ],
            'timestamp': asyncio.get_event_loop().time()
        })

        # Serve indefinitely (blocks until interrupted)
        await client.serve('broker')

    except Exception as e:
        print(f"[ERROR] Agent failed to start: {e}")
        raise

    finally:
        # Cleanup: Disconnect from Git MCP Server
        print("[*] Disconnecting from Git MCP Server...")
        await git_client.disconnect()
        print("[OK] Git MCP Server disconnected")


# ============================================================================
# Entry Point
# ============================================================================

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print()
        print("=" * 60)
        print("[*] Shutting down Python Data Processing Agent...")
        print("=" * 60)
    except Exception as e:
        print(f"[FATAL] Fatal error: {e}")
        import traceback
        traceback.print_exc()
