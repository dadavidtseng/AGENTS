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
from typing import List, Optional
import statistics


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

    # Subscribe to all data events (await required for async API)
    await client.subscribe_to_event('data.analysis', on_data_analysis)
    await client.subscribe_to_event('data.error', on_error)
    await client.subscribe_to_event('agent.connected', on_agent_connected)

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
        print("  - calculate_mean(numbers) - Arithmetic mean")
        print("  - calculate_median(numbers) - Median value")
        print("  - calculate_std_dev(numbers) - Standard deviation")
        print("  - find_min_max(numbers) - Min, max, and range")
        print("  - calculate_sum(numbers) - Sum of values")
        print()
        print("Subscribed to Events:")
        print("  - data.analysis - All data analysis events")
        print("  - data.error - All error events")
        print("  - agent.connected - Agent connection events")
        print()
        print("Press Ctrl+C to stop the agent...")
        print("=" * 60)

        # Publish connection event
        await client.publish_event('agent.connected', {
            'name': 'data-processor-python',
            'networks': networks,
            'tools': ['calculate_mean', 'calculate_median', 'calculate_std_dev', 'find_min_max', 'calculate_sum'],
            'timestamp': asyncio.get_event_loop().time()
        })

        # Serve indefinitely (blocks until interrupted)
        await client.serve('broker')

    except Exception as e:
        print(f"[ERROR] Agent failed to start: {e}")
        raise


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
