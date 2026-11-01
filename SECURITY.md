# Security policy

Voxarium runs downloaded model code on your computer, serves a local HTTP API, and installs
Python environments, so security reports are welcome.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting:
<https://github.com/AhmadMansy/voxarium/security/advisories/new>

Include the version (Settings → About), your operating system, and steps to reproduce. You can
expect an acknowledgment within a few days. Fixes ship in the next release, and reporters are
credited unless they prefer not to be.

## Scope

In scope:

- The local API, CLI and MCP server (authentication, origin and host checks, token handling).
- The model and runtime download pipeline (hash verification, archive extraction, path traversal,
  staging and atomic install).
- The Python sidecar (loopback binding, token authentication, process lifetime).
- Handling of the Hugging Face token and any cloning API key (storage and logging).

Out of scope:

- Vulnerabilities in third-party models or libraries themselves (report those upstream), unless
  Voxarium's configuration makes them exploitable.
- Misuse of synthetic speech. Report abuse of project spaces through the Code of Conduct.

## Supported versions

Only the latest release receives fixes while the project is below 1.0.

## Trust model

- Model files and runtime archives are pinned to exact revisions and checked against SHA-256
  hashes before use.
- Some models run with `trust_remote_code`; that code is part of the pinned, hash-verified
  download. Models that fetch helper files on first start are labelled in the app.
- The API and sidecars bind to `127.0.0.1` only and require a bearer token.
