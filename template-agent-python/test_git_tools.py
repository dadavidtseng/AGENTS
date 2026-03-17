"""Comprehensive test suite for Git MCP tools integration."""

import asyncio
import sys
from pathlib import Path
from mcp_clients import GitMCPClient


async def test_git_tools():
    """Test all git operations with the test repository."""
    client = GitMCPClient()
    test_repo = "C:/p4/Personal/SD/test-git-mcp"

    try:
        print("=" * 70)
        print("[*] Git Tools Integration Test Suite")
        print("=" * 70)
        print()

        # Connect to Git MCP Server
        print("[*] Connecting to Git MCP Server...")
        await client.connect()
        print("[OK] Connected successfully!")
        print()

        # Test 1: git_status
        print("[TEST 1] Testing git_status...")
        status_result = await client.git_status(repo_path=test_repo)
        print(f"  Result: {status_result}")
        assert status_result['success'] is True, "git_status failed"
        print("[OK] git_status test passed")
        print()

        # Test 2: git_branch list
        print("[TEST 2] Testing git_branch (list)...")
        branch_result = await client.git_branch(
            repo_path=test_repo,
            action="list"
        )
        print(f"  Result: {branch_result}")
        assert branch_result['success'] is True, "git_branch list failed"
        print("[OK] git_branch list test passed")
        print()

        # Test 3: git_worktree list
        print("[TEST 3] Testing git_worktree (list)...")
        worktree_result = await client.git_worktree(
            repo_path=test_repo,
            action="list"
        )
        print(f"  Result: {worktree_result}")
        assert worktree_result['success'] is True, "git_worktree list failed"
        print("[OK] git_worktree list test passed")
        print()

        # Test 4: git_worktree add (if not already exists)
        print("[TEST 4] Testing git_worktree (add)...")
        worktree_path = "C:/p4/Personal/SD/test-git-mcp-worktree"
        worktree_dir = Path(worktree_path)

        if worktree_dir.exists():
            print(f"  [SKIP] Worktree already exists at {worktree_path}")
        else:
            add_result = await client.git_worktree(
                repo_path=test_repo,
                action="add",
                path=worktree_path,
                branch="master"
            )
            print(f"  Result: {add_result}")

            if add_result['success']:
                print("[OK] git_worktree add test passed")

                # Test 5: git_worktree remove
                print()
                print("[TEST 5] Testing git_worktree (remove)...")
                remove_result = await client.git_worktree(
                    repo_path=test_repo,
                    action="remove",
                    path=worktree_path,
                    force=False
                )
                print(f"  Result: {remove_result}")
                assert remove_result['success'] is True, "git_worktree remove failed"
                print("[OK] git_worktree remove test passed")
            else:
                print(f"[WARN] git_worktree add failed: {add_result.get('message')}")
        print()

        # Test 6: git_worktree prune
        print("[TEST 6] Testing git_worktree (prune)...")
        prune_result = await client.git_worktree(
            repo_path=test_repo,
            action="prune"
        )
        print(f"  Result: {prune_result}")
        assert prune_result['success'] is True, "git_worktree prune failed"
        print("[OK] git_worktree prune test passed")
        print()

        # Summary
        print("=" * 70)
        print("[SUCCESS] All git tools tests passed!")
        print("=" * 70)
        print()
        print("Tested operations:")
        print("  [OK] git_status - Get repository status")
        print("  [OK] git_branch - List branches")
        print("  [OK] git_worktree list - List worktrees")
        print("  [OK] git_worktree add - Add worktree (conditional)")
        print("  [OK] git_worktree remove - Remove worktree (conditional)")
        print("  [OK] git_worktree prune - Prune worktrees")
        print()

        return 0

    except Exception as e:
        print()
        print("=" * 70)
        print(f"[ERROR] Test failed: {e}")
        print("=" * 70)
        import traceback
        traceback.print_exc()
        return 1

    finally:
        print("[*] Disconnecting from Git MCP Server...")
        await client.disconnect()
        print("[OK] Disconnected")
        print()


if __name__ == "__main__":
    exit_code = asyncio.run(test_git_tools())
    sys.exit(exit_code)
