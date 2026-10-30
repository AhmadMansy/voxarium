"""OpenAudio S1-mini through the pinned fish-speech source tree (on sys.path).

fish-speech locates its Hydra configs via ``.project-root`` in the source tree,
so it runs from the extracted archive rather than an installed wheel.
"""
import os


def check():
    import fish_speech.inference_engine  # noqa: F401


class OpenAudio:
    default_voice = "default"

    def __init__(self, ctx):
        import torch
        from fish_speech.inference_engine import TTSInferenceEngine
        from fish_speech.models.dac.inference import load_model as load_decoder_model
        from fish_speech.models.text2semantic.inference import launch_thread_safe_queue

        self.ctx = ctx
        device = ctx.placement(4)
        self.device_label = device
        precision = torch.bfloat16 if device == "cuda" else torch.float32
        ctx.set_stage(f"Loading OpenAudio S1-mini on {device.upper()}")
        queue = launch_thread_safe_queue(checkpoint_path=ctx.model_dir, device=device, precision=precision, compile=False)
        decoder = load_decoder_model(config_name="modded_dac_vq", checkpoint_path=os.path.join(ctx.model_dir, "codec.pth"), device=device)
        self.engine = TTSInferenceEngine(llama_queue=queue, decoder_model=decoder, precision=precision, compile=False)

    def voices(self):
        return [
            {"id": "default", "name": "OpenAudio default", "description": "No reference; the model picks a voice"},
            {"id": "narrator", "name": "Synthetic narrator", "language": "en", "description": "Clones the Apache-2.0 reference clip"},
        ]

    def synthesize(self, request):
        from fish_speech.utils.schema import ServeReferenceAudio, ServeTTSRequest

        voice = request.get("voice") or "default"
        reference = self.ctx.reference_for(voice) or (self.ctx.default_reference() if voice == "narrator" else None)
        references = []
        if reference:
            with open(reference["audio"], "rb") as handle:
                references.append(ServeReferenceAudio(audio=handle.read(), text=reference.get("text") or ""))
        temperature = min(1.0, max(0.1, float(request.get("temperature") or 0.8)))
        tts_request = ServeTTSRequest(text=request["text"], references=references, seed=request.get("seed"), temperature=temperature, format="wav")
        for result in self.engine.inference(tts_request):
            if result.code == "error":
                raise RuntimeError(str(result.error))
            if result.code == "final":
                rate, audio = result.audio
                return audio, rate
        raise RuntimeError("OpenAudio produced no audio.")


def load(ctx):
    return OpenAudio(ctx)
