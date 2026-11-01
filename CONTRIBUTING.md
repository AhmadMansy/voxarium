# Contributing to Voxarium

Thanks for helping. Voxarium is a private, on-device text-to-speech studio and it stays open
source under the **AGPL-3.0-or-later**.

## Before your first pull request

1. **Sign the CLA.** The CLA bot comments on your first pull request. See [`CLA.md`](CLA.md)
   for what it says and why: it keeps the code open source and lets the maintainer license it
   in other ways later. You keep your copyright. You sign once.
2. **Read the [Code of Conduct](CODE_OF_CONDUCT.md).**
3. For anything bigger than a small fix, open an issue first so we can agree on the approach.

## Setting up

You need Node.js 22 or newer.

```bash
git clone https://github.com/AhmadMansy/voxarium.git
cd voxarium
npm install          # also copies the Phonon and ONNX Runtime assets
npm run icon         # generates build/icon.png (needed for packaging)
npm run dev          # Vite renderer + Electron
```

Useful checks (the same ones CI runs):

```bash
npm run typecheck
npm run build
npm test             # model-layer unit tests
```

On Windows PowerShell, use `npm.cmd` if script execution is restricted.

Build installers for the current OS with `npm run pack`, or pick one: `pack:win`, `pack:linux`,
`pack:mac`. Output goes to `release/`.

## Adding or updating a model

Models are data, not code. Follow the checklist in
[`docs/model-support.md`](docs/model-support.md#extending-a-model). In short:

1. Add the model in `scripts/build-manifests.mjs` and regenerate `electron/models/manifests.json`.
2. Pin the exact Hugging Face revision; every file needs a size and SHA-256 (or LFS id).
3. For a Python model, add a recipe to `runtimes.json` and an adapter in
   `electron/sidecars/adapters`.
4. **Record the license accurately** (`license.id`, `commercial`, `restricted`, `review`), and
   read the actual license file at the pinned revision, not just the model card. Non-commercial
   or review-required licenses must keep their acknowledgment gate.
5. Build the environment, install the model and synthesize a sentence before opening the PR.
   Say in the PR which operating systems you tested.

Please use the **Model request** issue form to propose a model first.

## Code style

- TypeScript strict mode; no `any` without a reason.
- Keep platform-specific code behind small helpers instead of scattering `process.platform` checks.
- Don't add telemetry or any network call that isn't listed in the privacy table in the README.
- Add `// SPDX-License-Identifier: AGPL-3.0-or-later` to new source files.

## Commit and PR conventions

- Commit messages: `type: short summary` (`feat`, `fix`, `docs`, `chore`, `ci`, `refactor`, `test`).
- One logical change per pull request. Include screenshots for UI changes.
- CI must pass on Windows, Linux and macOS.

## Licensing of contributions

By contributing you agree your work is licensed under the AGPL-3.0-or-later and, through the CLA,
that the maintainer may also license it under other terms. Third-party code you add must be
compatible with the AGPL-3.0 and listed in `THIRD_PARTY_NOTICES.md` (run `npm run notices`).
