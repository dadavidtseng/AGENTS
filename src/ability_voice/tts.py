"""
Text-to-Speech Module using Piper on Jetson.

This module provides fast, offline text-to-speech synthesis using the
Piper TTS engine, which is optimized for edge devices like the Jetson.
"""

import os
import subprocess
import tempfile
import asyncio
from pathlib import Path
from typing import Optional, List

import numpy as np

try:
    import soundfile as sf
except ImportError:
    sf = None


class TextToSpeech:
    """
    Piper-based text-to-speech optimized for Jetson.
    
    Piper is a fast, local neural TTS system that runs efficiently on
    edge devices. It produces natural-sounding speech with low latency.
    
    Attributes:
        voice: Name of the voice model (e.g., 'en_US-lessac-medium')
        piper_path: Path to the piper executable
        
    Example:
        >>> tts = TextToSpeech(voice="en_US-lessac-medium")
        >>> result = await tts.synthesize("Hello, world!")
        >>> # result['audio'] contains the audio samples
    """
    
    DEFAULT_VOICE = "en_US-lessac-medium"
    VOICES_DIR = Path.home() / ".local/share/piper/voices"
    
    # Popular voice models and their characteristics
    RECOMMENDED_VOICES = {
        "en_US-lessac-medium": "American English, natural male voice",
        "en_US-amy-medium": "American English, female voice", 
        "en_US-ryan-medium": "American English, male voice",
        "en_GB-alan-medium": "British English, male voice",
        "en_GB-southern_english_female-medium": "British English, female voice",
    }
    
    def __init__(
        self,
        voice: Optional[str] = None,
        piper_path: Optional[str] = None,
        voices_dir: Optional[Path] = None
    ):
        """
        Initialize the TTS engine.
        
        Args:
            voice: Voice model name (default: en_US-lessac-medium)
            piper_path: Path to piper executable (auto-detected if None)
            voices_dir: Directory containing voice models
        """
        self.voice = voice or self.DEFAULT_VOICE
        self.voices_dir = Path(voices_dir) if voices_dir else self.VOICES_DIR
        self.piper_path = piper_path or self._find_piper()
        
        # Validate setup
        self._validate_setup()
        
    def _find_piper(self) -> str:
        """Find the piper executable."""
        # Check common locations
        locations = [
            "/usr/local/bin/piper",
            "/usr/bin/piper",
            str(Path.home() / "piper/build/piper"),
            str(Path.home() / "piper/install/piper"),
            "piper"  # Rely on PATH
        ]
        
        for loc in locations:
            expanded = os.path.expanduser(loc)
            if os.path.isfile(expanded) and os.access(expanded, os.X_OK):
                return expanded
                
        # Try which command
        try:
            result = subprocess.run(
                ["which", "piper"],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
        except Exception:
            pass
        
        # Check if piper is available via the current Python's bin directory (venv)
        import sys
        venv_piper = Path(sys.executable).parent / "piper"
        if venv_piper.exists() and os.access(str(venv_piper), os.X_OK):
            print(f"[TTS] Found piper in venv: {venv_piper}")
            return str(venv_piper)
        
        # Try piper-tts Python package as last resort (may have issues)
        try:
            from piper import PiperVoice
            print("[TTS] Warning: Using piper-python library (CLI not found)")
            return "piper-python"  # Use Python library instead
        except ImportError:
            pass
            
        raise RuntimeError(
            "Piper executable not found.\n"
            "Install options:\n"
            "  1. Build from source: https://github.com/rhasspy/piper\n"
            "  2. pip install piper-tts"
        )
    
    def _validate_setup(self):
        """Validate Piper and voice model are available."""
        model_path = self.voices_dir / f"{self.voice}.onnx"
        config_path = self.voices_dir / f"{self.voice}.onnx.json"
        
        if not model_path.exists():
            raise RuntimeError(
                f"Voice model not found: {model_path}\n\n"
                f"Download the voice model:\n"
                f"  mkdir -p {self.voices_dir}\n"
                f"  cd {self.voices_dir}\n"
                f"  wget https://huggingface.co/rhasspy/piper-voices/resolve/main/"
                f"en/en_US/lessac/medium/{self.voice}.onnx\n"
                f"  wget https://huggingface.co/rhasspy/piper-voices/resolve/main/"
                f"en/en_US/lessac/medium/{self.voice}.onnx.json"
            )
            
        if not config_path.exists():
            raise RuntimeError(
                f"Voice config not found: {config_path}\n"
                f"Download the .onnx.json file alongside the .onnx model."
            )
            
        self.model_path = str(model_path)
        self.config_path = str(config_path)
        print(f"[TTS] Voice model loaded: {self.voice}")
    
    async def synthesize(
        self,
        text: str,
        speaker_id: int = 0,
        length_scale: float = 1.0,
        noise_scale: float = 0.667,
        noise_w: float = 0.8
    ) -> dict:
        """
        Synthesize speech from text.
        
        Args:
            text: Text to convert to speech
            speaker_id: Speaker ID for multi-speaker models (default: 0)
            length_scale: Speech speed (lower = faster, higher = slower)
            noise_scale: Variation in pronunciation (0-1)
            noise_w: Variation in duration (0-1)
            
        Returns:
            dict with keys:
                - audio: Audio samples as list of floats
                - sample_rate: Audio sample rate (typically 22050)
                - duration_seconds: Duration of generated audio
                
        Raises:
            RuntimeError: If synthesis fails
        """
        text = text.strip()
        if not text:
            return {
                "audio": [],
                "sample_rate": 22050,
                "duration_seconds": 0.0
            }
        
        print(f"[TTS] Synthesizing: '{text[:50]}{'...' if len(text) > 50 else ''}'")
        
        # Create temp file for output
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            output_path = f.name
        
        try:
            if self.piper_path == "piper-python":
                # Use Python library
                return await self._synthesize_python(
                    text, speaker_id, length_scale, noise_scale, noise_w
                )
            else:
                # Use piper executable
                return await self._synthesize_cli(
                    text, output_path, speaker_id,
                    length_scale, noise_scale, noise_w
                )
                
        finally:
            # Clean up temp file
            if os.path.exists(output_path):
                os.unlink(output_path)
    
    async def _synthesize_cli(
        self,
        text: str,
        output_path: str,
        speaker_id: int,
        length_scale: float,
        noise_scale: float,
        noise_w: float
    ) -> dict:
        """Synthesize using piper CLI executable."""
        # Build piper command
        cmd = [
            self.piper_path,
            "--model", self.model_path,
            "--config", self.config_path,
            "--output_file", output_path,
            "--speaker", str(speaker_id),
            "--length_scale", str(length_scale),
            "--noise_scale", str(noise_scale),
            "--noise_w", str(noise_w)
        ]
        
        # Run piper asynchronously
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        stdout, stderr = await process.communicate(input=text.encode('utf-8'))
        
        if process.returncode != 0:
            error_msg = stderr.decode() if stderr else "Unknown error"
            raise RuntimeError(f"Piper synthesis failed: {error_msg}")
        
        # Read the generated audio
        if sf is None:
            raise RuntimeError("soundfile is required to read audio output")
            
        audio_array, sample_rate = sf.read(output_path)
        duration = len(audio_array) / sample_rate
        
        print(f"[TTS] Generated {duration:.2f}s of audio")
        
        return {
            "audio": audio_array.tolist(),
            "sample_rate": sample_rate,
            "duration_seconds": duration
        }
    
    async def _synthesize_python(
        self,
        text: str,
        speaker_id: int,
        length_scale: float,
        noise_scale: float,
        noise_w: float
    ) -> dict:
        """Synthesize using piper-tts Python library."""
        from piper import PiperVoice
        import wave
        import tempfile
        
        # Load voice if not cached
        if not hasattr(self, '_piper_voice') or self._piper_voice is None:
            print(f"[TTS] Loading Piper voice from {self.model_path}")
            self._piper_voice = PiperVoice.load(self.model_path)
        
        # Use a temp file instead of BytesIO - more reliable with Piper
        temp_wav_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
                temp_wav_path = tmp.name
            
            # Synthesize to temp WAV file
            with wave.open(temp_wav_path, 'wb') as wav_file:
                self._piper_voice.synthesize(text, wav_file)
            
            # Read back the WAV data
            with wave.open(temp_wav_path, 'rb') as wav_file:
                sample_rate = wav_file.getframerate()
                n_frames = wav_file.getnframes()
                audio_data = wav_file.readframes(n_frames)
            
            if n_frames == 0:
                print(f"[TTS] Warning: Piper produced no audio frames, retrying with fresh voice...")
                # Reset voice and retry once
                self._piper_voice = PiperVoice.load(self.model_path)
                with wave.open(temp_wav_path, 'wb') as wav_file:
                    self._piper_voice.synthesize(text, wav_file)
                with wave.open(temp_wav_path, 'rb') as wav_file:
                    sample_rate = wav_file.getframerate()
                    n_frames = wav_file.getnframes()
                    audio_data = wav_file.readframes(n_frames)
            
            # Convert to float32
            audio_array = np.frombuffer(audio_data, dtype=np.int16)
            audio_float = audio_array.astype(np.float32) / 32768.0
            
            duration = len(audio_float) / sample_rate if sample_rate > 0 else 0.0
            
            print(f"[TTS] Generated {duration:.2f}s of audio")
            
            return {
                "audio": audio_float.tolist(),
                "sample_rate": sample_rate,
                "duration_seconds": duration
            }
        except Exception as e:
            # Reset the voice object on failure - it may be in a bad state
            print(f"[TTS] Synthesis failed, resetting voice: {e}")
            self._piper_voice = None
            raise
        finally:
            # Clean up temp file
            if temp_wav_path and os.path.exists(temp_wav_path):
                try:
                    os.unlink(temp_wav_path)
                except:
                    pass
    
    async def synthesize_to_file(
        self,
        text: str,
        output_path: str,
        **kwargs
    ) -> dict:
        """
        Synthesize speech and save to file.
        
        Args:
            text: Text to convert to speech
            output_path: Path to save the audio file
            **kwargs: Additional arguments passed to synthesize()
            
        Returns:
            dict with file_path, sample_rate, and duration_seconds
        """
        result = await self.synthesize(text, **kwargs)
        
        if sf is None:
            raise RuntimeError("soundfile is required to save audio files")
        
        audio_array = np.array(result["audio"], dtype=np.float32)
        sf.write(output_path, audio_array, result["sample_rate"])
        
        return {
            "file_path": output_path,
            "sample_rate": result["sample_rate"],
            "duration_seconds": result["duration_seconds"]
        }
    
    def get_available_voices(self) -> List[str]:
        """
        List available voice models in the voices directory.
        
        Returns:
            List of voice model names
        """
        voices = []
        if self.voices_dir.exists():
            for f in self.voices_dir.glob("*.onnx"):
                voices.append(f.stem)
        return sorted(voices)
    
    @classmethod
    def download_voice(cls, voice_name: str, target_dir: Optional[Path] = None) -> None:
        """
        Download a voice model from HuggingFace.
        
        Args:
            voice_name: Name of the voice to download
            target_dir: Directory to save the model (default: ~/.local/share/piper/voices)
        """
        import urllib.request
        
        target_dir = target_dir or cls.VOICES_DIR
        target_dir.mkdir(parents=True, exist_ok=True)
        
        # Parse voice name to construct URL
        # Format: lang_REGION-name-quality (e.g., en_US-lessac-medium)
        parts = voice_name.split("-")
        if len(parts) < 3:
            raise ValueError(f"Invalid voice name format: {voice_name}")
        
        lang_region = parts[0].replace("_", "/")  # en_US -> en/en_US
        lang = parts[0].split("_")[0]
        name = parts[1]
        quality = parts[2]
        
        base_url = (
            f"https://huggingface.co/rhasspy/piper-voices/resolve/main/"
            f"{lang}/{lang_region}/{name}/{quality}"
        )
        
        for ext in [".onnx", ".onnx.json"]:
            url = f"{base_url}/{voice_name}{ext}"
            output_path = target_dir / f"{voice_name}{ext}"
            
            if output_path.exists():
                print(f"[TTS] Already exists: {output_path}")
                continue
                
            print(f"[TTS] Downloading: {url}")
            urllib.request.urlretrieve(url, output_path)
            print(f"[TTS] Saved to: {output_path}")
