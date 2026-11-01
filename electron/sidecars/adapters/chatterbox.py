# SPDX-License-Identifier: AGPL-3.0-or-later
"""Chatterbox Multilingual (Resemble AI). Outputs carry the Perth watermark."""


def check():
    import chatterbox.mtl_tts  # noqa: F401


class Chatterbox:
    default_voice = "default"

    def __init__(self, ctx):
        from chatterbox.mtl_tts import SUPPORTED_LANGUAGES, ChatterboxMultilingualTTS

        self.ctx = ctx
        self.device_label = ctx.device
        ctx.set_stage("Loading Chatterbox (voice encoder, T3, S3Gen)")
        self.tts = ChatterboxMultilingualTTS.from_local(ctx.model_dir, ctx.device)
        self.languages = set(SUPPORTED_LANGUAGES)
        self.conds = {"default": self.tts.conds}

    def voices(self):
        return [
            {"id": "default", "name": "Chatterbox default", "description": "The model's built-in voice"},
            {"id": "narrator", "name": "Synthetic narrator", "language": "en", "description": "Apache-2.0 reference clip"},
        ]

    def _conditionals(self, voice, exaggeration):
        reference = self.ctx.reference_for(voice)
        if reference is None and voice == "narrator":
            reference = self.ctx.default_reference()
        if reference is None:
            return self.conds["default"]
        key = f"{voice}:{exaggeration}"
        if key not in self.conds:
            self.tts.prepare_conditionals(reference["audio"], exaggeration=exaggeration)
            self.conds[key] = self.tts.conds
        return self.conds[key]

    def synthesize(self, request):
        language = (request.get("language") or "en").split("-")[0].lower()
        if language not in self.languages:
            language = "en"
        # The Expression panel's intensity slider is Chatterbox's exaggeration.
        exaggeration = float(request.get("intensity") or request.get("exaggeration") or 0.5)
        self.tts.conds = self._conditionals(request.get("voice") or "default", exaggeration)
        wav = self.tts.generate(
            request["text"],
            language_id=language,
            exaggeration=exaggeration,
            temperature=float(request.get("temperature") or 0.8),
        )
        return wav, self.tts.sr


def load(ctx):
    return Chatterbox(ctx)
