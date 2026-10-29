# Voxarium — Multi-Model Expansion Plan

**Status:** Proposal · **Date:** 29 October 2026 · **Scope:** turn Voxarium (formerly Phonon Studio) from a single-model Phonon 31M studio into a model-agnostic local TTS workstation.

> This revision widens the shortlist from 13 to **35 models**, lists the languages each one actually speaks, calls out every model that supports **Arabic**, and adds an editorial **1–10 quality score** anchored on public benchmarks and model cards. The score is a planning aid, not a measurement; re-verify it against the pinned revision before shipping.

---

## 1. Executive summary

Voxarium today is excellent at one thing: English speech with Phonon 31M, fully on-device, with a small Q8 model and a deep voice catalog. The next step is not "replace Phonon". It is to make the studio **model-aware**:

- one **model registry** that describes what each model can do, what it costs, which languages it speaks, and what hardware it needs;
- one **adapter layer** so a model can run in the existing `phonon-tts` WebGPU/WASM runtime, in an ONNX browser runtime, or in a local sidecar process;
- one **download center** that checks the machine, shows the license, downloads only the chosen pack, verifies it, and lets the user uninstall it;
- one **capability-driven UI** that enables or hides cloning, multi-speaker, emotion, streaming, language selection and phoneme controls depending on the selected model.

**The 35-model shortlist at a glance**

| Tier | Models | Why they are here |
| --- | --- | --- |
| **Best overall quality** | **Breeze TTS 2 (10)**, Qwen3-TTS (9), VoxCPM2 (9), MOSS-TTS v1.5 (9), Higgs Audio v2 (9), IndexTTS2 (9) | Current open-weight state of the art for naturalness, cloning and expression |
| **Best quality per byte** | Kokoro-82M (8), Supertonic 3 (8), Sopro V2 Turbo (7), Pocket TTS (7), Kitten TTS (5) | Small, fast, CPU-friendly, commercially usable |
| **Best language coverage** | OmniVoice (646), MMS-TTS (1,100+), Piper (35), Supertonic 3 (31), MOSS-TTS v1.5 (31), VoxCPM2 (30) | From long-tail locales to full multilingual production |
| **Best Arabic** | SILMA TTS (dedicated ar/en), Magpie-TTS 357M (commercial-safe), OmniVoice (14 Arabic varieties), VoxCPM2, MOSS-TTS, FireRedTTS3, Chatterbox, Supertonic 3, OpenAudio S1-mini | 13 of the 35 models support Arabic — see §5.0 |
| **Best cloning** | Breeze TTS 2, Chatterbox, CosyVoice2, F5-TTS, IndexTTS2, Higgs Audio v2, VoxCPM2, OpenAudio S1-mini | Local zero-shot cloning, no upload |
| **Best dialogue / expression** | Dia-1.6B (2 speakers), VibeVoice (4 speakers), Higgs Audio v2, CSM-1B, IndexTTS2, Orpheus | Podcast, audiobook and character workflows |
| **Best CPU / low-end** | Piper, Kokoro, Kitten TTS, Pocket TTS, Supertonic 3 | Runs on 2–8 GB machines, no GPU |

**The fastest visible win** is still Gradium's own **Phonon 40M family**. It uses the same file layout and the same `phonon-tts` runtime. Adding `phonon-40m-multilingual` (English, French, German, Spanish, Portuguese) is mostly registry, download and UI work — not a new inference engine. That gives the app five languages in the first milestone.

**The second win** is **browser-native breadth**: Kokoro-82M (8 languages, 54 voices, Apache-2.0), Piper (35 languages, MIT), Supertonic 3 (31 languages, ONNX CPU, Arabic included), Kitten TTS and Sopro V2 Turbo. All fit the app's offline, no-server identity.

**The third win** is **local cloning and dialogue** through optional sidecar runtimes: Chatterbox (23 languages, MIT, zero-shot cloning), CosyVoice2 (9 languages + 18 Chinese dialects), SILMA TTS (Arabic/English), and Dia (English dialogue and non-verbal sounds). These are heavy; they should be opt-in downloads with a hardware gate, not default installs.

**Recommended first release after this plan:** Phonon 40M multilingual + English, the model registry, capability gating, hardware fit checks and per-model downloads. Then Kokoro, Piper and Supertonic 3. Then the cloning sidecar. The 3–9B flagships (Qwen3-TTS, VoxCPM2, MOSS, OmniVoice, Breeze TTS 2) come after the sidecar has proven itself on smaller models.

---

## 2. What exists today

| Area | Current state | What it means for multi-model |
| --- | --- | --- |
| Engine | `phonon-tts` 0.5.0, WebGPU/WASM worker, Q8 GGUF or F32 safetensors | Same runtime already supports the Phonon 40M family |
| Model | `gradium/phonon-31m-en`, 31M, English, Apache-2.0 | Becomes `phonon-31m-en`, the default and the compatibility baseline |
| Voices | 102 catalog voices + custom imports/clones, `1×512×125` speaker tensors | Catalog already contains en/es/de/fr/pt voices (38/25/13/15/12) |
| Cloning | Gradium cloud once → local `.safetensors`; import is offline | Model-dependent: not every model consumes the same voice format |
| Settings | quality, device, GPU preference, threads, language, rewrites, conditions | Most become per-model settings with model-specific defaults |
| Downloads | model files + voice files, hash validation, progress | Needs packs, licenses, disk-space checks, uninstall |
| UI | Studio, Voices, History, Batch, Settings | Needs model picker, capability badges, model details, fit warnings |
| Storage | `userData/models`, `userData/voices`, `userData/audio` | Needs `userData/models/<modelId>/` and per-model voice folders |

The current architecture is a good foundation. The main change is to stop assuming that "the model" is a global singleton and start treating it as a **selected runtime + manifest + capabilities**.

---

## 3. Design principles

1. **Offline first.** Models are downloaded once; generation never needs a network. Cloud cloning remains optional and explicitly disclosed.
2. **The model is data, not code.** A JSON manifest describes files, hashes, languages, voices, features and hardware requirements. Adding a compatible model should not require a new settings screen.
3. **Capabilities, not conditionals.** The UI asks "does this model support X?" instead of "is this Kokoro?".
4. **Fit before download.** Tell the user *before* a 2 GB download whether the machine can run it, and why.
5. **Licenses are visible.** Commercial vs non-commercial is a first-class badge, not a line in a README.
6. **One engine failure must not break the app.** Every adapter loads behind a timeout and a clear error state; the last working model stays selectable.
7. **Preserve the current experience.** Existing voices, history, batch renders and settings keep working after migration.
8. **Score, don't rank blindly.** Every model carries a 1–10 quality score and the evidence behind it, so users can compare a 15M model with an 8.5B model honestly.

---

## 4. Model shortlist

### 4.1 Selection logic and rating rubric

Models were shortlisted by five questions:

- Can it run locally and offline after download?
- Is the license usable for a desktop app (and is commercial use allowed)?
- Does it add a capability or language the app does not already have?
- Is the engineering path realistic in this Electron/React/TypeScript codebase?
- Is it good enough to justify the download, or is it superseded by a better model?

**Quality score (1–10).** The score is a weighted editorial judgement:

| Weight | Dimension | What it measures |
| --- | --- | --- |
| 40% | Naturalness and prosody | How human the output sounds on the model card, demo page and public leaderboard samples |
| 25% | Cloning and expression | Zero-shot similarity, emotion/style control, non-verbal and dialogue ability |
| 20% | Language coverage and depth | Number of languages, and whether each language has usable quality rather than a token checkpoint |
| 15% | Efficiency and deployability | Size, CPU/GPU floor, streaming latency, ONNX/browser viability |

| Score | Meaning |
| --- | --- |
| **10** | Best open-weight quality available in its language pair; a reference point for the field |
| **9** | Near state of the art; production-ready if the hardware and license fit |
| **8** | Excellent; a strong default for its class or language |
| **7** | Good; clear strengths and clear trade-offs |
| **6** | Competent; usable, but superseded on quality or convenience |
| **5** | Niche or experimental; include only for coverage or research |
| **4 or below** | Legacy, unstable or not worth the support burden |

Anchors: Artificial Analysis TTS Elo where the model is listed, the vendor's own WER/CER and speaker-similarity tables, and the public demo pages. Scores are **relative to October 2026** and must be re-checked at pin time. A high score does **not** mean "ship it by default" — license, size and language coverage still decide that.

### 4.2 Recommended models

`AR` = supports Arabic. `Clone` = local zero-shot cloning unless marked cloud/import. Sizes are planning estimates for the files the app would ship, not the whole Hugging Face repository.

| # | Model | Params | Download (est.) | Runtime | Languages | AR | Clone | Dialogue | Emotion | License | Score |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Phonon 31M English** | 31M | 64.5 MB Q8 / 102.8 MB F32 | `phonon-tts` (WASM/WebGPU) | English | — | Import / cloud | — | Duration/pacing | **Apache-2.0** | 7 |
| 2 | **Phonon 40M Multilingual** | 40M | 74.6 MB Q8 | `phonon-tts` | English, French, German, Spanish, Portuguese | — | Import / cloud | — | Duration/pacing | CC-BY-NC-4.0 | 7 |
| 3 | **Kokoro-82M** | 82M | ~86 MB Q8 / ~164 MB FP16 | ONNX Runtime Web | English (US, UK), Japanese, Mandarin Chinese, Spanish, French, Hindi, Italian, Brazilian Portuguese | — | — | — | Style vectors | **Apache-2.0** | 8 |
| 4 | **Piper** | 20–60M per voice | 20–100 MB per voice | ONNX Runtime Web (WASM) | 35 languages, 39 locales (full list §5.3) | ✅ `ar_JO` | — | — | — | **MIT** | 6 |
| 5 | **MeloTTS** | ~50M per language | 50–200 MB per language | ONNX Runtime Web | English (US, UK, Indian, Australian), Spanish, French, Chinese, Japanese, Korean | — | — | — | — | **MIT** | 6 |
| 6 | **MMS-TTS** | 36M per language | 36–140 MB per language | ONNX / Transformers.js | 1,100+ languages, one checkpoint each (indexed, §5.5) | ✅ `ara` | — | — | — | CC-BY-NC-4.0 | 5 |
| 7 | **Kitten TTS** | 15M | ~25 MB | ONNX Runtime Web | English | — | — | — | — | **Apache-2.0** | 5 |
| 8 | **Pocket TTS** | 100M | ~200 MB | Local sidecar | English, French, German, Portuguese, Italian, Spanish, Dutch | — | **Local** | — | — | **MIT** | 7 |
| 9 | **Supertonic 3** | ~66M | ~400 MB ONNX | ONNX Runtime Web (CPU) | 31 languages (full list §5.8) | ✅ | — | — | Expression tags | OpenRAIL | 8 |
| 10 | **Sopro V2 Turbo** | 122M | ~630 MB | ONNX Runtime Web | English, Portuguese, French, German | — | **Local** | — | — | **Apache-2.0** | 7 |
| 11 | **OmniVoice** | 612M | ~1.2 GB | Local sidecar | 646 languages/dialects (full list §16.5) | ✅ 14 varieties | **Local** | — | Voice design | **Apache-2.0** | 8 |
| 12 | **Qwen3-TTS 1.7B** | 1.93B | ~3.5 GB BF16 / ~1.8 GB Q8 | Local sidecar | Chinese, English, Japanese, Korean, German, French, Russian, Portuguese, Spanish, Italian | — | **Local** | — | Instruct | **Apache-2.0** | 9 |
| 13 | **MOSS-TTS v1.5** | 8.49B | ~17 GB BF16 / ~5 GB Q4 | Local sidecar | 31 languages (full list §5.12) | ✅ | **Local** | — | Instruct, pause tags | **Apache-2.0** | 9 |
| 14 | **VoxCPM2** | 2.29B | ~4.6 GB BF16 / ~1.3 GB Q4 | Local sidecar | 30 languages (full list §5.13) | ✅ | **Local** | — | Voice design | **Apache-2.0** | 9 |
| 15 | **FireRedTTS3** | ~4.2B | ~8.5 GB BF16 | Local sidecar | 24 languages + 21 Chinese dialects (full list §5.14) | ✅ | **Local** | — | Voice design, editing | **Apache-2.0** | 8 |
| 16 | **Audio8 TTS** | 601M | ~1.2 GB | Local sidecar | 11 languages (full list §5.15) | — | **Local** | — | — | **Apache-2.0** | 8 |
| 17 | **Breeze TTS 2** | 3.47B | ~7 GB BF16 / ~2 GB Q4 | Local sidecar | English, Chinese | — | **Local** | — | Voice direction, vocal events | BreezeBlue NC | **10** |
| 18 | **Magpie-TTS 357M** | 364M | ~0.7 GB | Local sidecar | 12 languages (full list §5.17) | ✅ | — | — | — | NVIDIA Open Model | 8 |
| 19 | **Chatterbox Multilingual** | 0.5B | ~3.2 GB F16 / ~1 GB Q4 | Local sidecar | 23 languages (full list §5.18) | ✅ | **Local** | — | Exaggeration | **MIT** (watermarked) | 8 |
| 20 | **CosyVoice2-0.5B** | 0.5B | ~3 GB | Local sidecar | 9 languages + 18 Chinese dialects (full list §5.19) | — | **Local** | — | Instruct (emotion, speed) | **Apache-2.0** | 8 |
| 21 | **F5-TTS** | 0.3B | ~1.35 GB | Local sidecar | English, Chinese | — | **Local** | — | Reference style | CC-BY-NC-4.0 | 7 |
| 22 | **XTTS-v2** | 467M | ~1.9 GB | Local sidecar | 17 languages (full list §5.21) | ✅ | **Local** | Multi-reference | Style transfer | Coqui CPML | 6 |
| 23 | **IndexTTS2** | ~1.5B | ~6 GB | Local sidecar | English, Chinese | — | **Local** | — | Emotion, duration | Bilibili custom | 9 |
| 24 | **MegaTTS3** | 0.45B | ~1.2 GB + latents | Local sidecar | English, Chinese | — | **Local** | — | — | **Apache-2.0** | 7 |
| 25 | **Spark-TTS** | 0.5B | ~1 GB | Local sidecar | English, Chinese | — | **Local** | — | — | CC-BY-NC-SA-4.0 | 6 |
| 26 | **Dia-1.6B** | 1.6B | ~3.2 GB F16 | Local sidecar | English | — | **Local** | **2 speakers** | Non-verbal tags | **Apache-2.0** | 7 |
| 27 | **VibeVoice-1.5B** | 1.5B (2.7B repo) | ~5.4 GB BF16 | Local sidecar | English, Chinese | — | — | **4 speakers** | Expressive | **MIT** | 7 |
| 28 | **Higgs Audio v2 3B** | 3B (5.8B repo) | ~11.5 GB BF16 | Local sidecar | English, Chinese, German, Korean | — | **Local** | Multi-speaker | **✅** | Boson AI custom | 9 |
| 29 | **Orpheus-3B** | 3B (3.8B repo) | ~7.6 GB BF16 | Local sidecar | English | — | **Local** | — | **✅** | **Apache-2.0** | 7 |
| 30 | **CSM-1B** | 1B (1.55B repo) | ~3.1 GB | Local sidecar | English | — | **Local** | 2 speakers | **✅** | **Apache-2.0** | 6 |
| 31 | **Zonos-v0.1** | 1.6B | ~3.2 GB | Local sidecar | English | — | **Local** | — | **✅** | **Apache-2.0** | 6 |
| 32 | **Parler-TTS large** | 2.3B | ~4.7 GB | Local sidecar | English | — | — | — | Text description | **Apache-2.0** | 6 |
| 33 | **SILMA TTS** | 150M | ~0.3 GB FP16 | Local sidecar | Arabic, English | ✅ | **Local** | — | — | **Apache-2.0** | 7 |
| 34 | **Fasih-TTS** | 467M (XTTS base) | ~1.9 GB | Local sidecar | Arabic (MSA/Fusha and dialects) | ✅ | **Local** | — | — | Custom / review | 6 |
| 35 | **OpenAudio S1-mini** | ~0.5B | ~1 GB | Local sidecar | 13 languages (full list §5.34) | ✅ | **Local** | — | Emotion tags | CC-BY-NC-SA-4.0 | 8 |

> **Reading the table:** a 10 is not a universal recommendation. Breeze TTS 2 is the best-sounding open model in English and Chinese, but it is non-commercial and does not speak Arabic. Magpie-TTS scores 8 with no cloning, while SILMA scores 7 because it is small and Arabic-first. Use the score with the language, license and hardware columns.

### 4.3 Best-in-class picks

| Need | Pick | Score | Why |
| --- | --- | --- | --- |
| Best English/Chinese quality | **Breeze TTS 2** | 10 | #1 open-weight on the Artificial Analysis TTS leaderboard at release; cloning, voice design and vocal events; <40 ms time-to-first-audio |
| Best multilingual flagship | **Qwen3-TTS 1.7B** | 9 | 10 languages, Apache-2.0, streaming, ~97 ms latency, cloning and voice design |
| Best 30-language flagship | **VoxCPM2** | 9 | 2B, 48 kHz, 30 languages including Arabic, Apache-2.0, voice design |
| Best 31-language heavyweight | **MOSS-TTS v1.5** | 9 | 8.5B, 31 languages including Arabic, pause markers, cloning |
| Best language coverage | **OmniVoice** | 8 | 646 languages/dialects, 14 Arabic varieties, Apache-2.0, 612M |
| Best Arabic-first | **SILMA TTS** | 7 | 150M bilingual Arabic/English, Apache-2.0, <8 s cloning, diacritics |
| Best commercial-safe Arabic | **Magpie-TTS 357M** | 8 | NVIDIA Open Model License, 12 languages including Arabic, no cloning |
| Best tiny browser model | **Kokoro-82M** | 8 | 82M, 54 voices, Apache-2.0, excellent quality per byte |
| Best CPU multilingual | **Supertonic 3** | 8 | 31 languages including Arabic, ONNX CPU, expression tags |
| Best low-end coverage | **Piper** | 6 | 35 languages, MIT, runs on 2 GB, voice-per-download |
| Best local cloning | **Chatterbox / CosyVoice2** | 8 | Permissive licenses, 23 / 9 languages, emotion controls |
| Best dialogue | **VibeVoice-1.5B** | 7 | Up to 4 speakers, MIT, long-form podcasts |
| Best expressive | **Higgs Audio v2** | 9 | Emotion, multi-speaker, music and humming, 4 languages |
| Best small Arabic/English clone | **SILMA TTS** | 7 | 150M, Apache-2.0, 8-second reference |
| Best research ceiling | **IndexTTS2** | 9 | Emotion and duration control; custom license needs review |

### 4.4 What to skip, and what to watch

- **Skip as defaults:** legacy Tacotron/FastSpeech checkpoints, Bark, and any model whose only distribution is a cloud API. They add maintenance without adding a capability.
- **Skip unless requested:** MMS-TTS as a default pack. It is the only realistic path to 1,000+ languages, but it is non-commercial, 36M per language, and quality is uneven. Keep it as a searchable advanced pack.
- **Skip for now:** the very large 8B+ models as *default* installs. MOSS-TTS v1.5 is excellent, but 17 GB and 24 GB+ VRAM is a power-user download. Put it behind a "Flagship" filter, not on the first screen.
- **Watch (not shortlisted yet):** dots.tts 2B, Maya1, FishAudio S1 (full), Kokoro v2, Chatterbox Turbo, and the next Supertonic/OmniVoice revisions. Re-evaluate every quarter; the field moves faster than this document.
- **Avoid as defaults:** models with unclear licenses (IndexTTS2, Fasih, Higgs), non-commercial weights (Breeze, XTTS, F5, Spark, OpenAudio, Phonon 40M, MMS), and any model that requires sending text or audio to a cloud service for basic generation.

---

## 5. Languages per model

### 5.0 Arabic support at a glance

**13 of the 35 models support Arabic.** This is the explicit list; everything not in it should be treated as non-Arabic until its pinned manifest says otherwise.

| Model | Arabic coverage | Clone | License | Score | Arabic notes |
| --- | --- | --- | --- | --- | --- |
| **SILMA TTS** | Arabic (MSA/Fusha) + English | ✅ | Apache-2.0 | 7 | Dedicated bilingual model; Arabic diacritics; dialect coverage claimed; best small Arabic-first pick |
| **Magpie-TTS 357M** | Arabic (MSA) | — | NVIDIA Open Model | 8 | Commercial-friendly, 364M, no cloning; strong production default for MSA |
| **OmniVoice** | 14 Arabic varieties: `arb` (MSA), `arq` (Algerian), `ars` (Najdi), `ary` (Moroccan), `arz` (Egyptian), `acm` (Mesopotamian), `aeb` (Tunisian), `afb` (Gulf), `apc` (North Levantine), `apd` (Sudanese), `avl` (Eastern Egyptian), `ayl` (Libyan), `ayp` (North Mesopotamian), `shu` (Chadian) | ✅ | Apache-2.0 | 8 | Widest Arabic variety coverage; quality varies by variety; verify each one |
| **VoxCPM2** | Arabic (`ar`) | ✅ | Apache-2.0 | 9 | 30-language flagship, 48 kHz, voice design; one Arabic voice profile |
| **MOSS-TTS v1.5** | Arabic (`ar`) | ✅ | Apache-2.0 | 9 | 8.5B heavyweight; best when quality matters more than size |
| **FireRedTTS3** | Arabic | ✅ | Apache-2.0 | 8 | 24 languages + voice design/editing; strong cloning metrics |
| **Chatterbox Multilingual** | Arabic | ✅ | MIT (watermarked) | 8 | 23 languages; outputs carry a Perth watermark |
| **OpenAudio S1-mini** | Arabic | ✅ | CC-BY-NC-SA-4.0 | 8 | 13 languages; emotion tags; non-commercial |
| **Supertonic 3** | Arabic | — | OpenRAIL | 8 | 31 languages; ONNX CPU; expression tags; no cloning |
| **XTTS-v2** | Arabic | ✅ | Coqui CPML | 6 | Legacy but widely used; non-commercial |
| **Piper** | Arabic (`ar_JO`) | — | MIT | 6 | Fast, CPU-only, robotic; one Jordanian Arabic voice |
| **MMS-TTS** | Arabic (`ara`) | — | CC-BY-NC-4.0 | 5 | 36M checkpoint; low-resource fallback |
| **Fasih-TTS** | Arabic (MSA/Fusha + dialects) | ✅ | Custom / review | 6 | XTTS-v2 fine-tune; research-grade; verify license before shipping |

**Models that do *not* support Arabic** (despite often being described as "multilingual"): **Breeze TTS 2** (English + Chinese only), **Qwen3-TTS** (10 languages, no Arabic), **Kokoro**, **Pocket TTS**, **Audio8 TTS**, **Sopro V2 Turbo**, **MeloTTS**, **Kitten TTS**, **CosyVoice2**, **F5-TTS**, **IndexTTS2**, **MegaTTS3**, **Spark-TTS**, **Dia-1.6B**, **VibeVoice**, **Higgs Audio v2**, **Orpheus**, **CSM-1B**, **Zonos**, **Parler-TTS**, and the **Phonon** family. Do not show an Arabic language chip for these.

> Arabic quality is not uniform. MSA (Fusha) is the best-covered; Gulf, Egyptian, Moroccan and Levantine varieties are usable in OmniVoice but need per-variety QA. Show a "variety" selector, not a single "Arabic" chip, and default to MSA.

### 5.1 Phonon 31M and 40M family

- **Phonon 31M English:** English (`en`), with US/UK accent voices in the catalog. English-only checkpoint; other-language text is read with English pronunciation.
- **Phonon 40M Multilingual:** English (`en`), French (`fr`), German (`de`), Spanish (`es`), Portuguese (`pt`).
- **Phonon 40M single-language packs:** French, German, Spanish, Portuguese.
- The voice catalog also contains Spanish, German, French and Portuguese voices; those are useful with the 40M family, not with 31M.

### 5.2 Kokoro-82M

8 languages, 54 voices, 9 locales:

- English (US) — 20 voices
- English (UK) — 8 voices
- Japanese (`ja`) — 5 voices
- Mandarin Chinese (`zh`) — 8 voices
- Spanish (`es`) — 3 voices
- French (`fr`) — 1 voice
- Hindi (`hi`) — 4 voices
- Italian (`it`) — 2 voices
- Brazilian Portuguese (`pt-BR`) — 3 voices

> English US/UK count as one language with two locales. Some non-English voices are thin (French has a single voice); show a quality note rather than hiding them.

### 5.3 Piper

35 languages, 39 locales in the official voice zoo:

Arabic (`ar_JO`) · Catalan (`ca_ES`) · Czech (`cs_CZ`) · Welsh (`cy_GB`) · Danish (`da_DK`) · German (`de_DE`) · Greek (`el_GR`) · English (`en_GB`, `en_US`) · Spanish (`es_ES`, `es_MX`) · Persian (`fa_IR`) · Finnish (`fi_FI`) · French (`fr_FR`) · Hungarian (`hu_HU`) · Icelandic (`is_IS`) · Italian (`it_IT`) · Georgian (`ka_GE`) · Kazakh (`kk_KZ`) · Luxembourgish (`lb_LU`) · Latvian (`lv_LV`) · Nepali (`ne_NP`) · Dutch (`nl_BE`, `nl_NL`) · Norwegian (`no_NO`) · Polish (`pl_PL`) · Portuguese (`pt_BR`, `pt_PT`) · Romanian (`ro_RO`) · Russian (`ru_RU`) · Slovak (`sk_SK`) · Slovenian (`sl_SI`) · Serbian (`sr_RS`) · Swedish (`sv_SE`) · Swahili (`sw_CD`) · Turkish (`tr_TR`) · Ukrainian (`uk_UA`) · Vietnamese (`vi_VN`) · Chinese (`zh_CN`).

Piper is voice-per-download, so the app should show a language → locale → voice drill-down rather than a 39-item flat list.

### 5.4 MeloTTS

- English (US, UK, Indian, Australian, default)
- Spanish (`es`)
- French (`fr`)
- Chinese (`zh`, mixed Chinese/English)
- Japanese (`ja`)
- Korean (`ko`)

### 5.5 MMS-TTS

- 1,100+ languages, one checkpoint per language, indexed by ISO 639-3 code.
- Key codes: `ara` (Arabic), `eng`, `fra`, `deu`, `spa`, `por`, `hin`, `swh`, `zho`, `jpn`, `kor`, `rus`, `tur`, `vie`, `ukr`, `pol`, `nld`, `ita`, `fas`, `urd`, `ben`, `tam`, `tel`, `mar`, `guj`, `kan`, `mal`, `pan`, `ory`, `asm`, `nep`, `sin`, `amh`, `hau`, `ibo`, `yor`, `zul`, `xho`, `afr`, `swe`, `nor`, `dan`, `fin`, `ell`, `ces`, `slk`, `slv`, `hrv`, `srp`, `bul`, `ron`, `hun`, `cat`, `eus`, `glg`, `cym`, `gle`, `isl`, `lav`, `lit`, `est`, `kaz`, `uzb`, `aze`, `hye`, `kat`, `mon`, `khm`, `lao`, `mya`, `tha`, `ind`, `msa`, `tgl`, `jav`, `sun`, `ceb`.
- The full list must be generated from Meta's MMS coverage index at build time, not hard-coded. The app ships a searchable index and downloads a language pack by ISO code and name.
- Quality varies heavily by language and data availability; show a "community coverage" note.

### 5.6 Kitten TTS

- English only (`en`).
- 15M parameters, CPU-first, developer preview; treat as a fast draft voice, not a production narrator.

### 5.7 Pocket TTS

7 languages:

English (`en`) · French (`fr`) · German (`de`) · Portuguese (`pt`) · Italian (`it`) · Spanish (`es`) · Dutch (`nl`).

- Also ships tiny English-only models (18.2M, 6.9M, 1.9M) for low-power devices.
- No Arabic.

### 5.8 Supertonic 3

31 languages:

Arabic (`ar`) · Bulgarian (`bg`) · Czech (`cs`) · Danish (`da`) · German (`de`) · Greek (`el`) · English (`en`) · Spanish (`es`) · Estonian (`et`) · Finnish (`fi`) · French (`fr`) · Hindi (`hi`) · Croatian (`hr`) · Hungarian (`hu`) · Indonesian (`id`) · Italian (`it`) · Japanese (`ja`) · Korean (`ko`) · Lithuanian (`lt`) · Latvian (`lv`) · Dutch (`nl`) · Polish (`pl`) · Portuguese (`pt`) · Romanian (`ro`) · Russian (`ru`) · Slovak (`sk`) · Slovenian (`sl`) · Swedish (`sv`) · Turkish (`tr`) · Ukrainian (`uk`) · Vietnamese (`vi`).

- ONNX CPU; expression tags; no zero-shot cloning (voice styles instead).

### 5.9 Sopro V2 Turbo

4 languages:

English (`en`) · Portuguese (`pt`) · French (`fr`) · German (`de`).

- 122M; streaming; on-device; voice cloning tag present. No Arabic.

### 5.10 OmniVoice

**646 languages and dialects**, the broadest coverage in the shortlist. It includes 14 Arabic varieties (`arb`, `arq`, `ars`, `ary`, `arz`, `acm`, `aeb`, `afb`, `apc`, `apd`, `avl`, `ayl`, `ayp`, `shu`).

Major languages include: Afrikaans · Albanian · Amharic · Arabic (MSA + 13 varieties) · Armenian · Assamese · Azerbaijani · Basque · Belarusian · Bengali · Bosnian · Bulgarian · Burmese · Catalan · Cebuano · Chinese (Mandarin, Cantonese, Wu, Min Nan) · Croatian · Czech · Danish · Dutch · English · Estonian · Faroese · Finnish · French · Galician · Georgian · German · Greek · Gujarati · Haitian Creole · Hausa · Hebrew · Hindi · Hungarian · Icelandic · Igbo · Indonesian · Irish · Italian · Japanese · Javanese · Kannada · Kazakh · Khmer · Kinyarwanda · Korean · Kurdish · Kyrgyz · Lao · Latin · Latvian · Lithuanian · Luxembourgish · Macedonian · Malagasy · Malay · Malayalam · Maltese · Marathi · Mongolian · Nepali · Norwegian · Occitan · Odia · Pashto · Persian · Polish · Portuguese · Punjabi · Romanian · Russian · Serbian · Sinhala · Slovak · Slovenian · Somali · Spanish · Sundanese · Swahili · Swedish · Tagalog · Tajik · Tamil · Tatar · Telugu · Thai · Tibetan · Tigrinya · Turkish · Turkmen · Ukrainian · Urdu · Uzbek · Vietnamese · Welsh · Wolof · Xhosa · Yiddish · Yoruba · Zulu.

The complete 646-code list is in **§16.5**. Treat this as a coverage model: excellent breadth, good cloning, but quality varies by language. Show a per-language quality note and do not claim "production quality in 646 languages" in the UI.

### 5.11 Qwen3-TTS 1.7B

10 languages:

Chinese (`zh`) · English (`en`) · Japanese (`ja`) · Korean (`ko`) · German (`de`) · French (`fr`) · Russian (`ru`) · Portuguese (`pt`) · Spanish (`es`) · Italian (`it`).

- Streaming, ~97 ms latency, voice cloning and voice design, Apache-2.0.
- **No Arabic.**

### 5.12 MOSS-TTS v1.5

31 languages:

Arabic (`ar`) · Cantonese (`yue`) · Chinese (`zh`) · Czech (`cs`) · Danish (`da`) · Dutch (`nl`) · English (`en`) · Finnish (`fi`) · French (`fr`) · German (`de`) · Greek (`el`) · Hebrew (`he`) · Hindi (`hi`) · Hungarian (`hu`) · Italian (`it`) · Japanese (`ja`) · Korean (`ko`) · Macedonian (`mk`) · Malay (`ms`) · Persian (`fa`) · Polish (`pl`) · Portuguese (`pt`) · Romanian (`ro`) · Russian (`ru`) · Spanish (`es`) · Swahili (`sw`) · Swedish (`sv`) · Tagalog (`tl`) · Thai (`th`) · Turkish (`tr`) · Vietnamese (`vi`).

- 8.49B parameters; cloning; pause markers; Apache-2.0. Heavy but excellent.

### 5.13 VoxCPM2

30 languages:

Arabic (`ar`) · Burmese (`my`) · Chinese (`zh`) · Danish (`da`) · Dutch (`nl`) · English (`en`) · Finnish (`fi`) · French (`fr`) · German (`de`) · Greek (`el`) · Hebrew (`he`) · Hindi (`hi`) · Indonesian (`id`) · Italian (`it`) · Japanese (`ja`) · Khmer (`km`) · Korean (`ko`) · Lao (`lo`) · Malay (`ms`) · Norwegian (`no`) · Polish (`pl`) · Portuguese (`pt`) · Russian (`ru`) · Spanish (`es`) · Swahili (`sw`) · Swedish (`sv`) · Tagalog (`tl`) · Thai (`th`) · Turkish (`tr`) · Vietnamese (`vi`).

- 2.29B; 48 kHz; tokenizer-free diffusion autoregressive; voice design; Apache-2.0.

### 5.14 FireRedTTS3

24 languages:

Arabic · Cantonese · Chinese · Czech · Dutch · English · Finnish · French · German · Greek · Hindi · Indonesian · Italian · Japanese · Korean · Polish · Portuguese · Romanian · Russian · Spanish · Thai · Turkish · Ukrainian · Vietnamese.

Plus 21 Chinese dialects: Anhui · Fujian · Gansu · Guizhou · Hebei · Henan · Hubei · Hunan · Jiangxi · Liaoning · Minnan · Ningxia · Shaanxi · Shandong · Shanghai · Shanxi · Sichuan · Tianjin · Wenzhou · Wu · Yunnan.

- Base variant: zero-shot cloning. Instruct variant: voice design and speech editing (semantic insert/delete/substitute, acoustic speed/pitch/volume).

### 5.15 Audio8 TTS

11 languages:

Cantonese (`yue`) · Chinese (`zh`) · Dutch (`nl`) · English (`en`) · French (`fr`) · German (`de`) · Italian (`it`) · Japanese (`ja`) · Korean (`ko`) · Polish (`pl`) · Spanish (`es`).

- 601M; 44.1 kHz codec; zero-shot cloning; Apache-2.0. No Arabic.

### 5.16 Breeze TTS 2

2 languages:

English (`en`) · Chinese (`zh`).

- 3.47B; #1 open-weight on the Artificial Analysis TTS leaderboard at release; voice cloning, voice design, voice direction and vocal events; <40 ms time-to-first-audio; ~7.7 GiB VRAM.
- Weights: BreezeBlue Research & Non-Commercial License; code Apache-2.0. **No Arabic.**

### 5.17 Magpie-TTS 357M

12 languages:

Arabic (`ar`) · German (`de`) · English (`en`) · Spanish (`es`) · French (`fr`) · Hindi (`hi`) · Italian (`it`) · Japanese (`ja`) · Korean (`ko`) · Portuguese (`pt`) · Vietnamese (`vi`) · Chinese (`zh`).

- 364M; encoder–decoder transformer; NVIDIA Open Model License (commercial use allowed); zero-shot cloning was removed for security reasons; IPA G2P and code-switching support.

### 5.18 Chatterbox Multilingual

23 languages:

Arabic (`ar`) · Danish (`da`) · German (`de`) · Greek (`el`) · English (`en`) · Spanish (`es`) · Finnish (`fi`) · French (`fr`) · Hebrew (`he`) · Hindi (`hi`) · Italian (`it`) · Japanese (`ja`) · Korean (`ko`) · Malay (`ms`) · Dutch (`nl`) · Norwegian (`no`) · Polish (`pl`) · Portuguese (`pt`) · Russian (`ru`) · Swedish (`sv`) · Swahili (`sw`) · Turkish (`tr`) · Chinese (`zh`).

- Zero-shot cloning, exaggeration control, MIT-licensed code/weights, output watermark (Perth). Dedicated single-language packs exist for Chinese, LatAm Spanish, Brazilian Portuguese, Spain Spanish, Portugal Portuguese and Hindi.

### 5.19 CosyVoice2-0.5B

9 languages:

Chinese (`zh`) · English (`en`) · French (`fr`) · Spanish (`es`) · Japanese (`ja`) · Korean (`ko`) · Italian (`it`) · Russian (`ru`) · German (`de`).

Plus 18+ Chinese dialects/accents (Guangdong, Minnan, Sichuan, Dongbei, Shaanxi, Shanxi, Shanghai, Tianjin, Shandong, Ningxia, Gansu, etc.). Show these as a sub-list under Chinese, not as separate top-level languages. **No Arabic.**

### 5.20 F5-TTS

- English (`en`)
- Chinese (`zh`)

Community fine-tunes exist for other languages, but they are not part of the default pack. **No Arabic.**

### 5.21 XTTS-v2

17 languages:

English (`en`) · Spanish (`es`) · French (`fr`) · German (`de`) · Italian (`it`) · Portuguese (`pt`) · Polish (`pl`) · Turkish (`tr`) · Russian (`ru`) · Dutch (`nl`) · Czech (`cs`) · Arabic (`ar`) · Chinese (`zh-cn`) · Japanese (`ja`) · Hungarian (`hu`) · Korean (`ko`) · Hindi (`hi`).

- Coqui CPML; non-commercial; legacy but still the compatibility baseline for many voice-cloning tools.

### 5.22 IndexTTS2

- English (`en`)
- Chinese (`zh`)

Emotion and duration control; zero-shot cloning. License is the **bilibili Model Use License Agreement** (custom; review before commercial use). **No Arabic.**

### 5.23 MegaTTS3

- English (`en`)
- Chinese (`zh`)

0.45B transformer; Apache-2.0; zero-shot cloning; sparse alignment. **No Arabic.**

### 5.24 Spark-TTS

- English (`en`)
- Chinese (`zh`)

0.5B; zero-shot cloning; CC-BY-NC-SA-4.0 (non-commercial, share-alike). **No Arabic.**

### 5.25 Dia-1.6B

- English (`en`) only.

Native two-speaker dialogue, `[S1]` / `[S2]` tags, non-verbal sounds (laughs, sighs, coughs). Apache-2.0. **No Arabic.**

### 5.26 VibeVoice-1.5B

- English (`en`)
- Chinese (`zh`)

Long-form multi-speaker podcasts, up to 4 speakers; MIT; no documented reference-audio cloning (use built-in speaker prompts). **No Arabic.**

### 5.27 Higgs Audio v2 3B

- English (`en`)
- Chinese (`zh`)
- German (`de`)
- Korean (`ko`)

Emotion, multi-speaker dialogue, background music and humming; zero-shot cloning; custom Boson AI license. **No Arabic.**

### 5.28 Orpheus-3B

- English (`en`) only.

Expressive English narration; zero-shot cloning; Apache-2.0. **No Arabic.**

### 5.29 CSM-1B

- English (`en`) only.

Conversational speech model; two-speaker context; Apache-2.0. **No Arabic.**

### 5.30 Zonos-v0.1

- English (`en`) only.

44.1 kHz; speaker embedding or audio prefix; emotion/speed/pitch control; Apache-2.0. **No Arabic.**

### 5.31 Parler-TTS large

- English (`en`) only.

Text-description-controlled voice (gender, pace, noise); no cloning; Apache-2.0. **No Arabic.**

### 5.32 SILMA TTS

- Arabic (`ar`, MSA/Fusha, with dialect coverage claimed)
- English (`en`)

150M; F5-TTS diffusion architecture; <8 s reference for cloning; Arabic diacritics; RTF ~0.12; Apache-2.0. The best small Arabic-first option.

### 5.33 Fasih-TTS

- Arabic (MSA/Fusha and dialects) only.

XTTS-v2 fine-tune by NightPrince; research-grade; check the custom license and the base XTTS CPML before shipping. Useful as an Arabic evaluation baseline, not a default.

### 5.34 OpenAudio S1-mini

13 languages:

Arabic (`ar`) · Chinese (`zh`) · English (`en`) · French (`fr`) · German (`de`) · Italian (`it`) · Japanese (`ja`) · Korean (`ko`) · Dutch (`nl`) · Polish (`pl`) · Portuguese (`pt`) · Russian (`ru`) · Spanish (`es`).

- ~0.5B; zero-shot cloning; emotion markers; CC-BY-NC-SA-4.0 (non-commercial, share-alike).

---

## 6. Hardware fit and in-app downloads

### 6.1 What the app can detect

| Signal | Source | Use |
| --- | --- | --- |
| Logical cores | `navigator.hardwareConcurrency` | CPU tier, thread default |
| Device memory | `navigator.deviceMemory` (where available) | Rough RAM class |
| System memory | Electron `process.getSystemMemoryInfo()` | Precise free/total RAM |
| GPUs | `app.getGPUInfo('complete')` | Adapter list, active GPU, driver |
| WebGPU | `navigator.gpu.requestAdapter()` + limits | Whether GPU inference is possible |
| Disk space | `fs.statfs` / Electron equivalent | Block downloads that cannot fit |
| Existing files | manifest + hash | Show installed / corrupt / partial |

### 6.2 Fit levels

Each manifest declares `minRamGb`, `recRamGb`, `minVramGb`, `recVramGb`, `backend` and `diskGb`.

- **Great** — meets recommended RAM and VRAM. Green badge, default download button.
- **Runs** — meets minimums but not recommendations. Amber badge, note about slower generation.
- **CPU fallback** — GPU model with no suitable GPU but enough RAM. Amber badge, "runs on CPU, expect 5–20× slower".
- **Too heavy** — below minimum. Red badge, download disabled with an explanation and an "I understand, download anyway" override for advanced users.
- **Unknown** — detection failed. Allow download, show a generic warning.

The check happens **before** the download, not after. The user can always open "Details" to see the exact numbers.

> Special cases: Breeze TTS 2 is ~7.7 GiB VRAM at BF16 (12 GB recommended); MOSS-TTS v1.5 needs ~17 GB of weights and 24 GB+ VRAM for comfort; Higgs Audio v2 and Orpheus at 3B+ need 8–12 GB VRAM. These belong behind the "Flagship" filter.

### 6.3 Download flow

1. **Model card** — name, description, size, license, languages, capabilities, score, fit badge.
2. **Details sheet** — what will be downloaded, disk space, runtime, voice packs, benchmark notes, license link.
3. **License gate** — for CC-BY-NC, CPML, BreezeBlue or other restricted weights: explicit checkbox "I will only use this model for non-commercial purposes" (persisted per model).
4. **Download** — per-file progress, speed, pause/resume, cancel, SHA-256 verification, atomic install into `userData/models/<id>/`.
5. **Voices** — optional voice packs; "download all" for small catalogs; per-voice size and preview.
6. **Activate** — "Use this model" selects it, reloads the engine, and updates the studio.
7. **Manage** — verify, reveal folder, update (pin revision), uninstall (keeps voices unless asked).

The existing generic download manager can be extended; the UI should stop treating all downloads as one global queue. Each model has its own state machine: `not-installed → queued → downloading → verifying → installed → update-available → error`.

### 6.4 Storage layout

```
userData/
  models/
    phonon-31m-en/
      manifest.json
      model.q8.gguf
      model.safetensors
      tokenizer.json
      config.json
      default-voice.safetensors
    phonon-40m-multilingual/
    kokoro-82m/
    supertonic-3/
    piper/
      en_US-amy-medium/
      fr_FR-siwis-medium/
    chatterbox/
    qwen3-tts-1.7b/
  voices/
    catalog/            # current catalog .safetensors
    custom/             # cloned/imported Phonon voices
    kokoro/             # Kokoro voice packs
    piper/              # Piper voices
    silma/              # Arabic/English clones
  audio/
  history.json
  settings.json
  models-state.json     # installed packs, licenses accepted, hashes
```

`models-state.json` is the single source of truth for installed models and license acceptance. It should be written atomically like `settings.json`.

---

## 7. Capability matrix and feature gating

### 7.1 Capabilities

| Capability | Meaning |
| --- | --- |
| `languages` | Languages the model can speak, with locales and quality notes |
| `voices` | Fixed voices, voice packs, or embedding-file voices |
| `voiceImport` | Can consume an imported speaker tensor/file |
| `voiceClone` | Can clone from a short recording, locally or via cloud |
| `multiSpeaker` | Native dialogue / speaker tags |
| `emotion` | Emotion, style, exaggeration or instruct control |
| `nonVerbal` | Laughter, sighs, coughs, etc. |
| `streaming` | Audio chunks while generating |
| `phonemes` | Phoneme input or pronunciation dictionary |
| `normalization` | Numbers, dates, currency, URLs |
| `speed` | Speaking-rate control |
| `seed` | Reproducible generation |
| `watermark` | Output carries a watermark (must be disclosed) |
| `license.commercial` | Commercial use allowed |
| `backend` | `phonon`, `onnx-web`, `sidecar`, `cloud` |
| `rating` | Editorial 1–10 quality score (§4.1) |
| `arabic` | Whether Arabic is a declared, tested language |

### 7.2 Matrix — browser and compact models

| Model | Langs | AR | Clone | Dialogue | Emotion | Non-verbal | Streaming | Commercial | Backend | Score |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Phonon 31M | 1 | — | Cloud/import | — | Pacing | — | ✅ | ✅ | WASM/WebGPU | 7 |
| Phonon 40M | 1 or 5 | — | Cloud/import | — | Pacing | — | ✅ | ❌ | WASM/WebGPU | 7 |
| Kokoro-82M | 8 | — | — | — | Style | — | ✅ | ✅ | ONNX Web | 8 |
| Piper | 35 | ✅ | — | — | — | — | ✅ | ✅ | ONNX Web | 6 |
| MeloTTS | 6 | — | — | — | — | — | — | ✅ | ONNX Web | 6 |
| MMS-TTS | 1,100+ | ✅ | — | — | — | — | — | ❌ | ONNX Web | 5 |
| Kitten TTS | 1 | — | — | — | — | — | ✅ | ✅ | ONNX Web | 5 |
| Pocket TTS | 7 | — | Local | — | — | — | ✅ | ✅ | Sidecar | 7 |
| Supertonic 3 | 31 | ✅ | — | — | Tags | — | ✅ | ✅ | ONNX Web | 8 |
| Sopro V2 Turbo | 4 | — | Local | — | — | — | ✅ | ✅ | ONNX Web | 7 |
| OmniVoice | 646 | ✅ | Local | — | Design | Tags | ✅ | ✅ | Sidecar | 8 |
| Magpie-TTS 357M | 12 | ✅ | — | — | — | — | ✅ | ✅ | Sidecar | 8 |
| SILMA TTS | 2 | ✅ | Local | — | — | — | ✅ | ✅ | Sidecar | 7 |

### 7.3 Matrix — sidecar flagships and specialists

| Model | Langs | AR | Clone | Dialogue | Emotion | Non-verbal | Streaming | Commercial | Backend | Score |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Qwen3-TTS 1.7B | 10 | — | Local | — | Instruct | — | ✅ | ✅ | Sidecar | 9 |
| MOSS-TTS v1.5 | 31 | ✅ | Local | — | Instruct | Pause tags | ✅ | ✅ | Sidecar | 9 |
| VoxCPM2 | 30 | ✅ | Local | — | Design | — | ✅ | ✅ | Sidecar | 9 |
| FireRedTTS3 | 24 + 21 | ✅ | Local | — | Design/edit | — | ✅ | ✅ | Sidecar | 8 |
| Audio8 TTS | 11 | — | Local | — | — | — | ✅ | ✅ | Sidecar | 8 |
| Breeze TTS 2 | 2 | — | Local | — | Direction | Vocal events | ✅ | ❌ | Sidecar | 10 |
| Chatterbox | 23 | ✅ | Local | — | Exaggeration | — | Partial | ✅ | Sidecar | 8 |
| CosyVoice2 | 9 + 18 | — | Local | — | Instruct | — | ✅ | ✅ | Sidecar | 8 |
| F5-TTS | 2 | — | Local | — | Ref style | — | — | ❌ | Sidecar | 7 |
| XTTS-v2 | 17 | ✅ | Local | Multi-ref | Style | — | ✅ | ❌ | Sidecar | 6 |
| IndexTTS2 | 2 | — | Local | — | ✅ | — | ✅ | Review | Sidecar | 9 |
| MegaTTS3 | 2 | — | Local | — | — | — | — | ✅ | Sidecar | 7 |
| Spark-TTS | 2 | — | Local | — | — | — | — | ❌ | Sidecar | 6 |
| Dia-1.6B | 1 | — | Local | 2 speakers | ✅ | ✅ | — | ✅ | Sidecar | 7 |
| VibeVoice | 2 | — | — | 4 speakers | ✅ | — | ✅ | ✅ | Sidecar | 7 |
| Higgs Audio v2 | 4 | — | Local | Multi | ✅ | Music/hum | ✅ | Review | Sidecar | 9 |
| Orpheus-3B | 1 | — | Local | — | ✅ | — | ✅ | ✅ | Sidecar | 7 |
| CSM-1B | 1 | — | Local | 2 speakers | ✅ | — | ✅ | ✅ | Sidecar | 6 |
| Zonos-v0.1 | 1 | — | Local | — | ✅ | — | ✅ | ✅ | Sidecar | 6 |
| Parler-TTS | 1 | — | — | — | Description | — | — | ✅ | Sidecar | 6 |
| Fasih-TTS | 1 | ✅ | Local | — | — | — | ✅ | Review | Sidecar | 6 |
| OpenAudio S1-mini | 13 | ✅ | Local | — | Tags | — | ✅ | ❌ | Sidecar | 8 |

### 7.4 Gating rules

- **Language selector** is driven by the selected model. Switching from OmniVoice (646) to Phonon 31M (English) must disable or hide the other languages and explain why.
- **Arabic chip** appears only for the 13 models in §5.0. Breeze TTS 2, Qwen3-TTS and Kokoro must not show it.
- **Voice picker** groups voices by model compatibility. A Kokoro voice is not shown for Phonon; a Phonon `.safetensors` is not shown for Piper.
- **Cloning tab** is enabled only when the model declares `voiceClone`. For Phonon, the existing "cloud once" disclosure stays. For Chatterbox/CosyVoice/SILMA, the recording never leaves the machine; the copy changes accordingly.
- **Multi-speaker editor** appears only for `multiSpeaker` models. Dia gets `[S1]`/`[S2]` chips and non-verbal tag buttons; VibeVoice gets up to 4 speaker chips.
- **Emotion controls** appear only when `emotion` is true; the slider maps to the model's own parameter (exaggeration, instruct, style vector, audio prefix).
- **Streaming toggle** is hidden when `streaming` is false; the engine falls back to buffer-and-play.
- **Score badge** is visible on every card and in the details sheet, with the rubric and the evidence link.
- **Batch page** validates that every row uses a voice compatible with the selected model and offers "switch all to <model>".
- **History** records `modelId`, `modelName`, `runtime`, `rating` and capability metadata so a take can be reproduced or migrated.

### 7.5 Settings that become per-model

| Setting | Today | Multi-model behavior |
| --- | --- | --- |
| Quality | q8/f32 | Per model; some models have only one format |
| Device | auto/cpu/webgpu | Per model + global GPU preference |
| Threads | auto/1–8 | Per model; sidecar uses its own |
| Language | en/none | Per model; drives normalization and tokenizer |
| Rewrites | default/all/none | Per model/language |
| Conditions | speakers/duration | Only for models that declare conditioners |
| Temperature/seed | global | Per model; defaults from manifest |
| Voice | lastVoice | Per model; "last voice per model" map |
| GPU preference | global | Global, passed to every local runtime |
| Arabic variety | — | Per model; MSA default, dialect sub-selector |

Migration: the existing global values become the defaults for `phonon-31m-en`; other models get manifest defaults on first selection. Nothing is lost.

---

## 8. Architecture

### 8.1 Layers

```
┌──────────────────────────────────────────────────────────────┐
│ Renderer (React)                                             │
│  Model gallery · Studio · Voices · Batch · History · Settings│
│  capability hooks: useModel(), useCapability('voiceClone')    │
└──────────────────────────────┬───────────────────────────────┘
                               │ IPC + local HTTP
┌──────────────────────────────▼───────────────────────────────┐
│ Electron main                                                │
│  model registry · download manager · license store           │
│  hardware probe · storage · sidecar supervisor               │
└───────────────┬──────────────────────────────┬───────────────┘
                │                              │
┌───────────────▼──────────────┐  ┌────────────▼───────────────┐
│ phonon-tts worker            │  │ ONNX Runtime Web worker    │
│ WASM / WebGPU                │  │ WASM / WebGPU              │
│ Phonon 31M / 40M family      │  │ Kokoro · Piper · Melo ·    │
│                              │  │ MMS · Supertonic · Kitten  │
└──────────────────────────────┘  └────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│ Optional local sidecar (127.0.0.1, random port)              │
│  Qwen3 · VoxCPM2 · MOSS · OmniVoice · FireRed · Breeze ·     │
│  Chatterbox · CosyVoice2 · SILMA · Dia · Higgs · IndexTTS2  │
│  Python/ONNX runtime, started on demand, killed on quit      │
└──────────────────────────────────────────────────────────────┘
```

### 8.2 Model manifest (illustrative)

```json
{
  "id": "phonon-40m-multilingual",
  "name": "Phonon 40M Multilingual",
  "family": "Phonon",
  "description": "Five-language Phonon checkpoint with the same runtime and voice format.",
  "runtime": "phonon",
  "repo": "gradium/phonon-40m-multilingual",
  "revision": "<pinned commit>",
  "rating": 7,
  "ratingNotes": "Good quality per byte; English-led; not a state-of-the-art multilingual model.",
  "license": {
    "id": "CC-BY-NC-4.0",
    "commercial": false,
    "url": "https://creativecommons.org/licenses/by-nc/4.0/"
  },
  "languages": [
    { "code": "en", "name": "English", "locale": "en-US", "quality": "high", "arabic": false },
    { "code": "fr", "name": "French", "locale": "fr-FR", "quality": "high", "arabic": false },
    { "code": "de", "name": "German", "locale": "de-DE", "quality": "high", "arabic": false },
    { "code": "es", "name": "Spanish", "locale": "es-ES", "quality": "high", "arabic": false },
    { "code": "pt", "name": "Portuguese", "locale": "pt-BR", "quality": "high", "arabic": false }
  ],
  "capabilities": {
    "voiceImport": true,
    "voiceClone": false,
    "multiSpeaker": false,
    "emotion": false,
    "nonVerbal": false,
    "streaming": true,
    "phonemes": true,
    "normalization": true,
    "speed": true,
    "seed": true,
    "watermark": false,
    "arabic": false
  },
  "files": [
    { "name": "config.json", "size": 4634, "sha256": "…", "required": true },
    { "name": "tokenizer.json", "size": 277967, "sha256": "…", "required": true },
    { "name": "model.q8.gguf", "size": 74600000, "sha256": "…", "required": true },
    { "name": "default-voice.safetensors", "size": 256136, "sha256": "…", "required": true }
  ],
  "voices": {
    "format": "phonon-safetensors",
    "catalog": "gradium/phonon-voices",
    "compatibleLocales": ["en-us", "en-gb", "fr-fr", "de-de", "es-es", "es-mx", "pt-br"]
  },
  "hardware": {
    "backend": "wasm-webgpu",
    "minRamGb": 4,
    "recRamGb": 8,
    "minVramGb": 0,
    "recVramGb": 0,
    "diskGb": 0.1
  },
  "defaults": {
    "quality": "q8",
    "device": "auto",
    "temperature": 0.3,
    "language": "en"
  }
}
```

Every downloaded file is pinned to a revision and verified by SHA-256. A model update is a new manifest revision + changed hashes; the old files stay until verification succeeds.

### 8.3 Adapter contract

```ts
export interface TtsAdapter {
  readonly id: string;
  readonly manifest: ModelManifest;
  load(options: LoadOptions): Promise<LoadedModel>;
  synthesize(request: SynthesisRequest): AsyncIterable<AudioChunk>;
  voices(): Promise<VoicePack[]>;
  addVoice?(source: VoiceSource): Promise<VoicePack>;
  dispose(): Promise<void>;
  capabilities(): ModelCapabilities;
}
```

Adapters to build:

1. `PhononAdapter` — wraps the existing `loadEngine`/`synthesize`; parameterized by model id and file URLs.
2. `OnnxWebAdapter` — shared ONNX Runtime Web loader; model-specific pre/post-processing for Kokoro, Piper, MeloTTS, MMS, Supertonic 3, Kitten and Sopro.
3. `SidecarAdapter` — starts a local process on demand, waits for a health check, sends JSON/HTTP requests, streams audio, kills on app quit.
4. `CloudAdapter` — only for optional cloud cloning, never for basic generation.

### 8.4 Registry and state

- `src/models/registry.ts` — manifest list, capability queries, compatibility, score.
- `src/models/adapters/*` — one file per runtime family.
- `src/models/hooks.ts` — `useSelectedModel()`, `useCapability()`, `useModelVoices()`.
- `electron/models/registry.cjs` — reads manifests bundled in `electron/models/manifests/`.
- `electron/models/downloads.cjs` — per-model state machine, resume, hash verification.
- `electron/models/hardware.cjs` — RAM/VRAM/disk/WebGPU probe, cached for the session.
- `electron/models/sidecar.cjs` — spawn, health check, port allocation, logs, shutdown.
- `userData/models-state.json` — installed files, revisions, accepted licenses.

### 8.5 Sidecar decision

Browser-only inference is ideal, but most of the flagships (Qwen3-TTS, VoxCPM2, MOSS, OmniVoice, FireRed, Breeze, Chatterbox, CosyVoice, Higgs, IndexTTS2) are PyTorch-first. Porting all of them to ONNX/WebGPU would take months and produce fragile results. The pragmatic path is an **optional local sidecar**:

- ships as an extra download (or a separate "Local Voices Pack" installer);
- listens on `127.0.0.1` with a random port and a per-session token;
- is started only when a sidecar model is selected;
- has no outbound network access;
- is killed when the app quits or the model is deselected;
- shows a clear "local runtime" badge and a log viewer for troubleshooting.

This keeps the default app small and offline, while giving power users cloning, dialogue and flagship quality.

---

## 9. UX plan

### 9.1 New screen: Models

A first-class "Models" page (between Voices and History, or inside Settings):

- hero: "Your studio, your engines" + hardware summary (RAM, GPU, disk);
- filter chips: All / Best (9+) / Arabic / Installed / Browser-native / Local runtime / Commercial use / Clone / Multi-speaker / 10+ languages;
- search by name, language, runtime, license or score;
- cards with fit badge, score badge, size, license badge, language chips, Arabic badge and capability icons;
- "Details" sheet with full language list, Arabic varieties, hardware table, license, voice packs, score evidence and changelog;
- primary action: Download / Use / Update / Uninstall;
- "Recommended for your machine" row at the top.

### 9.2 Studio changes

- model chip in the header (next to the voice chip), click to switch;
- switching models prompts if the current text/voice is incompatible, and offers to keep the text;
- voice picker groups by "Voices for <model>" and "Other voices" (disabled with reason);
- language selector only lists the model's languages; Arabic opens a variety sub-menu;
- capability bar under the prompt: tags for Streaming, Emotion, Multi-speaker, Cloning, each clickable to the relevant control;
- live warning when the model is loading or failed, with "Switch back to <last working model>".

### 9.3 Voices changes

- tabs: Catalog / Your voices / Model voices;
- a voice card shows which models it works with (e.g. "Phonon 31M + 40M", "SILMA ar/en", "Kokoro");
- imported `.safetensors` files are validated against the selected model's voice format;
- cloned voices show origin (local/cloud), model compatibility, language and a "re-clone for this model" action when formats differ.

### 9.4 Batch and History

- Batch gets a model column and a per-row compatibility check.
- History stores `modelId`, `modelName`, `runtime`, `license`, `rating` and capability values used; "Reuse settings" restores the model + voice + language.
- A model that is uninstalled keeps its history entries; "Re-download to replay" replaces the play button.

### 9.5 Settings changes

- "Models" section: default model, auto-download recommendations, storage location, "clear downloaded models" (preserves custom voices).
- "Compute" section: global GPU preference (already implemented), per-backend notes (WebGPU vs ONNX vs sidecar).
- "Licenses" section: accepted non-commercial licenses, revoke.
- "Local runtime" section: status, port, logs, "stop runtime".

---

## 10. Compatibility and migration

1. Keep `phonon-31m-en` as the default model id for existing installs.
2. Map existing settings to `models['phonon-31m-en'].settings`.
3. Keep the current `voices/` layout and `custom-voices.json`; add `modelId`/`format` fields with safe defaults.
4. Existing history entries get `modelId: 'phonon-31m-en'` if missing.
5. Existing downloads are adopted into the new `models/phonon-31m-en/` folder on first launch; verify hashes, do not re-download 64 MB if the files are already correct.
6. The app is now **Voxarium**; existing profiles are adopted from `%APPDATA%\Phonon Studio` on first launch and history paths are repointed (already implemented in `electron/main.cjs`).

---

## 11. Licensing and responsible AI

### 11.1 License groups

| License | Models | Commercial | Action |
| --- | --- | --- | --- |
| **Apache-2.0** | Phonon 31M, Kokoro-82M, Qwen3-TTS, MOSS-TTS v1.5, VoxCPM2, FireRedTTS3, Audio8 TTS, OmniVoice, Sopro V2 Turbo, CosyVoice2, MegaTTS3, Kitten TTS, SILMA TTS, Dia-1.6B, Orpheus-3B, CSM-1B, Zonos, Parler-TTS | ✅ | Attribution; ship the notice |
| **MIT** | Piper, MeloTTS, Pocket TTS, VibeVoice, Chatterbox (watermarked) | ✅ | Attribution; disclose the watermark |
| **NVIDIA Open Model** | Magpie-TTS 357M | ✅ | Accept the NVIDIA Open Model License; attribution |
| **CC-BY-NC-4.0** | Phonon 40M family, F5-TTS, MMS-TTS | ❌ | Non-commercial gate + persistent badge |
| **CC-BY-NC-SA-4.0** | Spark-TTS, OpenAudio S1-mini | ❌ | Non-commercial + share-alike gate |
| **Coqui CPML** | XTTS-v2 | ❌ | Evaluation-only unless a separate license is obtained |
| **BreezeBlue Research & Non-Commercial** | Breeze TTS 2 | ❌ | Research/non-commercial gate; code is Apache-2.0, weights are not |
| **Bilibili Model Use License** | IndexTTS2 | Review | Custom terms; legal review before shipping |
| **Boson AI custom** | Higgs Audio v2 | Review | Custom terms; confirm commercial permission |
| **Custom / other** | Fasih-TTS | Review | XTTS-derived; verify base CPML and the fine-tune license |

### 11.2 Responsible AI

- **Voice cloning consent:** require an explicit "I have permission to clone this voice" checkbox for every clone path, local or cloud. Store the consent timestamp with the voice metadata.
- **Watermarks:** disclose Chatterbox's Perth watermark in the model details and in exported file metadata where possible.
- **Arabic and dialect sensitivity:** do not label a model "Arabic" unless it is in §5.0. Do not claim dialect quality without per-dialect samples; default to MSA.
- **No telemetry:** model usage stays local. Download counts, if ever added, must be opt-in and aggregate-only.
- **Provenance:** record model id, revision, license, score and hash in history metadata so a generated file can be traced to its weights.

---

## 12. App name

The rename is **done**: the app is **Voxarium** (product name, app id `com.voxarium.app`, installer and shortcuts). Existing profiles are adopted automatically from `%APPDATA%\Phonon Studio` on first launch, and recording paths in `history.json` are repointed. Phonon remains the flagship model family.

| Name | Why it works | Notes |
| --- | --- | --- |
| **Voxarium** ✅ | "A place for voices"; broad, memorable, works across models | Applied; check trademark |
| Sonora Studio | Warm, audio-first | Likely collisions in audio software |
| Polyvox | "Many voices" | Techy, short, good logo potential |
| Timbral | Timbre is what makes voices distinct | Abstract, may need explanation |
| Cadence | Rhythm of speech | Common in music/audio |
| Vocalis | Latin for "of the voice" | Close to existing products |
| Utter Studio | Clear, verb-first, friendly | Good for a creator tool |

---

## 13. Phased roadmap

Estimates assume one experienced developer, part-time design/QA, and the existing codebase. The shortlist is now large enough that phases 4–5 are explicitly **optional power-user tiers**, not default installs.

### Phase 0 — Foundation (1–2 weeks)

- Define `ModelManifest`, `ModelCapabilities`, `TtsAdapter`.
- Add the model registry (bundled JSON + TypeScript types).
- Add `models-state.json`, per-model folders, adoption of the existing Phonon files.
- Add hardware probe (RAM/VRAM/disk/WebGPU) and fit calculation.
- Refactor the engine loader to accept a manifest instead of hard-coded Phonon URLs.
- Add model id, score and Arabic flag to history/settings with migration.
- Add capability hooks and a hidden "Models" debug page.

**Exit:** the app still runs Phonon 31M exactly as before, but the engine is selected through the registry.

### Phase 1 — Phonon family (3–5 days)

- Add Phonon 40M English, 40M Multilingual, and the four single-language packs.
- Add license gate for CC-BY-NC and a commercial/non-commercial badge.
- Add language selector driven by manifest.
- Add model download cards and per-model voice compatibility.
- Reuse the existing 102-voice catalog across compatible Phonon models.

**Exit:** five languages, four new models, same runtime, no new inference dependency.

### Phase 2 — Browser-native breadth (2–3 weeks)

- Build the ONNX Runtime Web adapter (worker, WASM/WebGPU, cancellation).
- Add Kokoro-82M (8 languages, 54 voices).
- Add Piper (language → locale → voice download flow).
- Add Supertonic 3 (31 languages, Arabic, CPU ONNX).
- Add MeloTTS, MMS (indexed), Kitten TTS and Sopro V2 Turbo as optional packs.
- Add per-model voice folders and preview.
- Add model comparison and "recommended for your machine".

**Exit:** 35+ languages on CPU, Kokoro/Supertonic quality on mid-range machines, all offline.

### Phase 3 — Local cloning sidecar (3–4 weeks)

- Build the sidecar supervisor (spawn, health check, token, logs, shutdown).
- Add Chatterbox Multilingual (23 languages, local zero-shot cloning).
- Add CosyVoice2-0.5B (9 languages, instruct control).
- Add SILMA TTS (Arabic/English, 150M, fast cloning).
- Add Pocket TTS (CPU-first cloning), F5-TTS and OpenAudio S1-mini behind license gates.
- Add "clone locally" flow: record → trim → consent → embed → save voice → use offline.
- Add per-model cloned voices and compatibility warnings.
- Add sidecar pack download, license gate, disk/VRAM checks, uninstall.

**Exit:** local cloning in 23+ languages, including Arabic; no upload for sidecar models.

### Phase 4 — Flagship multilingual (4–6 weeks)

- Add Qwen3-TTS 1.7B (10 languages, streaming, Apache-2.0).
- Add VoxCPM2 (30 languages, 48 kHz, Arabic).
- Add MOSS-TTS v1.5 (31 languages, Arabic, heavyweight).
- Add OmniVoice (646 languages, 14 Arabic varieties).
- Add FireRedTTS3 (24 languages + 21 Chinese dialects, design/editing).
- Add Breeze TTS 2 (best English/Chinese quality, non-commercial gate).
- Add Audio8 TTS and Magpie-TTS 357M.
- Add a "Flagship" filter and a storage warning before 7–17 GB downloads.

**Exit:** the app can honestly claim state-of-the-art local TTS in English, Chinese, Arabic and 30+ other languages.

### Phase 5 — Dialogue and long-tail expression (3–4 weeks)

- Add Dia-1.6B: `[S1]`/`[S2]` editor, non-verbal tag palette, two-speaker preview.
- Add VibeVoice (up to 4 speakers), Higgs Audio v2, CSM-1B.
- Add IndexTTS2, Orpheus, Zonos, Parler-TTS, MegaTTS3 and Spark-TTS as optional packs.
- Add XTTS-v2 and Fasih-TTS behind non-commercial/research gates for compatibility and Arabic evaluation.
- Add emotion/style controls mapped per model.
- Add multi-speaker batch and history metadata.
- Add A/B comparison between models for the same script.

**Exit:** dialogue, emotion and reference-style workflows; the app is a genuine multi-model studio.

### Phase 6 — Polish and hardening (2–3 weeks)

- Model update notifications with pinned revisions.
- Benchmark page (load time, first-audio latency, real-time factor per model on this machine).
- Score verification workflow: re-run the rubric whenever a model revision changes.
- Storage dashboard and "remove unused models".
- Import/export of model presets.
- Full QA matrix, accessibility, reduced motion, keyboard navigation.

**Total:** roughly 4–6 months for one developer, with Phase 1 usable in under two weeks and Phase 2 in under six.

---

## 14. Acceptance criteria

### Functional

- A user can browse models, see fit, score, Arabic support and license, download, verify, activate, switch, update and uninstall without restarting the app (except GPU adapter changes).
- The Studio only offers languages, voices and features the selected model supports.
- The Arabic chip and Arabic variety selector appear only for models in §5.0.
- Switching models preserves text and per-model settings; switching back restores the previous voice.
- Batch validates compatibility and can switch all rows to a model.
- History records the model, score and can replay with the same model/voice/language.
- Phonon 31M behavior, quality and file layout remain unchanged for existing users.
- Every downloaded file is hash-verified; a corrupted file is re-downloaded, not silently used.
- Non-commercial models cannot be activated without an explicit license acknowledgment.
- Sidecar models start on demand, expose no network beyond loopback, and stop on quit.
- Cloning consent is required and stored; cloud cloning remains opt-in and clearly labeled.

### Hardware and performance

- Fit badges match the actual ability to load on the test matrix (4 GB CPU-only, 8 GB iGPU, 16 GB + 6 GB dGPU, 32 GB + 12 GB dGPU, 64 GB + 24 GB workstation).
- A failed model load leaves the previous model usable.
- First-audio latency and real-time factor are shown per model after a benchmark.
- Downloads can be cancelled, resumed and verified; disk-full is handled before writing.
- The flagship tier is never downloaded by default.

### Quality

- TypeScript strict passes.
- No `any` in the adapter contract.
- Unit tests for fit calculation, manifest validation, license gating, score parsing and voice compatibility.
- Playwright coverage for: browse → download (stubbed) → activate → synthesize → switch model → uninstall.
- No renderer console errors on any model page.
- Accessibility: keyboard reachable cards, focus states, reduced-motion support.

---

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Breeze TTS 2 is non-commercial | Cannot be used commercially | License gate, badge, keep 31M Apache-2.0 as default |
| Phonon 40M weights are CC-BY-NC | Cannot be used commercially | License gate, badge, keep 31M Apache-2.0 as default |
| Model sprawl (35 models) | Choice paralysis, support burden | Score + "Best for" rows, 3 primary cards, advanced filters, flagship tier hidden by default |
| Arabic quality is uneven | Bad output in a sensitive language | Arabic table in §5.0, MSA default, per-dialect samples, do not claim untested varieties |
| 8B+ models need 17 GB+ | Download and VRAM failures | Flagship filter, hard fit gate, disk check before download |
| Custom licenses (IndexTTS2, Higgs, Fasih) | Legal risk | Legal review, pin revision, store license snapshot, exclude from "commercial OK" until cleared |
| Browser memory limits (WASM32) | Large models fail to load | Sidecar for >0.5B, fit gate, clear error, fallback |
| ONNX conversions drift | Quality/regression per model | Pin exported files + hashes; keep a known-good revision; QA samples per language |
| Sidecar packaging increases installer size | Slow downloads, support burden | Separate optional pack; on-demand download; clear disk usage |
| GPU selection is a hint, not a guarantee | User expects a specific GPU | Show detected adapters, explain Chromium ownership, offer Windows graphics settings |
| Model licenses change | Legal/reputational risk | Pin revisions, store license snapshot, re-check on update |
| Voice format mismatch | Import fails or sounds wrong | Validate shape/metadata; show "works with" badges; re-clone per model |
| QA matrix explodes | Regressions | Capability-based tests, not model-by-model UI forks; per-model smoke tests in CI |

---

## 16. Appendix

### 16.1 Model sources

- Phonon 31M: <https://huggingface.co/gradium/phonon-31m-en>
- Phonon 40M family: <https://huggingface.co/gradium/phonon-40m-multilingual> (and `phonon-40m-en`, `-fr`, `-de`, `-es`, `-pt`)
- Phonon voices: <https://huggingface.co/gradium/phonon-voices>
- Kokoro-82M: <https://huggingface.co/hexgrad/Kokoro-82M>
- Piper voices: <https://huggingface.co/rhasspy/piper-voices>
- MeloTTS: <https://huggingface.co/myshell-ai/MeloTTS-English>
- MMS-TTS: <https://huggingface.co/facebook/mms-tts-eng>
- Kitten TTS: <https://huggingface.co/KittenML/kitten-tts-nano-0.1>
- Pocket TTS: <https://github.com/kyutai-labs/pocket-tts>
- Supertonic 3: <https://huggingface.co/Supertone/supertonic-3>
- Sopro V2 Turbo: <https://huggingface.co/samuel-vitorino/sopro-v2-turbo>
- OmniVoice: <https://huggingface.co/k2-fsa/OmniVoice>
- Qwen3-TTS: <https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base>
- MOSS-TTS v1.5: <https://huggingface.co/OpenMOSS-Team/MOSS-TTS-v1.5>
- VoxCPM2: <https://huggingface.co/openbmb/VoxCPM2>
- FireRedTTS3: <https://huggingface.co/FireRedTeam/FireRedTTS3>
- Audio8 TTS: <https://huggingface.co/Edge0/Audio8-TTS-Preview-0.6b>
- Breeze TTS 2: <https://huggingface.co/BreezeBlue/Breeze-TTS-2>
- Magpie-TTS 357M: <https://huggingface.co/nvidia/magpie_tts_multilingual_357m>
- Chatterbox: <https://huggingface.co/ResembleAI/chatterbox>
- CosyVoice2: <https://huggingface.co/FunAudioLLM/CosyVoice2-0.5B>
- F5-TTS: <https://huggingface.co/SWivid/F5-TTS>
- XTTS-v2: <https://huggingface.co/coqui/XTTS-v2>
- IndexTTS2: <https://huggingface.co/IndexTeam/IndexTTS-2>
- MegaTTS3: <https://github.com/bytedance/MegaTTS3>
- Spark-TTS: <https://huggingface.co/SparkAudio/Spark-TTS-0.5B>
- Dia-1.6B: <https://huggingface.co/nari-labs/Dia-1.6B-0626>
- VibeVoice-1.5B: <https://huggingface.co/microsoft/VibeVoice-1.5B>
- Higgs Audio v2: <https://huggingface.co/bosonai/higgs-audio-v2-generation-3B-base>
- Orpheus-3B: <https://huggingface.co/canopylabs/orpheus-3b-0.1-ft>
- CSM-1B: <https://huggingface.co/sesame/csm-1b>
- Zonos-v0.1: <https://huggingface.co/Zyphra/Zonos-v0.1-transformer>
- Parler-TTS: <https://huggingface.co/parler-tts/parler-tts-large-v1>
- SILMA TTS: <https://huggingface.co/silma-ai/silma-tts>
- Fasih-TTS: <https://huggingface.co/NightPrince/Fasih-TTS-V1>
- OpenAudio S1-mini: <https://huggingface.co/fishaudio/openaudio-s1-mini>
- Artificial Analysis TTS leaderboard: <https://artificialanalysis.ai/text-to-speech>

### 16.2 Suggested file map

```
src/models/
  types.ts
  registry.ts
  fit.ts
  rating.ts
  hooks.ts
  adapters/
    phonon.ts
    onnx-web.ts
    sidecar.ts
  runtimes/
    kokoro.ts
    piper.ts
    melo.ts
    mms.ts
    supertonic.ts
    kitten.ts
    sopro.ts
src/pages/ModelsPage.tsx
src/components/ModelCard.tsx
src/components/ModelDetails.tsx
src/components/FitBadge.tsx
src/components/RatingBadge.tsx
src/components/LicenseGate.tsx
src/components/CapabilityGate.tsx
electron/models/
  manifests/*.json
  registry.cjs
  downloads.cjs
  hardware.cjs
  sidecar.cjs
  licenses.cjs
```

### 16.3 Score verification checklist

For every model revision:

1. Confirm the license and the commercial-use answer on the model card.
2. Confirm the parameter count and the actual downloadable file sizes.
3. Confirm the language list from the model card, not from a blog post.
4. Confirm Arabic support and the exact Arabic varieties.
5. Re-run the rubric in §4.1 on at least three samples per core language.
6. Record the score, the reviewer, the date and the evidence URL in the manifest.
7. Re-check the Artificial Analysis TTS leaderboard if the model is listed.

### 16.4 Prompt generator

The companion HTML file (`docs/model-expansion-plan.html`) contains an interactive prompt generator. Choose models, phases, hardware profile and priorities; it produces a ready-to-paste prompt for OpenCode and a copy button. The generated prompt includes the selected model ids, the license policy, the capability work and the acceptance criteria from §14.

### 16.5 OmniVoice — complete 646-code language list

<details>
<summary>Expand the full ISO 639-3 list</summary>

`aae, aal, aao, ab, abb, abn, abr, abs, abv, acm, acw, acx, adf, adx, ady, aeb, aec, af, afb, afo, ahl, ahs, ajg, aju, ala, aln, alo, am, amu, an, anc, ank, anp, anw, aom, apc, apd, arb, arq, ars, ary, arz, as, ast, avl, awo, ayl, ayp, az, ba, bag, bas, bax, bba, bbj, bbl, bbu, bce, bci, bcs, bcy, bda, bde, bdm, be, beb, bew, bfd, bft, bg, bgp, bhb, bhh, bho, bhp, bhr, bjj, bjk, bjn, bjt, bkh, bkm, bky, bmm, bmq, bn, bnm, bnn, bns, bo, bou, bqg, br, bra, brh, bri, brx, bs, bsh, bsj, bsk, btm, btv, bug, bum, buo, bux, bwr, bxf, byc, bys, byv, byx, bzc, bzw, ca, ccg, ceb, cen, cfa, cgg, chq, cjk, ckb, ckl, ckr, cky, cnh, cpy, cs, cte, ctl, cut, cux, cv, cy, da, dag, dar, dav, dbd, dcc, de, deg, dgh, dgo, dje, dmk, dml, dru, dty, dua, dv, dyu, dzg, ebr, ebu, ego, eiv, eko, ekr, el, elm, en, eo, es, esu, et, eto, ets, etu, eu, ewo, ext, eyo, fa, fan, fat, ff, ffm, fi, fia, fil, fip, fkk, fmp, fr, fub, fuc, fue, fuf, fuh, fui, fuq, fuv, fy, ga, gbm, gbr, gby, gcc, gdf, gej, ges, ggg, gid, gig, giz, gjk, gju, gl, glw, gn, gol, gom, gsl, gu, gui, gur, guz, gv, gwc, gwe, gwt, gya, gyz, ha, hah, hao, haw, haz, hbb, he, hem, hi, hia, hkk, hla, hno, hoj, hr, hsb, ht, hu, hue, hul, hux, hwo, hy, hz, ia, ibb, id, ida, idu, ig, ijc, ijn, ik, ikw, is, ish, iso, it, its, itw, itz, ja, jal, jax, jgo, jmx, jns, jqr, juk, juo, jv, ka, kab, kai, kaj, kam, kbd, kbl, kbt, kcq, kdh, kea, keu, kfe, kfk, kfp, khg, khw, kj, kjc, kjk, kk, kln, kls, km, kmr, kmy, kn, kna, knn, ko, kol, koo, kpo, kqo, ks, ksd, ksf, kto, kuh, kvx, kw, kwm, kxp, ky, kyx, lag, lb, lcm, ldb, lg, lij, lir, lkb, lla, ln, lnu, lo, loa, lrk, lss, lt, ltg, lto, lua, luo, lus, lv, lwg, mab, maf, mai, mau, max, mbo, mcf, mcn, mcx, mdd, mde, mdf, mek, mer, meu, mfm, mfn, mfo, mfv, mgg, mgi, mhk, mhr, mi, mig, miu, mk, mkf, mki, ml, mlq, mn, mne, mni, mqy, mr, mrj, mrr, mrt, ms, mse, msh, msw, mt, mtr, mtu, mtx, mua, mug, mui, mve, mvy, mxs, mxu, mxy, my, myv, mzl, nal, nan, nap, nb, nbh, ncf, nco, ncx, ndi, ng, ngi, nhg, nhi, nhn, nhq, nja, nl, nla, nlv, nmg, nmz, nn, nnh, no, noe, npi, nso, ny, nyu, oc, odk, odu, ogo, om, orc, oru, ory, os, pa, pbs, pbt, pbu, pcm, pex, phl, phr, pip, piy, pko, pl, plk, plt, pmq, pms, pmy, pnb, poc, poe, pow, prq, ps, pst, pt, pua, pwn, qug, qum, qup, qur, qus, quv, qux, quy, qva, qvi, qvj, qvl, qwa, qws, qxa, qxp, qxt, qxu, qxw, rag, rm, ro, rob, rof, roo, rth, ru, rup, rw, sa, sah, sat, sau, say, sbn, sc, scl, scn, sd, sei, shu, si, sip, siw, sjr, sk, skg, skr, sl, sn, snc, snk, so, sol, sps, sq, sr, src, sro, ssi, ste, sua, sv, sva, sw, szy, ta, tan, tar, tay, tbf, tcf, tcy, tdn, tdx, te, tg, tgc, th, the, thq, thr, thv, ti, tig, tio, tk, tkg, tkt, tli, tlp, tn, tok, tpl, tpz, tqp, tr, trp, trq, trv, trw, tt, ttj, ttr, ttu, tui, tul, tuq, tuv, tuy, tvo, tvu, tw, twu, txs, txy, udl, ug, uk, uki, umb, ur, ush, uz, uzn, vai, var, ver, vi, vmc, vmj, vmm, vmp, vmz, vot, vro, wbl, wci, weo, wes, wja, wji, wo, wof, xh, xhe, xka, xmf, xmv, xmw, xpe, xti, xtu, yaq, yav, yay, ydd, ydg, yer, yes, yi, yo, yue, zga, zgh, zh, zoc, zoh, zor, zpv, zpy, ztg, ztn, ztp, zts, ztu, zu, zza`

</details>

### 16.6 Open questions

1. Is commercial use a hard requirement for this app, or is a non-commercial license acceptable with a clear gate?
2. Should the sidecar ship in the main installer (larger, simpler) or as an optional pack (smaller, one more step)?
3. Should Breeze TTS 2 ship at all given its non-commercial weights, or only as a "quality reference" that users sideload?
4. Which Arabic variety matters most after MSA: Egyptian, Gulf, Levantine or Moroccan? OmniVoice covers all four; SILMA is MSA-first.
5. Is the 8B+ flagship tier (MOSS, FireRed, Higgs) worth the 17 GB download, or should it be a separate "Studio Pro" build?
6. Should MMS-TTS (1,100+ languages, non-commercial) be included at all, or only offered as an advanced/experimental pack?
7. Do we keep the 1–10 score visible in the main UI, or only in the details sheet, to avoid oversimplifying quality?

---

*This plan is intentionally implementation-ready but not implementation-binding: every size, license, language and score must be re-verified against the pinned manifest before shipping.*
