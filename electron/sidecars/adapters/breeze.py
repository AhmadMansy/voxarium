# SPDX-License-Identifier: AGPL-3.0-or-later
"""Breeze TTS 2. The inference code is the pinned breeze-tts source tree (added to sys.path)."""

PRESETS = [
    ("warm-female", "Warm woman", "A warm, thoughtful young woman with a clear voice and a calm, reflective delivery."),
    ("steady-male", "Steady man", "A composed middle-aged man with a deep, steady voice and an even, measured pace."),
    ("bright-female", "Bright woman", "A cheerful young woman with a bright, lively voice and an upbeat delivery."),
    ("news-male", "Newsreader", "A confident male newsreader with crisp diction and a neutral, professional tone."),
]
MAX_NEW_TOKENS = 1500
MAX_SEQ_LEN = 2048


def check():
    import breeze_infer.runtime  # noqa: F401
    import models.fast_streaming  # noqa: F401


class Breeze:
    default_voice = "warm-female"

    def __init__(self, ctx):
        from breeze_infer.runtime import load_runtime, update_generation_config_for_breeze
        from models.fast_streaming import FastBreezeStreamingRuntime, FastStreamingConfig

        self.ctx = ctx
        device = ctx.placement(8)
        self.device_label = device
        ctx.set_stage(f"Loading Breeze TTS 2 on {device.upper()}")
        tokenizer, model, audio_tokenizer = load_runtime(ctx.model_dir, device="cuda:0" if device == "cuda" else "cpu", attn_implementation="eager")
        update_generation_config_for_breeze(model)
        config = FastStreamingConfig(
            max_new_tokens=MAX_NEW_TOKENS,
            max_seq_len=MAX_SEQ_LEN,
            fast_all=False,
            fast_text_encoder=False,
            fast_backbone_prefill=False,
            fast_backbone_decode=False,
            fast_depth_decoder=False,
            fast_codec=False,
            repetition_penalty=1.1,
        )
        self.tokenizer, self.model, self.audio_tokenizer = tokenizer, model, audio_tokenizer
        self.runtime = FastBreezeStreamingRuntime(model, audio_tokenizer, config, tokenizer=tokenizer)
        self.presets = {key: instruction for key, _name, instruction in PRESETS}

    def voices(self):
        return [{"id": key, "name": name, "description": instruction, "kind": "design"} for key, name, instruction in PRESETS]

    def synthesize(self, request):
        import numpy as np
        from breeze_infer.runtime import set_all_seeds
        from breeze_infer.templates import get_template, prepare_inputs, select_template_name

        item = {"id": "voxarium", "text": request["text"], "speaker": "S0"}
        instruction = (request.get("instruction") or "").strip()
        reference = self.ctx.reference_for(request.get("voice"))
        cfg = 1.0
        if reference:
            if not reference.get("text"):
                raise ValueError("Breeze needs the exact transcript of a reference clip. Save it as a .txt file next to the audio.")
            item["ref_audio_path"] = reference["audio"]
            item["ref_text"] = reference["text"]
            if instruction:
                # Voice direction: keep the cloned identity, change the delivery.
                item["instruction"] = instruction
                cfg = 4.0
        else:
            item["instruction"] = instruction or self.presets.get(request.get("voice") or "", self.presets[self.default_voice])
            cfg = 4.0
        seed = request.get("seed") or 42
        set_all_seeds(seed)
        inputs = prepare_inputs(
            self.tokenizer,
            self.audio_tokenizer,
            self.model,
            [item],
            get_template(select_template_name(item)),
            guidance_scale=cfg,
            guidance_scale_ref=None,
            guidance_scale_ins=None,
        )
        chunks = [np.asarray(chunk.audio, dtype=np.float32).reshape(-1) for chunk in self.runtime.iter_audio_chunks(inputs, request_id="voxarium", seed=seed)]
        if not chunks:
            raise RuntimeError("Breeze produced no audio.")
        return np.concatenate(chunks), self.runtime.sample_rate


def load(ctx):
    return Breeze(ctx)
