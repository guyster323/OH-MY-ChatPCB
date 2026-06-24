use std::fs;
use std::path::PathBuf;

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap()
        .to_path_buf()
}

#[test]
fn github_actions_builds_and_uploads_windows_preview_package() {
    let workflow =
        fs::read_to_string(workspace_root().join(".github/workflows/build-preview.yml")).unwrap();

    assert!(workflow.contains("windows-latest"));
    assert!(workflow.contains("actions/checkout"));
    assert!(workflow.contains("dtolnay/rust-toolchain"));
    assert!(workflow.contains("cargo fmt --check"));
    assert!(workflow.contains("cargo test -- --test-threads=1"));
    assert!(workflow.contains("scripts\\package-preview.ps1"));
    assert!(workflow.contains("actions/upload-artifact"));
    assert!(workflow.contains("ChatPCB-KiCad-Preview-windows-x64"));
    assert!(workflow.contains("dist/ChatPCB-KiCad-Preview-windows-x64.zip"));
}

#[test]
fn github_actions_publishes_tagged_preview_zip_to_releases() {
    let workflow =
        fs::read_to_string(workspace_root().join(".github/workflows/release-preview.yml")).unwrap();

    assert!(workflow.contains("tags:"));
    assert!(workflow.contains("preview-*"));
    assert!(workflow.contains("workflow_dispatch"));
    assert!(workflow.contains("windows-latest"));
    assert!(workflow.contains("cargo test -- --test-threads=1"));
    assert!(workflow.contains("scripts\\package-preview.ps1"));
    assert!(workflow.contains("softprops/action-gh-release"));
    assert!(workflow.contains("ChatPCB KiCad Preview"));
    assert!(workflow.contains("dist/ChatPCB-KiCad-Preview-windows-x64.zip"));
    assert!(workflow.contains("dist/ChatPCB-KiCad-Preview-windows-x64/RELEASE-EVIDENCE.txt"));
    assert!(workflow.contains("dist/ChatPCB-KiCad-Preview-windows-x64/SHA256SUMS.txt"));
}

#[test]
fn github_replacement_readiness_script_is_a_dry_run_gate() {
    let script =
        fs::read_to_string(workspace_root().join("scripts/verify-github-replacement-ready.ps1"))
            .unwrap();

    assert!(script.contains("guyster323/OH-MY-ChatPCB"));
    assert!(script.contains("git remote get-url origin"));
    assert!(script.contains("git status --porcelain"));
    assert!(script.contains("ChatPCB-KiCad-Preview-windows-x64.zip"));
    assert!(script.contains("RELEASE-EVIDENCE.txt"));
    assert!(script.contains("SHA256SUMS.txt"));
    assert!(script.contains("README-FIRST.txt"));
    assert!(script.contains("README-FIRST-KO.txt"));
    assert!(script.contains("install-from-package.ps1"));
    assert!(script.contains("INSTALL-READY.txt"));
    assert!(script.contains("Assert-Contains $sha256 \"INSTALL-READY.txt\""));
    assert!(script.contains("Assert-Contains $installer \"INSTALL-READY.txt\""));
    assert!(!script.contains("Type a board idea in Chat prompt, then press Enter."));
    assert!(script.contains("Start Here.lnk"));
    assert!(script.contains("Start Here Start Menu shortcut"));
    assert!(script.contains("First Chat Guide Start Menu shortcut"));
    assert!(script.contains("Git commit: $head"));
    assert!(script.contains("Working tree: clean"));
    assert!(script.contains("Provider model selector is readiness-only for preview generation"));
    assert!(script.contains("Korean first-screen chat cue"));
    assert!(script.contains("Preview generation uses the built-in local generator"));
    assert!(script.contains("No provider CLI is invoked for preview generation"));
    assert!(script.contains("Assert-Contains $firstReadme \"Provider/model\""));
    assert!(script.contains("Assert-Contains $firstReadme \"provider CLI\""));
    assert!(script.contains("Assert-Contains $firstReadmeKo \"채팅 입력칸\""));
    assert!(!script.contains("Assert-Contains $firstReadmeKo \"Chat prompt\""));
    assert!(script.contains("Assert-Contains $firstReadmeKo \"Provider/model\""));
    assert!(script.contains("Assert-Contains $firstReadmeKo \"provider CLI\""));
    assert!(!script.contains("provider CLI는 호출하지 않습니다"));
    assert!(!script
        .contains("Assert-Contains $firstReadme \"provider/model selection is readiness-only\""));
    assert!(!script.contains("Assert-Contains $firstReadme \"No provider CLI is invoked\""));
    assert!(!script.contains("Assert-Contains $firstReadmeKo \"No provider CLI is invoked\""));
    assert!(script.contains("ChatPCB KiCad Preview 빠른 시작"));
    assert!(script.contains("CheckRemoteHead"));
    assert!(script.contains("git ls-remote origin refs/heads/main"));
    assert!(script.contains("NO_PUSH_PERFORMED"));
    assert!(script.contains("explicit user approval"));
    assert!(!script.contains("git push"));
}

#[test]
fn github_replacement_published_verifier_confirms_remote_matches_local_head() {
    let script = fs::read_to_string(
        workspace_root().join("scripts/verify-github-replacement-published.ps1"),
    )
    .unwrap();

    assert!(script.contains("guyster323/OH-MY-ChatPCB"));
    assert!(script.contains("[string]$ExpectedRemote"));
    assert!(script.contains("[string]$ExpectedHead"));
    assert!(script.contains("git remote get-url origin"));
    assert!(script.contains("git rev-parse HEAD"));
    assert!(script.contains("git rev-parse --short HEAD"));
    assert!(script.contains("git status --porcelain"));
    assert!(script.contains("git ls-remote origin refs/heads/main"));
    assert!(script.contains("RELEASE-EVIDENCE.txt"));
    assert!(script.contains("Git commit: $shortHead"));
    assert!(script.contains("Working tree: clean"));
    assert!(script.contains("Provider model selector is readiness-only for preview generation"));
    assert!(script.contains("No provider CLI is invoked for preview generation"));
    assert!(script.contains("Remote main matches local HEAD"));
    assert!(script.contains("GitHub replacement published verification passed"));
    assert!(!script.contains("git push"));
}

#[test]
fn github_replacement_push_script_requires_explicit_approval_and_verifies_after_push() {
    let script =
        fs::read_to_string(workspace_root().join("scripts/replace-github-after-approval.ps1"))
            .unwrap();

    assert!(script.contains("guyster323/OH-MY-ChatPCB"));
    assert!(script.contains("[switch]$ConfirmExternalReplacement"));
    assert!(script.contains("explicit action-time approval"));
    assert!(script.contains("if (-not $ConfirmExternalReplacement)"));
    assert!(script.contains("git rev-parse HEAD"));
    assert!(script.contains("verify-github-replacement-ready.ps1"));
    assert!(script.contains("-CheckRemoteHead"));
    assert!(script.contains("git push origin HEAD:main"));
    assert!(script.contains("verify-github-replacement-published.ps1"));
    assert!(script.contains("-ExpectedHead $head"));
    assert!(script.contains("EXTERNAL_GITHUB_PUSH_PERFORMED"));
    assert!(script.contains("Published replacement verified"));
    assert!(!script.contains("--force"));
    assert!(!script.contains("--mirror"));
}

#[test]
fn github_replacement_runbook_keeps_the_external_action_explicit() {
    let runbook =
        fs::read_to_string(workspace_root().join("docs/github-replacement-runbook.md")).unwrap();

    assert!(runbook.contains("OH-MY-ChatPCB"));
    assert!(runbook.contains("scripts\\verify-github-replacement-ready.ps1"));
    assert!(runbook.contains("explicit action-time approval"));
    assert!(runbook.contains("Do not push"));
    assert!(runbook.contains("ChatPCB-KiCad-Preview-windows-x64.zip"));
    assert!(runbook.contains("README-FIRST.txt"));
    assert!(runbook.contains("First Chat Guide"));
    assert!(runbook.contains("Preview only; not order-ready"));
}

#[test]
fn github_replacement_runbook_requires_post_push_verification() {
    let runbook =
        fs::read_to_string(workspace_root().join("docs/github-replacement-runbook.md")).unwrap();

    assert!(runbook.contains("scripts\\replace-github-after-approval.ps1"));
    assert!(runbook.contains("-ConfirmExternalReplacement"));
    assert!(runbook.contains("scripts\\verify-github-replacement-published.ps1"));
    assert!(runbook.contains("After the approved push"));
    assert!(runbook.contains("Remote main matches local HEAD"));
    assert!(runbook.contains("GitHub replacement published verification passed"));
    assert!(runbook.contains("Do not treat the replacement as verified"));
}
