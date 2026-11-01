# SPDX-License-Identifier: AGPL-3.0-or-later
"""IndexTTS2 (Bilibili). Zero-shot cloning only, so a reference clip is always used.

The first load downloads its auxiliary models (w2v-BERT, MaskGCT codec,
CAMPPlus, BigVGAN) into ``<model>/hf_cache``; afterwards it runs offline.
"""
import os


def check():
    import indextts.infer_v2  # noqa: F401


class Index:
    default_voice = "narrator"

    def __init__(self, ctx):
        from indextts.infer_v2 import IndexTTS2

        self.ctx = ctx
        device = ctx.placement(6)
        self.device_label = device
        ctx.set_stage(f"Loading IndexTTS2 on {device.upper()} (first run downloads auxiliary models)")
        self.tts = IndexTTS2(
            cfg_path=os.path.join(ctx.model_dir, "config.yaml"),
            model_dir=ctx.model_dir,
            use_fp16=device == "cuda",
            device="cuda:0" if device == "cuda" else "cpu",
            use_cuda_kernel=False,
            use_deepspeed=False,
            use_qwen_emo=False,
        )

    def voices(self):
        return [{"id": "narrator", "name": "Synthetic narrator", "language": "en", "description": "Apache-2.0 reference clip; add your own clips to clone them"}]

    def synthesize(self, request):
        reference = self.ctx.reference_for(request.get("voice")) or self.ctx.default_reference()
        result = self.tts.infer(spk_audio_prompt=reference["audio"], text=request["text"], output_path=None)
        if not result:
            raise RuntimeError("IndexTTS2 produced no audio for this text.")
        rate, wav = result
        return wav, rate


def load(ctx):
    return Index(ctx)
