use chatpcb_desktop::ui_model::{
    append_chat_transcript, design_pipeline_status, erc_drc_validation_transcript,
    example_loaded_pipeline_status, initial_left_workspace_status, initial_pipeline_status,
    initial_transcript, kicad_cli_check_transcript, left_tab_body, left_tab_status,
    model_selector_items, open_evidence_pipeline_status, open_pcb_pipeline_status,
    preview_workspace_body, preview_workspace_body_with_kicad_check,
    preview_workspace_body_with_validation_reports, preview_workspace_left_status,
    preview_workspace_saved_transcript, provider_login_pipeline_status, provider_login_transcript,
    recovered_preview_workspace_body, recovered_preview_workspace_left_status,
    recovered_preview_workspace_transcript, saved_preview_tab_body, saved_preview_tab_status,
    selected_model_for_statuses, selected_provider_model, send_design_transcript,
    validation_pipeline_status, ProviderUiStatus,
};

#[test]
fn initial_transcript_invites_a_non_expert_first_chat() {
    let transcript = initial_transcript();
    let non_empty_lines = transcript
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();

    assert!(transcript.contains("Welcome to ChatPCB KiCad Preview"));
    assert!(transcript.contains("Type a board idea"));
    assert!(transcript.contains("Provider Login"));
    assert!(transcript.contains("built-in-preview"));
    assert!(transcript.contains("Send design"));
    assert!(transcript.contains("prototype-review"));
    assert!(transcript.contains("JLCPCB"));
    assert!(
        non_empty_lines <= 4,
        "first-run chat should stay concise, got {non_empty_lines} lines: {transcript}"
    );
    assert!(!transcript.contains("Click Open PCB"));
    assert!(!transcript.contains("Click Use example"));
    assert!(!transcript.contains("KiCad 10 when installed"));
    assert!(!transcript.contains("no provider is ready"));
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
fn send_design_transcript_explains_empty_prompt_builtin_example() {
    let transcript = send_design_transcript("  ");

    assert!(
        transcript.contains("User: USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB package")
    );
    assert!(transcript.contains("No prompt was typed"));
    assert!(transcript.contains("built-in ESP32-S3 example"));
    assert!(transcript.contains("edit the prompt"));
    assert!(!transcript.contains("User:   "));
}

#[test]
fn provider_login_transcript_reports_local_cli_status_without_secrets() {
    let transcript = provider_login_transcript(&[
        ProviderUiStatus {
            display_name: "Codex".to_string(),
            available: true,
            version: Some("codex 0.41.0".to_string()),
            login_hint: "Install Codex CLI and complete local login before invoking this provider."
                .to_string(),
        },
        ProviderUiStatus {
            display_name: "Claude Code".to_string(),
            available: false,
            version: None,
            login_hint:
                "Install Claude Code and complete local login before invoking this provider."
                    .to_string(),
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
fn provider_login_transcript_keeps_first_run_preview_unblocked_when_no_cli_is_ready() {
    let transcript = provider_login_transcript(&[
        ProviderUiStatus {
            display_name: "Codex".to_string(),
            available: false,
            version: None,
            login_hint: "Install Codex CLI and complete local login before invoking this provider."
                .to_string(),
        },
        ProviderUiStatus {
            display_name: "Claude Code".to_string(),
            available: false,
            version: None,
            login_hint:
                "Install Claude Code and complete local login before invoking this provider."
                    .to_string(),
        },
        ProviderUiStatus {
            display_name: "Gemini CLI".to_string(),
            available: false,
            version: None,
            login_hint:
                "Install Gemini CLI and complete local login before invoking this provider."
                    .to_string(),
        },
    ]);

    assert!(transcript.contains("No local provider is ready yet"));
    assert!(transcript.contains("You can still press Send design"));
    assert!(transcript.contains("Use built-in-preview now"));
    assert!(transcript.contains("CLI login later"));
    assert!(transcript.contains("Install Codex CLI"));
    assert!(transcript.contains("Install Claude Code"));
    assert!(transcript.contains("Install Gemini CLI"));
    assert!(transcript.contains("click Provider Login again"));
    assert!(!transcript.contains("Selected model:"));
    assert!(!transcript.contains("Pick an available provider"));
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
            login_hint: "Install Codex CLI and complete local login before invoking this provider."
                .to_string(),
        },
        ProviderUiStatus {
            display_name: "Claude Code".to_string(),
            available: true,
            version: Some("2.1.183".to_string()),
            login_hint:
                "Install Claude Code and complete local login before invoking this provider."
                    .to_string(),
        },
        ProviderUiStatus {
            display_name: "Gemini CLI".to_string(),
            available: true,
            version: Some("gemini 0.9.0".to_string()),
            login_hint:
                "Install Gemini CLI and complete local login before invoking this provider."
                    .to_string(),
        },
    ];

    assert_eq!(selected_provider_model(&statuses), Some("claude:auto"));

    let transcript = provider_login_transcript(&statuses);
    assert!(transcript.contains("Selected model: claude:auto"));
}

#[test]
fn model_selector_uses_builtin_preview_when_no_provider_is_ready() {
    let statuses = [
        ProviderUiStatus {
            display_name: "Codex".to_string(),
            available: false,
            version: None,
            login_hint: "Install Codex CLI and complete local login before invoking this provider."
                .to_string(),
        },
        ProviderUiStatus {
            display_name: "Claude Code".to_string(),
            available: false,
            version: None,
            login_hint:
                "Install Claude Code and complete local login before invoking this provider."
                    .to_string(),
        },
    ];

    let items = model_selector_items();

    assert_eq!(items[0], "built-in-preview");
    assert!(items.contains(&"codex:auto"));
    assert_eq!(selected_provider_model(&statuses), None);
    assert_eq!(selected_model_for_statuses(&statuses), "built-in-preview");
}

#[test]
fn chat_transcript_appends_new_turns_without_erasing_context() {
    let existing = provider_login_transcript(&[ProviderUiStatus {
        display_name: "Claude Code".to_string(),
        available: true,
        version: Some("2.1.183".to_string()),
        login_hint: "Install Claude Code and complete local login before invoking this provider."
            .to_string(),
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
        "No local provider found; built-in preview still works."
    );
    assert_eq!(
        design_pipeline_status(),
        "Preview plan queued: schematic -> layout -> DRC -> JLCPCB."
    );
}

#[test]
fn validation_pipeline_status_keeps_next_actions_visible_for_non_experts() {
    let status = validation_pipeline_status(
        "ERC: 0 errors, 0 warnings. DRC: 0 errors, 0 warnings, 0 unconnected. Gate remains prototype-review until schematic, layout, DRC, Gerber, BOM, and CPL evidence are reviewed.",
    );

    assert_eq!(
        status,
        "Validated: Open PCB/evidence, or type a follow-up. Still prototype-review."
    );
    assert!(status.contains("Open PCB"));
    assert!(status.contains("evidence"));
    assert!(status.contains("type a follow-up"));
    assert!(status.contains("prototype-review"));
    assert!(
        status.len() <= 90,
        "status bar text should stay short enough to remain visible: {status}"
    );
}

#[test]
fn open_pcb_pipeline_status_distinguishes_kicad_from_file_fallback() {
    let kicad_status = open_pcb_pipeline_status(true);
    let fallback_status = open_pcb_pipeline_status(false);

    assert_eq!(kicad_status, "Opened preview PCB in KiCad PCB Editor.");
    assert!(fallback_status.contains("Opened preview PCB file."));
    assert!(fallback_status.contains("Install KiCad 10"));
    assert!(fallback_status.contains("PCB Editor did not open"));
    assert_ne!(kicad_status, fallback_status);
}

#[test]
fn open_evidence_pipeline_status_names_the_beginner_next_steps_file() {
    let status = open_evidence_pipeline_status();

    assert_eq!(status, "Opened BEGINNER-NEXT-STEPS.txt in evidence folder.");
    assert!(status.contains("BEGINNER-NEXT-STEPS.txt"));
    assert!(status.contains("evidence folder"));
    assert!(status.len() <= 70);
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
    assert!(transcript.contains("KiCad 10 when installed"));
    assert!(transcript.contains("chatpcb3-esp32s3.kicad_pro"));
    assert!(transcript.contains("chatpcb3-esp32s3.kicad_sch"));
    assert!(transcript.contains("chatpcb3-esp32s3.kicad_pcb"));
    assert!(transcript.contains("BEGINNER-NEXT-STEPS.txt"));
    assert!(transcript.contains("Ask a follow-up"));
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
    assert!(manufacturing.contains("Gerber and Drill files are not generated yet"));
    assert!(manufacturing.contains("BOM/CPL preview files are generated after Send design"));
    assert!(manufacturing.contains("not upload-ready"));
    assert!(!manufacturing.contains("Gerber, Drill, BOM, and CPL files are not generated yet"));

    assert_eq!(left_tab_body(99), left_tab_body(0));
}

#[test]
fn saved_preview_tabs_keep_workspace_context_after_send_design() {
    let project_dir =
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview";

    let schematic_status = saved_preview_tab_status(0, project_dir);
    assert!(schematic_status.contains("Schematic"));
    assert!(schematic_status.contains("Preview workspace saved"));
    assert!(schematic_status.contains(project_dir));

    let schematic = saved_preview_tab_body(0, project_dir);
    assert!(schematic.contains("Preview workspace saved"));
    assert!(schematic.contains("chatpcb3-esp32s3.kicad_sch"));
    assert!(schematic.contains(project_dir));

    let pcb = saved_preview_tab_body(1, project_dir);
    assert!(pcb.contains("PCB Layout"));
    assert!(pcb.contains("chatpcb3-esp32s3.kicad_pcb"));
    assert!(pcb.contains("50mm x 50mm Edge.Cuts"));
    assert!(pcb.contains("Open PCB"));

    let validation = saved_preview_tab_body(2, project_dir);
    assert!(validation.contains("KiCad ERC/DRC reports"));
    assert!(validation.contains("kicad-pcb-check.txt"));
    assert!(validation.contains("erc-report.json"));
    assert!(validation.contains("drc-report.json"));
    assert!(validation.contains("kicad-validation-summary.txt"));
    assert!(validation.contains("prototype-review"));

    let manufacturing = saved_preview_tab_body(3, project_dir);
    assert!(manufacturing.contains("Manufacturing Preview"));
    assert!(manufacturing.contains("JLCPCB upload remains blocked"));
    assert!(manufacturing.contains("Gerber"));
    assert!(manufacturing.contains("jlcpcb-bom-preview.csv"));
    assert!(manufacturing.contains("jlcpcb-cpl-preview.csv"));
    assert!(manufacturing.contains("manufacturing-readiness-preview.txt"));
    assert!(manufacturing.contains("prototype-review"));
    assert!(manufacturing.contains("not order-ready"));

    assert_eq!(
        saved_preview_tab_body(99, project_dir),
        saved_preview_tab_body(0, project_dir)
    );
}

#[test]
fn preview_workspace_body_points_to_saved_artifacts_without_order_ready_claims() {
    let body = preview_workspace_body(
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\release-evidence-preview.md",
    );

    assert!(body.contains("Preview workspace saved"));
    assert!(body.contains("artifact-manifest.json"));
    assert!(body.contains("FIRST-RUN-SUMMARY.txt"));
    assert!(body.contains("BEGINNER-NEXT-STEPS.txt"));
    assert!(body.contains("release-evidence-preview.md"));
    assert!(body.contains("jlcpcb-bom-preview.csv"));
    assert!(body.contains("jlcpcb-cpl-preview.csv"));
    assert!(body.contains("manufacturing-readiness-preview.txt"));
    assert!(body.contains("chatpcb3-esp32s3.kicad_pro"));
    assert!(body.contains("chatpcb3-esp32s3.kicad_sch"));
    assert!(body.contains("chatpcb3-esp32s3.kicad_pcb"));
    assert!(body.contains("50mm x 50mm Edge.Cuts"));
    assert!(body.contains("Open PCB"));
    assert!(body.contains("KiCad 10 when installed"));
    assert!(body.contains("Open evidence"));
    assert!(body.contains("type a follow-up"));
    assert!(body.contains("prototype-review"));
    assert!(body.contains("not order-ready"));
}

#[test]
fn preview_workspace_body_surfaces_kicad_cli_check_for_non_experts() {
    let body = preview_workspace_body_with_kicad_check(
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\release-evidence-preview.md",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\kicad-pcb-check.txt",
        "KiCad accepted the preview PCB. Gate remains prototype-review.",
    );

    assert!(body.contains("KiCad CLI check"));
    assert!(body.contains("kicad-pcb-check.txt"));
    assert!(body.contains("KiCad accepted the preview PCB"));
    assert!(body.contains("prototype-review"));
    assert!(body.contains("not order-ready"));
}

#[test]
fn kicad_cli_check_transcript_points_to_local_report_without_order_ready_claims() {
    let transcript = kicad_cli_check_transcript(
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\kicad-pcb-check.txt",
        "KiCad accepted the preview PCB. Gate remains prototype-review.",
    );

    assert!(transcript.contains("KiCad CLI check"));
    assert!(transcript.contains("KiCad accepted the preview PCB"));
    assert!(transcript.contains("kicad-pcb-check.txt"));
    assert!(transcript.contains("prototype-review"));
    assert!(!transcript
        .to_ascii_lowercase()
        .contains("order-ready evidence"));
}

#[test]
fn preview_workspace_body_surfaces_erc_drc_reports_for_non_experts() {
    let body = preview_workspace_body_with_validation_reports(
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\release-evidence-preview.md",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\kicad-pcb-check.txt",
        "KiCad accepted the preview PCB. Gate remains prototype-review.",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\erc-report.json",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\drc-report.json",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\kicad-validation-summary.txt",
        "ERC: 0 errors, 0 warnings. DRC: 0 errors, 0 warnings, 0 unconnected. Gate remains prototype-review.",
    );

    assert!(body.contains("KiCad ERC/DRC reports"));
    assert!(body.contains("erc-report.json"));
    assert!(body.contains("drc-report.json"));
    assert!(body.contains("kicad-validation-summary.txt"));
    assert!(body.contains("ERC: 0 errors, 0 warnings"));
    assert!(body.contains("DRC: 0 errors, 0 warnings"));
    assert!(body.contains("prototype-review"));
    assert!(body.contains("not order-ready"));
}

#[test]
fn erc_drc_validation_transcript_points_to_saved_reports_without_order_ready_claims() {
    let transcript = erc_drc_validation_transcript(
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\erc-report.json",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\drc-report.json",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\kicad-validation-summary.txt",
        "ERC: 0 errors, 0 warnings. DRC: 0 errors, 0 warnings, 0 unconnected. Gate remains prototype-review.",
    );

    assert!(transcript.contains("KiCad ERC/DRC reports"));
    assert!(transcript.contains("erc-report.json"));
    assert!(transcript.contains("drc-report.json"));
    assert!(transcript.contains("kicad-validation-summary.txt"));
    assert!(transcript.contains("prototype-review"));
    assert!(!transcript
        .to_ascii_lowercase()
        .contains("order-ready evidence"));
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
    assert!(body.contains("FIRST-RUN-SUMMARY.txt"));
    assert!(body.contains("BEGINNER-NEXT-STEPS.txt"));
    assert!(body.contains("kicad-pcb-check.txt"));
    assert!(body.contains("erc-report.json"));
    assert!(body.contains("drc-report.json"));
    assert!(body.contains("kicad-validation-summary.txt"));
    assert!(body.contains("jlcpcb-bom-preview.csv"));
    assert!(body.contains("jlcpcb-cpl-preview.csv"));
    assert!(body.contains("manufacturing-readiness-preview.txt"));
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
