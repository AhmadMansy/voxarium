# Voxarium — Milestone 2 plan: a Python-free default experience

**Status:** Proposal · **Date:** 1 November 2026 · **Depends on:** Milestone 1 (cross-platform runtime, install pipeline, release workflows)

> Not legal advice. Items marked **(verify)** are general knowledge or unchecked and must be confirmed when implemented.

---

## 1. Why this milestone

Today only Phonon 31M (English, 62 MB) runs inside the app. Every other model needs a Python sidecar:
uv, a Python interpreter, a per-model virtual environment, PyTorch or ONNX Runtime, and a first-start
step. That is the most fragile part of the product and the part that varies most between Windows,
Linux and macOS.

Measured on a clean Windows profile with the headless smoke test (`scripts/smoke-sidecar.mjs`):
Supertonic 3 took about 2.5 minutes from nothing to a spoken sentence, 27 s of it building the
environment, and it generated 2.44 s of audio in 0.8 s. The Python route works, but it adds a failure
surface (network to PyPI, wheels, path lengths, antivirus) and cannot run at all on Intel Macs for
PyTorch models.

The goal is for a fresh install, on any of the three systems, to speak in a small, commercial-safe,
multilingual model **without Python**, and to make the next small models cheap to add.

## 2. Goals and non-goals

**Goals**

1. **Supertonic 3 runs inside the app** (31 languages including Arabic, CPU-friendly, ONNX).
2. **Kokoro 82M runs inside the app for English**, as a better English default than Phonon 31M.
3. A **model-agnostic in-app ONNX engine**, so a further model (Piper, Kitten, Fun-CosyVoice3) is a
   manifest entry plus one adapter, not a new engine.
4. The in-app models are **tier A** (verified by CI on all three systems), because they need no
   Python and so can run in every pull request.

**Non-goals**

- Replacing the Python sidecar. Large and PyTorch-only models (Qwen3-TTS, VoxCPM2, MOSS, IndexTTS2…) stay there.
- Kokoro in Japanese, Chinese, Hindi and the other non-English languages (their text-to-phoneme step is far harder to port; they stay on the sidecar for now).
- Voice cloning in the new in-app models (Supertonic and Kokoro have style presets, not cloning).
- A new default model on day one (see section 6).

## 3. What already exists

| Piece | State |
| --- | --- |
| `RuntimeKind = 'phonon' \| 'onnx-web' \| 'sidecar'` | `onnx-web` is declared in the types, the model card and the wizard icons |
| ONNX Runtime Web | **Not bundled today.** An earlier, unused single-session worker and 43 MB of runtime files were removed from the app in the clean-up before launch; this milestone adds the runtime back, together with its first real user |
| Local model server (`electron/model-server.cjs`) | Serves model files over loopback with range requests, so a worker can fetch them by URL |
| Supertonic files | Already pinned: 4 ONNX graphs (`duration_predictor` 3.7 MB, `text_encoder` 36.4 MB, `vector_estimator` 256.5 MB, `vocoder` 101.4 MB), `unicode_indexer.json`, `tts.json`, 10 style presets. About 398 MB |
| Install pipeline | `planInstall` already skips toolchain, environment and first start for non-sidecar models |

**Not yet true:** Kokoro. The pinned repo (`hexgrad/Kokoro-82M`) contains PyTorch `.pth` weights and
`.pt` voice packs only. An ONNX build comes from a different repo and needs its own pinned revision.

## 4. Key decision: where the ONNX engine runs

| | A. Renderer, ONNX Runtime Web | B. Main process, `onnxruntime-node` |
| --- | --- | --- |
| Already in the repo | No (removed until needed; small to add back) | No |
| New native binaries per OS | None | Yes, tens of MB per platform, rebuilt per Electron version |
| Cross-platform effort | None, WebAssembly is identical everywhere | Per-OS builds and signing |
| CPU speed | Slower (WebAssembly; threads need cross-origin isolation, which Phonon already uses) | Native, closest to the Python numbers |
| GPU | Optional WebGPU | CPU, DirectML (Windows) or CUDA with extra packages |
| Memory | WebAssembly heap limits; the guard allows ~2× the model size | Normal process memory |

**Decision:** build **A first**, because the infrastructure exists and it needs nothing per platform.
Measure it (section 8). If it misses the real-time gate on a reference CPU, build **B** behind the
same adapter interface. The adapters (text processing, tensors, loop) are identical in both cases, so
the choice only affects the thin session layer.

## 5. Workstreams

Effort: **S** ≤ half a day · **M** 1–3 days · **L** about a week.

### A. In-app ONNX engine (M–L)

1. **Multi-session worker.** Supertonic needs four graphs alive at once. Write a worker that holds several named sessions (`create`, `run(name, inputs)`, `dispose`), with cancellation and a memory guard **(M)**.
2. **Adapter interface** in TypeScript: `load(ctx)`, `voices()`, `synthesize(request)`, with streaming chunks and an abort signal, mirroring the Python adapters so the Studio, Batch, API and history code does not care which route produced the audio **(M)**.
3. **Engine gate.** Route `onnx-web` models through the existing engine selection; keep the honest "unavailable" state until the adapter ships **(S)**.
4. **Seeded randomness.** Supertonic starts from noise. Provide a seeded generator (so "same text, voice and seed gives the same audio" still holds) **(S)**.
5. **Performance plumbing.** Thread count from settings, optional WebGPU execution provider, warm-up run, and timing stats compatible with the history page **(M)**.

### B. Supertonic 3 adapter (M)

A direct port of the MIT-licensed SDK's pipeline (about 500 lines of Python):

1. **Text front end.** The Unicode processor: emoji removal, symbol normalization, abbreviation expansion, punctuation spacing, language token (`<lang>` or `na`), indexer lookup against `unicode_indexer.json` **(M)**.
2. **Chunking.** Split long text by sentence with the SDK's chunk limits (Korean uses a smaller limit) and join with 0.3 s of silence **(S)**.
3. **Inference loop.** Duration predictor → divide by speed → text encoder → sample masked noisy latent → 5 steps of the vector estimator → vocoder **(M)**.
4. **Styles.** Load the style JSON presets into tensors; list the ten voices with gender **(S)**.
5. **Manifest.** `runtime: 'onnx-web'`, `backend: 'onnx-web'`, runtime pack not required, pinned files unchanged **(S)**.
6. **Parity tests.** Same text must give identical token ids and durations to the Python SDK (run the Python SDK in CI as an oracle); audio is checked with the plausibility analysis rather than sample equality, because the noise generators differ **(M)**.
7. **License gate.** Supertonic is OpenRAIL-M. Show its use restrictions and require acknowledgment (a gap noted in the legal review) **(S)**.

### C. Kokoro 82M English adapter (L, with a research step)

1. **Pick and pin an ONNX build** (a community export such as `onnx-community/Kokoro-82M-ONNX` is the likely source). Confirm its license, file list and hashes, and that its voices match the 54 packs **(verify)** **(S)**.
2. **English text-to-phoneme.** Kokoro needs phonemes. Options: a JavaScript G2P port, or eSpeak NG compiled to WebAssembly (GPL-3.0: compatible with the AGPL, but it must be listed in the notices) **(verify)**. This is the main risk **(M–L)**.
3. **Adapter.** Tokenize phonemes, load a voice pack as the style tensor, run the single graph, return 24 kHz audio **(M)**.
4. **Scope.** US and UK English first. The other seven languages keep using the sidecar, shown with their tier **(S)**.
5. **Manifest.** A new model entry (or an in-app runtime variant of the existing one) so the sidecar and in-app builds do not collide **(M)**.

### D. Verification and CI (M)

1. **Golden synthesis for in-app models.** Port `analyzePcm` to the renderer and run it as install stage 7, so *Test passed* works for every route **(S)**.
2. **Cross-platform E2E.** Extend the Electron end-to-end test to install Supertonic from local fixtures and synthesize, on Windows, Linux (under `xvfb`) and macOS. No Python means no multi-gigabyte downloads, so it can run on every pull request **(M)**.
3. **Tier A.** When those runs are green, promote both models to tier A on all three systems **(S)**.

### E. Product and docs (S–M)

1. **Model cards** show *Runs inside the app* and skip the toolchain and environment steps (already handled by the install plan) **(S)**.
2. **First-run chooser** recommends by system language, using only commercial-safe tier A in-app models **(M)**.
3. **Docs.** `docs/model-support.md` route table, README platform table, third-party notices (Supertonic SDK port is MIT; the model is OpenRAIL-M; eSpeak NG if used) **(S)**.

## 6. How the default is chosen

Phonon 31M stays the default until the new models earn it. A model replaces it as the default for
a given language only if **all** of these hold:

1. Commercial-safe license (Apache-2.0, MIT, or OpenRAIL-M with restrictions shown).
2. Runs in-app with no Python on Windows, Linux and macOS (tier A).
3. Passes the real-time gate (section 8) on the reference CPU.
4. Beats Phonon 31M on the in-app listening review for that language.

Expected outcome: **English → Kokoro** if it passes; **Arabic and the other Supertonic languages →
Supertonic 3**; **Phonon 31M** remains the fallback and the fastest install.

## 7. Order of work

```
Week 1   A1–A3 (multi-session worker, adapter interface)   B1–B2 (text front end, chunking)
Week 2   B3–B6 (inference loop, styles, parity tests)      D1 (golden synthesis in-app)
Week 3   A5 + the performance gate                         D2 (cross-platform E2E)    B7
         ── decision: stay on the renderer, or build the native route ──
Week 4   C1–C5 (Kokoro English)                            E1–E3
```

Supertonic ships first and alone if Kokoro's text-to-phoneme step proves harder than expected.

## 8. Performance gate

Measure on three reference machines (a 4-core laptop CPU, a 16-core desktop, an Apple Silicon Mac)
with the same 20-word sentence, five runs each, after warm-up:

| Metric | Python sidecar (baseline) | Target in-app |
| --- | --- | --- |
| Real-time factor (generation time ÷ audio time) | 0.33 on this machine (Supertonic, 2.44 s audio in 0.8 s) | **≤ 1.0 required, ≤ 0.6 wanted** |
| Time to first audio (cold) | about 120 s including download | **< 10 s after files are on disk** |
| Peak memory | not measured | **< 1.5 GB** |
| Install time from nothing | about 150 s (27 s environment, rest download) | **download time only** |

For reference, Phonon 31M runs at about 0.24× real time on CPU in the same app. If Supertonic in
WebAssembly misses 1.0, try the WebGPU provider for the vector estimator; if that still misses,
build the main-process route (section 4, option B).

## 9. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| WebAssembly is too slow for the 256 MB vector estimator × 5 steps | Not real time | WebGPU provider, then the native route behind the same adapter |
| WebAssembly memory limits or crashes with four sessions | Fails on low-RAM machines | Memory guard; load sessions lazily; release the vocoder between chunks |
| Kokoro text-to-phoneme is hard to port | Kokoro slips | Ship Supertonic alone; keep Kokoro on the sidecar |
| eSpeak NG (GPL-3) in the bundle | Notices and distribution duties | AGPL is compatible; list it in `THIRD_PARTY_NOTICES.md`; confirm with counsel before bundling **(verify)** |
| Port differs from the Python SDK | Bad audio in some languages | Parity tests against the SDK as an oracle in CI |
| Hugging Face repo or hash drift for an ONNX export | Install failures | Pin revisions and hashes like every other model |
| OpenRAIL-M restrictions not surfaced | Legal exposure | Acknowledgment gate and restriction text in the model card |

## 10. Definition of done

- [ ] Supertonic 3 installs and speaks on Windows, Linux and macOS with no Python, and shows *Test passed*.
- [ ] Kokoro English does the same, or the milestone ships without it and says so.
- [ ] The in-app end-to-end test runs on all three systems in CI and is green.
- [ ] The performance table is filled in with real measurements, and the renderer-versus-native decision is recorded.
- [ ] The default-model rule (section 6) is applied and documented, whether or not the default changes.
- [ ] README, model-support docs and third-party notices are updated.

## 11. Open questions

1. **Reference hardware:** which machines count as the "typical user" for the real-time gate?
2. **Default policy:** is one default for everyone acceptable, or should the first-run chooser pick by system language?
3. **Kokoro scope:** is English-only Kokoro worth shipping alone, given the other eight languages stay on the sidecar?
4. **Native route:** are you willing to ship native ONNX binaries per platform if the renderer route is too slow?
