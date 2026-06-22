use chatpcb_desktop::ui_model::{
    append_chat_transcript, design_pipeline_status, example_loaded_pipeline_status,
    initial_left_workspace_status, initial_pipeline_status, initial_transcript, left_tab_body,
    left_tab_status, preview_workspace_body, preview_workspace_left_status,
    preview_workspace_saved_transcript, provider_login_pipeline_status, provider_login_transcript,
    recovered_preview_workspace_body, recovered_preview_workspace_left_status,
    recovered_preview_workspace_transcript, selected_provider_model, send_design_transcript,
    ProviderUiStatus,
};

#[test]
fn initial_transcript_invites_a_non_expert_first_chat() {
    let transcript = initial_transcript();

    assert!(transcript.contains("Welcome to ChatPCB KiCad Preview"));
    assert!(transcript.contains("Type a board idea"));
    assert!(transcript.contains("Use example"));
    assert!(transcript.contains("Provider Login"));
    assert!(transcript.contains("Send design"));
    assert!(transcript.contains("Open PCB"));
    assert!(transcript.contains("preview"));
}

#[test]
fn send_design_transcript_uses_the_user_prompt() {
    let transcript =
        send_design_transcript("Battery powered ESP32-S3 board with OLED and JLCPCB assembly");

    assert!(
        transcript.contains("User: Battery powered ESP32-S3 board with OLED and JLCPCB assembly")
    );
    assert!(transcript.contains("ESP32-S3 target spec"));
    assert!(transcript.contains("JLCPCB package contract"));
    assert!(transcript.contains("Freerouting autoroute"));
    assert!(transcript.contains("Full KiCad fork integration"));
    assert!(transcript.contains("What happened"));
    assert!(transcript.contains("Next"));
    assert!(transcript.contains("order-ready"));
}

#[test]
fn provider_login_transcript_reports_local_cli_status_without_secrets() {
    let transcript = provider_login_transcript(&[
        ProviderUiStatus {
            display_name: "Codex".to_string(),
            available: true,
            version: Some("codex 0.41.0".to_string()),
        },
        ProviderUiStatus {
            display_name: "Claude Code".to_string(),
            available: false,
            version: None,
        },
    ]);

    assert!(transcript.contains("Provider Login"));
    assert!(transcript.contains("Codex: available"));
    assert!(transcript.contains("Claude Code: not found"));
    assert!(transcript.contains("Pick an available provider"));
    assert!(transcript.contains("not stored"));
    assert!(!transcript.to_ascii_lowercase().contains("token"));
    assert!(!transcript.to_ascii_lowercase().contains("api_key"));
    assert!(!transcript.to_ascii_lowercase().contains("secret"));
}

#[test]
fn provider_login_selects_the_first_available_model_for_non_experts() {
    let statuses = [
        ProviderUiStatus {
            display_name: "Codex".to_string(),
            available: false,
            version: None,
        },
        ProviderUiStatus {
            display_name: "Claude Code".to_string(),
            available: true,
            version: Some("2.1.183".to_string()),
        },
        ProviderUiStatus {
            display_name: "Gemini CLI".to_string(),
            available: true,
            version: Some("gemini 0.9.0".to_string()),
        },
    ];

    assert_eq!(selected_provider_model(&statuses), Some("claude:auto"));

    let transcript = provider_login_transcript(&statuses);
    assert!(transcript.contains("Selected model: claude:auto"));
}

#[test]
fn chat_transcript_appends_new_turns_without_erasing_context() {
    let existing = provider_login_transcript(&[ProviderUiStatus {
        display_name: "Claude Code".to_string(),
        available: true,
        version: Some("2.1.183".to_string()),
    }]);
    let next_turn = send_design_transcript("ESP32-S3 board with USB-C and IMU");

    let combined = append_chat_transcript(&existing, &next_turn);

    assert!(combined.contains("Provider Login"));
    assert!(combined.contains("Claude Code: available"));
    assert!(combined.contains("User: ESP32-S3 board with USB-C and IMU"));
    assert!(combined.contains("Assistant: What happened"));
    assert!(combined.find("Provider Login").unwrap() < combined.find("User: ESP32-S3").unwrap());
}

#[test]
fn chat_transcript_append_avoids_empty_history_padding() {
    let combined = append_chat_transcript("", "User: hello\r\n");

    assert_eq!(combined, "User: hello\r\n");
}

#[test]
fn pipeline_status_text_tracks_the_first_run_actions() {
    assert_eq!(
        initial_pipeline_status(),
        "Ready: check provider, edit prompt, then press Enter or Send design."
    );
    assert_eq!(
        example_loaded_pipeline_status(),
        "Example loaded: edit, press Enter, or Send design."
    );
    assert_eq!(
        provider_login_pipeline_status(Some("claude:auto")),
        "Provider ready: claude:auto selected."
    );
    assert_eq!(
        provider_login_pipeline_status(None),
        "Provider needed: install or login to a local CLI."
    );
    assert_eq!(
        design_pipeline_status(),
        "Preview plan queued: schematic -> layout -> DRC -> JLCPCB."
    );
}

#[test]
fn preview_workspace_transcript_points_to_saved_local_evidence() {
    let transcript = preview_workspace_saved_transcript(
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\release-evidence-preview.md",
    );

    assert!(transcript.contains("Preview workspace saved"));
    assert!(transcript.contains("chatpcb3-esp32s3-preview"));
    assert!(transcript.contains("release-evidence-preview.md"));
    assert!(transcript.contains("KiCad preview scaffold"));
    assert!(transcript.contains("50mm x 50mm Edge.Cuts"));
    assert!(transcript.contains("Open PCB"));
    assert!(transcript.contains("chatpcb3-esp32s3.kicad_pro"));
    assert!(transcript.contains("chatpcb3-esp32s3.kicad_sch"));
    assert!(transcript.contains("chatpcb3-esp32s3.kicad_pcb"));
    assert!(transcript.contains("prototype-review"));
    assert!(transcript.contains("not order-ready"));
}

#[test]
fn left_workspace_status_moves_from_placeholder_to_saved_preview() {
    assert!(initial_left_workspace_status().contains("Schematic"));
    assert!(initial_left_workspace_status().contains("chatpcb3-esp32s3.kicad_sch"));
    assert!(initial_left_workspace_status().contains("Native KiCad editor embedding"));

    let status = preview_workspace_left_status(
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview",
    );

    assert!(status.contains("Preview workspace saved"));
    assert!(status.contains("ChatPCB3\\Projects"));
    assert!(status.contains("prototype-review"));
    assert!(status.contains("not order-ready"));
}

#[test]
fn left_tab_status_describes_each_current_project_view() {
    let schematic = left_tab_status(0);
    assert!(schematic.contains("Schematic"));
    assert!(schematic.contains("chatpcb3-esp32s3.kicad_sch"));

    let pcb = left_tab_status(1);
    assert!(pcb.contains("PCB Layout"));
    assert!(pcb.contains("chatpcb3-esp32s3.kicad_pcb"));

    let validation = left_tab_status(2);
    assert!(validation.contains("Validation"));
    assert!(validation.contains("ERC/DRC"));
    assert!(validation.contains("not run yet"));

    let manufacturing = left_tab_status(3);
    assert!(manufacturing.contains("Manufacturing Preview"));
    assert!(manufacturing.contains("Gerber/BOM/CPL"));
    assert!(manufacturing.contains("not generated yet"));

    assert_eq!(left_tab_status(99), initial_left_workspace_status());
}

#[test]
fn left_tab_body_gives_non_experts_a_visible_design_preview() {
    let schematic = left_tab_body(0);
    assert!(schematic.contains("Schematic"));
    assert!(schematic.contains("ESP32-S3"));
    assert!(schematic.contains("USB-C"));
    assert!(schematic.contains("nets"));

    let pcb = left_tab_body(1);
    assert!(pcb.contains("PCB Layout"));
    assert!(pcb.contains("50mm x 50mm"));
    assert!(pcb.contains("Edge.Cuts"));
    assert!(pcb.contains("placement"));
    assert!(pcb.contains("Freerouting"));

    let validation = left_tab_body(2);
    assert!(validation.contains("Validation"));
    assert!(validation.contains("ERC"));
    assert!(validation.contains("DRC"));

    let manufacturing = left_tab_body(3);
    assert!(manufacturing.contains("Manufacturing Preview"));
    assert!(manufacturing.contains("Gerber"));
    assert!(manufacturing.contains("BOM"));
    assert!(manufacturing.contains("CPL"));

    assert_eq!(left_tab_body(99), left_tab_body(0));
}

#[test]
fn preview_workspace_body_points_to_saved_artifacts_without_order_ready_claims() {
    let body = preview_workspace_body(
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\release-evidence-preview.md",
    );

    assert!(body.contains("Preview workspace saved"));
    assert!(body.contains("artifact-manifest.json"));
    assert!(body.contains("release-evidence-preview.md"));
    assert!(body.contains("chatpcb3-esp32s3.kicad_pro"));
    assert!(body.contains("chatpcb3-esp32s3.kicad_sch"));
    assert!(body.contains("chatpcb3-esp32s3.kicad_pcb"));
    assert!(body.contains("50mm x 50mm Edge.Cuts"));
    assert!(body.contains("Open PCB"));
    assert!(body.contains("prototype-review"));
    assert!(body.contains("not order-ready"));
}

#[test]
fn recovered_preview_workspace_text_orients_relaunch_users() {
    let project_dir =
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview";
    let status = recovered_preview_workspace_left_status(project_dir);
    let body = recovered_preview_workspace_body(project_dir);

    assert!(status.contains("Previous preview workspace found"));
    assert!(status.contains("chatpcb3-esp32s3-preview"));
    assert!(status.contains("prototype-review"));
    assert!(body.contains("Previous preview workspace found"));
    assert!(body.contains("Click Open evidence"));
    assert!(body.contains("Open PCB"));
    assert!(body.contains("release-evidence-preview.md"));
    assert!(body.contains("not order-ready"));
}

#[test]
fn recovered_preview_workspace_chat_turn_orients_relaunch_users() {
    let project_dir =
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview";
    let transcript = recovered_preview_workspace_transcript(project_dir);

    assert!(transcript.contains("Previous preview workspace found"));
    assert!(transcript.contains("Open evidence"));
    assert!(transcript.contains("Open PCB"));
    assert!(transcript.contains("chatpcb3-esp32s3-preview"));
    assert!(transcript.contains("prototype-review"));
    assert!(transcript.contains("not order-ready"));
    assert!(!transcript
        .to_ascii_lowercase()
        .contains("order-ready evidence"));
}
