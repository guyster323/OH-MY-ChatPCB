use chatpcb_core::project::create_preview_workspace;
use std::fs;
use std::path::PathBuf;

fn unique_test_root() -> PathBuf {
    std::env::temp_dir().join(format!(
        "chatpcb3-preview-workspace-test-{}",
        std::process::id()
    ))
}

#[test]
fn creates_preview_workspace_evidence_without_claiming_order_ready() {
    let root = unique_test_root();
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace(
        "USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB package",
        &root,
    )
    .unwrap();

    let project_dir = PathBuf::from(&workspace.project_dir);
    assert!(project_dir.exists());
    assert!(project_dir.ends_with("chatpcb3-esp32s3-preview"));

    let manifest = fs::read_to_string(&workspace.manifest_file).unwrap();
    assert!(manifest.contains("ChatPCB3 ESP32-S3 USB-C Sensor Board"));
    assert!(manifest.contains("chatpcb3-esp32s3.kicad_pro"));

    let report = fs::read_to_string(&workspace.release_report_file).unwrap();
    assert!(report.contains("prototype-review"));
    assert!(report.contains("not order-ready"));
    assert!(report.contains("KiCad fork integration is still required"));

    let prompt = fs::read_to_string(&workspace.prompt_file).unwrap();
    assert!(prompt.contains("USB-C ESP32-S3"));

    for file in &workspace.files {
        assert!(PathBuf::from(file).exists(), "{file} should exist");
    }

    fs::remove_dir_all(root).unwrap();
}
