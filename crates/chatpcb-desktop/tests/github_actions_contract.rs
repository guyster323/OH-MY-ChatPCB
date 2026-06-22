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
