# SPDX-License-Identifier: AGPL-3.0-or-later
"""Piper: small ONNX voices that run on any CPU, one file pair per voice.

Every voice is its own ``<language>-<name>-<quality>.onnx`` file plus a ``.onnx.json`` config in
the model folder. Only voices with clearly permissive dataset licenses are offered.
"""
import glob
import os

# id -> (display name, language, locale, dataset licence)
VOICE_INFO = {
    "en_US-kristin-medium": ("Kristin", "en", "en-US", "Public domain"),
    "en_GB-alba-medium": ("Alba", "en", "en-GB", "CC BY 4.0, credit: Alba voice dataset"),
    "de_DE-thorsten-medium": ("Thorsten", "de", "de-DE", "CC0"),
    "es_ES-davefx-medium": ("Davefx", "es", "es-ES", "CC0"),
    "fr_FR-siwis-medium": ("Siwis", "fr", "fr-FR", "CC BY 4.0, credit: SIWIS dataset"),
    "pt_BR-faber-medium": ("Faber", "pt", "pt-BR", "CC0"),
}

LANGUAGE_NAMES = {"en": "English", "de": "German", "es": "Spanish", "fr": "French", "pt": "Portuguese"}


def check():
    import piper  # noqa: F401


class Piper:
    default_voice = "en_US-kristin-medium"
    device_label = "cpu"

    def __init__(self, ctx):
        from piper import PiperVoice

        self.ctx = ctx
        self._load = PiperVoice.load
        ctx.set_stage("Finding Piper voices")
        self.paths = {}
        for path in sorted(glob.glob(os.path.join(ctx.model_dir, "**", "*.onnx"), recursive=True)):
            self.paths[os.path.basename(path)[: -len(".onnx")]] = path
        if not self.paths:
            raise RuntimeError("No Piper voice files were found in the model folder.")
        self.loaded = {}
        if self.default_voice not in self.paths:
            self.default_voice = sorted(self.paths)[0]
        # Load the default voice now so a broken install shows up while the model is loading.
        ctx.set_stage("Loading the default Piper voice")
        self._voice(self.default_voice)

    def _voice(self, voice_id):
        if voice_id not in self.loaded:
            self.loaded[voice_id] = self._load(self.paths[voice_id])
        return self.loaded[voice_id]

    def _info(self, voice_id):
        known = VOICE_INFO.get(voice_id)
        if known:
            return known
        language = voice_id.split("_", 1)[0].lower()
        return (voice_id, language, language, "See the voice's model card")

    def voices(self):
        items = []
        for voice_id in self.paths:
            name, language, locale, licence = self._info(voice_id)
            items.append(
                {
                    "id": voice_id,
                    "name": f"{name} ({LANGUAGE_NAMES.get(language, language)})",
                    "language": language,
                    "locale": locale,
                    "description": f"Dataset license: {licence}.",
                }
            )
        return items

    def _choose(self, voice, language):
        if voice in self.paths:
            return voice
        language = (language or "").split("-")[0].lower()
        for voice_id in self.paths:
            if self._info(voice_id)[1] == language:
                return voice_id
        return self.default_voice

    def synthesize(self, request):
        import numpy as np
        from piper import SynthesisConfig

        voice_id = self._choose(request.get("voice"), request.get("language"))
        voice = self._voice(voice_id)
        speed = float(request.get("speed") or 1.0)
        config = SynthesisConfig(length_scale=1.0 / max(0.5, min(2.0, speed)))
        chunks = [np.asarray(chunk.audio_float_array, dtype=np.float32) for chunk in voice.synthesize(request["text"], syn_config=config)]
        if not chunks:
            raise RuntimeError("Piper returned no audio.")
        return np.concatenate(chunks), int(voice.config.sample_rate)


def load(ctx):
    return Piper(ctx)
