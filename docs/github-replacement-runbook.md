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
- The package boundary remains honest: `Preview only; not order-ready`.

The script is intentionally a dry run. It prints `NO_PUSH_PERFORMED` and does
not replace the remote.

## Replacement Rule

Do not push, force-push, create a release, upload assets, or otherwise modify
GitHub until the user gives explicit action-time approval for the exact external
action.

After approval, rerun the dry run first, then perform only the approved remote
action and verify the resulting GitHub state.
