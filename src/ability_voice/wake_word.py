"""
Wake word detection module.

Continuously listens for a wake word via microphone, then transcribes
the following voice command. Emits events via KĀDI broker.
"""

import asyncio
import time
from typing import Callable, List, Optional

import numpy as np
import sounddevice as sd

try:
    import webrtcvad
    VAD_AVAILABLE = True
except ImportError:
    VAD_AVAILABLE = False

MIC_SAMPLE_RATE = 16000
CHUNK_DURATION_MS = 30
CHUNK_SIZE = int(MIC_SAMPLE_RATE * CHUNK_DURATION_MS / 1000)  # 480 samples


class WakeWordListener:
    """
    Continuously listens for a wake word, then transcribes commands.

    1. Streams audio from the microphone
    2. Continuously transcribes short chunks looking for the wake word
    3. When detected, records until silence (pause detection)
    4. Transcribes the full command and emits event
    """

    def __init__(
        self,
        wake_word: str = "hey katie",
        alternatives: List[str] = None,
        vad_aggressiveness: int = 2,
        silence_timeout_ms: int = 1500,
        max_recording_seconds: int = 30,
        stt_getter: Callable = None,
        event_emitter: Callable = None,
    ):
        self.wake_word = wake_word.lower().strip()
        self.alternatives = [w.strip() for w in (alternatives or [])]
        self.vad_aggressiveness = vad_aggressiveness
        self.silence_timeout_ms = silence_timeout_ms
        self.max_recording_seconds = max_recording_seconds
        self._get_stt = stt_getter
        self._emit = event_emitter

        self.is_listening = False
        self.is_recording_command = False
        self._stop_event = asyncio.Event()
        self._audio_queue: Optional[asyncio.Queue] = None
        self._stream = None
        self._listen_task: Optional[asyncio.Task] = None
        self._is_transcribing = False
        self._transcription_timeout = 8.0
        self._last_transcription_time = 0.0
        self._min_transcription_gap = 0.3

        if VAD_AVAILABLE:
            self.vad = webrtcvad.Vad(vad_aggressiveness)
        else:
            self.vad = None

        print(f"[WakeWord] Initialized: '{self.wake_word}'")

    def _audio_callback(self, indata, frames, time_info, status):
        """Callback for sounddevice to receive audio data."""
        if status:
            print(f"[WakeWord] Audio status: {status}")
        if self._audio_queue is not None:
            try:
                self._audio_queue.put_nowait(indata.copy())
            except asyncio.QueueFull:
                pass

    def _is_speech(self, audio_chunk: np.ndarray) -> bool:
        """Check if audio chunk contains speech using VAD or energy."""
        if self.vad is not None:
            audio_int16 = (audio_chunk * 32767).astype(np.int16)
            frame_size = 480
            if len(audio_int16) >= frame_size:
                frame = audio_int16[:frame_size].tobytes()
                try:
                    return self.vad.is_speech(frame, MIC_SAMPLE_RATE)
                except Exception:
                    pass
        energy = np.sqrt(np.mean(audio_chunk ** 2))
        return energy > 0.02

    def _buffer_has_speech(self, audio_buffer: np.ndarray, threshold: float = 0.2) -> bool:
        """Check if buffer contains enough speech to be worth transcribing."""
        frame_size = 480
        total = len(audio_buffer) // frame_size
        if total == 0:
            return False
        speech_count = sum(
            1 for i in range(total)
            if self._is_speech(audio_buffer[i * frame_size:(i + 1) * frame_size])
        )
        return (speech_count / total) >= threshold

    def _contains_wake_word(self, text: str) -> bool:
        """Check if transcribed text contains the wake word or alternatives."""
        text_lower = text.lower().strip()
        all_words = [self.wake_word] + self.alternatives
        for word in all_words:
            if word in text_lower:
                return True
        # Fuzzy: check if wake word tokens appear in text
        wake_tokens = self.wake_word.split()
        text_tokens = text_lower.split()
        if len(wake_tokens) >= 2:
            matches = sum(1 for t in wake_tokens if any(t in tt for tt in text_tokens))
            if matches >= len(wake_tokens) - 1:
                return True
        return False

    async def start(self) -> None:
        """Start listening for wake word (non-blocking)."""
        if self.is_listening:
            return
        self._stop_event.clear()
        self._audio_queue = asyncio.Queue(maxsize=100)
        self._stream = sd.InputStream(
            samplerate=MIC_SAMPLE_RATE,
            channels=1,
            dtype="float32",
            blocksize=CHUNK_SIZE,
            callback=self._audio_callback,
        )
        self._stream.start()
        self.is_listening = True
        self._listen_task = asyncio.create_task(self._listen_loop())
        print("[WakeWord] Listening started")

    async def stop(self) -> None:
        """Stop listening."""
        self.is_listening = False
        self._stop_event.set()
        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None
        if self._listen_task:
            self._listen_task.cancel()
            try:
                await self._listen_task
            except asyncio.CancelledError:
                pass
            self._listen_task = None
        self._audio_queue = None
        print("[WakeWord] Listening stopped")

    async def _listen_loop(self) -> None:
        """Main loop: accumulate audio, check for wake word, record command."""
        wake_buffer = np.array([], dtype=np.float32)
        wake_chunk_seconds = 3.0
        wake_chunk_samples = int(MIC_SAMPLE_RATE * wake_chunk_seconds)

        while self.is_listening and not self._stop_event.is_set():
            try:
                chunk = await asyncio.wait_for(
                    self._audio_queue.get(), timeout=0.5
                )
            except (asyncio.TimeoutError, asyncio.CancelledError):
                continue

            audio = chunk.flatten()
            wake_buffer = np.concatenate([wake_buffer, audio])

            if len(wake_buffer) < wake_chunk_samples:
                continue

            # Check for speech before transcribing
            if not self._buffer_has_speech(wake_buffer):
                wake_buffer = wake_buffer[-CHUNK_SIZE * 5:]
                continue

            # Throttle transcription
            now = time.time()
            if self._is_transcribing or (now - self._last_transcription_time) < self._min_transcription_gap:
                wake_buffer = wake_buffer[-wake_chunk_samples // 2:]
                continue

            self._is_transcribing = True
            try:
                stt = await self._get_stt()
                result = await asyncio.wait_for(
                    stt.transcribe(audio_data=wake_buffer, sample_rate=MIC_SAMPLE_RATE),
                    timeout=self._transcription_timeout,
                )
                self._last_transcription_time = time.time()
                text = result.get("text", "").strip()

                if text and self._contains_wake_word(text):
                    print(f"[WakeWord] Detected: '{text}'")
                    if self._emit:
                        self._emit("voice.wake_word_detected", {"text": text, "wake_word": self.wake_word})
                    await self._record_command()
            except asyncio.TimeoutError:
                print("[WakeWord] Transcription timeout")
            except Exception as e:
                print(f"[WakeWord] Error: {e}")
            finally:
                self._is_transcribing = False

            wake_buffer = np.array([], dtype=np.float32)

    async def _record_command(self) -> None:
        """Record audio after wake word until silence, then transcribe."""
        self.is_recording_command = True
        print("[WakeWord] Recording command...")
        if self._emit:
            self._emit("voice.recording_started", {})

        command_buffer = np.array([], dtype=np.float32)
        silence_start = None
        max_samples = MIC_SAMPLE_RATE * self.max_recording_seconds

        while self.is_listening and not self._stop_event.is_set():
            try:
                chunk = await asyncio.wait_for(
                    self._audio_queue.get(), timeout=0.5
                )
            except (asyncio.TimeoutError, asyncio.CancelledError):
                continue

            audio = chunk.flatten()
            command_buffer = np.concatenate([command_buffer, audio])

            if self._is_speech(audio):
                silence_start = None
            else:
                if silence_start is None:
                    silence_start = time.time()
                elif (time.time() - silence_start) * 1000 >= self.silence_timeout_ms:
                    print("[WakeWord] Silence detected, ending recording")
                    break

            if len(command_buffer) >= max_samples:
                print("[WakeWord] Max recording length reached")
                break

        self.is_recording_command = False

        if len(command_buffer) < MIC_SAMPLE_RATE * 0.3:
            print("[WakeWord] Recording too short, ignoring")
            if self._emit:
                self._emit("voice.recording_ended", {"reason": "too_short"})
            return

        try:
            stt = await self._get_stt()
            result = await stt.transcribe(
                audio_data=command_buffer, sample_rate=MIC_SAMPLE_RATE
            )
            text = result.get("text", "").strip()
            print(f"[WakeWord] Command: '{text}'")
            if self._emit:
                self._emit("voice.command_transcribed", {
                    "text": text,
                    "duration_seconds": len(command_buffer) / MIC_SAMPLE_RATE,
                })
        except Exception as e:
            print(f"[WakeWord] Transcription error: {e}")
            if self._emit:
                self._emit("voice.recording_ended", {"reason": "error", "error": str(e)})
