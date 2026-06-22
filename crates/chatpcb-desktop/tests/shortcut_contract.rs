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
