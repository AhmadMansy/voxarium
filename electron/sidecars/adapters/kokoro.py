# SPDX-License-Identifier: AGPL-3.0-or-later
"""Kokoro-82M through the official ``kokoro`` package, loaded from verified local files."""
import os

LANG_CODE = {"en": "a", "en-US": "a", "en-GB": "b", "ja": "j", "zh": "z", "es": "e", "fr": "f", "hi": "h", "it": "i", "pt": "p"}
LANG_NAMES = {"a": "en", "b": "en-GB", "j": "ja", "z": "zh", "e": "es", "f": "fr", "h": "hi", "i": "it", "p": "pt"}
GENDER = {"f": "female", "m": "male"}


def check():
    import kokoro  # noqa: F401
    import misaki.en  # noqa: F401


class Kokoro:
    default_voice = "af_heart"

    def __init__(self, ctx):
        import torch
        from kokoro import KModel

        self.ctx = ctx
        self.device_label = ctx.device
        ctx.set_stage("Loading Kokoro weights")
        self.model = KModel(repo_id="hexgrad/Kokoro-82M", config=ctx.path("config.json"), model=ctx.path("kokoro-v1_0.pth")).to(ctx.device).eval()
        self.torch = torch
        self.pipelines = {}
        voice_dir = ctx.path("voices")
        self.voice_files = {name[:-3]: os.path.join(voice_dir, name) for name in sorted(os.listdir(voice_dir)) if name.endswith(".pt")}
        self.pipeline("a")
        if ctx.prepare:
            # Japanese and Chinese G2P fetch dictionaries on first use; warm them while online.
            for code in ("j", "z"):
                try:
                    list(self.pipeline(code)("テスト" if code == "j" else "测试", voice=self.voice_files["af_heart"]))
                except Exception as error:  # a missing optional language must not block English
                    ctx.set_stage(f"Optional language {code} unavailable: {error}")

    def pipeline(self, code):
        if code not in self.pipelines:
            from kokoro import KPipeline

            if code == "j":
                # misaki's default Japanese backend (cutlet) needs a UniDic dictionary
                # package that only builds from source; pyopenjtalk-plus ships wheels.
                from misaki import ja

                pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", model=self.model)
                pipeline.lang_code = "j"
                pipeline.g2p = ja.JAG2P(version="pyopenjtalk")
            else:
                pipeline = KPipeline(lang_code=code, repo_id="hexgrad/Kokoro-82M", model=self.model)
            self.pipelines[code] = pipeline
        return self.pipelines[code]

    def voices(self):
        items = []
        for voice_id in self.voice_files:
            lang = LANG_NAMES.get(voice_id[0], "en")
            name = voice_id.split("_", 1)[-1].replace("_", " ").title()
            items.append({"id": voice_id, "name": name, "language": lang, "gender": GENDER.get(voice_id[1:2], None)})
        return items

    def synthesize(self, request):
        voice = request.get("voice") or self.default_voice
        if voice not in self.voice_files:
            voice = self.default_voice
        language = request.get("language") or LANG_NAMES.get(voice[0], "en")
        code = LANG_CODE.get(language, LANG_CODE.get(language.split("-")[0], voice[0]))
        speed = float(request.get("speed") or 1.0)
        chunks = []
        with self.torch.inference_mode():
            for result in self.pipeline(code)(request["text"], voice=self.voice_files[voice], speed=speed, split_pattern=r"\n+"):
                if result.audio is not None:
                    chunks.append(result.audio.detach().cpu())
        if not chunks:
            raise RuntimeError("Kokoro produced no audio for this text.")
        return self.torch.cat(chunks).numpy(), 24000


def load(ctx):
    return Kokoro(ctx)
