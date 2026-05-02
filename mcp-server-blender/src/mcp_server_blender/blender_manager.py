"""
BlenderManager — launch, monitor, and auto-restart headless Blender.

Starts Blender with: blender --background --python bootstrap.py
Monitors health via socket heartbeat ping every N seconds.
Auto-restarts within 5s on crash (up to max attempts).
"""

import asyncio
import json
import logging
import os
import signal
import socket
import subprocess
import sys
from pathlib import Path

logger = logging.getLogger("blender-manager")

BOOTSTRAP_PATH = str(Path(__file__).parent / "bootstrap.py")


class BlenderManager:
    def __init__(
        self,
        executable: str = "blender",
        socket_host: str = "127.0.0.1",
        socket_port: int = 9876,
        heartbeat_interval: float = 5.0,
        restart_delay: float = 3.0,
        max_restart_attempts: int = 5,
    ):
        self.executable = executable
        self.socket_host = socket_host
        self.socket_port = socket_port
        self.heartbeat_interval = heartbeat_interval
        self.restart_delay = restart_delay
        self.max_restart_attempts = max_restart_attempts

        self._process: subprocess.Popen | None = None
        self._restart_count = 0
        self._running = False
        self._monitor_task: asyncio.Task | None = None

    @property
    def is_running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def launch(self) -> bool:
        """Launch headless Blender with the bootstrap socket server."""
        if self.is_running:
            logger.info("Blender already running (PID %d)", self._process.pid)
            return True

        cmd = [
            self.executable,
            "--background",
            "--python", BOOTSTRAP_PATH,
        ]

        env = os.environ.copy()
        env["BLENDER_SOCKET_HOST"] = self.socket_host
        env["BLENDER_SOCKET_PORT"] = str(self.socket_port)

        try:
            logger.info("Launching: %s", " ".join(cmd))
            self._process = subprocess.Popen(
                cmd,
                stdout=None,
                stderr=None,
                env=env,
            )
            logger.info("Blender launched (PID %d)", self._process.pid)
            return True
        except FileNotFoundError:
            logger.error("Blender executable not found: %s", self.executable)
            return False
        except Exception as e:
            logger.error("Failed to launch Blender: %s", e)
            return False

    def stop(self):
        """Stop the Blender process."""
        if self._process:
            logger.info("Stopping Blender (PID %d)", self._process.pid)
            try:
                self._process.terminate()
                try:
                    self._process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    logger.warning("Blender didn't terminate, killing...")
                    self._process.kill()
                    self._process.wait(timeout=3)
            except Exception as e:
                logger.error("Error stopping Blender: %s", e)
            finally:
                self._process = None
        self._running = False
        if self._monitor_task:
            self._monitor_task.cancel()
            self._monitor_task = None

    def heartbeat(self, timeout: float = 3.0) -> bool:
        """Ping Blender via socket heartbeat. Returns True if alive."""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            sock.connect((self.socket_host, self.socket_port))
            msg = json.dumps({"command": "heartbeat", "params": {}})
            sock.sendall(msg.encode("utf-8"))
            data = sock.recv(4096)
            sock.close()
            result = json.loads(data.decode("utf-8"))
            return result.get("success", False)
        except Exception:
            return False

    async def start_with_monitor(self):
        """Launch Blender and start the health monitoring loop."""
        self._running = True
        self._restart_count = 0

        if not self.launch():
            logger.error("Initial Blender launch failed")
            return False

        # Wait for socket to be ready
        ready = await self._wait_for_socket(timeout=15.0)
        if not ready:
            logger.error("Blender socket not ready after launch")
            return False

        logger.info("Blender socket ready — starting health monitor")
        self._monitor_task = asyncio.create_task(self._monitor_loop())
        return True

    async def _wait_for_socket(self, timeout: float = 15.0) -> bool:
        """Wait for Blender's socket server to become available."""
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            if self.heartbeat(timeout=2.0):
                return True
            await asyncio.sleep(0.5)
        return False

    async def _monitor_loop(self):
        """Periodic health check — auto-restart on failure."""
        while self._running:
            await asyncio.sleep(self.heartbeat_interval)

            if not self._running:
                break

            if not self.is_running:
                logger.warning("Blender process exited (code %s)", self._process.returncode if self._process else "?")
                await self._try_restart("process exited")
                continue

            if not self.heartbeat():
                logger.warning("Blender heartbeat failed")
                await self._try_restart("heartbeat failed")

    async def _try_restart(self, reason: str):
        """Attempt to restart Blender after failure."""
        self._restart_count += 1
        if self._restart_count > self.max_restart_attempts:
            logger.error("Max restart attempts (%d) exceeded — giving up", self.max_restart_attempts)
            self._running = False
            return

        logger.info("Restarting Blender (attempt %d/%d, reason: %s)",
                     self._restart_count, self.max_restart_attempts, reason)

        self.stop()
        self._running = True  # stop() sets this to False
        await asyncio.sleep(self.restart_delay)

        if not self.launch():
            logger.error("Restart launch failed")
            return

        ready = await self._wait_for_socket(timeout=15.0)
        if ready:
            logger.info("Blender restarted successfully")
        else:
            logger.error("Blender restarted but socket not ready")
