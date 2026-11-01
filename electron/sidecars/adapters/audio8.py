# SPDX-License-Identifier: AGPL-3.0-or-later
"""Audio8 TTS Preview 0.6B (custom Transformers code from the verified checkpoint)."""


def check():
    import transformers  # noqa: F401


class Audio8:
    default_voice = "default"

    def __init__(self, ctx):
        import torch
        from transformers import AutoModel, AutoProcessor

        self.ctx = ctx
        self.torch = torch
        device = ctx.placement(3)
        self.device = device
        self.device_label = device
        ctx.set_stage(f"Loading Audio8 on {device.upper()}")
        self.processor = AutoProcessor.from_pretrained(ctx.model_dir, trust_remote_code=True)
        self.model = AutoModel.from_pretrained(ctx.model_dir, trust_remote_code=True, dtype=ctx.torch_dtype(device)).eval().to(device)

    def voices(self):
        return [
            {"id": "default", "name": "Audio8 default", "description": "Generation without a reference voice"},
            {"id": "narrator", "name": "Synthetic narrator", "language": "en", "description": "Clones the Apache-2.0 reference clip"},
        ]

    def synthesize(self, request):
        voice = request.get("voice") or "default"
        reference = self.ctx.reference_for(voice) or (self.ctx.default_reference() if voice == "narrator" else None)
        kwargs = {"text": [request["text"]], "return_tensors": "pt"}
        if reference:
            if not reference.get("text"):
                raise ValueError("Audio8 needs the exact transcript of a reference clip. Save it as a .txt file next to the audio.")
            kwargs.update(reference_audio=[reference["audio"]], reference_text=[reference["text"]])
        inputs = {name: value.to(self.device) for name, value in self.processor(**kwargs).items()}
        with self.torch.inference_mode():
            output = self.model.generate(
                **inputs,
                max_new_tokens=1024,
                temperature=float(request.get("temperature") or 0.8),
                top_p=0.95,
                top_k=50,
                do_sample=True,
                return_dict_in_generate=True,
            )
            waveforms, lengths = self.model.decode_audio(output.codes)
        return waveforms[0, : int(lengths[0])].float().cpu().numpy(), self.model.config.codec_sample_rate


def load(ctx):
    return Audio8(ctx)
