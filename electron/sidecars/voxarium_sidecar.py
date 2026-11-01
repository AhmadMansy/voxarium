# SPDX-License-Identifier: AGPL-3.0-or-later
"""Loopback TTS server shared by every Voxarium sidecar model.

The Electron supervisor starts this with the model's isolated Python
environment. It binds to 127.0.0.1 only, prints ``VOXARIUM_READY {"port": N}``
as soon as the socket is listening, then loads the model in the background so
the app can show progress. Every request must carry the per-session bearer
token from ``VOXARIUM_SIDECAR_TOKEN``.

Adapters live in ``adapters/<name>.py`` and expose ``load(ctx)`` returning an
object with ``voices()`` and ``synthesize(request) -> (float32 mono, sample_rate)``.
Audio is resampled to the app's 24 kHz pipeline before it is returned.
"""
from __future__ import annotations

import argparse
import base64
import importlib
import json
import os
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUTPUT_RATE = 24000


def log(message: str) -> None:
    print(f"[voxarium] {message}", flush=True)


class Context:
    """Everything an adapter needs to load its model."""

    def __init__(self, args: argparse.Namespace):
        self.model_dir = os.path.abspath(args.model_dir)
        self.app_dir = os.path.dirname(os.path.abspath(__file__))
        self.assets_dir = os.path.join(self.app_dir, "assets")
        self.references_dir = args.references_dir
        self.preference = args.device
        self.prepare = bool(args.prepare)
        self.stage = "Starting"
        self._device = None

    def set_stage(self, stage: str) -> None:
        self.stage = stage
        log(stage)

    def path(self, *parts: str) -> str:
        return os.path.join(self.model_dir, *parts)

    @property
    def device(self) -> str:
        if self._device is None:
            self._device = pick_device(self.preference)
        return self._device

    def cuda_memory_gb(self) -> float:
        try:
            import torch

            if torch.cuda.is_available():
                return torch.cuda.get_device_properties(0).total_memory / 1024**3
        except Exception:
            pass
        return 0.0

    def placement(self, min_vram_gb: float) -> str:
        """CUDA when the GPU has room for the model, otherwise CPU (slow but it runs)."""
        if self.device != "cuda":
            return "cpu"
        vram = self.cuda_memory_gb()
        if vram + 0.25 < min_vram_gb:
            log(f"GPU has {vram:.1f} GB; this model needs about {min_vram_gb:g} GB, so it runs on the CPU.")
            return "cpu"
        return "cuda"

    def torch_dtype(self, device: str):
        import torch

        if device != "cuda":
            return torch.float32
        return torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16

    def default_reference(self) -> dict:
        """A license-clean synthetic voice used by models that can only clone."""
        return {
            "audio": os.path.join(self.assets_dir, "reference-en.wav"),
            "text": "The sky above the port was the color of television, tuned to a dead channel.",
        }

    def user_references(self) -> list[dict]:
        """Reference clips the user dropped into voices/references (wav + optional txt)."""
        found = []
        folder = self.references_dir
        if not folder or not os.path.isdir(folder):
            return found
        for name in sorted(os.listdir(folder)):
            stem, ext = os.path.splitext(name)
            if ext.lower() not in (".wav", ".flac", ".mp3", ".ogg"):
                continue
            text = ""
            transcript = os.path.join(folder, stem + ".txt")
            if os.path.isfile(transcript):
                with open(transcript, "r", encoding="utf-8") as handle:
                    text = handle.read().strip()
            found.append({"id": f"ref:{stem}", "name": stem.replace("_", " ").replace("-", " ").title(), "audio": os.path.join(folder, name), "text": text})
        return found

    def reference_for(self, voice: str | None) -> dict | None:
        if voice and voice.startswith("ref:"):
            for item in self.user_references():
                if item["id"] == voice:
                    return item
            raise ValueError(f"Reference voice {voice[4:]} was not found.")
        return None


def pick_device(preference: str) -> str:
    if preference == "cpu":
        return "cpu"
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def seed_everything(seed) -> int | None:
    if seed in (None, ""):
        return None
    value = int(str(seed)) % (2**32)
    import random

    random.seed(value)
    try:
        import numpy as np

        np.random.seed(value)
    except Exception:
        pass
    try:
        import torch

        torch.manual_seed(value)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(value)
    except Exception:
        pass
    return value


def to_mono_float32(audio):
    import numpy as np

    try:
        import torch

        if isinstance(audio, torch.Tensor):
            audio = audio.detach().float().cpu().numpy()
    except Exception:
        pass
    array = np.asarray(audio)
    if array.dtype == np.int16:
        array = array.astype(np.float32) / 32768.0
    array = array.astype(np.float32, copy=False)
    array = np.squeeze(array)
    if array.ndim == 2:
        # (channels, samples) or (samples, channels)
        array = array.mean(axis=0 if array.shape[0] < array.shape[1] else 1)
    if array.ndim != 1:
        array = array.reshape(-1)
    return np.ascontiguousarray(np.clip(array, -1.0, 1.0), dtype=np.float32)


def resample(audio, rate: int):
    if rate == OUTPUT_RATE:
        return audio
    import soxr

    return soxr.resample(audio, rate, OUTPUT_RATE, quality="HQ").astype("float32", copy=False)


class State:
    def __init__(self):
        self.ready = False
        self.error: str | None = None
        self.model = None
        self.lock = threading.Lock()
        self.loaded_at = None
        self.load_ms = 0


def make_handler(state: State, ctx: Context, token: str):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # quiet access log
            return

        def _cors(self):
            self.send_header("access-control-allow-origin", "*")
            self.send_header("access-control-allow-headers", "authorization, content-type")
            self.send_header("access-control-allow-methods", "GET, POST, OPTIONS")
            self.send_header("cross-origin-resource-policy", "cross-origin")

        def _json(self, status: int, payload: dict):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self._cors()
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _authorized(self) -> bool:
            if self.headers.get("authorization", "") == f"Bearer {token}":
                return True
            self._json(401, {"error": "Missing or invalid session token."})
            return False

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.send_header("content-length", "0")
            self.end_headers()

        def do_GET(self):
            if not self._authorized():
                return
            if self.path.startswith("/health"):
                payload = {
                    "ok": True,
                    "ready": state.ready,
                    "stage": ctx.stage,
                    "error": state.error,
                    "sampleRate": OUTPUT_RATE,
                    "loadMs": state.load_ms,
                }
                if state.ready:
                    payload["device"] = getattr(state.model, "device_label", ctx.device)
                self._json(200, payload)
                return
            if self.path.startswith("/voices"):
                if not state.ready:
                    self._json(503, {"error": "The model is still loading."})
                    return
                voices = list(state.model.voices())
                for ref in ctx.user_references():
                    voices.append({"id": ref["id"], "name": ref["name"], "description": "Your reference clip", "kind": "reference"})
                default = getattr(state.model, "default_voice", None) or (voices[0]["id"] if voices else "default")
                self._json(200, {"voices": voices, "default": default})
                return
            self._json(404, {"error": "Not found"})

        def do_POST(self):
            if not self._authorized():
                return
            if not self.path.startswith("/synthesize"):
                self._json(404, {"error": "Not found"})
                return
            if not state.ready:
                self._json(503, {"error": state.error or "The model is still loading."})
                return
            try:
                length = int(self.headers.get("content-length") or 0)
                request = json.loads(self.rfile.read(length) or b"{}")
                text = str(request.get("text") or "").strip()
                if not text:
                    self._json(400, {"error": "There is no text to speak."})
                    return
                request["text"] = text
                with state.lock:
                    started = time.perf_counter()
                    request["seed"] = seed_everything(request.get("seed"))
                    audio, rate = state.model.synthesize(request)
                    audio = resample(to_mono_float32(audio), int(rate))
                    elapsed = time.perf_counter() - started
                seconds = len(audio) / OUTPUT_RATE
                self._json(
                    200,
                    {
                        "pcm": base64.b64encode(audio.tobytes()).decode("ascii"),
                        "sampleRate": OUTPUT_RATE,
                        "stats": {"seconds": seconds, "elapsedMs": round(elapsed * 1000), "rtf": (elapsed / seconds) if seconds else None},
                    },
                )
            except Exception as error:  # report adapter errors to the app instead of dropping the socket
                traceback.print_exc()
                self._json(500, {"error": f"{type(error).__name__}: {error}"})

    return Handler


def load_model(state: State, ctx: Context, adapter_name: str) -> None:
    started = time.perf_counter()
    try:
        ctx.set_stage("Importing the model runtime")
        adapter = importlib.import_module(f"adapters.{adapter_name}")
        state.model = adapter.load(ctx)
        if ctx.prepare:
            ctx.set_stage("Running a test generation")
            audio, rate = state.model.synthesize({"text": "Voxarium is ready.", "voice": None, "language": None, "seed": 1234})
            if to_mono_float32(audio).size == 0:
                raise RuntimeError("The test generation returned no audio.")
            with open(os.path.join(ctx.model_dir, ".voxarium-prepared"), "w", encoding="utf-8") as handle:
                json.dump({"preparedAt": time.time(), "device": ctx.device}, handle)
        state.load_ms = round((time.perf_counter() - started) * 1000)
        state.ready = True
        ctx.set_stage("Ready")
    except Exception as error:
        traceback.print_exc()
        state.error = f"{type(error).__name__}: {error}"
        ctx.set_stage("Failed")


def watch_parent(pid: int) -> None:
    if os.name == "nt":
        import ctypes

        SYNCHRONIZE = 0x00100000
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        handle = kernel32.OpenProcess(SYNCHRONIZE, False, pid)
        if not handle:
            os._exit(0)  # the parent is already gone
        kernel32.WaitForSingleObject(handle, 0xFFFFFFFF)
        os._exit(0)
    while True:
        try:
            os.kill(pid, 0)
        except OSError:
            os._exit(0)
        time.sleep(2)


def main(adapter_name: str) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--references-dir", default="")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda", "webgpu"])
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--check", action="store_true", help="Import the adapter's dependencies and exit.")
    args = parser.parse_args()

    if args.check:
        adapter = importlib.import_module(f"adapters.{adapter_name}")
        getattr(adapter, "check", lambda: None)()
        print("VOXARIUM_CHECK_OK", flush=True)
        return

    if args.host not in ("127.0.0.1", "localhost", "::1"):
        raise SystemExit("Voxarium sidecars only listen on the loopback interface.")
    token = os.environ.get("VOXARIUM_SIDECAR_TOKEN") or ""
    if len(token) < 32:
        raise SystemExit("VOXARIUM_SIDECAR_TOKEN is missing.")

    ctx = Context(args)
    state = State()
    server = ThreadingHTTPServer((args.host, args.port), make_handler(state, ctx, token))
    server.daemon_threads = True
    port = server.server_address[1]
    # Exit when Voxarium goes away, so a crashed app never leaves a model in
    # memory. This waits on the parent's process handle. (A blocking read on a
    # stdin pipe is not safe on Windows: synchronous I/O on that file object
    # serializes with handle queries made while DLLs initialise, which hangs
    # imports such as numpy.)
    parent = os.environ.get("VOXARIUM_PARENT_PID", "")
    if parent.isdigit():
        threading.Thread(target=watch_parent, args=(int(parent),), daemon=True).start()

    print(f"VOXARIUM_READY {json.dumps({'port': port})}", flush=True)
    threading.Thread(target=load_model, args=(state, ctx, adapter_name), daemon=True).start()
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
