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
    assert!(readme.contains("만들 보드를 `채팅 입력칸`에 적고 Enter를 누릅니다."));
    assert!(readme.contains("만들 보드를 채팅 입력칸에 적고 Enter를 누릅니다."));
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
fn native_window_default_size_supports_readable_embedded_schematic_review() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(
        main.contains("1600,\r\n                1000,")
            || main.contains("1600,\n                1000,"),
        "the default native window should be large enough for a readable KiCad schematic review screenshot"
    );
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
    assert!(main.contains("populate_model_selector"));
    assert!(ui_model.contains("model_selector_index_for_statuses"));
    assert!(main.contains("controls.model_choice"));
    assert!(main.contains("CB_RESETCONTENT"));
    assert!(main.contains("CB_SETDROPPEDWIDTH"));
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
    assert!(ui_model.contains("로컬 도구 없음; 내장 미리보기는 계속 사용 가능합니다."));
    assert!(!ui_model.contains("로컬 provider 없음"));
    assert!(!ui_model.contains("No local provider found; built-in preview still works."));
    assert!(ui_model.contains("그래도 설계 생성으로 ESP32-S3 미리보기를 만들 수 있습니다."));
    assert!(!ui_model.contains("built-in-preview로 계속 진행"));
    assert!(!ui_model.contains("You can still press Send design"));
    assert!(ui_model.contains("selected_model_for_statuses"));
    assert!(main.contains("provider_login_pipeline_status(selected_provider, &statuses)"));
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
    assert!(main.contains("\"채팅 입력\""));
    assert!(!main.contains("\"Chat prompt\""));
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

    assert!(guide.contains("바로 채팅: 만들 보드를 채팅 입력칸에 적고 Enter."));
    assert!(guide.contains("준비: 만들 보드 입력 후 Enter. 빈칸=ESP32-S3 예시."));
    assert!(readme.contains("바로 채팅: 만들 보드를 채팅 입력칸에 적고 Enter."));
}

#[test]
fn native_workspace_labels_are_korean_first_for_first_run_users() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let self_test =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/tests/self_test.rs"))
            .unwrap();

    assert!(main.contains("\"현재 프로젝트: ESP32-S3 USB-C 센서 보드\""));
    assert!(main.contains("add_tab(tabs, 0, \"회로도\")"));
    assert!(main.contains("add_tab(tabs, 1, \"블록도\")"));
    assert!(main.contains("add_tab(tabs, 2, \"PCB 레이아웃\")"));
    assert!(main.contains("add_tab(tabs, 3, \"검증\")"));
    assert!(main.contains("add_tab(tabs, 4, \"제조 미리보기\")"));
    assert!(self_test.contains("Value::String(\"회로도\".to_string())"));
    assert!(self_test.contains("Value::String(\"채팅 입력 라벨\".to_string())"));

    assert!(!main.contains("\"Current Project: ESP32-S3 USB-C Sensor Board\""));
    assert!(!main.contains("add_tab(tabs, 0, \"Schematic\")"));
    assert!(!main.contains("add_tab(tabs, 2, \"Validation\")"));
    assert!(!main.contains("add_tab(tabs, 3, \"Manufacturing Preview\")"));
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
    assert!(main.contains("catalog_with_status_probe(super::probe_provider_status)"));
    assert!(main.contains("selected_provider_model"));
    assert!(main.contains("model_selector_index_for_statuses"));
    assert!(main.contains("CB_SETCURSEL"));
    assert!(main.contains("provider_login_pipeline_status"));
}

#[test]
fn provider_detection_recovers_antigravity_windows_app_outside_path() {
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let main = std::fs::read_to_string(manifest_dir.join("src/main.rs")).unwrap();
    let core_bin = std::fs::read_to_string(
        manifest_dir
            .parent()
            .unwrap()
            .join("chatpcb-core/src/bin/chatpcb-core.rs"),
    )
    .unwrap();

    assert!(main.contains("probe_windows_provider_install"));
    assert!(main.contains(".local\\\\bin\\\\codex.cmd"));
    assert!(main.contains("Codex installed (Windows user bin)"));
    assert!(main.contains("Programs\\\\Antigravity\\\\Antigravity.exe"));
    assert!(main.contains("Antigravity installed (Windows app)"));
    assert!(core_bin.contains("probe_windows_provider_install"));
    assert!(core_bin.contains(".local\\\\bin\\\\codex.cmd"));
    assert!(core_bin.contains("Codex installed (Windows user bin)"));
    assert!(core_bin.contains("Programs\\\\Antigravity\\\\Antigravity.exe"));
    assert!(core_bin.contains("Antigravity installed (Windows app)"));
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
    assert!(main.contains("상태: 미리보기 단계"));
    assert!(!main.contains("상태: preview only"));
    assert!(!main.contains("Gate: preview only."));
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
    assert!(main.contains("live_schematic_body"));
    assert!(main.contains("kicad_cli_check_transcript"));
    assert!(main.contains("erc_drc_validation_transcript"));
}

#[test]
fn prompt_typing_updates_the_live_schematic_before_send() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(main.contains("EN_CHANGE"));
    assert!(main.contains("handle_prompt_changed"));
    assert!(main.contains("ID_PROMPT"));
    assert!(main.contains("입력 중"));
    assert!(main.contains("live_body_for_selected_tab(controls, &prompt"));
    assert!(main.contains("live_block_diagram_body(prompt, apply_result)"));
    assert!(main.contains("live_schematic_body(prompt, apply_result)"));
    assert!(main.contains("set_live_schematic(controls, &preview_body)"));
}

#[test]
fn native_window_draws_a_graphical_live_schematic_canvas() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(main.contains("SCHEMATIC_CANVAS_CLASS_NAME"));
    assert!(main.contains("register_schematic_canvas_class"));
    assert!(main.contains("schematic_canvas: HWND"));
    assert!(main.contains("paint_schematic_canvas"));
    assert!(main.contains("KICAD_SCHEMATIC_VIEW"));
    assert!(main.contains("paint_kicad_schematic_canvas"));
    assert!(main.contains("paint_saved_kicad_schematic_canvas"));
    assert!(main.contains("SAVED_KICAD_EVIDENCE_VIEW"));
    assert!(main.contains("schematic-review.svg"));
    assert!(main.contains("design-quality-report.md"));
    assert!(main.contains("GetParent"));
    assert!(main.contains("paint_block_diagram_canvas"));
    assert!(main.contains("draw_kicad_symbol"));
    assert!(main.contains("Rectangle("));
    assert!(main.contains("MoveToEx("));
    assert!(main.contains("LineTo("));
    assert!(main.contains("TextOutW("));
    assert!(main.contains("set_live_schematic"));
    assert!(main.contains("InvalidateRect(controls.schematic_canvas"));
}

#[test]
fn native_saved_schematic_canvas_prefers_real_kicad_export_over_review_block_diagram() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let cargo =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/Cargo.toml")).unwrap();

    assert!(
        cargo.contains("resvg"),
        "the native tab needs an SVG renderer so KiCad schematic export can replace the block diagram"
    );
    assert!(main.contains("paint_kicad_exported_schematic_canvas"));
    assert!(main.contains("render_kicad_svg_to_bitmap"));
    assert!(main.contains("StretchDIBits"));
    assert!(main.contains("kicad-render"));
    assert!(main.contains("chatpcb3-esp32s3.svg"));

    let exported_svg_branch = main
        .find("paint_kicad_exported_schematic_canvas")
        .expect("saved schematic canvas should look for KiCad exported SVG first");
    let block_diagram_branch = main
        .find("draw_review_block(")
        .expect("review-block fallback should remain available only when KiCad export is missing");
    assert!(
        exported_svg_branch < block_diagram_branch,
        "real KiCad SVG rendering must be the primary 회로도 tab path, not the review block diagram"
    );
}

#[test]
fn native_saved_schematic_canvas_zooms_real_kicad_export_to_circuit_bounds() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(main.contains("detect_kicad_svg_content_bounds"));
    assert!(main.contains("KICAD_SCHEMATIC_CROP_PADDING_MM"));
    assert!(main.contains("KICAD_SCHEMATIC_CIRCUIT_VIEWPORT_LEFT_MM"));
    assert!(main.contains("KICAD_SCHEMATIC_CIRCUIT_VIEWPORT_RIGHT_MM"));
    assert!(main.contains("KICAD_SCHEMATIC_CIRCUIT_BAND_BOTTOM_MM"));
    assert!(main.contains("unit_scale_x"));
    assert!(main.contains("unit_scale_y"));
    assert!(main.contains("let crop_width = (crop_right - crop_left).max(1.0);"));
    assert!(main.contains("tiny_skia::Transform::from_row("));
    assert!(main.contains("-crop_left * scale"));
    assert!(main.contains("-crop_top * scale"));
    assert!(main.contains("schematic_detail_height"));
    assert!(main.contains("preview_height - schematic_detail_height - gap"));
    assert!(
        main.contains("KiCad schematic viewport: auto-cropped circuit content"),
        "the 회로도 tab should show an enlarged design viewport, not a tiny full A4 page"
    );
}

#[test]
fn send_design_exports_real_kicad_schematic_svg_after_chat_generation() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(main.contains("run_kicad_schematic_svg_export"));
    assert!(main.contains("\"sch\""));
    assert!(main.contains("\"export\""));
    assert!(main.contains("\"svg\""));
    assert!(main.contains("--black-and-white"));
    assert!(main.contains("--exclude-drawing-sheet"));
    assert!(main.contains("kicad-schematic-export.txt"));

    let create_workspace = main
        .find("create_preview_workspace(prompt_for_workspace")
        .expect("send design should still create the KiCad workspace from chat");
    let export_svg = main
        .find("run_kicad_schematic_svg_export(&project_dir)")
        .expect("send design should export the KiCad schematic SVG");
    let render_saved = main
        .find("let preview_body = saved_body_for_selected_tab")
        .expect("send design should render the saved workspace after export");
    assert!(
        create_workspace < export_svg && export_svg < render_saved,
        "chat generation must create .kicad_sch, export the KiCad schematic SVG, then update the 회로도 tab"
    );
}

#[test]
fn native_manufacturing_tab_draws_part_selection_review_canvas_not_block_diagram() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("saved_part_selection_review_canvas_lines"));
    assert!(main.contains("schematic_canvas_selected_tab(hwnd) == Some(4)"));
    assert!(main.contains("paint_saved_manufacturing_review_canvas"));
    assert!(
        main.find("schematic_canvas_selected_tab(hwnd) == Some(4)")
            .unwrap()
            < main.find("paint_block_diagram_canvas").unwrap(),
        "manufacturing tab must be routed before the default block diagram fallback"
    );
}

#[test]
fn native_saved_schematic_canvas_reads_saved_workspace_prompt_options() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(main.contains("saved_preview_summary(project_dir"));
    assert!(main.contains("summary.has_h2_sensor"));
    assert!(main.contains("summary.has_touch_display"));
    assert!(main.contains("U5 MQ-8 H2"));
    assert!(main.contains("5V heater"));
    assert!(main.contains("H2_AOUT_RAW"));
    assert!(main.contains("H2_ADC -> GPIO1"));
    assert!(main.contains("DS1 Waveshare 2.8 TFT"));
    assert!(main.contains("ST7789V SPI"));
    assert!(main.contains("XPT2046 touch"));
    assert!(main.contains("quality_summary"));
}

#[test]
fn native_saved_schematic_canvas_uses_parsed_kicad_schematic_model() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(ui_model.contains("pub fn saved_schematic_render_model(project_dir: &str)"));
    assert!(ui_model.contains("pub struct SavedSchematicRenderModel"));
    assert!(ui_model.contains("pub pin_names: Vec<String>"));
    assert!(main.contains("saved_schematic_render_model(project_dir_text.as_ref())"));
    assert!(main.contains("draw_schematic_model_summary(hdc, &schematic_model"));
    assert!(main.contains("model.pin_names"));
    assert!(main.contains("pins ["));
    assert!(main.contains("schematic_model.has_reference(\"U5\")"));
    assert!(main.contains("schematic_model.has_reference(\"DS1\")"));
    assert!(main.contains("schematic_model.has_net(\"H2_ADC\")"));
    assert!(main.contains("schematic_model.has_net(\"DISPLAY_SPI_SCK\")"));
}

#[test]
fn native_saved_schematic_canvas_keeps_parsed_summary_out_of_circuit_area() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(
        !main.contains("draw_schematic_model_summary(hdc, &schematic_model, 18, height - 26);"),
        "parsed KiCad summary must not be drawn at the bottom of the canvas where it overlaps sensor/display symbols"
    );
    assert!(main.contains("draw_schematic_model_summary(hdc, &schematic_model, 18, 78);"));
}

#[test]
fn native_saved_schematic_canvas_shows_prompt_specific_nets_and_signal_conditioning() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(main.contains("draw_saved_h2_adc_conditioning"));
    assert!(main.contains("H2_AOUT_RAW"));
    assert!(main.contains("R7 10k"));
    assert!(main.contains("R8 10k"));
    assert!(main.contains("C6 100nF"));
    assert!(main.contains("H2_ADC -> GPIO1"));
    assert!(main.contains("VBUS_5V heater/VCC"));
    assert!(main.contains("draw_saved_touch_spi_nets"));
    assert!(main.contains("DISPLAY_SPI_SCK"));
    assert!(main.contains("DISPLAY_SPI_MOSI"));
    assert!(main.contains("DISPLAY_SPI_MISO"));
    assert!(main.contains("TOUCH_CS"));
    assert!(main.contains("TOUCH_IRQ"));
    assert!(main.contains("USB ADC SPI"));
    assert!(main.contains("fill_block_background(hdc, bounds);"));
    assert!(
        !main.contains("USB + I2C pins"),
        "saved schematic canvas must not describe an H2/touch prompt as only I2C"
    );

    let h2_wire = main
        .find("draw_saved_h2_adc_conditioning(hdc, sensor, mcu);")
        .unwrap();
    let h2_block = main
        .find("draw_review_block_compact(\r\n            hdc,\r\n            sensor")
        .unwrap_or_else(|| {
            main.find("draw_review_block_compact(\n            hdc,\n            sensor")
                .unwrap()
        });
    assert!(
        h2_wire < h2_block,
        "H2 conditioning wires should be drawn before the U5 block so block fill keeps text legible"
    );

    let touch_wire = main
        .find("draw_saved_touch_spi_nets(hdc, display, mcu);")
        .unwrap();
    let touch_block = main
        .find("draw_review_block_compact(\r\n                hdc,\r\n                display")
        .unwrap_or_else(|| {
            main.find("draw_review_block_compact(\n                hdc,\n                display")
                .unwrap()
        });
    assert!(
        touch_wire < touch_block,
        "touch SPI wires should be drawn before the DS1 block so block fill keeps text legible"
    );
}

#[test]
fn native_saved_schematic_canvas_keeps_h2_passives_out_of_u5_text_rows() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(
        !main.contains("\"R7 10k top\""),
        "R7 should be drawn as a front-end symbol, not duplicated as a U5 text row"
    );
    assert!(
        !main.contains("\"R8 10k bottom\""),
        "R8 should be drawn as a front-end symbol, not duplicated as a U5 text row"
    );
    assert!(
        !main.contains("\"C6 100nF LPF\""),
        "C6 should be drawn as a capacitor symbol, not duplicated as a U5 text row"
    );
    assert!(
        !main.contains("\"AOUT -> R7/R8/C6\""),
        "the AOUT divider/filter should be represented by R7/R8/C6 schematic symbols, not as another crowded U5 text row"
    );
}

#[test]
fn native_saved_schematic_canvas_does_not_duplicate_h2_net_labels_over_symbols() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(
        !main.contains("draw_wire(hdc, sensor.0, signal_y, node_x, signal_y, \"H2_AOUT_RAW\");"),
        "H2_AOUT_RAW already appears in the U5 row; duplicating it on the wire overlaps the schematic symbols"
    );
    assert!(
        !main.contains("draw_wire(hdc, cap_x + 24, signal_y, mcu.0, mcu.3 - 24, \"H2_ADC\");"),
        "H2_ADC already appears in the U5 row; duplicating it on the wire overlaps the schematic symbols"
    );
}

#[test]
fn native_saved_schematic_canvas_routes_optional_display_wire_around_text() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(main.contains("draw_saved_touch_display_wire"));
    assert!(main.contains("draw_saved_touch_display_wire(hdc, mcu, display)"));
    assert!(
        !main.contains("draw_wire(hdc, mcu.0, mcu.3 - 24, display.2, display.1 + 28"),
        "saved schematic canvas must not route the touch display wire through the DS1 label text"
    );
    assert!(
        !main.contains("start_y, \"DISPLAY\""),
        "the display wire label clips visually between U2 and U1; DS1 block text already names the interface"
    );
}

#[test]
fn native_saved_schematic_canvas_gives_optional_blocks_text_clearance() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(main.contains("draw_review_block_compact"));
    assert!(main.contains("idx as i32 * 15"));
    assert!(main.contains("let bottom_top = top + 146;"));
    assert!(main.contains("let sensor = (350, bottom_top, 580, bottom_bottom);"));
    assert!(main.contains("let display = (40, bottom_top, 310, bottom_bottom);"));
    assert!(
        !main.contains("let display = (320, top + 162, 560, top + 304);"),
        "DS1 display block must fit SPI and touch pin rows inside the visible schematic canvas"
    );
    assert!(
        !main.contains("let display = (320, top + 128, 560, top + 256);"),
        "old DS1 position leaves no dedicated lane for H2 front-end symbols"
    );
}

#[test]
fn native_saved_schematic_canvas_draws_actual_circuit_symbols_not_only_review_boxes() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(
        main.contains("draw_saved_h2_adc_front_end_symbols"),
        "H2 path should draw the divider/filter as schematic symbols, not only text rows"
    );
    assert!(main.contains("draw_resistor_symbol"));
    assert!(main.contains("draw_capacitor_symbol"));
    assert!(main.contains("draw_power_net_label"));
    assert!(main.contains("draw_ground_symbol"));
    assert!(main.contains("R7 10k"));
    assert!(main.contains("R8 10k"));
    assert!(main.contains("C6 100nF"));
    assert!(main.contains("H2_ADC"));
    assert!(main.contains("VBUS_5V"));
    assert!(main.contains("+3V3"));
    assert!(
        main.contains("draw_saved_usb_power_entry_symbols"),
        "USB-C and regulator front end should expose CC/fuse/ESD/LDO support as schematic cues"
    );
}

#[test]
fn native_kicad_svg_view_uses_clean_viewport_not_app_grid_underlay() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    let saved_canvas_start = main
        .find("unsafe fn paint_saved_kicad_schematic_canvas")
        .unwrap();
    let exported_canvas_start = main
        .find("unsafe fn paint_kicad_exported_schematic_canvas")
        .unwrap();
    let saved_canvas = &main[saved_canvas_start..exported_canvas_start];

    assert!(
        !saved_canvas.contains("draw_grid(hdc, width, height);"),
        "the KiCad exported SVG view must not look like an image pasted onto the app's fake grid"
    );
    assert!(main.contains("draw_kicad_export_viewport_background"));
    assert!(main.contains("KiCad export viewport"));
}

#[test]
fn native_kicad_svg_view_supports_mouse_wheel_zoom() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(main.contains("WM_MOUSEWHEEL"));
    assert!(main.contains("KICAD_SCHEMATIC_ZOOM_STEP_PERCENT"));
    assert!(main.contains("schematic_zoom_percent"));
    assert!(main.contains("adjust_schematic_zoom_percent"));
    assert!(main.contains(
        "render_kicad_svg_to_bitmap(&svg_file, image_width, image_height, zoom_percent)"
    ));
    assert!(main.contains("Zoom:"));
}

#[test]
fn native_kicad_svg_view_supports_drag_pan() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(main.contains("WM_LBUTTONDOWN"));
    assert!(main.contains("WM_MOUSEMOVE"));
    assert!(main.contains("WM_LBUTTONUP"));
    assert!(main.contains("SetCapture"));
    assert!(main.contains("ReleaseCapture"));
    assert!(main.contains("schematic_pan_x"));
    assert!(main.contains("schematic_pan_y"));
    assert!(main.contains("schematic_drag_origin"));
    assert!(main.contains("adjust_schematic_pan"));
    assert!(main.contains("centered_image_x + pan_x"));
    assert!(main.contains("image_y + pan_y"));
    assert!(main.contains("drag to pan"));
}

#[test]
fn native_app_opens_saved_schematic_in_real_kicad_editor() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(main.contains("ID_OPEN_KICAD"));
    assert!(main.contains("open_kicad_button"));
    assert!(main.contains("\"KiCad 열기\""));
    assert!(main.contains("handle_open_kicad"));
    assert!(main.contains("open_preview_kicad_editor"));
    assert!(main.contains("open_preview_kicad_editor_file"));
    assert!(main.contains("preferred_kicad_gui_path"));
    assert!(main.contains("kicad.exe"));
    assert!(main.contains("chatpcb3-esp32s3.kicad_sch"));
    assert!(main.contains("chatpcb3-esp32s3.kicad_pro"));
    assert!(ui_model.contains("open_kicad_editor_pipeline_status"));
}

#[test]
fn native_saved_schematic_canvas_reserves_space_for_h2_front_end_symbols() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(
        main.contains("let mcu_left = (width - 300).max(640);"),
        "U1/U5 should remain visible inside the canvas instead of being pushed off the right edge"
    );
    assert!(main.contains("let bottom_top = top + 146;"));
    assert!(main.contains("let display = (40, bottom_top, 310, bottom_bottom);"));
    assert!(main.contains("let sensor = (350, bottom_top, 580, bottom_bottom);"));
    assert!(main.contains("let h2_front_end = ("));
    assert!(main.contains("600, bottom_top, width - 80, bottom_bottom"));
    assert!(main.contains("H2 ADC front-end"));
    assert!(
        !main.contains("sensor.3 + 4"),
        "H2 front-end must not be drawn below U5 because the schematic tab is shallow on the real window"
    );
    assert!(
        !main.contains("(sensor.3 + 78).min(height - 64)"),
        "a below-U5 front-end collapses when the canvas height is near the observed 350 px"
    );
    assert!(
        !main.contains(
            "let h2_front_end = (sensor.0 + 18, sensor.1 + 82, sensor.2 - 18, sensor.3 - 8);"
        ),
        "H2 divider/filter symbols should be below the U5 text block, not inside it"
    );
    assert!(main.contains("draw_saved_h2_adc_front_end_symbols(hdc, h2_front_end, sensor, mcu);"));
    assert!(
        !main.contains("let sensor = (mcu_left, top + 150, width - 70, top + 276);"),
        "lower U5 placement pushes the H2 front-end symbols into the canvas edge"
    );
    assert!(
        !main.contains("let mcu_left = (width - 300).max(780);"),
        "pushing U1/U5 far right clips the visible schematic canvas"
    );
}

#[test]
fn native_saved_schematic_canvas_routes_h2_front_end_left_to_right_instead_of_through_u5_text() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(
        main.contains("draw_wire(hdc, sensor.2, signal_y, r7_start - 14, signal_y, \"\");"),
        "U5 AOUT should leave the connector from its right edge into a readable R7/R8/C6 lane"
    );
    assert!(
        !main.contains("draw_wire(hdc, sensor.0, signal_y, r7_start - 14, signal_y, \"\");"),
        "routing from the left edge crosses the U5 label rows and does not read like a schematic"
    );
    assert!(
        main.contains("\"DISPLAY_SPI_MOSI\"")
            && main.contains("\"DISPLAY_SPI_MISO\"")
            && main.contains("\"XPT2046 touch TOUCH_CS\"")
            && main.contains("\"TOUCH_IRQ\""),
        "DS1 rows should be compact enough to fit without colliding with the lower schematic lane"
    );
}

#[test]
fn native_saved_schematic_canvas_keeps_r7_label_below_h2_front_end_symbol() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(
        main.contains("draw_horizontal_resistor_symbol_label_below"),
        "R7 below U5 needs a label-below variant so the label does not climb into U5 review rows"
    );
    assert!(!main
        .contains("draw_resistor_symbol(hdc, r7_start, signal_y, node_x, signal_y, \"R7 10k\");"));
}

#[test]
fn native_saved_schematic_canvas_keeps_h2_ground_label_below_front_end_symbol() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(
        main.contains("draw_ground_symbol_label_below(hdc, node_x, ground_y + 6);"),
        "H2 divider ground label should sit below the symbol instead of colliding with U5 rows"
    );
    assert!(!main.contains("draw_ground_symbol(hdc, node_x, ground_y + 6);"));
}

#[test]
fn send_design_switches_schematic_tab_to_saved_workspace_evidence_view() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(main.contains("saved_body_for_selected_tab"));
    assert!(main.contains("saved_preview_tab_body(selected_left_tab(controls)"));
    assert!(main.contains("set_live_schematic(controls, &preview_body)"));
    assert!(main.contains("controls.last_workspace_dir = Some(project_dir)"));
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
fn send_design_rewrites_quality_report_after_erc_drc_reports() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(main.contains("write_workspace_quality_reports"));
    assert!(main.contains("run_kicad_erc_drc_reports(&project_dir)"));
    assert!(
        main.contains("rewrite_quality_report_after_validation(&project_dir)")
            || main.contains("rewrite_quality_report_after_validation(project_dir)"),
        "send design must recalculate design-quality-report after ERC/DRC files exist"
    );
}

#[test]
fn kicad_validation_fallback_copy_is_korean_first_for_non_experts() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let ui_model =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/ui_model.rs"))
            .unwrap();

    assert!(main.contains("KiCad ERC/DRC 미실행"));
    assert!(main.contains("KiCad 10 실행 파일을 찾지 못했습니다"));
    assert!(main.contains("JSON report를 읽지 못했습니다"));
    assert!(main.contains("검토 목록의 KiCad 검증 요약"));
    assert!(ui_model.contains("KiCad CLI 확인"));
    assert!(ui_model.contains("KiCad ERC/DRC 검증"));

    assert!(!main.contains("KiCad ERC/DRC were not run because"));
    assert!(!main.contains(
        "KiCad ERC/DRC reports were requested, but the JSON reports could not be parsed"
    ));
    assert!(!main.contains("Gate remains prototype-review; install KiCad 10"));
    assert!(!main.contains("gate는 prototype-review"));
    assert!(!main.contains("preview schematic"));
    assert!(!main.contains("kicad-cli.exe 없음"));
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
    assert!(main.contains("saved_body_for_selected_tab"));
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
    assert!(main.contains("let recovered_workspace = if fresh_start_requested()"));
    assert!(main.contains("recover_last_preview_workspace()"));
    assert!(main.contains("recovered_preview_workspace_left_status"));
    assert!(main.contains("saved_preview_tab_body(0, project_dir.as_ref())"));
    assert!(main.contains("recovered_preview_pipeline_status"));
    assert!(main.contains("let initial_pipeline_status = if recovered_workspace.is_some()"));
    assert!(main.contains("&initial_pipeline_status"));
    assert!(main.contains("last_workspace_dir: recovered_workspace"));
}

#[test]
fn recovered_preview_initial_schematic_canvas_uses_saved_schematic_body() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let initial_canvas_block = main
        .split("let initial_schematic_canvas_body = recovered_workspace")
        .nth(1)
        .unwrap()
        .split("let initial_design_preview = recovered_workspace")
        .next()
        .unwrap();

    assert!(
        initial_canvas_block.contains("saved_preview_tab_body(0, project_dir.as_ref())"),
        "recovered app launch must seed the 회로도 canvas with the saved schematic tab body"
    );
    assert!(
        !initial_canvas_block.contains("recovered_preview_workspace_body"),
        "recovered 안내 문구 lacks KICAD_SCHEMATIC_VIEW and makes the 회로도 tab paint as a block diagram"
    );
    assert!(main.contains("&initial_schematic_canvas_body"));
    assert!(main.contains("&initial_design_preview"));
}

#[test]
fn recovered_preview_initial_text_preview_uses_saved_schematic_body() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let initial_text_preview_block = main
        .split("let initial_design_preview = recovered_workspace")
        .nth(1)
        .unwrap()
        .split("let initial_left_status = recovered_workspace")
        .next()
        .unwrap();

    assert!(
        initial_text_preview_block.contains("saved_preview_tab_body(0, project_dir.as_ref())"),
        "recovered app launch must seed the lower text preview with the saved schematic evidence, not only a recovery notice"
    );
    assert!(
        !initial_text_preview_block.contains("recovered_preview_workspace_body"),
        "the first recovered 회로도 tab must show KiCad evidence and quantitative review details before generic recovery guidance"
    );
}

#[test]
fn installer_launch_starts_clean_without_disabling_normal_recovery() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let source_installer =
        fs::read_to_string(workspace_root().join("scripts/install-local.ps1")).unwrap();
    let package_installer =
        fs::read_to_string(workspace_root().join("packaging/install-from-package.ps1")).unwrap();
    let root_readme = fs::read_to_string(workspace_root().join("README.md")).unwrap();
    let guide = fs::read_to_string(workspace_root().join("docs/user-test-guide.md")).unwrap();
    let package_readme =
        fs::read_to_string(workspace_root().join("packaging/README-FIRST.txt")).unwrap();

    assert!(main.contains("fn fresh_start_requested() -> bool"));
    assert!(main.contains("arg == \"--fresh-start\""));
    assert!(main.contains("let recovered_workspace = if fresh_start_requested()"));
    assert!(main.contains("recover_last_preview_workspace()"));

    for installer in [source_installer, package_installer] {
        assert!(installer
            .contains("Start-Process -FilePath \"$InstallRoot\\ChatPCB KiCad Preview.exe\""));
        assert!(installer.contains("-ArgumentList \"--fresh-start\""));
        assert!(installer
            .contains("$startShortcut.TargetPath = \"$InstallRoot\\ChatPCB KiCad Preview.exe\""));
        assert!(!installer.contains("$startShortcut.Arguments = \"--fresh-start\""));
    }

    for document in [root_readme, guide, package_readme] {
        assert!(document.contains("설치 직후 자동 실행은 깨끗한 첫 채팅 화면으로 열립니다."));
        assert!(document.contains("기존 미리보기 파일은 삭제하지 않습니다."));
    }
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
    assert!(main.contains("model_selector_display_items()"));
    assert!(main.contains("selected_model_for_statuses"));
    assert!(ui_model.contains("model_selector_display_items"));
    assert!(ui_model.contains("\"내장 미리보기\""));
    assert!(ui_model.contains("\"Claude Code 자동\""));
    assert!(ui_model.contains("\"built-in-preview\""));
    assert!(ui_model.contains("selected_model_for_statuses"));
}

#[test]
fn bottom_model_selector_leaves_room_for_friendly_provider_names() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();
    let bottom_row = main
        .split("let provider_width =")
        .nth(1)
        .unwrap()
        .split("MoveWindow( controls.pipeline_status")
        .next()
        .unwrap();

    assert!(bottom_row.contains("112;"));
    assert!(bottom_row.contains("let evidence_width = 88;"));
    assert!(bottom_row.contains("right_width - (model_x - right_x)"));
    assert!(!bottom_row.contains("let evidence_width = 140;"));
    assert!(!bottom_row.contains("let provider_width = 122;"));
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
    assert!(guide.contains(
        "Computer Use verified the fresh first-chat view keeps the native left preview concise"
    ));
    assert!(
        guide.contains("large left preview body keeps KiCad/ERC/DRC details behind `검토 목록`")
    );
    assert!(guide.contains("Computer Use verified the saved preview bottom status stays path-free"));
    assert!(guide.contains("Computer Use verified the first-chat transcript stays path-free"));
    assert!(guide.contains("`다음 행동`"));
    assert!(guide.contains("`채팅 입력칸에 바꿀 점을 적고 Enter`"));
    assert!(!guide.contains("Computer Use verified the fresh first-chat view lists"));
    assert!(guide.contains("Computer Use verified the recovered preview launch status"));
    assert!(guide.contains("Computer Use verified the recovered chat transcript stays path-free"));
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
        "`Provider Login은 선택 사항입니다. 내장 미리보기로 prototype-review 증거를 만들며 JLCPCB 주문 준비 파일은 아닙니다.`"
    ));
    assert!(guide
        .contains("`Provider 감지: Claude Code 자동; 미리보기 생성은 앱 안에서만 진행됩니다.`"));
    assert!(guide.contains("`내장 미리보기`"));
    assert!(guide.contains("`Claude Code 자동`"));
    assert!(!guide.contains("Confirm the model selector says `built-in-preview`"));
    assert!(
        !guide.contains("`Provider 감지: claude:auto; 미리보기 생성은 앱 안에서만 진행됩니다.`")
    );
    assert!(!guide.contains("`Provider 감지: claude:auto; preview 생성은 아직 로컬입니다.`"));
    assert!(guide.contains("accessibility text did not include old English provider copy"));
    assert!(guide.contains(
        "Computer Use reinstalled the package after the Korean-first INSTALL-READY template change"
    ));
    assert!(guide.contains("`만들 보드를 채팅 입력칸에 적고 Enter를 누릅니다.`"));
    assert!(guide.contains(
        "Computer Use relaunched the installed app and verified `채팅 입력칸` was focused"
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
    assert!(guide.contains(
        "Computer Use reinstalled and relaunched the package after the friendly model selector update"
    ));
    assert!(guide.contains("`Claude Code 자동` fits in the collapsed model selector"));
    assert!(
        guide.contains("`내장 미리보기`, `Codex 자동`, `Claude Code 자동`, and `Antigravity 자동`")
    );
    assert!(guide.contains("no raw `built-in-preview` or `claude:auto` model id"));
    assert!(guide.contains(
        "Computer Use relaunched the installed app after the Korean-first default guide update"
    ));
    assert!(guide.contains(
        "the installed `README-FIRST.txt` starts with `ChatPCB KiCad Preview 빠른 시작`"
    ));
    assert!(guide.contains(
        "Notepad approval timed out, so the guide content was verified from the installed file"
    ));
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

#[test]
fn docs_explain_saved_preview_status_hides_local_paths() {
    let root_readme = fs::read_to_string(workspace_root().join("README.md")).unwrap();
    let guide = fs::read_to_string(workspace_root().join("docs/user-test-guide.md")).unwrap();
    let package_readme =
        fs::read_to_string(workspace_root().join("packaging/README-FIRST.txt")).unwrap();

    for text in [root_readme, guide, package_readme] {
        assert!(text.contains(
            "미리보기 저장 완료 | 품질 리포트 90점 게이트 확인 | prototype-review, 주문 준비 전."
        ));
        assert!(text.contains("saved preview bottom status"));
        assert!(text.contains("품질 리포트"));
        assert!(!text.contains("미리보기 저장 완료: C:\\"));
    }
}
