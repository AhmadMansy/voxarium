# SPDX-License-Identifier: AGPL-3.0-or-later
"""XTTS-v2 through the maintained ``coqui-tts`` fork. Built-in studio speakers plus local clones."""
import os

LANGUAGE_CODES = {"zh": "zh-cn"}


def check():
    from TTS.tts.models.xtts import Xtts  # noqa: F401


class XTTS:
    default_voice = "Ana Florence"

    def __init__(self, ctx):
        from TTS.tts.configs.xtts_config import XttsConfig
        from TTS.tts.models.xtts import Xtts

        self.ctx = ctx
        device = ctx.placement(3)
        self.device_label = device
        ctx.set_stage(f"Loading XTTS-v2 on {device.upper()}")
        config = XttsConfig()
        config.load_json(os.path.join(ctx.model_dir, "config.json"))
        self.model = Xtts.init_from_config(config)
        self.model.load_checkpoint(config, checkpoint_dir=ctx.model_dir, eval=True)
        self.model.to(device)
        self.languages = set(config.languages)
        self.speakers = self.model.speaker_manager.speakers if self.model.speaker_manager else {}
        if self.default_voice not in self.speakers and self.speakers:
            self.default_voice = next(iter(self.speakers))
        self.latents = {}

    def voices(self):
        return [{"id": name, "name": name, "description": "XTTS studio speaker"} for name in self.speakers]

    def _latents(self, voice):
        reference = self.ctx.reference_for(voice)
        if reference:
            if voice not in self.latents:
                self.latents[voice] = self.model.get_conditioning_latents(audio_path=[reference["audio"]])
            return self.latents[voice]
        speaker = self.speakers.get(voice) or self.speakers[self.default_voice]
        gpt_cond_latent, speaker_embedding = speaker.values()  # same unpacking as Xtts.synthesize
        return gpt_cond_latent, speaker_embedding

    def synthesize(self, request):
        language = (request.get("language") or "en").split("-")[0].lower()
        language = LANGUAGE_CODES.get(language, language)
        if language not in self.languages:
            language = "en"
        gpt_cond_latent, speaker_embedding = self._latents(request.get("voice") or self.default_voice)
        out = self.model.inference(
            request["text"],
            language,
            gpt_cond_latent,
            speaker_embedding,
            temperature=float(request.get("temperature") or 0.75),
            speed=float(request.get("speed") or 1.0),
            enable_text_splitting=True,
        )
        return out["wav"], self.model.config.audio.output_sample_rate


def load(ctx):
    return XTTS(ctx)
