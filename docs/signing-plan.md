# Signing plan

Releases are unsigned today. Users see a Windows SmartScreen warning and a macOS Gatekeeper block.
This page is the plan for fixing that. Prices, eligibility rules and product names below come from
memory and change often, so **verify each one before committing to it**.

## Order of work

1. **macOS first.** Gatekeeper blocks unsigned apps outright, which is worse than a SmartScreen warning.
2. **Windows second.**
3. **Linux** needs no signing; publish checksums and provenance (already done in `release.yml`).

## macOS: Developer ID and notarization

- Join the Apple Developer Program (about 99 USD a year; verify).
- Create a *Developer ID Application* certificate and export it as a `.p12`.
- Create an app-specific password or an App Store Connect API key for notarization.
- electron-builder signs and notarizes when these secrets exist: `CSC_LINK` (base64 `.p12`),
  `CSC_KEY_PASSWORD`, and either `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` or the
  API key variables. Add `hardenedRuntime`, an entitlements file and `notarize` to the mac config.
- Test on a clean Mac, on both Apple Silicon and Intel, by downloading the `.dmg` through a browser.

## Windows: pick one

| Option | Notes |
| --- | --- |
| SignPath Foundation | Free for open-source projects that meet its criteria; needs an application and a CI integration (verify eligibility). |
| Azure Trusted Signing | Low monthly cost; availability depends on country and organization type (verify). |
| OV/EV certificate | Most expensive. EV no longer gives instant SmartScreen reputation (verify). |

Whichever is chosen, SmartScreen reputation builds over downloads, so a short warning period is
likely even after signing.

## Secrets and CI

- Store certificates and passwords only as GitHub Actions secrets, scoped to the `release` environment
  with required reviewers.
- Sign only in the tag-triggered release job, never on pull requests.
- Keep publishing `SHA256SUMS.txt`, the SBOM and build-provenance attestations.

## Done when

- A fresh Windows and a fresh macOS machine install a release with no security warning beyond the
  standard "downloaded from the internet" prompt.
- The README's "Builds are unsigned" limitation is removed.
