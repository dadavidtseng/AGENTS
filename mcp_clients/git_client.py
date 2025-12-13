"""
Git MCP Client Wrapper

Connects to @cyanheads/git-mcp-server via STDIO transport
and provides typed methods for git operations.
"""

import asyncio
from typing import Any, Dict, Optional, List
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


class GitMCPClient:
    """Client wrapper for Git MCP Server operations."""

    def __init__(self, server_command: str = "npx"):
        """
        Initialize Git MCP Client.

        Args:
            server_command: Command to start MCP server (default: npx)
        """
        self.server_command = server_command
        self.server_args = ["@cyanheads/git-mcp-server@latest"]
        self.session: Optional[ClientSession] = None
        self._read_stream = None
        self._write_stream = None
        self._streams_context = None
        self._connected = False

    async def connect(self) -> None:
        """Establish connection to Git MCP Server."""
        if self._connected:
            return

        server_params = StdioServerParameters(
            command=self.server_command,
            args=self.server_args,
            env=None  # Inherit environment
        )

        # Create stdio transport (async context manager)
        streams_context = stdio_client(server_params)
        read_stream, write_stream = await streams_context.__aenter__()
        self._read_stream = read_stream
        self._write_stream = write_stream
        self._streams_context = streams_context

        # Create and initialize session
        self.session = ClientSession(read_stream, write_stream)
        await self.session.__aenter__()

        # Initialize the session
        await self.session.initialize()
        self._connected = True

    async def disconnect(self) -> None:
        """Close connection to Git MCP Server."""
        if not self._connected:
            return

        if self.session:
            try:
                await self.session.__aexit__(None, None, None)
            except Exception:
                pass  # Ignore cleanup errors
            self.session = None

        if self._streams_context:
            try:
                await self._streams_context.__aexit__(None, None, None)
            except Exception:
                pass  # Ignore cleanup errors
            self._streams_context = None

        self._read_stream = None
        self._write_stream = None
        self._connected = False

    async def call_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Call a tool on the Git MCP Server.

        Args:
            tool_name: Name of the MCP tool (e.g., "git_status")
            arguments: Tool arguments as dictionary

        Returns:
            Tool execution result

        Raises:
            RuntimeError: If not connected or tool call fails
        """
        if not self._connected or not self.session:
            raise RuntimeError("Not connected to Git MCP Server. Call connect() first.")

        try:
            result = await self.session.call_tool(tool_name, arguments)
            # Extract content from result
            if hasattr(result, 'content') and result.content:
                # Return first content item if it has text
                if len(result.content) > 0:
                    content_item = result.content[0]
                    if hasattr(content_item, 'text'):
                        # Try to parse as JSON if possible
                        import json
                        try:
                            return json.loads(content_item.text)
                        except (json.JSONDecodeError, AttributeError):
                            return {"result": content_item.text}
            # Fallback to model dump
            return result.model_dump() if hasattr(result, 'model_dump') else {"result": str(result)}
        except Exception as e:
            raise RuntimeError(f"Tool call failed: {str(e)}") from e

    # Convenience methods for specific git operations

    async def git_status(self, repo_path: str) -> Dict[str, Any]:
        """Get repository status."""
        return await self.call_tool("git_status", {"path": repo_path})

    async def git_branch(
        self,
        repo_path: str,
        action: str = "list",
        branch_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """Manage branches."""
        args = {"path": repo_path, "action": action}
        if branch_name:
            args["branch_name"] = branch_name
        return await self.call_tool("git_branch", args)

    async def git_checkout(
        self,
        repo_path: str,
        branch: str,
        create: bool = False
    ) -> Dict[str, Any]:
        """Checkout a branch."""
        args = {"path": repo_path, "branch": branch}
        if create:
            args["create_branch"] = create
        return await self.call_tool("git_checkout", args)

    async def git_add(
        self,
        repo_path: str,
        files: List[str]
    ) -> Dict[str, Any]:
        """Stage files for commit."""
        return await self.call_tool("git_add", {
            "path": repo_path,
            "files": files
        })

    async def git_commit(
        self,
        repo_path: str,
        message: str
    ) -> Dict[str, Any]:
        """Create a commit."""
        return await self.call_tool("git_commit", {
            "path": repo_path,
            "message": message
        })

    async def git_push(
        self,
        repo_path: str,
        remote: str = "origin",
        branch: Optional[str] = None,
        force: bool = False
    ) -> Dict[str, Any]:
        """Push commits to remote."""
        args = {"path": repo_path, "remote": remote}
        if branch:
            args["branch"] = branch
        if force:
            args["force"] = force
        return await self.call_tool("git_push", args)

    async def git_pull(
        self,
        repo_path: str,
        remote: str = "origin",
        branch: Optional[str] = None
    ) -> Dict[str, Any]:
        """Pull commits from remote."""
        args = {"path": repo_path, "remote": remote}
        if branch:
            args["branch"] = branch
        return await self.call_tool("git_pull", args)

    async def git_worktree(
        self,
        repo_path: str,
        action: str,
        path: Optional[str] = None,
        branch: Optional[str] = None,
        force: bool = False
    ) -> Dict[str, Any]:
        """
        Manage git worktrees.

        Args:
            repo_path: Path to main repository
            action: Action to perform (add, list, remove, prune)
            path: Path for worktree (required for add/remove)
            branch: Branch name (for add action)
            force: Force operation (for remove action)

        Returns:
            Operation result
        """
        args = {"path": repo_path, "action": action}
        if path:
            args["worktree_path"] = path
        if branch:
            args["branch"] = branch
        if force:
            args["force"] = force
        return await self.call_tool("git_worktree", args)
