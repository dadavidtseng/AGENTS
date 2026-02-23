"""
ability-voice — Voice Operations (TTS, STT, Wake Word)

Provides Text-to-Speech (Piper), Speech-to-Text (Whisper), and wake word
detection as KĀDI ability tools. CUDA-accelerated when available.

Environment Variables:
    KADI_BROKER_URL: WebSocket URL of the KĀDI broker
    KADI_MODE: Transport mode (native, stdio, broker)
    KADI_NETWORK: Network scope for this ability
    WHISPER_MODEL: Whisper model to use (default: tiny.en)
    PIPER_VOICE: Piper voice model (default: en_US-lessac-medium)
"""

import asyncio
import base64
import os
from typing import Optional

import numpy as np
import sounddevice as sd
from pydantic import BaseModel, Field
from kadi import KadiClient

from .stt import SpeechToText
from .tts import TextToSpeech

# ============================================================================
# Configuration
# ============================================================================

BROKER_URL = os.getenv("KADI_BROKER_URL", "ws://localhost:8080/kadi")
KADI_NETWORK = os.getenv("KADI_NETWORK", "voice")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "tiny.en")
PIPER_VOICE = os.getenv("PIPER_VOICE", "en_US-lessac-medium")
WAKE_WORD = os.getenv("KADI_WAKE_WORD", "hey katie").lower()
WAKE_WORD_ALTERNATIVES = os.getenv(
    "KADI_WAKE_WORD_ALT",
    "hey katie,hey kady,hey kv,hey kadie,hey cavy,hey cavie,hey cady,"
    "katie,kady,kv,cavy,kadie,cavie,cady,katy,catie,kavie,kati"
).lower().split(",")

MIC_SAMPLE_RATE = 16000
VAD_AGGRESSIVENESS = int(os.getenv("KADI_VAD_AGGRESSIVENESS", "2"))
SILENCE_TIMEOUT_MS = int(os.getenv("KADI_SILENCE_TIMEOUT_MS", "1500"))
MAX_RECORDING_SECONDS = int(os.getenv("KADI_MAX_RECORDING_SECONDS", "30"))

# ============================================================================
# Input Schemas
# ============================================================================

class TranscribeInput(BaseModel):
    audio_base64: str = Field(description="Base64-encoded audio data")
    sample_rate: int = Field(default=16000, ge=8000, le=48000, description="Audio sample rate in Hz")
    language: str = Field(default="en", description="Language code (e.g., 'en', 'es', 'fr')")
    format: str = Field(default="float32", description="Audio format: 'float32', 'int16', or 'wav'")

class SynthesizeInput(BaseModel):
    text: str = Field(description="Text to convert to speech", min_length=1, max_length=10000)
    voice: Optional[str] = Field(default=None, description="Voice model name")
    speed: float = Field(default=1.0, ge=0.5, le=2.0, description="Speech speed multiplier")

class TranscribeFileInput(BaseModel):
    file_path: str = Field(description="Absolute path to audio file")
    language: str = Field(default="en", description="Language code")

class ListVoicesInput(BaseModel):
    pass

class SpeakInput(BaseModel):
    text: str = Field(description="Text to speak aloud", min_length=1, max_length=10000)
    voice: Optional[str] = Field(default=None, description="Voice model name")
    speed: float = Field(default=1.0, ge=0.5, le=2.0, description="Speech speed multiplier")
    volume: float = Field(default=1.0, ge=0.0, le=1.0, description="Playback volume")
    wait: bool = Field(default=True, description="Wait for playback to complete")
    lead_in_ms: int = Field(default=150, ge=0, le=1000, description="Silence before speech (ms)")

class StartListeningInput(BaseModel):
    wake_word: Optional[str] = Field(default=None, description="Custom wake word")

class StopListeningInput(BaseModel):
    pass

class ListenerStatusInput(BaseModel):
    pass

# ============================================================================
# Engine State
# ============================================================================

stt_engine: Optional[SpeechToText] = None
tts_engine: Optional[TextToSpeech] = None
wake_word_listener = None  # WakeWordListener instance
_audio_playback_lock = asyncio.Lock()

async def get_stt() -> SpeechToText:
    global stt_engine
    if stt_engine is None:
        print(f"[STT] Loading model: {WHISPER_MODEL}")
        stt_engine = SpeechToText(model_name=WHISPER_MODEL)
        await stt_engine.load()
    return stt_engine

async def get_tts() -> TextToSpeech:
    global tts_engine
    if tts_engine is None:
        tts_engine = TextToSpeech(voice=PIPER_VOICE)
    return tts_engine

async def play_audio(
    audio_array: np.ndarray,
    sample_rate: int,
    volume: float = 1.0,
    wait: bool = True,
    lead_in_ms: int = 150,
) -> None:
    """Play audio through device speakers with lock to prevent concurrent playback."""
    async with _audio_playback_lock:
        sd.stop()
        if volume != 1.0:
            audio_array = audio_array * volume
        audio_array = np.clip(audio_array, -1.0, 1.0).astype(np.float32)
        if lead_in_ms > 0:
            silence = np.zeros(int(sample_rate * lead_in_ms / 1000), dtype=np.float32)
            audio_array = np.concatenate([silence, audio_array])
        sd.play(audio_array, sample_rate)
        if wait:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, sd.wait)

# ============================================================================
# KadiClient
# ============================================================================

client = KadiClient(
    name="ability-voice",
    version="1.0.0",
    brokers={
        "default": {
            "url": BROKER_URL,
            "networks": [KADI_NETWORK],
        }
    },
)

# ============================================================================
# Tool 1: Transcribe (STT)
# ============================================================================

@client.tool(TranscribeInput)
async def transcribe(params) -> dict:
    """Convert speech audio to text using Whisper."""
    engine = await get_stt()
    audio_bytes = base64.b64decode(params["audio_base64"])
    fmt = params.get("format", "float32")
    sample_rate = params.get("sample_rate", 16000)
    language = params.get("language", "en")

    if fmt == "float32":
        audio_array = np.frombuffer(audio_bytes, dtype=np.float32)
    elif fmt == "int16":
        audio_array = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
    elif fmt == "wav":
        import io, soundfile as sf
        audio_array, _ = sf.read(io.BytesIO(audio_bytes))
        if len(audio_array.shape) > 1:
            audio_array = audio_array.mean(axis=1)
    else:
        return {"error": f"Unsupported format: {fmt}"}

    return await engine.transcribe(
        audio_data=audio_array,
        sample_rate=sample_rate,
        language=language,
    )

# ============================================================================
# Tool 2: Synthesize (TTS)
# ============================================================================

@client.tool(SynthesizeInput)
async def synthesize(params) -> dict:
    """Convert text to speech audio using Piper TTS. Returns base64 audio."""
    engine = await get_tts()
    length_scale = 1.0 / params.get("speed", 1.0)
    result = await engine.synthesize(text=params["text"], length_scale=length_scale)
    audio_array = np.array(result["audio"], dtype=np.float32)
    audio_b64 = base64.b64encode(audio_array.tobytes()).decode("utf-8")
    return {
        "audio_base64": audio_b64,
        "sample_rate": result["sample_rate"],
        "duration_seconds": result["duration_seconds"],
        "format": "float32",
    }

# ============================================================================
# Tool 3: Transcribe File
# ============================================================================

@client.tool(TranscribeFileInput)
async def transcribe_file(params) -> dict:
    """Transcribe audio from a local file path."""
    engine = await get_stt()
    return await engine.transcribe_file(
        file_path=params["file_path"], language=params.get("language", "en")
    )

# ============================================================================
# Tool 4: List Voices
# ============================================================================

@client.tool(ListVoicesInput)
async def list_voices(params) -> dict:
    """List available Piper TTS voice models."""
    engine = await get_tts()
    voices = engine.get_available_voices()
    return {
        "voices": voices,
        "current_voice": engine.voice,
        "recommended": list(TextToSpeech.RECOMMENDED_VOICES.keys()),
    }

# ============================================================================
# Tool 5: Speak (TTS + playback)
# ============================================================================

@client.tool(SpeakInput)
async def speak(params) -> dict:
    """Synthesize text and play it on device speakers."""
    engine = await get_tts()
    speed = params.get("speed", 1.0)
    length_scale = 1.0 / speed
    result = await engine.synthesize(text=params["text"], length_scale=length_scale)
    audio_array = np.array(result["audio"], dtype=np.float32)
    volume = params.get("volume", 1.0)
    wait = params.get("wait", True)
    lead_in_ms = params.get("lead_in_ms", 150)
    await play_audio(
        audio_array=audio_array,
        sample_rate=result["sample_rate"],
        volume=volume,
        wait=wait,
        lead_in_ms=lead_in_ms,
    )
    return {
        "success": True,
        "text": params["text"],
        "duration_seconds": result["duration_seconds"],
        "sample_rate": result["sample_rate"],
        "played": True,
        "waited": wait,
    }

# ============================================================================
# Tool 6: Start Listening (wake word)
# ============================================================================

@client.tool(StartListeningInput)
async def start_listening(params) -> dict:
    """Start listening for wake word and voice commands."""
    global wake_word_listener
    from .wake_word import WakeWordListener

    word = (params.get("wake_word") or WAKE_WORD).lower().strip()
    if wake_word_listener and wake_word_listener.is_listening:
        return {"success": True, "status": "already_listening", "wake_word": wake_word_listener.wake_word}

    wake_word_listener = WakeWordListener(
        wake_word=word,
        alternatives=WAKE_WORD_ALTERNATIVES,
        vad_aggressiveness=VAD_AGGRESSIVENESS,
        silence_timeout_ms=SILENCE_TIMEOUT_MS,
        max_recording_seconds=MAX_RECORDING_SECONDS,
        stt_getter=get_stt,
        event_emitter=lambda topic, data: client.emit(topic, data),
    )
    await wake_word_listener.start()
    return {
        "success": True,
        "status": "listening",
        "wake_word": wake_word_listener.wake_word,
        "alternatives": wake_word_listener.alternatives,
    }

# ============================================================================
# Tool 7: Stop Listening
# ============================================================================

@client.tool(StopListeningInput)
async def stop_listening(params) -> dict:
    """Stop listening for wake word."""
    global wake_word_listener
    if wake_word_listener:
        await wake_word_listener.stop()
        wake_word_listener = None
    return {"success": True, "status": "stopped"}

# ============================================================================
# Tool 8: Listener Status
# ============================================================================

@client.tool(ListenerStatusInput)
async def listener_status(params) -> dict:
    """Get current status of the wake word listener."""
    global wake_word_listener
    if wake_word_listener and wake_word_listener.is_listening:
        return {
            "active": True,
            "wake_word": wake_word_listener.wake_word,
            "alternatives": wake_word_listener.alternatives,
            "is_recording_command": wake_word_listener.is_recording_command,
        }
    return {"active": False, "message": "Wake word listener is not running"}
