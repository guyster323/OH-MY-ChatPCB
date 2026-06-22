use std::{fs, path::PathBuf};

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap()
        .to_path_buf()
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
    assert!(ui_model.contains("use_example_fills_prompt"));
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
    assert!(main.contains("design_preview"));
    assert!(main.contains("set_design_preview"));
    assert!(main.contains("controls.design_preview"));
    assert!(main.contains("preview_workspace_body"));
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
    assert!(main.contains("Open evidence"));
    assert!(main.contains("handle_open_evidence"));
    assert!(main.contains("last_workspace_dir"));
    assert!(main.contains("open_evidence_folder"));
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
    assert!(main.contains("last_workspace_dir: recover_last_preview_workspace()"));
}

#[test]
fn model_selector_is_collapsed_dropdown_for_first_run_clarity() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(main.contains("CBS_DROPDOWNLIST"));
    assert!(main.contains("WS_TABSTOP | CBS_DROPDOWNLIST"));
}
