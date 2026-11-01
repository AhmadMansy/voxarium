# Voxarium design system: "Signal"

Voxarium is a tool for people who work with voices, so the interface should feel like a
well-made studio instrument: warm, quiet, precise, with one loud thing at a time. This note
records the decisions behind the interface so new screens stay consistent.

All tokens live in [`src/styles/tokens.css`](../src/styles/tokens.css). Pages and components use
the tokens; they should not hard-code colours, font sizes or radii.

## Principles

1. **One signal.** A single vivid colour (vermilion by default) marks what matters: the primary
   action, where you are, and live state. If everything is accented, nothing is.
2. **Flat and warm.** Solid surfaces and hairline borders. No glass, blur, glow, gradient fills or
   floating hover effects. Neutrals are warm (paper and graphite), never blue-black.
3. **Type does the work.** Big display titles, readable body text, nothing smaller than 12 px.
4. **Quiet metadata.** Labels, counts and licences are plain text or small rectangular tags, not
   rows of pill chips. Show only what is true and useful (a model lists what it *can* do).
5. **Identical everywhere.** Typefaces are bundled and window chrome is the only OS-specific
   part, so the app looks the same on Windows, Linux and macOS.
6. **Accessible by default.** Every text/surface pair meets WCAG AA (body text meets AAA);
   `npm run check:contrast` verifies all 54 pairs across both themes and all five accents.

## Tokens

| Group | Tokens |
| --- | --- |
| Themes | `Graphite` (dark, warm graphite `#121110`) and `Paper` (light, warm paper `#f2eee6`) via `data-theme` |
| Accents | `signal` (default), `violet`, `cyan`, `amber`, `rose` via `data-accent`. Each defines `--accent` (fills), `--accent-text` (text and icons on the current theme) and `--accent-ink` (text on a fill) |
| Type | `--font` Geist, `--font-display` Bricolage Grotesque, `--mono` Geist Mono, Noto Sans Arabic as the Arabic fallback. Scale: 12 / 13 / 14 / 16 / 20 / 28 / 40 px |
| Space | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 px (`--space-1` to `--space-8`) |
| Radius | `--r-xs` 5 · `--r-sm` 8 · `--r-md` 10 · `--r-lg` 14 · `--r-xl` 20. Circles only for dots and the play button |
| Motion | `--dur-fast` 120 ms, `--dur` 200 ms, `--ease`. `prefers-reduced-motion` is honoured globally |

Fonts ship in the app through `@fontsource-variable/*` (SIL OFL 1.1), imported in `src/main.tsx`.
Display type is for page titles and big numbers; UI headings use the text face.

## Components

| Component | Variants | Rule |
| --- | --- | --- |
| Button (`.btn`) | `primary`, `subtle` (outline), `ghost`, `danger`; sizes `sm` 32, default 38, `lg` 48 | One `primary` per screen area. Secondary actions are `subtle`. Dark ink on the signal colour |
| Tag (`.tag`) | neutral, `ok`, `warn`, `danger`, `accent` | Rectangular, 22 px, no outline. Status only, not decoration |
| Chip (`.chip`) | default, `tiny` | Something you can press (filters, suggestions) |
| Card (`.card`) | n/a | Hairline border, no shadow. Sections inside a side column are separated by lines, not boxed |
| Field (`.input`, `.select`, `.search`) | n/a | 38 px, accent border and ring on focus |
| Switch, range, progress | n/a | Solid accent, no glow |
| Voice avatar (`VoiceAvatar`) | `xs` to `xl` | A tile with the voice's own waveform signature (deterministic from its id) in a tint of its hue. It replaces gradient circles with initials |
| Page header (`PageHeader`) | n/a | One display title, one optional short line, actions on the right. No eyebrow, no icon tile |
| Sidebar | n/a | Solid, 232 px, wordmark, active page marked by a signal tick |

## Patterns

- **Studio** is built around the script: the editor is the largest surface, the Generate button sits
  in its footer, and the voice and delivery settings are a quiet column beside it.
- **Models** lists models first. Engines and runtimes are an advanced disclosure below.
- **Support tiers** (Builds, Experimental, Unsupported) appear on model cards for the current system.
- **Setup assistant** uses a solid signal-colour rail with ink type and a waveform skyline.
- **Toasts** appear bottom-right above the player so they never cover page actions.

## Platform notes

- Windows and Linux draw their caption buttons over our title bar; macOS keeps its traffic lights at
  the top-left of the sidebar (`html[data-platform="darwin"]` adjusts the layout).
- Shortcut labels follow the system: `⌘1` on macOS, `Ctrl+1` elsewhere (`src/lib/platform.ts`).

## Tools

```bash
npm run shots           # screenshot every page in both themes (needs a build and the Phonon files)
npm run check:contrast  # WCAG contrast for every token pair
```

## Do and don't

| Do | Don't |
| --- | --- |
| Use `var(--accent)` for the primary action and the active item | Tint backgrounds, borders and icons with the accent "for flair" |
| Use sentence-case labels at 12 px or larger | Use tracked uppercase micro-labels |
| Show capabilities a model has | List every capability with a tick or a cross |
| Use `Ctrl`/`⌘` from `shortcut()` | Hard-code `⌘` |
| Add a token when a value repeats | Add one-off hex colours or pixel sizes |
