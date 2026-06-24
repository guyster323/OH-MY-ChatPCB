use std::{fs, path::PathBuf};

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap()
        .to_path_buf()
}

#[test]
fn root_readme_puts_non_expert_install_and_chat_path_first() {
    let readme = fs::read_to_string(workspace_root().join("README.md")).unwrap();

    let start_here = readme.find("## Start Here").unwrap();
    let current_status = readme.find("## Current Status").unwrap();

    assert!(start_here < current_status);
    assert!(readme.contains("Download `ChatPCB-KiCad-Preview-windows-x64.zip`"));
    assert!(readme.contains("Double-click `Install ChatPCB KiCad Preview.cmd`"));
    assert!(readme.contains("Open `ChatPCB KiCad Preview`"));
    assert!(readme.contains("만들 보드를 `Chat prompt`에 적고 Enter를 누릅니다."));
    assert!(readme.contains("만들 보드를 Chat prompt에 적고 Enter를 누릅니다."));
    assert!(!readme.contains("Type a board idea in `Chat prompt`, then press Enter."));
    assert!(!readme.contains("Type a board idea in Chat prompt, then press Enter."));
    assert!(readme.contains("저장되면 `검토 목록`을 눌러 확인합니다."));
    assert!(readme.contains("Boundary: `prototype-review`, not order-ready."));
    assert!(readme.contains("Do not upload this preview to JLCPCB."));
}

#[test]
fn native_preview_has_use_example_button_that_fills_the_prompt() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(main.contains("ID_USE_EXAMPLE"));
    assert!(main.contains("handle_use_example"));
    assert!(main.contains("SetDlgItemTextW(hwnd, ID_PROMPT as i32"));
    assert!(main.contains("example_board_prompt"));
    assert!(main.contains("let initial_prompt = chatpcb_desktop::ui_model::example_board_prompt()"));
    assert!(!main.contains("\"USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB package\""));
    assert!(ui_model.contains("use_example_fills_prompt"));
}

#[test]
fn primary_action_buttons_are_korean_first_for_non_experts() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(main.contains("\"예시 사용\""));
    assert!(main.contains("\"설계 생성\""));
    assert!(main.contains("\"PCB 열기\""));
    assert!(main.contains("\"검토 목록\""));
    assert!(main.contains("\"Provider Login\""));
    assert!(!main.contains("\"Use example\""));
    assert!(!main.contains("\"Send design\""));
    assert!(!main.contains("\"Open PCB\""));
    assert!(!main.contains("\"Review checklist\""));
}

#[test]
fn use_example_returns_focus_to_the_prompt_for_immediate_editing() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("use_example_focuses_prompt_input"));
    assert!(main.contains("focus_prompt_after_action"));
    assert!(main.contains("handle_use_example"));
    assert!(main.contains("focus_prompt_after_action(controls)"));
}

#[test]
fn use_example_selects_the_example_for_immediate_overwrite() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();
    let use_example_handler = main
        .split("unsafe fn handle_use_example")
        .nth(1)
        .unwrap()
        .split("unsafe fn handle_provider_login")
        .next()
        .unwrap();

    assert!(ui_model.contains("use_example_selects_prompt_for_overwrite"));
    assert!(use_example_handler.contains("focus_prompt_for_first_chat(controls)"));
}

#[test]
fn provider_login_updates_model_selector_to_available_cli() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("selected_provider_model"));
    assert!(ui_model.contains("provider_login_selects_available_model"));
    assert!(main.contains("selected_provider_model_index"));
    assert!(main.contains("controls.model_choice"));
    assert!(main.contains("CB_SETCURSEL"));
}

#[test]
fn provider_login_returns_focus_to_the_prompt_for_immediate_chat() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("provider_login_returns_focus_to_prompt"));
    assert!(main.contains("handle_provider_login"));
    assert!(main.contains("append_provider_login_transcript"));
    assert!(main.contains("focus_prompt_after_action(controls)"));
}

#[test]
fn provider_login_does_not_block_the_builtin_preview_when_no_cli_is_ready() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("provider_login_keeps_builtin_preview_unblocked"));
    assert!(ui_model.contains("login_hint"));
    assert!(ui_model.contains("로컬 provider 없음; built-in-preview는 계속 사용 가능합니다."));
    assert!(!ui_model.contains("No local provider found; built-in preview still works."));
    assert!(ui_model.contains("그래도 설계 생성으로 ESP32-S3 preview를 만들 수 있습니다."));
    assert!(!ui_model.contains("You can still press Send design"));
    assert!(ui_model.contains("selected_model_for_statuses"));
    assert!(main.contains("provider_login_pipeline_status(selected_provider)"));
    assert!(main.contains("handle_provider_login"));
    assert!(main.contains("login_hint: provider.login_hint"));
}

#[test]
fn first_run_actions_update_the_visible_pipeline_status() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("initial_pipeline_status"));
    assert!(ui_model.contains("provider_login_pipeline_status"));
    assert!(ui_model.contains("example_loaded_pipeline_status"));
    assert!(ui_model.contains("design_pipeline_status"));
    assert!(ui_model.contains("pipeline_status_updates_after_actions"));
    assert!(main.contains("set_pipeline_status"));
    assert!(main.contains("controls.pipeline_status"));
}

#[test]
fn send_design_appends_to_the_existing_chat_transcript() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("send_design_appends_chat_transcript"));
    assert!(ui_model.contains("append_chat_transcript"));
    assert!(main.contains("append_chat_transcript"));
    assert!(main.contains("get_control_text(hwnd, ID_CHAT_TRANSCRIPT"));
}

#[test]
fn send_design_returns_focus_to_the_prompt_for_follow_up_chat() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("send_design_returns_focus_to_prompt"));
    let send_design_handler = main
        .split("unsafe fn handle_send_design")
        .nth(1)
        .unwrap()
        .split("fn run_kicad_pcb_check")
        .next()
        .unwrap();
    assert!(send_design_handler.contains("SetDlgItemTextW(hwnd, ID_PROMPT as i32, empty.as_ptr())"));
    assert!(send_design_handler.contains("focus_prompt_after_action(controls)"));
}

#[test]
fn provider_login_appends_to_the_existing_chat_transcript() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("provider_login_appends_chat_transcript"));
    assert!(main.contains("append_provider_login_transcript"));
    assert!(main.contains("provider_login_turn"));
    assert!(main.contains("append_chat_transcript"));
    assert!(main.contains("get_control_text(hwnd, ID_CHAT_TRANSCRIPT"));
}

#[test]
fn chat_transcript_scrolls_to_the_latest_turn_after_updates() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("chat_transcript_scrolls_to_latest"));
    assert!(main.contains("set_chat_transcript_text"));
    assert!(main.contains("scroll_chat_transcript_to_latest"));
    assert!(main.contains("EM_SETSEL"));
    assert!(main.contains("EM_SCROLLCARET"));
    assert!(main.contains("controls.chat_transcript"));
}

#[test]
fn prompt_enter_key_sends_design_like_a_chat_app() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("prompt_enter_sends_design"));
    assert!(main.contains("subclass_prompt_input"));
    assert!(main.contains("prompt_window_proc"));
    assert!(main.contains("VK_RETURN"));
    assert!(main.contains("WM_KEYDOWN"));
    assert!(main.contains("PostMessageW"));
    assert!(main.contains("WM_CHATPCB_SEND_DEFERRED"));
}

#[test]
fn app_launch_focuses_and_selects_prompt_for_immediate_chat() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("app_launch_focuses_prompt_input"));
    assert!(main.contains("focus_prompt_for_first_chat"));
    assert!(main.contains("SetFocus"));
    assert!(main.contains("controls.prompt"));
    assert!(main.contains("EM_SETSEL"));
    assert!(main.contains("-1"));
    assert!(main.contains("WM_SETFOCUS"));
}

#[test]
fn prompt_input_has_accessible_label_and_empty_cue() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("prompt_input_has_visible_label"));
    assert!(ui_model.contains("prompt_input_has_empty_cue"));
    assert!(main.contains("ID_PROMPT_LABEL"));
    assert!(main.contains("prompt_label"));
    assert!(main.contains("\"Chat prompt\""));
    assert!(main.contains("EM_SETCUEBANNER"));
    assert!(main.contains("만들 보드를 입력하고 Enter"));
    assert!(!main.contains("Type a board request"));
    let compact_main = main.split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(compact_main.contains("MoveWindow( controls.prompt_label"));
}

#[test]
fn user_test_guide_checks_the_korean_first_screen_cue() {
    let guide = fs::read_to_string(workspace_root().join("docs/user-test-guide.md")).unwrap();
    let readme = fs::read_to_string(workspace_root().join("README.md")).unwrap();

    assert!(guide.contains("바로 채팅: 만들 보드를 Chat prompt에 적고 Enter."));
    assert!(guide.contains("준비: 만들 보드 입력 후 Enter. 빈칸=ESP32-S3 예시."));
    assert!(readme.contains("바로 채팅: 만들 보드를 Chat prompt에 적고 Enter."));
}

#[test]
fn app_launch_selects_available_provider_model_for_first_chat() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("app_launch_selects_available_provider_model"));
    assert!(main.contains("initialize_provider_model_selection"));
    assert!(main.contains("catalog_with_probe(super::probe_command_version)"));
    assert!(main.contains("selected_provider_model"));
    assert!(main.contains("selected_provider_model_index"));
    assert!(main.contains("CB_SETCURSEL"));
    assert!(main.contains("provider_login_pipeline_status"));
}

#[test]
fn app_launch_provider_detection_keeps_immediate_chat_status_visible() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    let initializer = main
        .split("unsafe fn initialize_provider_model_selection")
        .nth(1)
        .unwrap()
        .split("unsafe fn subclass_prompt_input")
        .next()
        .unwrap();
    let provider_login_handler = main
        .split("unsafe fn handle_provider_login")
        .nth(1)
        .unwrap()
        .split("unsafe fn append_provider_login_transcript")
        .next()
        .unwrap();

    assert!(initializer.contains("selected_model_for_statuses"));
    assert!(initializer.contains("CB_SETCURSEL"));
    assert!(
        !initializer.contains("set_pipeline_status"),
        "app launch should not hide Ready/Recovered next-action status with provider status"
    );
    assert!(
        provider_login_handler.contains("set_pipeline_status"),
        "Provider Login clicks should still report provider status"
    );
}

#[test]
fn send_design_creates_a_local_preview_workspace_for_non_experts() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("send_design_writes_preview_workspace"));
    assert!(ui_model.contains("preview_workspace_saved_transcript"));
    assert!(main.contains("preview_workspace_root"));
    assert!(main.contains("create_preview_workspace"));
    assert!(main.contains("release_report_file"));
}

#[test]
fn preview_workspace_failure_copy_is_korean_first_in_the_native_window() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(main.contains("미리보기 저장 실패"));
    assert!(main.contains("chat에서 오류를 확인하세요."));
    assert!(main.contains("Gate: preview only."));
    assert!(!main.contains("Preview workspace could not be saved. Check chat for the error."));
    assert!(!main.contains(
        "Preview workspace was not saved.\\r\\nCheck the chat transcript for the error."
    ));
}

#[test]
fn send_design_runs_kicad_cli_check_after_writing_preview() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("kicad_cli_check_runs_after_send_design"));
    assert!(ui_model.contains("preview_workspace_body_with_kicad_check"));
    assert!(main.contains("run_kicad_pcb_check"));
    assert!(main.contains("preferred_kicad_cli_path"));
    assert!(main.contains("kicad-cli.exe"));
    assert!(main.contains("kicad-pcb-check.txt"));
    assert!(main.contains("summarize_kicad_cli_check"));
    assert!(main.contains("preview_workspace_body_with_validation_reports"));
}

#[test]
fn send_design_runs_erc_drc_reports_after_writing_preview() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("erc_drc_reports_run_after_send_design"));
    assert!(ui_model.contains("preview_workspace_body_with_validation_reports"));
    assert!(ui_model.contains("erc_drc_validation_transcript"));
    assert!(main.contains("run_kicad_erc_drc_reports"));
    assert!(main.contains("erc-report.json"));
    assert!(main.contains("drc-report.json"));
    assert!(main.contains("kicad-validation-summary.txt"));
    assert!(main.contains("summarize_erc_drc_reports"));
    assert!(main.contains("parse_kicad_report"));
    assert!(main.contains("validation_pipeline_status(&validation.summary)"));
    assert!(main.contains("visible_empty_prompt_pipeline_status"));
}

#[test]
fn kicad_validation_fallback_copy_is_korean_first_for_non_experts() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(main.contains("KiCad ERC/DRC 미실행"));
    assert!(main.contains("kicad-cli.exe 없음"));
    assert!(main.contains("JSON report를 읽지 못했습니다"));
    assert!(ui_model.contains("KiCad CLI 확인"));
    assert!(ui_model.contains("KiCad ERC/DRC 검증"));

    assert!(!main.contains("KiCad ERC/DRC were not run because"));
    assert!(!main.contains(
        "KiCad ERC/DRC reports were requested, but the JSON reports could not be parsed"
    ));
    assert!(!main.contains("Gate remains prototype-review; install KiCad 10"));
    assert!(!ui_model.contains("KiCad CLI check:"));
    assert!(!ui_model.contains("KiCad ERC/DRC reports:"));
}

#[test]
fn send_design_appends_korean_result_summary_after_validation_reports() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();
    let send_design_handler = main
        .split("unsafe fn handle_send_design")
        .nth(1)
        .unwrap()
        .split("fn run_kicad_pcb_check")
        .next()
        .unwrap();

    let validation_index = send_design_handler
        .find("erc_drc_validation_transcript")
        .unwrap();
    let summary_index = send_design_handler
        .find("preview_result_summary_transcript")
        .unwrap();
    assert!(
        validation_index < summary_index,
        "Korean result summary should be appended after validation so it remains visible at the latest chat position"
    );
    assert!(ui_model.contains("preview_result_summary_transcript"));
    assert!(ui_model.contains("결과: 미리보기 저장 완료"));
    assert!(ui_model.contains("JLCPCB 주문 금지"));
}

#[test]
fn send_design_updates_the_left_workspace_status() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("send_design_updates_left_workspace_status"));
    assert!(ui_model.contains("initial_left_workspace_status"));
    assert!(ui_model.contains("preview_workspace_left_status"));
    assert!(main.contains("set_left_workspace_status"));
    assert!(main.contains("controls.status"));
    assert!(main.contains("preview_workspace_left_status"));
}

#[test]
fn left_project_tabs_update_the_workspace_status() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("left_tabs_update_workspace_status"));
    assert!(ui_model.contains("left_tab_status"));
    assert!(main.contains("WM_NOTIFY"));
    assert!(main.contains("TCN_SELCHANGE"));
    assert!(main.contains("TCM_GETCURSEL"));
    assert!(main.contains("handle_tab_selection"));
    assert!(main.contains("left_tab_status"));
}

#[test]
fn left_project_tabs_show_a_native_preview_body() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("left_tabs_update_workspace_preview"));
    assert!(ui_model.contains("left_tab_body"));
    assert!(ui_model.contains("preview_workspace_body"));
    assert!(ui_model.contains("saved_preview_tab_body"));
    assert!(ui_model.contains("saved_preview_tab_status"));
    assert!(main.contains("design_preview"));
    assert!(main.contains("set_design_preview"));
    assert!(main.contains("controls.design_preview"));
    assert!(main.contains("preview_workspace_body"));
    assert!(main.contains("controls.last_workspace_dir"));
    assert!(main.contains("saved_preview_tab_body"));
    assert!(main.contains("saved_preview_tab_status"));
}

#[test]
fn native_preview_has_open_evidence_button_for_saved_workspace() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("open_evidence_opens_preview_workspace"));
    assert!(main.contains("ID_OPEN_EVIDENCE"));
    assert!(main.contains("검토 목록"));
    assert!(!main.contains("\"Open evidence\""));
    assert!(main.contains("handle_open_evidence"));
    assert!(main.contains("last_workspace_dir"));
    assert!(main.contains("open_evidence_folder"));
}

#[test]
fn saved_artifact_buttons_are_disabled_until_a_workspace_exists() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("open_saved_artifacts_disabled_until_workspace"));
    assert!(ui_model.contains("open_saved_artifacts_enabled_after_preview"));
    assert!(main.contains("set_workspace_action_buttons_enabled"));
    assert!(main.contains("EnableWindow(controls.open_pcb_button"));
    assert!(main.contains("EnableWindow(controls.open_evidence_button"));
    assert!(main.contains(
        "set_workspace_action_buttons_enabled(&controls, recovered_workspace.is_some())"
    ));

    let send_design_handler = main
        .split("unsafe fn handle_send_design")
        .nth(1)
        .unwrap()
        .split("fn run_kicad_pcb_check")
        .next()
        .unwrap();

    assert!(send_design_handler.contains("set_workspace_action_buttons_enabled(controls, true)"));
    assert!(send_design_handler.contains("set_workspace_action_buttons_enabled("));
    assert!(send_design_handler.contains("controls.last_workspace_dir.is_some()"));
}

#[test]
fn open_evidence_selects_beginner_next_steps_for_non_experts() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("open_evidence_selects_beginner_next_steps_file"));
    assert!(ui_model.contains("open_evidence_pipeline_status"));
    assert!(main.contains("open_evidence_report"));
    assert!(main.contains("open_evidence_report_file"));
    assert!(main.contains("open_evidence_pipeline_status()"));
    assert!(main.contains("BEGINNER-NEXT-STEPS.txt"));
    assert!(main.contains("FIRST-RUN-SUMMARY.txt"));
    assert!(main.contains("release-evidence-preview.md"));
    assert!(main.contains("explorer.exe"));
    assert!(main.contains("/select,"));

    let beginner_next_steps_index = main.find("BEGINNER-NEXT-STEPS.txt").unwrap();
    let first_run_summary_index = main.find("FIRST-RUN-SUMMARY.txt").unwrap();
    assert!(
        beginner_next_steps_index < first_run_summary_index,
        "검토 목록 should select BEGINNER-NEXT-STEPS.txt before falling back to FIRST-RUN-SUMMARY.txt"
    );
    assert!(!main.contains("Opened first-run summary in evidence folder."));
}

#[test]
fn native_preview_has_open_pcb_button_for_saved_workspace() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("open_pcb_opens_preview_board"));
    assert!(main.contains("ID_OPEN_PCB"));
    assert!(main.contains("PCB 열기"));
    assert!(main.contains("handle_open_pcb"));
    assert!(main.contains("open_preview_pcb"));
    assert!(main.contains("open_preview_pcb_file"));
    assert!(main.contains("let opened_with_kicad = open_preview_pcb_file"));
    assert!(main.contains("open_pcb_pipeline_status(opened_with_kicad)"));
    assert!(main.contains("chatpcb3-esp32s3.kicad_pcb"));
    assert!(main.contains("pcbnew.exe"));
}

#[test]
fn open_evidence_recovers_previous_preview_workspace_on_launch() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("open_evidence_recovers_previous_workspace"));
    assert!(main.contains("recover_last_preview_workspace"));
    assert!(main.contains("preview_workspace_root().join(\"chatpcb3-esp32s3-preview\")"));
    assert!(main.contains("last_workspace_dir: recovered_workspace"));
}

#[test]
fn app_launch_surfaces_recovered_preview_workspace_to_non_experts() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("app_launch_shows_recovered_workspace_status"));
    assert!(ui_model.contains("recovered_preview_workspace_left_status"));
    assert!(ui_model.contains("recovered_preview_workspace_body"));
    assert!(ui_model.contains("recovered_preview_pipeline_status"));
    assert!(main.contains("let recovered_workspace = recover_last_preview_workspace();"));
    assert!(main.contains("recovered_preview_workspace_left_status"));
    assert!(main.contains("recovered_preview_workspace_body"));
    assert!(main.contains("recovered_preview_pipeline_status"));
    assert!(main.contains("let initial_pipeline_status = if recovered_workspace.is_some()"));
    assert!(main.contains("&initial_pipeline_status"));
    assert!(main.contains("last_workspace_dir: recovered_workspace"));
}

#[test]
fn app_launch_mentions_recovered_preview_workspace_in_chat() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("app_launch_mentions_recovered_workspace_in_chat"));
    assert!(ui_model.contains("recovered_preview_workspace_transcript"));
    assert!(main.contains("initial_chat_transcript"));
    assert!(main.contains("append_chat_transcript"));
    assert!(main.contains("recovered_preview_workspace_transcript"));
}

#[test]
fn model_selector_is_collapsed_dropdown_for_first_run_clarity() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(main.contains("CBS_DROPDOWNLIST"));
    assert!(main.contains("WS_TABSTOP | CBS_DROPDOWNLIST"));
    assert!(main.contains("model_selector_items()"));
    assert!(main.contains("selected_model_for_statuses"));
    assert!(ui_model.contains("\"built-in-preview\""));
    assert!(ui_model.contains("selected_model_for_statuses"));
}

#[test]
fn user_test_guide_keeps_computer_use_status_separate_from_code_verification() {
    let guide = fs::read_to_string(workspace_root().join("docs/user-test-guide.md")).unwrap();

    assert!(guide.contains("Computer Use Verification Status"));
    assert!(guide.contains("Latest run after installing the current preview package"));
    assert!(guide.contains("Computer Use found the installed `ChatPCB KiCad Preview` app entry"));
    assert!(guide.contains("Computer Use launched the installed app"));
    assert!(guide.contains("one targetable `ChatPCB KiCad Preview` window"));
    assert!(guide.contains("captured a screenshot of the native 70/30 workspace"));
    assert!(guide.contains("Computer Use verified the fresh first-chat view lists"));
    assert!(guide.contains("`jlcpcb-bom-preview.csv`"));
    assert!(guide.contains("`jlcpcb-cpl-preview.csv`"));
    assert!(guide.contains("`manufacturing-readiness-preview.txt`"));
    assert!(guide.contains("Computer Use verified the recovered preview launch status"));
    assert!(guide.contains("`이전 미리보기: 이어서 입력 후 Enter. PCB 열기/검토 목록.`"));
    assert!(guide.contains("not hidden by automatic provider detection"));
    assert!(guide.contains(
        "Computer Use reinstalled the current package after the saved/recovered copy localization"
    ));
    assert!(guide.contains("`이전 미리보기 발견`"));
    assert!(guide.contains("`미리보기 저장 완료`"));
    assert!(guide.contains("`order-ready 아님`"));
    assert!(guide.contains("no old `Previous preview workspace found` heading"));
    assert!(guide.contains("no old `Preview workspace saved` heading"));
    assert!(guide.contains(
        "Computer Use reinstalled the current package after the first-screen/provider copy localization"
    ));
    assert!(guide.contains(
        "`Provider Login은 선택 사항입니다. built-in-preview로 prototype-review 증거를 만들며 JLCPCB order-ready 파일은 아닙니다.`"
    ));
    assert!(guide.contains("`Provider 감지: claude:auto; preview 생성은 아직 로컬입니다.`"));
    assert!(guide.contains("accessibility text did not include old English provider copy"));
    assert!(guide.contains(
        "Computer Use reinstalled the package after the Korean-first INSTALL-READY template change"
    ));
    assert!(guide.contains("`만들 보드를 Chat prompt에 적고 Enter를 누릅니다.`"));
    assert!(guide.contains(
        "Computer Use relaunched the installed app and verified `Chat prompt` was focused"
    ));
    assert!(guide.contains("`예시 사용`, `설계 생성`, `PCB 열기`, `Provider Login`, `검토 목록`"));
    assert!(guide.contains("Computer Use also verified the empty prompt fallback"));
    assert!(guide.contains("bottom pipeline status showed"));
    assert!(guide.contains("`내장 예시 사용.`"));
    assert!(!guide.contains("captured the chat log showing"));
    assert!(!guide.contains("empty prompt fallback was not proven through Computer Use"));
    assert!(!guide.contains("No fresh Computer Use proof was captured for the empty prompt"));
    assert!(guide.contains("latest Computer Use run"));
    assert!(!guide.contains("latest run's screenshot or typing proof"));
    assert!(guide.contains(
        "Computer Use reinstalled the current package after the first-response localization"
    ));
    assert!(guide.contains("`Assistant: 결과 요약`"));
    assert!(guide.contains("`다음 행동`"));
    assert!(guide.contains("no old `Assistant: What happened` heading"));
    assert!(guide.contains("Code and installed-package checks still passed"));
    assert!(guide.contains(
        "Computer Use reinstalled and relaunched the package after the status-copy localization"
    ));
    assert!(guide.contains("`이전 미리보기: 이어서 입력 후 Enter. PCB 열기/검토 목록.`"));
    assert!(
        guide.contains("`검증 완료: PCB 열기/검토 목록 또는 후속 입력. 아직 prototype-review.`")
    );
    assert!(guide.contains("no old `Open PCB/checklist`, `Open PCB/Review checklist`, `Recovered:`, or `Ready:` status text"));
}

#[test]
fn docs_explain_open_buttons_wait_for_a_saved_preview() {
    let root_readme = fs::read_to_string(workspace_root().join("README.md")).unwrap();
    let guide = fs::read_to_string(workspace_root().join("docs/user-test-guide.md")).unwrap();

    assert!(root_readme
        .contains("`PCB 열기` and `검토 목록` stay disabled until a preview workspace exists"));
    assert!(root_readme.contains("then become enabled after `설계 생성` saves the preview"));
    assert!(root_readme.contains("previous"));
    assert!(root_readme.contains("preview is recovered"));
    assert!(guide.contains("Confirm `PCB 열기` and `검토 목록` are disabled"));
    assert!(guide.contains("before the first preview"));
    assert!(guide.contains("Confirm `PCB 열기` and `검토 목록` become enabled"));
}

#[test]
fn docs_explain_recovered_preview_keeps_immediate_chat_visible() {
    let root_readme = fs::read_to_string(workspace_root().join("README.md")).unwrap();
    let guide = fs::read_to_string(workspace_root().join("docs/user-test-guide.md")).unwrap();
    let package_readme =
        fs::read_to_string(workspace_root().join("packaging/README-FIRST.txt")).unwrap();

    for text in [root_readme, guide, package_readme] {
        assert!(text.contains("이전 미리보기: 이어서 입력 후 Enter. PCB 열기/검토 목록."));
        assert!(text.contains("short bottom status"));
        assert!(!text.contains("Recovered preview: C:\\"));
    }
}
