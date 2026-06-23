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
fn installers_add_first_chat_smoke_test_for_non_expert_verification() {
    let source_installer =
        fs::read_to_string(workspace_root().join("scripts/install-local.ps1")).unwrap();
    let package_installer =
        fs::read_to_string(workspace_root().join("packaging/install-from-package.ps1")).unwrap();
    let package_script =
        fs::read_to_string(workspace_root().join("scripts/package-preview.ps1")).unwrap();
    let smoke_cmd =
        fs::read_to_string(workspace_root().join("packaging/Run First Chat Smoke Test.cmd"))
            .unwrap();
    let root_readme = fs::read_to_string(workspace_root().join("README.md")).unwrap();
    let guide = fs::read_to_string(workspace_root().join("docs/user-test-guide.md")).unwrap();
    let package_readme =
        fs::read_to_string(workspace_root().join("packaging/README-FIRST.txt")).unwrap();

    for script in [source_installer, package_installer] {
        assert!(script.contains("Run First Chat Smoke Test.cmd"));
        assert!(script.contains("Run First Chat Smoke Test.lnk"));
        assert!(script.contains("Verify the first ChatPCB chat-to-preview path"));
        assert!(script.contains("INSTALL-FIRST-CHAT-SMOKE.txt"));
        assert!(script.contains("--first-chat-smoke"));
        assert!(script.contains("First chat smoke test shortcut:"));
        assert!(script.contains("First chat smoke test:"));
    }

    assert!(package_script.contains("Run First Chat Smoke Test.cmd"));
    assert!(package_script.contains("First chat smoke test shortcut"));
    assert!(package_script.contains("Installer writes INSTALL-FIRST-CHAT-SMOKE.txt"));
    assert!(smoke_cmd.contains("--first-chat-smoke"));
    assert!(root_readme.contains("Run First Chat Smoke Test"));
    assert!(root_readme.contains("INSTALL-FIRST-CHAT-SMOKE.txt"));
    assert!(guide.contains("Run First Chat Smoke Test"));
    assert!(guide.contains("INSTALL-FIRST-CHAT-SMOKE.txt"));
    assert!(guide.contains("PASS beginner next steps written"));
    assert!(guide.contains("PASS JLCPCB manufacturing preview blockers written"));
    assert!(guide.contains("PASS KiCad compatibility report written"));
    assert!(guide.contains("PASS ERC/DRC validation summary written"));
    assert!(guide.contains("BEGINNER-NEXT-STEPS.txt"));
    assert!(guide.contains("jlcpcb-bom-preview.csv"));
    assert!(guide.contains("jlcpcb-cpl-preview.csv"));
    assert!(guide.contains("manufacturing-readiness-preview.txt"));
    assert!(guide.contains("Windows opens the preview evidence folder with"));
    assert!(guide.contains("`BEGINNER-NEXT-STEPS.txt` selected"));
    assert!(guide.contains("Opened BEGINNER-NEXT-STEPS.txt in evidence folder."));
    assert!(guide.contains("same folder still contains `FIRST-RUN-SUMMARY.txt`"));
    assert!(package_readme.contains("Run First Chat Smoke Test"));
    assert!(package_readme.contains("INSTALL-FIRST-CHAT-SMOKE.txt"));
    assert!(package_readme.contains("PASS beginner next steps written"));
    assert!(package_readme.contains("PASS JLCPCB manufacturing preview blockers written"));
    assert!(package_readme.contains("PASS KiCad compatibility report written"));
    assert!(package_readme.contains("PASS ERC/DRC validation summary written"));
    assert!(package_readme.contains("BEGINNER-NEXT-STEPS.txt"));
    assert!(package_readme.contains("jlcpcb-bom-preview.csv"));
    assert!(package_readme.contains("jlcpcb-cpl-preview.csv"));
    assert!(package_readme.contains("manufacturing-readiness-preview.txt"));
    assert!(package_readme.contains("with BEGINNER-NEXT-STEPS.txt selected"));
    assert!(package_readme.contains("FIRST-RUN-SUMMARY.txt stays in the same folder"));
    assert!(root_readme.contains("PASS beginner next steps written"));
    assert!(root_readme.contains("PASS JLCPCB manufacturing preview blockers written"));
    assert!(root_readme.contains("PASS KiCad compatibility report written"));
    assert!(root_readme.contains("PASS ERC/DRC validation summary written"));
    assert!(root_readme.contains("BEGINNER-NEXT-STEPS.txt"));
    assert!(root_readme.contains("jlcpcb-bom-preview.csv"));
    assert!(root_readme.contains("jlcpcb-cpl-preview.csv"));
    assert!(root_readme.contains("manufacturing-readiness-preview.txt"));
    assert!(root_readme.contains("with `BEGINNER-NEXT-STEPS.txt` selected"));
    assert!(root_readme.contains("Opened BEGINNER-NEXT-STEPS.txt in evidence folder."));
    assert!(root_readme.contains("same folder still contains `FIRST-RUN-SUMMARY.txt`"));
}

#[test]
fn source_installer_adds_start_menu_self_test_shortcut() {
    let installer = fs::read_to_string(workspace_root().join("scripts/install-local.ps1")).unwrap();

    assert!(installer.contains("Run ChatPCB Self Test.cmd"));
    assert!(installer.contains("Run ChatPCB Self Test.lnk"));
    assert!(installer.contains("Verify the ChatPCB KiCad Preview installation"));
    assert!(installer.contains("Self-test shortcut:"));
}

#[test]
fn installers_write_install_self_test_summary_for_first_run_confidence() {
    let source_installer =
        fs::read_to_string(workspace_root().join("scripts/install-local.ps1")).unwrap();
    let package_installer =
        fs::read_to_string(workspace_root().join("packaging/install-from-package.ps1")).unwrap();
    let root_readme = fs::read_to_string(workspace_root().join("README.md")).unwrap();
    let guide = fs::read_to_string(workspace_root().join("docs/user-test-guide.md")).unwrap();

    for script in [source_installer, package_installer] {
        assert!(script.contains("INSTALL-SELF-TEST.txt"));
        assert!(script.contains("--self-test-summary"));
        assert!(script.contains("ChatPCB KiCad Preview Self Test"));
        assert!(script.contains("Set-Content"));
        assert!(script.contains("Install self-test:"));
    }

    assert!(root_readme.contains("INSTALL-SELF-TEST.txt"));
    assert!(guide.contains("INSTALL-SELF-TEST.txt"));
    assert!(guide.contains("PASS Open PCB/evidence wait for a saved preview"));
    assert!(guide.contains("PASS app launch focuses the prompt for immediate first chat"));
    assert!(guide.contains("PASS prompt input has a visible label and empty cue"));
    assert!(guide.contains("PASS pressing Enter sends the first design"));
    assert!(guide.contains("PASS empty prompt visibly uses the built-in ESP32-S3 example"));
    assert!(guide.contains("PASS Send design returns focus for follow-up chat"));
}

#[test]
fn installers_copy_first_chat_readme_next_to_installed_app() {
    let source_installer =
        fs::read_to_string(workspace_root().join("scripts/install-local.ps1")).unwrap();
    let package_installer =
        fs::read_to_string(workspace_root().join("packaging/install-from-package.ps1")).unwrap();
    let root_readme = fs::read_to_string(workspace_root().join("README.md")).unwrap();
    let guide = fs::read_to_string(workspace_root().join("docs/user-test-guide.md")).unwrap();

    for script in [source_installer, package_installer] {
        assert!(script.contains("README-FIRST.txt"));
        assert!(script.contains("First chat guide:"));
    }

    assert!(root_readme.contains("README-FIRST.txt"));
    assert!(root_readme.contains("installed app"));
    assert!(guide.contains("`README-FIRST.txt` is copied beside the installed app"));
}

#[test]
fn installers_add_start_menu_first_chat_guide_shortcut() {
    let source_installer =
        fs::read_to_string(workspace_root().join("scripts/install-local.ps1")).unwrap();
    let package_installer =
        fs::read_to_string(workspace_root().join("packaging/install-from-package.ps1")).unwrap();
    let package_script =
        fs::read_to_string(workspace_root().join("scripts/package-preview.ps1")).unwrap();
    let root_readme = fs::read_to_string(workspace_root().join("README.md")).unwrap();
    let guide = fs::read_to_string(workspace_root().join("docs/user-test-guide.md")).unwrap();
    let package_readme =
        fs::read_to_string(workspace_root().join("packaging/README-FIRST.txt")).unwrap();

    for script in [source_installer, package_installer] {
        assert!(script.contains("First Chat Guide.lnk"));
        assert!(script.contains("README-FIRST.txt"));
        assert!(script.contains("Open the ChatPCB KiCad first chat guide"));
        assert!(script.contains("First chat guide shortcut:"));
    }

    assert!(package_script.contains("First Chat Guide Start Menu shortcut"));
    assert!(root_readme.contains("First Chat Guide"));
    assert!(guide.contains("First Chat Guide"));
    assert!(package_readme.contains("First Chat Guide"));
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
    assert!(script.contains("Run First Chat Smoke Test.cmd"));
    assert!(script.contains("install-from-package.ps1"));
}

#[test]
fn package_first_readme_matches_current_validation_status_copy() {
    let readme = fs::read_to_string(workspace_root().join("packaging/README-FIRST.txt")).unwrap();

    assert!(readme
        .contains("Validated: Open PCB/evidence, or type a follow-up. Still prototype-review."));
    assert!(readme.contains("The example text is selected, so typing replaces it."));
    assert!(readme.contains("INSTALL-SELF-TEST.txt"));
    assert!(readme.contains("PASS app launch focuses the prompt for immediate first chat"));
    assert!(readme.contains("PASS prompt input has a visible label and empty cue"));
    assert!(readme.contains("PASS pressing Enter sends the first design"));
    assert!(readme.contains("PASS empty prompt visibly uses the built-in ESP32-S3 example"));
    assert!(readme.contains("PASS Send design returns focus for follow-up chat"));
    assert!(readme.contains("PASS beginner next steps written"));
    assert!(readme.contains("BEGINNER-NEXT-STEPS.txt"));
    assert!(!readme.contains("Validated: ERC/DRC clear. Next: Open PCB or Open evidence."));
}

#[test]
fn root_readme_matches_current_self_test_shortcut_paths() {
    let readme = fs::read_to_string(workspace_root().join("README.md")).unwrap();

    assert!(readme.contains("Both the packaged installer and source-tree installer"));
    assert!(readme.contains("Start Menu shortcuts"));
    assert!(readme.contains("First Chat Guide"));
    assert!(readme.contains("self-test"));
    assert!(readme.contains("PASS app launch focuses the prompt for immediate first chat"));
    assert!(readme.contains("PASS prompt input has a visible label and empty cue"));
    assert!(readme.contains("PASS pressing Enter sends the first design"));
    assert!(readme.contains("PASS empty prompt visibly uses the built-in ESP32-S3 example"));
    assert!(readme.contains("PASS Send design returns focus for follow-up chat"));
    assert!(readme.contains("PASS Use example selects prompt text for immediate overwrite"));
    assert!(!readme.contains("The packaged installer also adds a Start Menu self-test shortcut"));
}

#[test]
fn user_test_guide_mentions_prompt_overwrite_self_test_line() {
    let guide = fs::read_to_string(workspace_root().join("docs/user-test-guide.md")).unwrap();

    assert!(guide.contains("PASS app launch focuses the prompt for immediate first chat"));
    assert!(guide.contains("PASS prompt input has a visible label and empty cue"));
    assert!(guide.contains("PASS pressing Enter sends the first design"));
    assert!(guide.contains("PASS empty prompt visibly uses the built-in ESP32-S3 example"));
    assert!(guide.contains("PASS Send design returns focus for follow-up chat"));
    assert!(guide.contains("PASS Use example selects prompt text for immediate overwrite"));
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
    assert!(script.contains("Prompt input has visible label and empty cue"));
    assert!(script.contains("Chat transcript append flow"));
    assert!(script.contains("Empty prompt visibly uses the built-in ESP32-S3 example"));
    assert!(script.contains("Provider Login appends without erasing chat"));
    assert!(script.contains("Provider Login keeps built-in preview unblocked when no CLI is ready"));
    assert!(script.contains("Provider Login shows local CLI login hints"));
    assert!(script.contains("Provider Login returns focus to prompt"));
    assert!(script.contains("Use example returns focus to prompt"));
    assert!(script.contains("Use example selects prompt text for immediate overwrite"));
    assert!(script.contains("Chat transcript latest-turn scrolling"));
    assert!(script.contains("Prompt Enter key sends design"));
    assert!(script.contains("Pipeline status transitions"));
    assert!(script.contains("Preview workspace evidence folder"));
    assert!(script.contains("KiCad preview scaffold files"));
    assert!(script.contains("50mm PCB preview outline"));
    assert!(script.contains("KiCad CLI preview compatibility check"));
    assert!(script.contains("KiCad ERC and DRC JSON reports on Send design"));
    assert!(script.contains("JLCPCB BOM/CPL preview blockers"));
    assert!(script.contains("Beginner next steps file for first-run users"));
    assert!(script.contains("Actionable validation status"));
    assert!(script.contains("Left workspace status update"));
    assert!(script.contains("Left tab status updates"));
    assert!(script.contains("Left design preview body"));
    assert!(script.contains("Open PCB/evidence waits until a preview workspace exists"));
    assert!(script.contains("Installer writes INSTALL-SELF-TEST.txt"));
    assert!(script.contains("Open evidence button"));
    assert!(script.contains("Open evidence selects BEGINNER-NEXT-STEPS.txt"));
    assert!(script.contains("Open PCB button"));
    assert!(script.contains("Open PCB status distinguishes KiCad editor from file fallback"));
    assert!(script.contains("Open evidence recovers previous preview workspace"));
    assert!(script.contains("Relaunch shows previous preview workspace status"));
    assert!(script.contains("Relaunch mentions previous preview workspace in chat"));
    assert!(script.contains("KiCad fork CMake drop-in target"));
    assert!(script.contains("KiCad fork stdio chatpcb-core bridge skeleton"));
}

#[test]
fn root_readme_reports_kicad_fork_drop_in_progress_without_overstating_completion() {
    let readme = fs::read_to_string(workspace_root().join("README.md")).unwrap();

    assert!(readme.contains("CMake drop-in target"));
    assert!(readme.contains("stdio `chatpcb-core.exe` bridge skeleton"));
    assert!(readme.contains("not the full KiCad fork"));
    assert!(readme.contains("Full KiCad fork rebased on KiCad 10.0.4 source."));
}
