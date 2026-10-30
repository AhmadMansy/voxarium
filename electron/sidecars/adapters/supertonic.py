"""Supertonic 3 (ONNX Runtime, CPU) through the official ``supertonic`` SDK."""


def check():
    import supertonic  # noqa: F401


class Supertonic:
    default_voice = "F1"
    device_label = "cpu"

    def __init__(self, ctx):
        from supertonic import TTS
        from supertonic.config import AVAILABLE_LANGUAGES

        ctx.set_stage("Loading Supertonic ONNX graphs")
        self.tts = TTS(model="supertonic-3", model_dir=ctx.model_dir, auto_download=False)
        self.languages = set(AVAILABLE_LANGUAGES)
        self.styles = {}

    def voices(self):
        items = []
        for name in sorted(self.tts.voice_style_names):
            gender = "male" if name.upper().startswith("M") else "female" if name.upper().startswith("F") else None
            items.append({"id": name, "name": f"{'Male' if gender == 'male' else 'Female' if gender == 'female' else 'Style'} {name[1:] or name}", "gender": gender})
        return items

    def synthesize(self, request):
        voice = request.get("voice") or self.default_voice
        if voice not in self.tts.voice_style_names:
            voice = self.default_voice
        if voice not in self.styles:
            self.styles[voice] = self.tts.get_voice_style(voice_name=voice)
        language = (request.get("language") or "na").split("-")[0].lower()
        if language not in self.languages:
            language = "na"
        wav, _duration = self.tts.synthesize(request["text"], voice_style=self.styles[voice], lang=language, speed=float(request.get("speed") or 1.05))
        return wav, self.tts.sample_rate


def load(ctx):
    return Supertonic(ctx)
