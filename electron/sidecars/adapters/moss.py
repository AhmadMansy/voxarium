"""MOSS-TTS v1.5 (8.5B). Custom Transformers code shipped with the verified checkpoint."""

LANGUAGES = {
    "zh": "Chinese", "yue": "Cantonese", "en": "English", "ar": "Arabic", "cs": "Czech", "da": "Danish",
    "nl": "Dutch", "fi": "Finnish", "fr": "French", "de": "German", "el": "Greek", "he": "Hebrew",
    "hi": "Hindi", "hu": "Hungarian", "it": "Italian", "ja": "Japanese", "ko": "Korean", "mk": "Macedonian",
    "ms": "Malay", "fa": "Persian", "pl": "Polish", "pt": "Portuguese", "ro": "Romanian", "ru": "Russian",
    "es": "Spanish", "sw": "Swahili", "sv": "Swedish", "tl": "Tagalog", "th": "Thai", "tr": "Turkish", "vi": "Vietnamese",
}


def check():
    import transformers  # noqa: F401
    import torchaudio  # noqa: F401


class Moss:
    default_voice = "default"

    def __init__(self, ctx):
        import torch
        from transformers import AutoModel, AutoProcessor

        self.ctx = ctx
        self.torch = torch
        device = ctx.placement(18)
        self.device = device
        self.device_label = device
        if device == "cuda":
            torch.backends.cuda.enable_cudnn_sdp(False)
        # bfloat16 even on CPU: float32 would need ~34 GB of RAM for 8.5B parameters.
        dtype = torch.bfloat16
        ctx.set_stage("Loading the MOSS processor and audio tokenizer")
        self.processor = AutoProcessor.from_pretrained(ctx.model_dir, trust_remote_code=True)
        self.processor.audio_tokenizer = self.processor.audio_tokenizer.to(device)
        ctx.set_stage(f"Loading MOSS-TTS (8.5B) on {device.upper()}; this takes a while")
        self.model = AutoModel.from_pretrained(ctx.model_dir, trust_remote_code=True, attn_implementation="sdpa" if device == "cuda" else "eager", torch_dtype=dtype).to(device)
        self.model.eval()

    def voices(self):
        return [
            {"id": "default", "name": "MOSS default", "description": "No reference; the model picks a voice"},
            {"id": "narrator", "name": "Synthetic narrator", "language": "en", "description": "Clones the Apache-2.0 reference clip"},
        ]

    def synthesize(self, request):
        voice = request.get("voice") or "default"
        reference = self.ctx.reference_for(voice) or (self.ctx.default_reference() if voice == "narrator" else None)
        kwargs = {"text": request["text"]}
        language = LANGUAGES.get((request.get("language") or "").split("-")[0].lower())
        if language:
            kwargs["language"] = language
        if reference:
            kwargs["reference"] = [reference["audio"]]
        batch = self.processor([[self.processor.build_user_message(**kwargs)]], mode="generation")
        with self.torch.no_grad():
            outputs = self.model.generate(
                input_ids=batch["input_ids"].to(self.device),
                attention_mask=batch["attention_mask"].to(self.device),
                max_new_tokens=4096,
            )
        message = next(iter(self.processor.decode(outputs)))
        return message.audio_codes_list[0], self.processor.model_config.sampling_rate


def load(ctx):
    return Moss(ctx)
