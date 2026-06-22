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
fn shortcut_script_uses_windows_desktop_special_folder() {
    let script = fs::read_to_string(workspace_root().join("scripts/install-local.ps1")).unwrap();

    assert!(script.contains("SpecialFolders.Item('Desktop')"));
    assert!(!script.contains("$env:USERPROFILE\\Desktop"));
}

#[test]
fn root_double_click_installer_runs_local_install_and_launches_preview() {
    let installer =
        fs::read_to_string(workspace_root().join("Install ChatPCB KiCad Preview.cmd")).unwrap();

    assert!(installer.contains("scripts\\install-local.ps1"));
    assert!(installer.contains("-Launch"));
    assert!(installer.contains("-ExecutionPolicy Bypass"));
}

#[test]
fn packaged_installer_does_not_require_cargo() {
    let installer =
        fs::read_to_string(workspace_root().join("packaging/install-from-package.ps1")).unwrap();

    assert!(installer.contains("ChatPCB KiCad Preview.exe"));
    assert!(installer.contains("chatpcb-core.exe"));
    assert!(installer.contains("SpecialFolders.Item('Desktop')"));
    assert!(installer.contains("Start-Process"));
    assert!(!installer.contains("cargo build"));
}

#[test]
fn package_script_creates_zip_with_first_run_files() {
    let script = fs::read_to_string(workspace_root().join("scripts/package-preview.ps1")).unwrap();

    assert!(script.contains("Compress-Archive"));
    assert!(script.contains("README-FIRST.txt"));
    assert!(script.contains("Install ChatPCB KiCad Preview.cmd"));
    assert!(script.contains("install-from-package.ps1"));
}
