# GitHub Replacement Runbook

This repo is prepared to replace the failed ChatPCB2 history at
`guyster323/OH-MY-ChatPCB`, but the external upload must remain a deliberate
human-approved step.

## Dry Run

Before any remote replacement, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-github-replacement-ready.ps1 -CheckRemoteHead
```

The script verifies:

- `origin` targets `OH-MY-ChatPCB`.
- The local branch is `main`.
- The working tree is clean.
- `dist\ChatPCB-KiCad-Preview-windows-x64.zip` exists.
- `RELEASE-EVIDENCE.txt` matches the current commit and says the working tree
  was clean.
- `SHA256SUMS.txt` includes both native executables.
- `README-FIRST.txt` is present and keeps the first-chat path and
  `prototype-review` boundary visible.
- `install-from-package.ps1` is present and creates the `First Chat Guide`
  Start Menu shortcut.
- The package boundary remains honest: `Preview only; not order-ready`.

The script is intentionally a dry run. It prints `NO_PUSH_PERFORMED` and does
not replace the remote.

## Approved Replacement Script

Only after explicit action-time approval for replacing
`guyster323/OH-MY-ChatPCB`, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\replace-github-after-approval.ps1 -ConfirmExternalReplacement
```

The script reruns `scripts\verify-github-replacement-ready.ps1` with
`-CheckRemoteHead`, pushes local `HEAD` to `origin/main`, then runs
`scripts\verify-github-replacement-published.ps1` with the exact commit it just
pushed. It must print `EXTERNAL_GITHUB_PUSH_PERFORMED` and
`Published replacement verified` before the external replacement is considered
complete.

Do not run this script without explicit action-time approval.

## Replacement Rule

Do not push, force-push, create a release, upload assets, or otherwise modify
GitHub until the user gives explicit action-time approval for the exact external
action.

After approval, rerun the dry run first, then perform only the approved remote
action and verify the resulting GitHub state.

## Published Verification

After the approved push, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-github-replacement-published.ps1
```

The script verifies:

- `origin` still targets `OH-MY-ChatPCB`.
- The local branch is `main`.
- The working tree is clean.
- `origin/main` resolves to the same commit as local `HEAD`.
- `RELEASE-EVIDENCE.txt` still matches the published commit.

Do not treat the replacement as verified until the script prints
`Remote main matches local HEAD` and
`GitHub replacement published verification passed`.
