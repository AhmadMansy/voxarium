# SPDX-License-Identifier: AGPL-3.0-or-later
"""VoxCPM2 (OpenBMB), 48 kHz. Voices are voice-design descriptions or reference clips."""

PRESETS = [
    ("warm-female", "Warm woman", "A young woman, gentle and warm voice"),
    ("calm-male", "Calm man", "A middle-aged man, calm and deep voice"),
    ("bright-female", "Bright woman", "A cheerful young woman, bright and lively voice"),
    ("narrator-male", "Narrator", "A mature male narrator, clear and steady voice"),
    ("neutral", "Model default", ""),
]


def check():
    import voxcpm  # noqa: F401


class Vox:
    default_voice = "warm-female"

    def __init__(self, ctx):
        from voxcpm import VoxCPM

        self.ctx = ctx
        device = ctx.placement(8)
        self.device_label = device
        ctx.set_stage(f"Loading VoxCPM2 on {device.upper()}")
        # torch.compile needs Triton, which is not available on Windows, so optimisation stays off.
        self.model = VoxCPM(voxcpm_model_path=ctx.model_dir, zipenhancer_model_path=None, enable_denoiser=False, optimize=False, device=device)
        self.presets = {key: description for key, _name, description in PRESETS}

    def voices(self):
        return [{"id": key, "name": name, "description": description or "No voice prompt", "kind": "design"} for key, name, description in PRESETS]

    def synthesize(self, request):
        text = request["text"]
        kwargs = {"cfg_value": 2.0, "inference_timesteps": 10}
        # The Expression panel's description wins over the preset; with a reference
        # clip it steers the delivery instead ("controllable cloning").
        instruction = (request.get("instruction") or "").strip().strip("()")
        reference = self.ctx.reference_for(request.get("voice"))
        if reference:
            kwargs["reference_wav_path"] = reference["audio"]
            if reference.get("text"):
                kwargs.update(prompt_wav_path=reference["audio"], prompt_text=reference["text"])
            if instruction:
                text = f"({instruction}){text}"
        else:
            description = instruction or self.presets.get(request.get("voice") or "", self.presets[self.default_voice])
            if description:
                text = f"({description}){text}"
        wav = self.model.generate(text=text, **kwargs)
        return wav, self.model.tts_model.sample_rate


def load(ctx):
    return Vox(ctx)
