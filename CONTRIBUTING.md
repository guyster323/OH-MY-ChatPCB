# Contributing

## Test-first workflow

Use TDD for behavior changes:

1. Add or update a focused test that proves the intended behavior.
2. Run the specific test and confirm it fails for the expected reason.
3. Implement the smallest change that passes the test.
4. Run the specific test again.
5. Run `npm test` before commit.

For KiCad file generation changes, also run:

```powershell
npm run verify:sample
```

If KiCad is not installed, `validate:sample` must return a typed skip or typed failure instead of silently succeeding. If `ngspice` is not installed, `simulate:sample` may return the typed `NGSPICE_UNAVAILABLE` skip.

## Local-only credentials

Do not store provider API keys, OAuth tokens, session files, or CLI credentials in this repository. ChatPCB provider adapters must use already-authenticated local CLI sessions and redact logs before writing traces.

Allowed:

- local provider availability checks
- local CLI invocation through the provider process bridge
- redacted traces in ignored workspace directories

Not allowed:

- committing API keys or provider tokens
- copying credential files into test fixtures
- sending user project files to a remote service without an explicit user action

## KiCad fork workflow

The main ChatPCB runtime lives in this repository. The KiCad source fork work starts from:

```powershell
cd C:\Users\windo\kicad-source-mirror-chatpcb
git checkout chatpcb-panel-scaffold
```

Keep the fork branch rebaseable:

- keep ChatPCB panel changes small and isolated
- prefer `plugins/chatpcb_panel` and packaged `share/chatpcb_panel` assets until the final source-tree location is chosen
- do not add custom top-level `chatpcb_*` nodes to KiCad schematic or PCB files
- keep ChatPCB metadata in `.chatpcb.json`
- verify generated files with `kicad-cli` before widening the generator

## Circuit quality and user-update workflow

Treat official KiCad latest-stable compatibility as a user-facing requirement.
A normal user may accept KiCad update prompts, so test generated project files
in official KiCad separately from the ChatPCB-enabled KiCad fork.

Do not mark a generated circuit release-ready only because ERC passes. For
release-quality circuit changes, tests and handoff notes must cover:

- exact KiCad version and executable path used for validation
- schematic readability in the GUI
- symbol library resolution
- part values and footprints
- power rails, power flags, decoupling, reset/boot/debug wiring, and connector pinout
- ERC errors, warnings, and residual risks
- generated review/export artifacts where available

If required electrical details are missing, expose them as blockers or review
findings and prefer an approval-gated review/fix/validate loop over silent
assumptions.
