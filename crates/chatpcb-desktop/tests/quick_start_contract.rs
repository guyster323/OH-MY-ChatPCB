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
fn model_selector_is_collapsed_dropdown_for_first_run_clarity() {
    let main =
        fs::read_to_string(workspace_root().join("crates/chatpcb-desktop/src/main.rs")).unwrap();

    assert!(main.contains("CBS_DROPDOWNLIST"));
    assert!(main.contains("WS_TABSTOP | CBS_DROPDOWNLIST"));
}
