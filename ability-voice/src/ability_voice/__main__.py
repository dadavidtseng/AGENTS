"""ability-voice entry point."""

import asyncio
import os
from dotenv import load_dotenv

# Load .env BEFORE importing the package (which reads env vars at module level)
load_dotenv()

from . import client

async def main():
    mode = os.getenv("KADI_MODE", "stdio")
    print(f"[ability-voice] Starting in {mode} mode...")
    print(f"[ability-voice] 8 tools registered")
    await client.serve(mode)

asyncio.run(main())
