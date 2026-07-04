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
fn installers_stop_with_clear_message_when_preview_app_is_running() {
    let source_installer =
        fs::read_to_string(workspace_root().join("scripts/install-local.ps1")).unwrap();
    let package_installer =
        fs::read_to_string(workspace_root().join("packaging/install-from-package.ps1")).unwrap();
    let source_cmd =
        fs::read_to_string(workspace_root().join("Install ChatPCB KiCad Preview.cmd")).unwrap();
    let package_cmd =
        fs::read_to_string(workspace_root().join("packaging/Install ChatPCB KiCad Preview.cmd"))
            .unwrap();
    let root_readme = fs::read_to_string(workspace_root().join("README.md")).unwrap();
    let guide = fs::read_to_string(workspace_root().join("docs/user-test-guide.md")).unwrap();
    let package_readme =
        fs::read_to_string(workspace_root().join("packaging/README-FIRST.txt")).unwrap();

    for script in [source_installer, package_installer] {
        assert!(script.contains("Assert-ChatPCBPreviewNotRunning"));
        assert!(script.contains("Get-Process -Name \"ChatPCB KiCad Preview\""));
        assert!(script.contains("ChatPCB KiCad Preview가 실행 중입니다."));
        assert!(script.contains("Write-Host \"앱을 닫고 설치 파일을 다시 실행하세요.\""));
        assert!(script.contains("exit 1"));

        let guard_index = script.find("Assert-ChatPCBPreviewNotRunning").unwrap();
        let copy_index = script.find("Copy-Item -Force").unwrap();
        assert!(
            guard_index < copy_index,
            "installer should check for a running app before copying over the executable"
        );
    }

    for script in [source_cmd, package_cmd] {
        assert!(script.contains("앱이 열려 있다면 닫고 다시 실행하세요."));
    }

    assert!(root_readme
        .contains("ChatPCB KiCad Preview가 이미 열려 있으면 닫고 설치 파일을 다시 실행하세요."));
    assert!(guide
        .contains("ChatPCB KiCad Preview가 이미 열려 있으면 닫고 설치 파일을 다시 실행하세요."));
    assert!(package_readme
        .contains("ChatPCB KiCad Preview가 이미 열려 있으면 닫고 설치 파일을 다시 실행하세요."));
}

#[test]
fn double_click_command_files_are_korean_first_for_non_experts() {
    let source_cmd =
        fs::read_to_string(workspace_root().join("Install ChatPCB KiCad Preview.cmd")).unwrap();
    let package_cmd =
        fs::read_to_string(workspace_root().join("packaging/Install ChatPCB KiCad Preview.cmd"))
            .unwrap();
    let self_test_cmd =
        fs::read_to_string(workspace_root().join("packaging/Run ChatPCB Self Test.cmd")).unwrap();
    let smoke_cmd =
        fs::read_to_string(workspace_root().join("packaging/Run First Chat Smoke Test.cmd"))
            .unwrap();

    for script in [&source_cmd, &package_cmd, &self_test_cmd, &smoke_cmd] {
        assert!(script.contains("chcp 65001 >nul"));
    }

    for installer in [&source_cmd, &package_cmd] {
        assert!(installer.contains("ChatPCB KiCad Preview 설치 실패"));
        assert!(installer.contains("앱이 열려 있다면 닫고 다시 실행하세요."));
        assert!(installer.contains("설치가 끝났습니다. 앱을 시작합니다."));
        assert!(!installer.contains("installation failed."));
        assert!(!installer.contains("is installed and starting now."));
    }

    assert!(self_test_cmd.contains("ChatPCB KiCad Preview 자체 검증을 실행합니다"));
    assert!(self_test_cmd.contains("자체 검증 실패"));
    assert!(self_test_cmd.contains("자체 검증이 끝났습니다"));
    assert!(!self_test_cmd.contains("Self-test failed."));
    assert!(!self_test_cmd.contains("Self-test finished."));

    assert!(smoke_cmd.contains("첫 채팅 smoke test를 실행합니다"));
    assert!(smoke_cmd.contains("첫 채팅 smoke test 실패"));
    assert!(smoke_cmd.contains("첫 채팅 smoke test가 끝났습니다"));
    assert!(!smoke_cmd.contains("First chat smoke test failed."));
    assert!(!smoke_cmd.contains("First chat smoke test finished."));
}

#[test]
fn install_and_uninstall_scripts_report_progress_in_korean_first() {
    let source_installer =
        fs::read_to_string(workspace_root().join("scripts/install-local.ps1")).unwrap();
    let package_installer =
        fs::read_to_string(workspace_root().join("packaging/install-from-package.ps1")).unwrap();
    let uninstall =
        fs::read_to_string(workspace_root().join("packaging/uninstall-preview.ps1")).unwrap();
    let uninstall_cmd =
        fs::read_to_string(workspace_root().join("packaging/Uninstall ChatPCB KiCad Preview.cmd"))
            .unwrap();

    for script in [&source_installer, &package_installer] {
        assert!(script.contains("ChatPCB KiCad Preview가 실행 중입니다."));
        assert!(script.contains("앱을 닫고 설치 파일을 다시 실행하세요."));
        assert!(script.contains("설치 완료:"));
        assert!(script.contains("바탕화면 바로가기:"));
        assert!(script.contains("시작 메뉴 바로가기:"));
        assert!(script.contains("자체 검증 결과:"));
        assert!(script.contains("첫 채팅 smoke test 결과:"));
        assert!(script.contains("시작 안내:"));
        assert!(script.contains("첫 채팅 안내:"));
        assert!(script.contains("한국어 첫 채팅 안내:"));
        assert!(script.contains("ChatPCB KiCad 네이티브 미리보기 앱"));
        assert!(script.contains("ChatPCB KiCad Preview 제거"));
        assert!(script.contains("설치 상태를 검증합니다"));
        assert!(script.contains("첫 채팅부터 미리보기 생성까지 검증합니다"));
        assert!(!script.contains("Installed ChatPCB KiCad Preview to:"));
        assert!(!script.contains("Close ChatPCB KiCad Preview, then run this installer again."));
        assert!(!script.contains("Desktop shortcut:"));
        assert!(!script.contains("Start menu shortcut:"));
        assert!(!script.contains("Self-test shortcut:"));
        assert!(!script.contains("First chat smoke test shortcut:"));
    }

    assert!(uninstall.contains("제거 완료:"));
    assert!(!uninstall.contains("Removed ChatPCB KiCad Preview from:"));

    assert!(uninstall_cmd.contains("chcp 65001 >nul"));
    assert!(uninstall_cmd.contains("ChatPCB KiCad Preview 제거 실패"));
    assert!(uninstall_cmd.contains("제거가 끝났습니다."));
    assert!(!uninstall_cmd.contains("uninstall failed."));
    assert!(!uninstall_cmd.contains("was removed."));
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
    assert!(installer.contains("설치 상태를 검증합니다"));
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
        assert!(script.contains("첫 채팅부터 미리보기 생성까지 검증합니다"));
        assert!(script.contains("INSTALL-FIRST-CHAT-SMOKE.txt"));
        assert!(script.contains("--first-chat-smoke"));
        assert!(script.contains("첫 채팅 smoke test 바로가기:"));
        assert!(script.contains("첫 채팅 smoke test 결과:"));
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
    assert!(guide.contains("PASS design quality report reflects ERC/DRC validation gate"));
    assert!(guide.contains("BEGINNER-NEXT-STEPS.txt"));
    assert!(guide.contains("design-quality-report.md"));
    assert!(guide.contains("production/chatpcb3-esp32s3"));
    assert!(guide.contains("visual-review"));
    assert!(guide.contains("jlcpcb-bom-preview.csv"));
    assert!(guide.contains("jlcpcb-cpl-preview.csv"));
    assert!(guide.contains("chat-to-circuit-trace.md"));
    assert!(guide.contains("part-selection-review.md"));
    assert!(guide.contains("circuit-review-findings.md"));
    assert!(guide.contains("manufacturing-readiness-preview.txt"));
    assert!(guide.contains("`검토 목록` opens the preview evidence folder with"));
    assert!(guide.contains("`BEGINNER-NEXT-STEPS.txt` selected"));
    assert!(guide.contains("검토 목록을 열었습니다."));
    assert!(!guide.contains("검토 목록: BEGINNER-NEXT-STEPS.txt를 열었습니다."));
    assert!(guide.contains("same folder still contains `FIRST-RUN-SUMMARY.txt`"));
    assert!(package_readme.contains("Run First Chat Smoke Test"));
    assert!(package_readme.contains("INSTALL-FIRST-CHAT-SMOKE.txt"));
    assert!(package_readme.contains("PASS beginner next steps written"));
    assert!(package_readme.contains("PASS JLCPCB manufacturing preview blockers written"));
    assert!(package_readme.contains("PASS KiCad compatibility report written"));
    assert!(package_readme.contains("PASS ERC/DRC validation summary written"));
    assert!(package_readme.contains("PASS design quality report reflects ERC/DRC validation gate"));
    assert!(package_readme.contains("BEGINNER-NEXT-STEPS.txt"));
    assert!(package_readme.contains("design-quality-report.md"));
    assert!(package_readme.contains("production/chatpcb3-esp32s3"));
    assert!(package_readme.contains("visual-review"));
    assert!(package_readme.contains("jlcpcb-bom-preview.csv"));
    assert!(package_readme.contains("jlcpcb-cpl-preview.csv"));
    assert!(package_readme.contains("chat-to-circuit-trace.md"));
    assert!(package_readme.contains("part-selection-review.md"));
    assert!(package_readme.contains("circuit-review-findings.md"));
    assert!(package_readme.contains("manufacturing-readiness-preview.txt"));
    assert!(package_readme.contains("with BEGINNER-NEXT-STEPS.txt selected"));
    assert!(package_readme.contains("FIRST-RUN-SUMMARY.txt stays in the same folder"));
    assert!(root_readme.contains("PASS beginner next steps written"));
    assert!(root_readme.contains("PASS JLCPCB manufacturing preview blockers written"));
    assert!(root_readme.contains("PASS KiCad compatibility report written"));
    assert!(root_readme.contains("PASS ERC/DRC validation summary written"));
    assert!(root_readme.contains("PASS design quality report reflects ERC/DRC validation gate"));
    assert!(root_readme.contains("BEGINNER-NEXT-STEPS.txt"));
    assert!(root_readme.contains("design-quality-report.md"));
    assert!(root_readme.contains("production/chatpcb3-esp32s3"));
    assert!(root_readme.contains("visual-review"));
    assert!(root_readme.contains("jlcpcb-bom-preview.csv"));
    assert!(root_readme.contains("jlcpcb-cpl-preview.csv"));
    assert!(root_readme.contains("chat-to-circuit-trace.md"));
    assert!(root_readme.contains("part-selection-review.md"));
    assert!(root_readme.contains("circuit-review-findings.md"));
    assert!(root_readme.contains("manufacturing-readiness-preview.txt"));
    assert!(root_readme.contains("with `BEGINNER-NEXT-STEPS.txt` selected"));
    assert!(root_readme.contains("검토 목록을 열었습니다."));
    assert!(!root_readme.contains("검토 목록: BEGINNER-NEXT-STEPS.txt를 열었습니다."));
    assert!(root_readme.contains("same folder still contains `FIRST-RUN-SUMMARY.txt`"));
}

#[test]
fn source_installer_adds_start_menu_self_test_shortcut() {
    let installer = fs::read_to_string(workspace_root().join("scripts/install-local.ps1")).unwrap();

    assert!(installer.contains("Run ChatPCB Self Test.cmd"));
    assert!(installer.contains("Run ChatPCB Self Test.lnk"));
    assert!(installer.contains("설치 상태를 검증합니다"));
    assert!(installer.contains("자체 검증 바로가기:"));
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
        assert!(script.contains("자체 검증 결과:"));
    }

    assert!(root_readme.contains("INSTALL-SELF-TEST.txt"));
    assert!(guide.contains("INSTALL-SELF-TEST.txt"));
    assert!(guide.contains("PASS Open PCB/checklist wait for a saved preview"));
    assert!(guide.contains("PASS app launch focuses the prompt for immediate first chat"));
    assert!(guide.contains("PASS prompt input has a visible label and empty cue"));
    assert!(guide.contains("PASS pressing Enter sends the first design"));
    assert!(guide.contains("PASS empty prompt visibly uses the built-in ESP32-S3 example"));
    assert!(guide.contains("PASS Send design returns focus for follow-up chat"));
}

#[test]
fn installers_write_install_ready_summary_for_non_experts() {
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
    let install_ready_template =
        fs::read_to_string(workspace_root().join("packaging/INSTALL-READY.txt")).unwrap();

    for script in [source_installer, package_installer] {
        assert!(script.contains("INSTALL-READY.txt"));
        assert!(script.contains("Copy-Item"));
        assert!(script.contains("INSTALL-READY.txt"));
        assert!(!script.contains("Type a board idea in Chat prompt, then press Enter."));
        assert!(!script.contains("Click Review checklist after the preview is saved."));
        assert!(!script.contains("Click Open evidence after the preview is saved."));
        assert!(script.contains("INSTALL-SELF-TEST.txt"));
        assert!(script.contains("INSTALL-FIRST-CHAT-SMOKE.txt"));
        assert!(script.contains("시작 안내:"));
    }

    assert!(install_ready_template.contains("ChatPCB KiCad Preview 설치 완료"));
    assert!(install_ready_template.contains("바로 시작:"));
    assert!(install_ready_template.contains("만들 보드를 채팅 입력칸에 적고 Enter를 누릅니다."));
    assert!(install_ready_template.contains("검토 목록"));
    assert!(install_ready_template.contains("현재 단계: prototype-review, 주문 준비 전."));
    assert!(!install_ready_template.contains("Boundary: prototype-review, not order-ready."));
    assert!(!install_ready_template.contains("Type a board idea in Chat prompt"));

    assert!(package_script.contains("packaging\\INSTALL-READY.txt"));
    assert!(package_script.contains("Installer copies Korean-first INSTALL-READY.txt"));
    assert!(root_readme.contains("INSTALL-READY.txt"));
    assert!(guide.contains("INSTALL-READY.txt"));
    assert!(package_readme.contains("INSTALL-READY.txt"));
    assert!(root_readme.contains("만들 보드를 채팅 입력칸에 적고 Enter를 누릅니다."));
    assert!(guide.contains("만들 보드를 채팅 입력칸에 적고 Enter를 누릅니다."));
    assert!(package_readme.contains("만들 보드를 채팅 입력칸에 적고 Enter를 누릅니다."));
    assert!(!root_readme.contains("Type a board idea in Chat prompt, then press Enter."));
    assert!(!guide.contains("Type a board idea in Chat prompt, then press Enter."));
    assert!(!package_readme.contains("Type a board idea in Chat prompt, then press Enter."));
}

#[test]
fn installers_add_start_here_shortcut_to_install_ready_summary() {
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
        assert!(script.contains("Start Here.lnk"));
        assert!(script.contains("INSTALL-READY.txt"));
        assert!(script.contains("설치 직후 시작 안내를 엽니다"));
        assert!(script.contains("시작 안내 바로가기:"));
    }

    assert!(package_script.contains("Start Here Start Menu shortcut"));
    assert!(root_readme.contains("Start Here"));
    assert!(guide.contains("Start Here"));
    assert!(package_readme.contains("Start Here"));
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
        assert!(script.contains("첫 채팅 안내:"));
    }

    assert!(root_readme.contains("README-FIRST.txt"));
    assert!(root_readme.contains("installed app"));
    assert!(root_readme.contains("`README-FIRST.txt` is Korean-first"));
    assert!(guide.contains("`README-FIRST.txt` is copied beside the installed app"));
    assert!(guide.contains("`README-FIRST.txt` is now Korean-first"));
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
        assert!(script.contains("첫 채팅 안내를 엽니다"));
        assert!(script.contains("첫 채팅 안내 바로가기:"));
    }

    assert!(package_script.contains("First Chat Guide Start Menu shortcut"));
    assert!(root_readme.contains("First Chat Guide"));
    assert!(guide.contains("First Chat Guide"));
    assert!(package_readme.contains("First Chat Guide"));
}

#[test]
fn installers_add_korean_first_chat_guide_for_non_expert_users() {
    let source_installer =
        fs::read_to_string(workspace_root().join("scripts/install-local.ps1")).unwrap();
    let package_installer =
        fs::read_to_string(workspace_root().join("packaging/install-from-package.ps1")).unwrap();
    let package_script =
        fs::read_to_string(workspace_root().join("scripts/package-preview.ps1")).unwrap();
    let root_readme = fs::read_to_string(workspace_root().join("README.md")).unwrap();
    let guide = fs::read_to_string(workspace_root().join("docs/user-test-guide.md")).unwrap();
    let korean_guide =
        fs::read_to_string(workspace_root().join("packaging/README-FIRST-KO.txt")).unwrap();

    for script in [source_installer, package_installer] {
        assert!(script.contains("README-FIRST-KO.txt"));
        assert!(script.contains("First Chat Guide Korean.lnk"));
        assert!(script.contains("한국어 첫 채팅 안내를 엽니다"));
        assert!(script.contains("한국어 첫 채팅 안내:"));
    }

    assert!(package_script.contains("README-FIRST-KO.txt"));
    assert!(package_script.contains("Korean first chat guide for non-expert users"));
    assert!(root_readme.contains("README-FIRST-KO.txt"));
    assert!(
        root_readme.contains("`README-FIRST-KO.txt` remains as the Korean quick-start duplicate")
    );
    assert!(guide.contains("README-FIRST-KO.txt"));
    assert!(korean_guide.contains("ChatPCB KiCad Preview 빠른 시작"));
    assert!(korean_guide.contains("채팅 입력칸"));
    assert!(korean_guide.contains("prototype-review"));
    assert!(korean_guide.contains("Provider Login은 선택 사항입니다"));
    assert!(korean_guide.contains("앱 안의 기본 생성기로 미리보기를 만듭니다"));
    assert!(
        korean_guide.contains("Codex, Claude Code, Antigravity 로컬 도구를 대신 실행하지 않습니다")
    );
    assert!(!korean_guide.contains("Provider/model"));
    assert!(!korean_guide.contains("preview 생성"));
    assert!(!korean_guide.contains("built-in local generator"));
    assert!(!korean_guide.contains("provider CLI"));
    assert!(!korean_guide.contains("Preview generation uses the built-in local generator"));
    assert!(!korean_guide.contains("No provider CLI is invoked"));
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

    assert!(readme.starts_with("ChatPCB KiCad Preview 빠른 시작"));
    assert!(readme.contains("첫 채팅 (First chat)"));
    assert!(readme.contains("설치"));
    assert!(readme.contains("압축을 푼 폴더에서"));
    assert!(readme.contains("만들 보드를 채팅 입력칸에 적고 Enter"));
    assert!(!readme.contains("This is a native Windows preview of the ChatPCB KiCad app."));
    assert!(!readme.contains("Type a PCB request immediately after the app opens."));
    assert!(readme.contains("검증 완료: PCB 열기/검토 목록 또는 후속 입력. 아직 prototype-review."));
    assert!(readme.contains("미리보기 저장 완료"));
    assert!(readme.contains("이전 미리보기 발견"));
    assert!(readme.contains("품질 리포트 90점 게이트 확인"));
    assert!(readme.contains("주문 준비 전"));
    assert!(!readme.contains("Confirm the chat transcript says \"Preview workspace saved\""));
    assert!(!readme.contains("Previous preview workspace found"));
    assert!(readme.contains("예시 문구가 선택되어 있으므로 바로 타이핑하면 덮어씁니다."));
    assert!(readme.contains("INSTALL-SELF-TEST.txt"));
    assert!(readme.contains("PASS app launch focuses the prompt for immediate first chat"));
    assert!(readme.contains("PASS prompt input has a visible label and empty cue"));
    assert!(readme.contains("PASS pressing Enter sends the first design"));
    assert!(readme.contains("PASS empty prompt visibly uses the built-in ESP32-S3 example"));
    assert!(readme.contains("PASS Send design returns focus for follow-up chat"));
    assert!(readme.contains("PASS beginner next steps written"));
    assert!(readme.contains("BEGINNER-NEXT-STEPS.txt"));
    assert!(!readme.contains("Validated: ERC/DRC clear. Next: Open PCB or Open evidence."));
    assert!(!readme.contains("Validated: Open PCB/evidence"));
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
    assert!(script.contains("Korean first-screen chat cue"));
    assert!(script.contains("App launch selects available provider model"));
    assert!(script.contains("Prompt input has visible label and empty cue"));
    assert!(script.contains("Chat transcript append flow"));
    assert!(script.contains("Empty prompt visibly uses the built-in ESP32-S3 example"));
    assert!(script.contains("Provider Login appends without erasing chat"));
    assert!(script.contains("Provider Login keeps built-in preview unblocked when no CLI is ready"));
    assert!(script.contains("Provider Login shows local CLI login hints"));
    assert!(script.contains("Provider model selector is readiness-only for preview generation"));
    assert!(script.contains("Preview generation uses the built-in local generator"));
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
    assert!(script.contains("JLCPCB Gerber/drill/BOM/CPL review artifacts"));
    assert!(script.contains("Design quality report evaluates the 90-point validation gate"));
    assert!(script.contains("Beginner next steps file for first-run users"));
    assert!(
        script.contains("$pcbOpenLabel = \"PCB \" + [string][char]0xC5F4 + [string][char]0xAE30")
    );
    assert!(script.contains("$checklistLabel = [string][char]0xAC80 + [string][char]0xD1A0 + \" \" + [string][char]0xBAA9 + [string][char]0xB85D"));
    assert!(script.contains(
        "\"- Actionable validation status points to $pcbOpenLabel and $checklistLabel\""
    ));
    assert!(script.contains("Left workspace status update"));
    assert!(script.contains("Left tab status updates"));
    assert!(script.contains("Left design preview body"));
    assert!(script
        .contains("\"- $pcbOpenLabel/$checklistLabel waits until a preview workspace exists\""));
    assert!(script.contains("Installer writes INSTALL-SELF-TEST.txt"));
    assert!(script.contains("\"- $checklistLabel button for the saved preview workspace\""));
    assert!(script.contains("Installer auto-launch opens a clean first-chat screen"));
    assert!(
        script.contains("Installer fresh-start launch preserves normal recovered preview relaunch")
    );
    assert!(script
        .contains("\"- $checklistLabel selects BEGINNER-NEXT-STEPS.txt for non-expert review\""));
    assert!(script.contains("\"- $pcbOpenLabel button launches the generated KiCad PCB preview\""));
    assert!(
        script.contains("\"- $pcbOpenLabel status distinguishes KiCad editor from file fallback\"")
    );
    assert!(
        script.contains("\"- $checklistLabel recovers previous preview workspace after relaunch\"")
    );
    assert!(
        !script.contains("Actionable validation status points to Open PCB and Review checklist")
    );
    assert!(
        script.contains("Set-Content -Path $releaseEvidencePath -Value $evidence -Encoding UTF8")
    );
    assert!(
        !script.contains("Set-Content -Path $releaseEvidencePath -Value $evidence -Encoding ASCII")
    );
    assert!(script.contains("Recovered preview status keeps follow-up chat visible"));
    assert!(script.contains("Relaunch shows previous preview workspace status"));
    assert!(script.contains("Relaunch mentions previous preview workspace in chat"));
    assert!(script.contains("KiCad fork CMake drop-in target"));
    assert!(script.contains("KiCad fork stdio chatpcb-core bridge skeleton"));
}

#[test]
fn first_run_docs_explain_provider_selection_is_not_invoked_for_preview() {
    let readme = fs::read_to_string(workspace_root().join("README.md")).unwrap();
    let guide = fs::read_to_string(workspace_root().join("docs/user-test-guide.md")).unwrap();
    let package_readme =
        fs::read_to_string(workspace_root().join("packaging/README-FIRST.txt")).unwrap();

    for document in [readme, guide, package_readme] {
        assert!(document.contains("Provider 선택은 로그인 상태와 모델 확인용"));
        assert!(document.contains("앱 안의 기본 생성기"));
        assert!(document.contains("로컬 도구를 대신 실행하지 않습니다"));
        assert!(!document.contains("Provider/model 선택은 준비 상태 확인용"));
        assert!(!document.contains("built-in local generator"));
        assert!(!document.contains("provider CLI는 호출하지 않습니다"));
        assert!(!document.contains(
            "preview generation uses the built-in local generator. No provider CLI is invoked"
        ));
    }
}

#[test]
fn root_readme_reports_kicad_fork_drop_in_progress_without_overstating_completion() {
    let readme = fs::read_to_string(workspace_root().join("README.md")).unwrap();

    assert!(readme.contains("CMake drop-in target"));
    assert!(readme.contains("stdio `chatpcb-core.exe` bridge skeleton"));
    assert!(readme.contains("not the full KiCad fork"));
    assert!(readme.contains("Full KiCad fork rebased on KiCad 10.0.4 source."));
}
