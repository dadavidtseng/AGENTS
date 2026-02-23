"""
Speech-to-Text Module using Whisper on Jetson.

This module provides speech recognition using OpenAI's Whisper model
with CUDA acceleration on Jetson devices.
"""

import asyncio
import os
import tempfile
from typing import Optional, Union
import numpy as np

try:
    import soundfile as sf
except ImportError:
    sf = None

# Use standard Whisper with CUDA (WhisperTRT has compatibility issues with PyTorch 2.5)
import threading

try:
    import whisper
    import torch
    WHISPER_AVAILABLE = True
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[STT] Using Whisper with {DEVICE.upper()}")
except ImportError:
    whisper = None
    WHISPER_AVAILABLE = False
    DEVICE = "cpu"
    print("[STT] WARNING: Whisper not found!")


class SpeechToText:
    """
    Whisper-based speech recognition with CUDA acceleration.
    
    Attributes:
        model_name: Name of the Whisper model to use (e.g., 'base.en', 'small.en')
        model: The loaded Whisper model
        
    Example:
        >>> stt = SpeechToText(model_name="base.en")
        >>> await stt.load()
        >>> result = await stt.transcribe(audio_data)
        >>> print(result['text'])
    """
    
    SUPPORTED_MODELS = [
        "tiny", "tiny.en",
        "base", "base.en", 
        "small", "small.en",
        "medium", "medium.en",
        "large", "large-v2", "large-v3"
    ]
    
    def __init__(self, model_name: str = "base.en"):
        """
        Initialize the STT engine.
        
        Args:
            model_name: Whisper model to use. Options:
                - tiny.en: Fastest, English only (~39MB)
                - base.en: Good balance, English only (~74MB) [RECOMMENDED]
                - small.en: Better accuracy, English only (~244MB)
                - base: Multilingual (~74MB)
                - small: Multilingual (~244MB)
        """
        if model_name not in self.SUPPORTED_MODELS:
            raise ValueError(
                f"Unknown model: {model_name}. "
                f"Supported: {self.SUPPORTED_MODELS}"
            )
        
        self.model_name = model_name
        self.model = None
        self._loaded = False
        self._lock = threading.Lock()  # Protect model from concurrent access
        self._async_lock: Optional[asyncio.Lock] = None  # For async coordination
        self._is_busy = False  # Track if model is currently transcribing
        
    async def load(self) -> None:
        """
        Load the Whisper model into memory.
        """
        if self._loaded:
            return
            
        if not WHISPER_AVAILABLE:
            raise RuntimeError(
                "Whisper not available. Install with: pip install openai-whisper"
            )
        
        print(f"[STT] Loading Whisper model: {self.model_name} on {DEVICE}")
        self.model = whisper.load_model(self.model_name, device=DEVICE)
        self._loaded = True
        print("[STT] Model loaded successfully")
    
    async def unload(self) -> None:
        """
        Unload the Whisper model from memory to free GPU/RAM.
        
        This is useful on memory-constrained devices like Jetson
        where multiple models cannot coexist.
        """
        if not self._loaded:
            return
        
        print(f"[STT] Unloading Whisper model: {self.model_name}")
        
        # Delete model and clear CUDA cache
        if self.model is not None:
            del self.model
            self.model = None
        
        self._loaded = False
        
        # Clear CUDA cache to actually free the memory
        if DEVICE == "cuda" and torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
        
        # Run garbage collection
        import gc
        gc.collect()
        
        print(f"[STT] Model unloaded")
    
    async def transcribe(
        self,
        audio_data: Union[bytes, np.ndarray],
        sample_rate: int = 16000,
        language: str = "en"
    ) -> dict:
        """
        Transcribe audio to text.
        
        Args:
            audio_data: Audio as raw bytes (float32) or numpy array
            sample_rate: Audio sample rate in Hz (Whisper expects 16kHz)
            language: Language code for transcription (e.g., 'en', 'es', 'fr')
            
        Returns:
            dict with keys:
                - text: Transcribed text
                - language: Detected or specified language
                - segments: List of timestamped segments (if available)
                
        Raises:
            RuntimeError: If model is not loaded
        """
        if not self._loaded:
            await self.load()
        
        # Convert bytes to numpy array if needed
        if isinstance(audio_data, bytes):
            audio_array = np.frombuffer(audio_data, dtype=np.float32)
        elif isinstance(audio_data, list):
            audio_array = np.array(audio_data, dtype=np.float32)
        else:
            audio_array = np.asarray(audio_data)
            
        # Ensure correct dtype
        if audio_array.dtype != np.float32:
            audio_array = audio_array.astype(np.float32)
        
        # Resample if needed (Whisper expects 16kHz)
        if sample_rate != 16000:
            from scipy import signal
            num_samples = int(len(audio_array) * 16000 / sample_rate)
            audio_array = signal.resample(audio_array, num_samples)
            print(f"[STT] Resampled from {sample_rate}Hz to 16000Hz")
        
        # Normalize audio to [-1, 1] range
        max_val = np.abs(audio_array).max()
        if max_val > 1.0:
            audio_array = audio_array / max_val
        
        # Handle stereo -> mono conversion
        if len(audio_array.shape) > 1:
            audio_array = audio_array.mean(axis=1)
        
        print(f"[STT] Transcribing {len(audio_array)/16000:.2f}s of audio...")
        
        # Transcribe (this is the blocking call)
        result = self.model.transcribe(audio_array, language=language)
        
        # Extract and format result
        transcription = {
            "text": result["text"].strip(),
            "language": result.get("language", language),
            "segments": []
        }
        
        # Include segments if available
        if "segments" in result:
            transcription["segments"] = [
                {
                    "start": seg.get("start", 0),
                    "end": seg.get("end", 0),
                    "text": seg.get("text", "").strip()
                }
                for seg in result["segments"]
            ]
        
        print(f"[STT] Transcribed: '{transcription['text'][:50]}...'")
        return transcription
    
    def transcribe_sync(
        self,
        audio_data: Union[bytes, np.ndarray],
        sample_rate: int = 16000,
        language: str = "en"
    ) -> dict:
        """
        Synchronous transcribe method for use in thread pool executors.
        
        This method is identical to transcribe() but is synchronous,
        making it suitable for running in a ThreadPoolExecutor to avoid
        blocking the asyncio event loop.
        
        Note: Caller should check is_busy() before calling to avoid blocking.
        """
        if not self._loaded:
            raise RuntimeError("Model not loaded. Call load() first.")
        
        # Acquire lock - will block if another transcription is running
        with self._lock:
            # Convert bytes to numpy array if needed
            if isinstance(audio_data, bytes):
                audio_array = np.frombuffer(audio_data, dtype=np.float32)
            elif isinstance(audio_data, list):
                audio_array = np.array(audio_data, dtype=np.float32)
            else:
                audio_array = np.asarray(audio_data)
                
            # Ensure correct dtype
            if audio_array.dtype != np.float32:
                audio_array = audio_array.astype(np.float32)
            
            # Check for empty or invalid audio
            if len(audio_array) == 0:
                print("[STT] Empty audio, skipping")
                return {"text": "", "language": language, "segments": []}
            
            # Resample if needed (Whisper expects 16kHz)
            if sample_rate != 16000:
                from scipy import signal
                num_samples = int(len(audio_array) * 16000 / sample_rate)
                audio_array = signal.resample(audio_array, num_samples)
            
            # Normalize audio to [-1, 1] range
            max_val = np.abs(audio_array).max()
            if max_val > 1.0:
                audio_array = audio_array / max_val
            elif max_val < 0.001:
                # Audio is essentially silence
                return {"text": "", "language": language, "segments": []}
            
            # Handle stereo -> mono conversion
            if len(audio_array.shape) > 1:
                audio_array = audio_array.mean(axis=1)
            
            print(f"[STT] Transcribing {len(audio_array)/16000:.2f}s of audio...")
            
            # Transcribe (blocking call)
            result = self.model.transcribe(audio_array, language=language)
            
            # Extract and format result
            transcription = {
                "text": result["text"].strip(),
                "language": result.get("language", language),
                "segments": []
            }
            
            # Include segments if available
            if "segments" in result:
                transcription["segments"] = [
                    {
                        "start": seg.get("start", 0),
                        "end": seg.get("end", 0),
                        "text": seg.get("text", "").strip()
                    }
                    for seg in result["segments"]
                ]
            
            print(f"[STT] Transcribed: '{transcription['text'][:50]}...'")
            return transcription
    
    def is_busy(self) -> bool:
        """Check if the model is currently transcribing (non-blocking check)."""
        return self._is_busy
    
    async def transcribe_async(
        self,
        audio_data: Union[bytes, np.ndarray],
        sample_rate: int = 16000,
        language: str = "en",
        skip_if_busy: bool = True
    ) -> dict:
        """
        Async transcribe that properly handles concurrency.
        
        Args:
            audio_data: Audio as raw bytes (float32) or numpy array
            sample_rate: Audio sample rate in Hz
            language: Language code for transcription
            skip_if_busy: If True, returns empty result if model is busy
                         If False, waits for model to be available
        
        Returns:
            Transcription result dict
        """
        if not self._loaded:
            await self.load()
        
        # Initialize async lock if needed (must be done in async context)
        if self._async_lock is None:
            self._async_lock = asyncio.Lock()
        
        # Check if busy and skip if requested
        if skip_if_busy and self._is_busy:
            return {"text": "", "language": language, "segments": []}
        
        # Acquire async lock (this properly queues waiters)
        async with self._async_lock:
            self._is_busy = True
            try:
                # Run transcription in thread pool
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(
                    None,
                    self._transcribe_internal,
                    audio_data,
                    sample_rate,
                    language
                )
                return result
            finally:
                self._is_busy = False
    
    def _transcribe_internal(
        self,
        audio_data: Union[bytes, np.ndarray],
        sample_rate: int = 16000,
        language: str = "en"
    ) -> dict:
        """
        Internal transcription method - no locking, called from transcribe_async.
        """
        # Convert bytes to numpy array if needed
        if isinstance(audio_data, bytes):
            audio_array = np.frombuffer(audio_data, dtype=np.float32)
        elif isinstance(audio_data, list):
            audio_array = np.array(audio_data, dtype=np.float32)
        else:
            audio_array = np.asarray(audio_data)
            
        # Ensure correct dtype
        if audio_array.dtype != np.float32:
            audio_array = audio_array.astype(np.float32)
        
        # Check for empty or invalid audio
        if len(audio_array) == 0:
            return {"text": "", "language": language, "segments": []}
        
        # Resample if needed (Whisper expects 16kHz)
        if sample_rate != 16000:
            from scipy import signal
            num_samples = int(len(audio_array) * 16000 / sample_rate)
            audio_array = signal.resample(audio_array, num_samples)
        
        # Normalize audio to [-1, 1] range
        max_val = np.abs(audio_array).max()
        if max_val > 1.0:
            audio_array = audio_array / max_val
        elif max_val < 0.001:
            # Audio is essentially silence
            return {"text": "", "language": language, "segments": []}
        
        # Handle stereo -> mono conversion
        if len(audio_array.shape) > 1:
            audio_array = audio_array.mean(axis=1)
        
        print(f"[STT] Transcribing {len(audio_array)/16000:.2f}s of audio...")
        
        # Transcribe (blocking call)
        result = self.model.transcribe(audio_array, language=language)
        
        # Extract and format result
        transcription = {
            "text": result["text"].strip(),
            "language": result.get("language", language),
            "segments": []
        }
        
        # Include segments if available
        if "segments" in result:
            transcription["segments"] = [
                {
                    "start": seg.get("start", 0),
                    "end": seg.get("end", 0),
                    "text": seg.get("text", "").strip()
                }
                for seg in result["segments"]
            ]
        
        print(f"[STT] Transcribed: '{transcription['text'][:50]}...'")
        return transcription
        return transcription
    
    async def transcribe_file(
        self,
        file_path: str,
        language: str = "en"
    ) -> dict:
        """
        Transcribe audio from a file.
        
        Args:
            file_path: Path to audio file (WAV, MP3, FLAC, etc.)
            language: Language code for transcription
            
        Returns:
            dict with transcription results (same as transcribe())
            
        Raises:
            FileNotFoundError: If audio file doesn't exist
            RuntimeError: If soundfile is not installed
        """
        if sf is None:
            raise RuntimeError("soundfile is required for file transcription")
            
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Audio file not found: {file_path}")
            
        print(f"[STT] Loading audio from: {file_path}")
        audio_array, sample_rate = sf.read(file_path)
        
        # Convert stereo to mono if needed
        if len(audio_array.shape) > 1:
            audio_array = audio_array.mean(axis=1)
            
        return await self.transcribe(
            audio_data=audio_array,
            sample_rate=sample_rate,
            language=language
        )
    
    @property
    def is_loaded(self) -> bool:
        """Check if model is loaded."""
        return self._loaded
    
    @property
    def uses_tensorrt(self) -> bool:
        """Check if TensorRT acceleration is being used."""
        return False  # Using standard Whisper with CUDA
