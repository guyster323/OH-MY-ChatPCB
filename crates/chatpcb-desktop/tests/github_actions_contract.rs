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
