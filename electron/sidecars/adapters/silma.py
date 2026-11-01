# SPDX-License-Identifier: AGPL-3.0-or-later
"""SILMA TTS (F5-TTS based Arabic/English cloning model).

Two Windows workarounds live here:
* ``nemo_text_processing`` needs ``pynini``, which has no Windows wheels. The
  pack installs a tiny pass-through shim instead (see ``shims/``) and number
  normalization is disabled.
* ``SilmaTTS`` always resolves its checkpoint through ``cached_path("hf://...")``,
  which would download a second copy. We point it at the verified local files.
"""
import os

AR_REFERENCE_TEXT = "ويدقق النظر في القرآن الكريم وسائر الكتب السماوية ويتبع مسالك الرسل العظام عليهم الصلاة والسلام."


def check():
    import silma_tts.api  # noqa: F401


class Silma:
    default_voice = "arabic"

    def __init__(self, ctx):
        from importlib.resources import files

        import silma_tts.api as api

        try:
            import imageio_ffmpeg
            from pydub import AudioSegment

            AudioSegment.converter = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            pass

        local = {"model.pt": ctx.path("model.pt"), "vocab.txt": ctx.path("vocab.txt")}
        original = api.cached_path

        def cached_path(url, *args, **kwargs):
            name = str(url).rsplit("/", 1)[-1]
            if str(url).startswith("hf://silma-ai/silma-tts/") and name in local:
                return local[name]
            return original(url, *args, **kwargs)

        api.cached_path = cached_path
        self.ctx = ctx
        self.device_label = ctx.device
        ctx.set_stage("Loading SILMA, the Vocos vocoder and the tashkeel model")
        self.tts = api.SilmaTTS(device=ctx.device, hf_cache_dir=os.environ.get("HF_HUB_CACHE"), enable_normalizer=False, force_tashkeel=True)
        self.references = {
            "arabic": {"audio": str(files("silma_tts").joinpath("infer/ref_audio_samples/ar.ref.24k.wav")), "text": AR_REFERENCE_TEXT},
            "english": ctx.default_reference(),
        }

    def voices(self):
        return [
            {"id": "arabic", "name": "Arabic narrator", "language": "ar", "description": "SILMA's bundled MSA reference"},
            {"id": "english", "name": "English narrator", "language": "en", "description": "Synthetic Apache-2.0 reference"},
        ]

    def synthesize(self, request):
        voice = request.get("voice")
        reference = self.ctx.reference_for(voice) or self.references.get(voice or "")
        if reference is None:
            reference = self.references["english" if (request.get("language") or "").startswith("en") else "arabic"]
        wav, rate, _spec = self.tts.infer(
            ref_file=reference["audio"],
            ref_text=reference.get("text") or None,
            gen_text=request["text"],
            seed=request.get("seed"),
            speed=float(request.get("speed") or 1.0),
            normalize_numbers=False,
            show_info=lambda *args, **kwargs: None,
        )
        return wav, rate


def load(ctx):
    return Silma(ctx)
