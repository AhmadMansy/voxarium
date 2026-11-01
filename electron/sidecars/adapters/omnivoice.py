# SPDX-License-Identifier: AGPL-3.0-or-later
"""OmniVoice (k2-fsa). Voices are voice-design prompts; reference clips clone."""

PRESETS = [
    ("female-young", "Young woman", "female, young adult, moderate pitch"),
    ("female-mid", "Middle-aged woman", "female, middle-aged, low pitch"),
    ("male-young", "Young man", "male, young adult, moderate pitch"),
    ("male-mid", "Middle-aged man", "male, middle-aged, low pitch"),
    ("female-british", "British woman", "female, young adult, british accent"),
    ("male-american", "American man", "male, middle-aged, american accent"),
    ("elderly-male", "Elderly man", "male, elderly, low pitch"),
    ("whisper", "Whisper", "female, young adult, whisper"),
]


def check():
    import omnivoice  # noqa: F401


class Omni:
    default_voice = "female-young"

    def __init__(self, ctx):
        from omnivoice import OmniVoice

        self.ctx = ctx
        device = ctx.placement(3)
        self.device_label = device
        ctx.set_stage(f"Loading OmniVoice on {device.upper()}")
        self.model = OmniVoice.from_pretrained(ctx.model_dir, device_map="cuda:0" if device == "cuda" else "cpu", dtype=ctx.torch_dtype(device))
        self.presets = {key: instruct for key, _name, instruct in PRESETS}

    def voices(self):
        return [{"id": key, "name": name, "description": instruct, "kind": "design"} for key, name, instruct in PRESETS]

    def synthesize(self, request):
        language = request.get("language") or None
        if language and language.startswith("ar") and request.get("variety"):
            language = request["variety"]
        kwargs = {"language": language}
        if request.get("speed"):
            kwargs["speed"] = float(request["speed"])
        reference = self.ctx.reference_for(request.get("voice"))
        if reference:
            if not reference.get("text"):
                raise ValueError("OmniVoice needs a transcript for reference clips. Save it next to the audio as a .txt file.")
            kwargs.update(ref_audio=reference["audio"], ref_text=reference["text"])
        else:
            # Attributes picked in the Expression panel arrive as one instruction.
            instruction = (request.get("instruction") or "").strip()
            kwargs["instruct"] = instruction or self.presets.get(request.get("voice") or "", self.presets[self.default_voice])
        audio = self.model.generate(text=request["text"], **kwargs)
        return audio[0], 24000


def load(ctx):
    return Omni(ctx)
