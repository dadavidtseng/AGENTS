"""Test MCP client connection to git-mcp-server."""

import asyncio
import sys
from mcp_clients import GitMCPClient


async def test_connection():
    """Test basic MCP connection and git_status call."""
    client = GitMCPClient()

    try:
        print("[*] Connecting to Git MCP Server...")
        await client.connect()
        print("[OK] Connected successfully!")

        # Test git_status on test repository
        repo_path = "C:/p4/Personal/SD/test-git-mcp"
        print(f"[*] Testing git_status on {repo_path}...")

        result = await client.git_status(repo_path)
        print(f"[OK] Git status result:")
        print(f"     {result}")

        # Test git_branch list
        print(f"[*] Testing git_branch list...")
        branch_result = await client.git_branch(repo_path, action="list")
        print(f"[OK] Branch list result:")
        print(f"     {branch_result}")

        print("\n[SUCCESS] All tests passed!")
        return 0

    except Exception as e:
        print(f"[ERROR] Test failed: {e}")
        import traceback
        traceback.print_exc()
        return 1

    finally:
        print("[*] Disconnecting...")
        await client.disconnect()
        print("[OK] Disconnected")


if __name__ == "__main__":
    exit_code = asyncio.run(test_connection())
    sys.exit(exit_code)
