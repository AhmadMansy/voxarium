# SPDX-License-Identifier: AGPL-3.0-or-later
"""Sopro V2 Turbo: a small multilingual model that clones a voice from a short reference clip."""

LANGUAGES = {"en", "pt", "fr", "de"}


def check():
    import sopro  # noqa: F401


class Sopro:
    default_voice = "default"

    def __init__(self, ctx):
        from sopro import SoproTTS

        self.ctx = ctx
        # The model is small enough for the CPU; use the GPU when it has room.
        device = ctx.placement(2.0)
        self.device_label = device
        ctx.set_stage(f"Loading Sopro V2 Turbo on {device.upper()}")
        self.tts = SoproTTS.from_pretrained(ctx.model_dir, device=device)
        self.references = {}

    def voices(self):
        return [{"id": "default", "name": "Synthetic narrator", "language": "en", "description": "A license-clean reference voice. Add your own clip to clone a voice."}]

    def _reference(self, voice):
        reference = self.ctx.reference_for(voice)
        if reference is None:
            reference = self.ctx.default_reference()
        key = reference["audio"]
        if key not in self.references:
            self.references[key] = self.tts.prepare_reference(ref_audio_path=key)
        return self.references[key]

    def synthesize(self, request):
        language = (request.get("language") or "en").split("-")[0].lower()
        lang = language if language in LANGUAGES else None
        wav = self.tts.synthesize(
            request["text"],
            ref=self._reference(request.get("voice") or "default"),
            lang=lang,
            temperature=float(request["temperature"]) if request.get("temperature") else None,
        )
        return wav.detach().float().cpu().numpy().reshape(-1), int(self.tts.sample_rate)


def load(ctx):
    return Sopro(ctx)
