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
fn installers_create_start_menu_shortcut_for_relaunch() {
    let source_installer =
        fs::read_to_string(workspace_root().join("scripts/install-local.ps1")).unwrap();
    let package_installer =
        fs::read_to_string(workspace_root().join("packaging/install-from-package.ps1")).unwrap();

    for script in [source_installer, package_installer] {
        assert!(script.contains("SpecialFolders.Item('Programs')"));
        assert!(script.contains("ChatPCB KiCad Preview.lnk"));
    }
}

#[test]
fn packaged_installer_adds_start_menu_self_test_shortcut() {
    let installer =
        fs::read_to_string(workspace_root().join("packaging/install-from-package.ps1")).unwrap();
    let package_script =
        fs::read_to_string(workspace_root().join("scripts/package-preview.ps1")).unwrap();
    let self_test_cmd =
        fs::read_to_string(workspace_root().join("packaging/Run ChatPCB Self Test.cmd")).unwrap();

    assert!(installer.contains("Run ChatPCB Self Test.cmd"));
    assert!(installer.contains("Run ChatPCB Self Test.lnk"));
    assert!(installer.contains("Verify the ChatPCB KiCad Preview installation"));
    assert!(package_script.contains("Run ChatPCB Self Test.cmd"));
    assert!(package_script.contains("Self-test shortcut for installed package verification"));
    assert!(self_test_cmd.contains("--self-test-summary"));
    assert!(!self_test_cmd.contains("--self-test\r"));
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
fn package_includes_double_click_uninstaller() {
    let uninstall =
        fs::read_to_string(workspace_root().join("packaging/uninstall-preview.ps1")).unwrap();
    let uninstall_cmd =
        fs::read_to_string(workspace_root().join("packaging/Uninstall ChatPCB KiCad Preview.cmd"))
            .unwrap();
    let package_script =
        fs::read_to_string(workspace_root().join("scripts/package-preview.ps1")).unwrap();

    assert!(uninstall.contains("$env:LOCALAPPDATA\\ChatPCB3\\ChatPCB KiCad Preview"));
    assert!(uninstall.contains("SpecialFolders.Item('Desktop')"));
    assert!(uninstall.contains("SpecialFolders.Item('Programs')"));
    assert!(uninstall.contains("Remove-Item"));
    assert!(uninstall_cmd.contains("uninstall-preview.ps1"));
    assert!(package_script.contains("Uninstall ChatPCB KiCad Preview.cmd"));
    assert!(package_script.contains("uninstall-preview.ps1"));
}

#[test]
fn package_script_creates_zip_with_first_run_files() {
    let script = fs::read_to_string(workspace_root().join("scripts/package-preview.ps1")).unwrap();

    assert!(script.contains("Compress-Archive"));
    assert!(script.contains("README-FIRST.txt"));
    assert!(script.contains("Install ChatPCB KiCad Preview.cmd"));
    assert!(script.contains("Uninstall ChatPCB KiCad Preview.cmd"));
    assert!(script.contains("Run ChatPCB Self Test.cmd"));
    assert!(script.contains("install-from-package.ps1"));
}

#[test]
fn package_script_writes_release_evidence_and_hashes() {
    let script = fs::read_to_string(workspace_root().join("scripts/package-preview.ps1")).unwrap();

    assert!(script.contains("RELEASE-EVIDENCE.txt"));
    assert!(script.contains("SHA256SUMS.txt"));
    assert!(script.contains("Get-FileHash"));
    assert!(script.contains("git rev-parse --short HEAD"));
    assert!(script.contains("git status --porcelain"));
    assert!(script.contains("Working tree"));
    assert!(script.contains("App launch focuses prompt input"));
    assert!(script.contains("App launch selects available provider model"));
    assert!(script.contains("Chat transcript append flow"));
    assert!(script.contains("Provider Login appends without erasing chat"));
    assert!(script.contains("Provider Login keeps built-in preview unblocked when no CLI is ready"));
    assert!(script.contains("Provider Login shows local CLI login hints"));
    assert!(script.contains("Provider Login returns focus to prompt"));
    assert!(script.contains("Use example returns focus to prompt"));
    assert!(script.contains("Chat transcript latest-turn scrolling"));
    assert!(script.contains("Prompt Enter key sends design"));
    assert!(script.contains("Pipeline status transitions"));
    assert!(script.contains("Preview workspace evidence folder"));
    assert!(script.contains("KiCad preview scaffold files"));
    assert!(script.contains("50mm PCB preview outline"));
    assert!(script.contains("KiCad CLI preview compatibility check"));
    assert!(script.contains("KiCad ERC and DRC JSON reports on Send design"));
    assert!(script.contains("Actionable validation status"));
    assert!(script.contains("Left workspace status update"));
    assert!(script.contains("Left tab status updates"));
    assert!(script.contains("Left design preview body"));
    assert!(script.contains("Open evidence button"));
    assert!(script.contains("Open evidence selects FIRST-RUN-SUMMARY.txt"));
    assert!(script.contains("Open PCB button"));
    assert!(script.contains("Open PCB status distinguishes KiCad editor from file fallback"));
    assert!(script.contains("Open evidence recovers previous preview workspace"));
    assert!(script.contains("Relaunch shows previous preview workspace status"));
    assert!(script.contains("Relaunch mentions previous preview workspace in chat"));
}
