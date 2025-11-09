@echo off
REM Wrapper script to launch Git MCP server with explicit PATH
REM This ensures git.exe is findable by the MCP server

REM CRITICAL FIX: Use absolute paths instead of %PATH% expansion
REM %PATH% may be empty when spawned from Node.js with custom env
REM We explicitly set the full PATH needed for Git and npx

REM Build complete PATH with Git, System32, and Node.js
set "PATH=C:\Program Files\Git\cmd;C:\Program Files\Git\mingw64\bin;C:\Windows\system32;C:\Windows;C:\Program Files\nodejs"

REM Set root directory for git-mcp-server to prevent path traversal errors
set "GIT_MCP_ROOT_DIR=C:\p4\Personal\SD"

REM Launch git-mcp-server with environment
npx @cyanheads/git-mcp-server@latest
