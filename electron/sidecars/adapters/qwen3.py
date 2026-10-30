"""Qwen3-TTS 12Hz 1.7B Base. The Base checkpoint clones from a reference clip."""

LANGUAGES = {"zh": "Chinese", "en": "English", "ja": "Japanese", "ko": "Korean", "de": "German", "fr": "French", "ru": "Russian", "pt": "Portuguese", "es": "Spanish", "it": "Italian"}


def check():
    import qwen_tts  # noqa: F401


class Qwen3:
    default_voice = "narrator"

    def __init__(self, ctx):
        from qwen_tts import Qwen3TTSModel

        self.ctx = ctx
        device = ctx.placement(6)
        self.device_label = device
        ctx.set_stage(f"Loading Qwen3-TTS on {device.upper()}")
        self.model = Qwen3TTSModel.from_pretrained(ctx.model_dir, device_map="cuda:0" if device == "cuda" else "cpu", dtype=ctx.torch_dtype(device))
        self.prompts = {}

    def voices(self):
        return [{"id": "narrator", "name": "Synthetic narrator", "language": "en", "description": "Apache-2.0 reference clip; add your own clips to clone them"}]

    def _prompt(self, voice):
        reference = self.ctx.reference_for(voice) or self.ctx.default_reference()
        key = voice or "narrator"
        if key not in self.prompts:
            text = reference.get("text") or None
            self.prompts[key] = self.model.create_voice_clone_prompt(ref_audio=reference["audio"], ref_text=text, x_vector_only_mode=not text)
        return self.prompts[key]

    def synthesize(self, request):
        language = LANGUAGES.get((request.get("language") or "").split("-")[0].lower(), "Auto")
        kwargs = {}
        if request.get("temperature"):
            kwargs["temperature"] = float(request["temperature"])
        wavs, rate = self.model.generate_voice_clone(text=request["text"], language=language, voice_clone_prompt=self._prompt(request.get("voice")), **kwargs)
        return wavs[0], rate


def load(ctx):
    return Qwen3(ctx)
