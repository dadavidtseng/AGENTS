"""
mcp-server-blender MCP Server

Exposes headless Blender operations as MCP tools using FastMCP.
Communicates with Blender process via TCP socket (same pattern as blender-mcp).
"""

import json
import os
import socket
import logging
from mcp.server.fastmcp import FastMCP
from typing import Optional, List

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("mcp-server-blender")

SOCKET_HOST = "127.0.0.1"
SOCKET_PORT = 9876

MCP_PORT = int(os.getenv("MCP_PORT", "3800"))

mcp = FastMCP("mcp-server-blender", host="0.0.0.0", port=MCP_PORT)

# ============================================================================
# Blender Socket Communication
# ============================================================================

def send_command(command: str, params: dict, timeout: float = 60.0) -> dict:
    """Send a JSON command to the Blender addon socket server and return the result."""
    logger.info("send_command: %s params=%s", command, json.dumps(params, default=str)[:200])
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((SOCKET_HOST, SOCKET_PORT))
    except (ConnectionRefusedError, socket.timeout, OSError) as e:
        logger.error("send_command: connect failed: %s", e)
        return {"success": False, "error": f"Blender not reachable: {e}"}

    try:
        message = json.dumps({"command": command, "params": params})
        sock.sendall(message.encode("utf-8"))

        chunks = []
        while True:
            chunk = sock.recv(8192)
            if not chunk:
                break
            chunks.append(chunk)
            try:
                return json.loads(b"".join(chunks).decode("utf-8"))
            except json.JSONDecodeError:
                continue

        if chunks:
            return json.loads(b"".join(chunks).decode("utf-8"))
        return {"success": False, "error": "No response from Blender"}
    except socket.timeout:
        return {"success": False, "error": f"Blender command timed out after {timeout}s"}
    except json.JSONDecodeError as e:
        return {"success": False, "error": f"Invalid response from Blender: {e}"}
    finally:
        sock.close()

# ============================================================================
# Tools
# ============================================================================

@mcp.tool()
def blender_create_object(
    type: str,
    name: Optional[str] = None,
    location: List[float] = [0, 0, 0],
    scale: List[float] = [1, 1, 1],
    rotation: List[float] = [0, 0, 0],
) -> str:
    """Create a 3D mesh primitive (cube, sphere, cylinder, plane, cone, torus) in the Blender scene."""
    result = send_command("create_object", {
        "type": type, "name": name, "location": location, "scale": scale, "rotation": rotation,
    })
    return json.dumps(result)

@mcp.tool()
def blender_modify_object(
    name: str,
    location: Optional[List[float]] = None,
    scale: Optional[List[float]] = None,
    rotation: Optional[List[float]] = None,
    modifier: Optional[str] = None,
    modifier_params: Optional[dict] = None,
) -> str:
    """Modify an existing object's transform or add modifiers (subdivision, solidify, mirror, bevel)."""
    result = send_command("modify_object", {
        "name": name, "location": location, "scale": scale, "rotation": rotation,
        "modifier": modifier, "modifier_params": modifier_params,
    })
    return json.dumps(result)

@mcp.tool()
def blender_set_material(
    object_name: str,
    material_name: Optional[str] = None,
    color: List[float] = [0.8, 0.8, 0.8, 1.0],
    roughness: float = 0.5,
    metallic: float = 0.0,
) -> str:
    """Create or assign a PBR material with color, roughness, and metallic properties."""
    result = send_command("set_material", {
        "object_name": object_name, "material_name": material_name,
        "color": color, "roughness": roughness, "metallic": metallic,
    })
    return json.dumps(result)

@mcp.tool()
def blender_render(
    output_path: Optional[str] = None,
    resolution_x: int = 1920,
    resolution_y: int = 1080,
    samples: int = 128,
    engine: str = "CYCLES",
) -> str:
    """Render the current scene to an image file (PNG). CYCLES (CPU) is recommended for headless servers. EEVEE auto-falls back to CYCLES without GPU."""
    result = send_command("render", {
        "output_path": output_path, "resolution_x": resolution_x,
        "resolution_y": resolution_y, "samples": samples, "engine": engine,
    })
    return json.dumps(result)

@mcp.tool()
def blender_export(
    format: str,
    output_path: Optional[str] = None,
    selected_only: bool = False,
) -> str:
    """Export the scene to glTF, FBX, OBJ, or STL format."""
    result = send_command("export", {
        "format": format, "output_path": output_path, "selected_only": selected_only,
    })
    return json.dumps(result)

@mcp.tool()
def blender_execute_python(code: str) -> str:
    """Execute arbitrary Python/bpy code inside the Blender process."""
    result = send_command("execute_python", {"code": code})
    return json.dumps(result)

@mcp.tool()
def blender_get_scene_info() -> str:
    """Get complete scene info: all objects with type, position, materials, cameras, and lights."""
    result = send_command("get_scene_info", {})
    return json.dumps(result)

# ============================================================================
# Entry point
# ============================================================================

_manager = None

def main():
    import asyncio
    from .blender_manager import BlenderManager

    global _manager
    _manager = BlenderManager()

    async def _start_blender():
        ok = await _manager.start_with_monitor()
        if ok:
            logger.info("Blender manager ready — starting MCP server (7 tools)")
        else:
            logger.warning("Blender not available — tools will return errors until Blender connects")

    # Start Blender manager in background, then run MCP server
    loop = asyncio.new_event_loop()
    loop.run_until_complete(_start_blender())

    # Run as Streamable HTTP so broker can connect via http type, or stdio for local use
    # Supports both MCP_TRANSPORT and MCP_TRANSPORT_TYPE env vars for compatibility
    transport = os.getenv("MCP_TRANSPORT_TYPE", os.getenv("MCP_TRANSPORT", "stdio"))

    if transport == "http":
        transport = "streamable-http"

    if transport == "streamable-http":
        logger.info("MCP server listening on http://0.0.0.0:%d/mcp", MCP_PORT)
    mcp.run(transport=transport)

if __name__ == "__main__":
    main()
