use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChatActionsContract {
    pub send_design_uses_prompt: bool,
    pub send_design_clears_prompt: bool,
    pub use_example_fills_prompt: bool,
    pub use_example_focuses_prompt_input: bool,
    pub use_example_selects_prompt_for_overwrite: bool,
    pub provider_login_selects_available_model: bool,
    pub provider_login_keeps_builtin_preview_unblocked: bool,
    pub pipeline_status_updates_after_actions: bool,
    pub send_design_writes_preview_workspace: bool,
    pub send_design_returns_focus_to_prompt: bool,
    pub kicad_cli_check_runs_after_send_design: bool,
    pub erc_drc_reports_run_after_send_design: bool,
    pub send_design_updates_left_workspace_status: bool,
    pub open_evidence_opens_preview_workspace: bool,
    pub open_evidence_selects_first_run_summary_file: bool,
    pub open_pcb_opens_preview_board: bool,
    pub provider_login_reports_cli_status: bool,
    pub provider_login_shows_local_cli_login_hints: bool,
    pub left_tabs_update_workspace_status: bool,
    pub left_tabs_update_workspace_preview: bool,
    pub send_design_appends_chat_transcript: bool,
    pub chat_transcript_scrolls_to_latest: bool,
    pub prompt_enter_sends_design: bool,
    pub app_launch_focuses_prompt_input: bool,
    pub app_launch_selects_available_provider_model: bool,
    pub provider_login_appends_chat_transcript: bool,
    pub provider_login_returns_focus_to_prompt: bool,
    pub open_evidence_recovers_previous_workspace: bool,
    pub app_launch_shows_recovered_workspace_status: bool,
    pub app_launch_mentions_recovered_workspace_in_chat: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderUiStatus {
    pub display_name: String,
    pub available: bool,
    pub version: Option<String>,
    pub login_hint: String,
}

pub fn chat_actions_contract() -> ChatActionsContract {
    ChatActionsContract {
        send_design_uses_prompt: true,
        send_design_clears_prompt: true,
        use_example_fills_prompt: true,
        use_example_focuses_prompt_input: true,
        use_example_selects_prompt_for_overwrite: true,
        provider_login_selects_available_model: true,
        provider_login_keeps_builtin_preview_unblocked: true,
        pipeline_status_updates_after_actions: true,
        send_design_writes_preview_workspace: true,
        send_design_returns_focus_to_prompt: true,
        kicad_cli_check_runs_after_send_design: true,
        erc_drc_reports_run_after_send_design: true,
        send_design_updates_left_workspace_status: true,
        open_evidence_opens_preview_workspace: true,
        open_evidence_selects_first_run_summary_file: true,
        open_pcb_opens_preview_board: true,
        provider_login_reports_cli_status: true,
        provider_login_shows_local_cli_login_hints: true,
        left_tabs_update_workspace_status: true,
        left_tabs_update_workspace_preview: true,
        send_design_appends_chat_transcript: true,
        chat_transcript_scrolls_to_latest: true,
        prompt_enter_sends_design: true,
        app_launch_focuses_prompt_input: true,
        app_launch_selects_available_provider_model: true,
        provider_login_appends_chat_transcript: true,
        provider_login_returns_focus_to_prompt: true,
        open_evidence_recovers_previous_workspace: true,
        app_launch_shows_recovered_workspace_status: true,
        app_launch_mentions_recovered_workspace_in_chat: true,
    }
}

pub fn initial_left_workspace_status() -> &'static str {
    "Schematic: preview target file chatpcb3-esp32s3.kicad_sch. Native KiCad editor embedding is next."
}

pub fn left_tab_status(index: usize) -> &'static str {
    match index {
        0 => initial_left_workspace_status(),
        1 => "PCB Layout: preview target file chatpcb3-esp32s3.kicad_pcb. Placement and routing are not generated yet.",
        2 => "Validation: ERC/DRC not run yet. Send design creates prototype-review evidence only.",
        3 => "Manufacturing Preview: Gerber/BOM/CPL not generated yet. JLCPCB upload package is still blocked.",
        _ => initial_left_workspace_status(),
    }
}

pub fn left_tab_body(index: usize) -> &'static str {
    match index {
        0 => "Schematic Preview\r\n\
              - Target board: ESP32-S3 USB-C sensor board.\r\n\
              - Planned nets: USB_D+, USB_D-, 5V, 3V3, GND, I2C_SCL, and I2C_SDA.\r\n\
              - Native KiCad schematic embedding is the next fork milestone.\r\n\
              - This preview is safe for first-run orientation, not order-ready evidence.",
        1 => "PCB Layout Preview\r\n\
              - A 50mm x 50mm Edge.Cuts board outline is generated for visual orientation.\r\n\
              - Component placement and Freerouting route data are not generated yet.\r\n\
              - Planned flow: component placement -> DSN export -> Freerouting -> SES import.\r\n\
              - DRC must pass before manufacturing output can be trusted.",
        2 => "Validation Preview\r\n\
              - ERC has not run yet.\r\n\
              - DRC has not run yet.\r\n\
              - The release gate stays prototype-review until KiCad reports and artifacts exist.",
        3 => "Manufacturing Preview\r\n\
              - Gerber, Drill, BOM, and CPL files are not generated yet.\r\n\
              - JLCPCB upload package creation is blocked until schematic, layout, ERC, and DRC evidence exist.\r\n\
              - The app must stop before real ordering and ask for user signoff.",
        _ => left_tab_body(0),
    }
}

pub fn initial_pipeline_status() -> &'static str {
    "Ready: check provider, edit prompt, then press Enter or Send design."
}

pub fn example_loaded_pipeline_status() -> &'static str {
    "Example loaded: edit, press Enter, or Send design."
}

pub fn provider_login_pipeline_status(selected_model: Option<&str>) -> String {
    match selected_model {
        Some(model) => format!("Provider ready: {model} selected."),
        None => "No local provider found; built-in preview still works.".to_string(),
    }
}

pub fn model_selector_items() -> [&'static str; 4] {
    [
        "built-in-preview",
        "codex:auto",
        "claude:auto",
        "gemini:auto",
    ]
}

pub fn model_selector_index(model: &str) -> Option<usize> {
    model_selector_items()
        .iter()
        .position(|item| *item == model)
}

pub fn selected_model_for_statuses(statuses: &[ProviderUiStatus]) -> &'static str {
    selected_provider_model(statuses).unwrap_or("built-in-preview")
}

pub fn design_pipeline_status() -> &'static str {
    "Preview plan queued: schematic -> layout -> DRC -> JLCPCB."
}

pub fn validation_pipeline_status(validation_summary: &str) -> String {
    if validation_summary.contains("ERC: 0 errors, 0 warnings")
        && validation_summary.contains("DRC: 0 errors, 0 warnings, 0 unconnected")
    {
        return "Validated: Open PCB/evidence, or type a follow-up. Still prototype-review."
            .to_string();
    }

    "Review validation: open evidence, inspect ERC/DRC reports. Still prototype-review.".to_string()
}

pub fn open_pcb_pipeline_status(opened_with_kicad: bool) -> &'static str {
    if opened_with_kicad {
        "Opened preview PCB in KiCad PCB Editor."
    } else {
        "Opened preview PCB file. Install KiCad 10 if PCB Editor did not open."
    }
}

pub fn example_board_prompt() -> &'static str {
    "USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB package"
}

pub fn initial_transcript() -> String {
    "Welcome to ChatPCB KiCad Preview\r\n\
     Type a board idea, then press Enter or click Send design.\r\n\
     Click Open PCB after a preview is saved to inspect the board outline with KiCad 10 when installed.\r\n\
     Click Use example to refill the starter board request.\r\n\
     You can start with: ESP32-S3 USB-C sensor board with OLED display.\r\n\
     Provider Login checks local Codex, Claude Code, and Gemini CLI status without storing credentials.\r\n\
     If no provider is ready, built-in-preview still lets you press Enter and create the preview.\r\n\
     This preview shows the native app flow before real order-ready KiCad output is connected.\r\n"
        .to_string()
}

pub fn send_design_transcript(prompt: &str) -> String {
    let prompt = prompt.trim();
    let prompt = if prompt.is_empty() {
        example_board_prompt()
    } else {
        prompt
    };

    format!(
        "User: {prompt}\r\n\
         Assistant: What happened\r\n\
         - Created the fixed ESP32-S3 target spec.\r\n\
         - Selected the JLCPCB package contract.\r\n\
         - Queued schematic -> placement -> Freerouting autoroute -> DRC -> manufacturing package.\r\n\
         Next\r\n\
         - Review the generated plan here first.\r\n\
         - Full KiCad fork integration is still required before order-ready files can be trusted.\r\n\
         Status: preview only, not order-ready yet.\r\n"
    )
}

pub fn append_chat_transcript(existing: &str, next_turn: &str) -> String {
    if existing.trim().is_empty() {
        return next_turn.to_string();
    }

    let mut combined = existing.trim_end_matches(['\r', '\n']).to_string();
    combined.push_str("\r\n\r\n");
    combined.push_str(next_turn.trim_start_matches(['\r', '\n']));
    combined
}

pub fn preview_workspace_saved_transcript(project_dir: &str, release_report_file: &str) -> String {
    format!(
        "Preview workspace saved\r\n\
         - Project folder: {project_dir}\r\n\
         - KiCad preview scaffold: chatpcb3-esp32s3.kicad_pro, chatpcb3-esp32s3.kicad_sch, chatpcb3-esp32s3.kicad_pcb\r\n\
         - PCB preview: 50mm x 50mm Edge.Cuts outline only; no placement or routing yet.\r\n\
         - Click Open PCB to inspect chatpcb3-esp32s3.kicad_pcb with KiCad 10 when installed.\r\n\
         - Release evidence: {release_report_file}\r\n\
         Status: prototype-review, not order-ready.\r\n"
    )
}

pub fn preview_workspace_left_status(project_dir: &str) -> String {
    format!("Preview workspace saved: {project_dir} | prototype-review, not order-ready.")
}

pub fn saved_preview_tab_status(index: usize, project_dir: &str) -> String {
    match index {
        0 => format!(
            "Schematic: Preview workspace saved at {project_dir}. Open chatpcb3-esp32s3.kicad_sch for prototype-review."
        ),
        1 => format!(
            "PCB Layout: Preview workspace saved at {project_dir}. Open chatpcb3-esp32s3.kicad_pcb for the 50mm x 50mm outline."
        ),
        2 => format!(
            "Validation: Preview workspace saved at {project_dir}. Inspect KiCad ERC/DRC reports; gate remains prototype-review."
        ),
        3 => format!(
            "Manufacturing Preview: Preview workspace saved at {project_dir}. Gerber/BOM/CPL are still not order-ready."
        ),
        _ => saved_preview_tab_status(0, project_dir),
    }
}

pub fn saved_preview_tab_body(index: usize, project_dir: &str) -> String {
    match index {
        0 => format!(
            "Preview workspace saved\r\n\
             Schematic\r\n\
             Project folder:\r\n\
             {project_dir}\r\n\r\n\
             Open file:\r\n\
             {project_dir}\\chatpcb3-esp32s3.kicad_sch\r\n\r\n\
             Expected nets:\r\n\
             - USB_D+, USB_D-, 5V, 3V3, GND, I2C_SCL, and I2C_SDA.\r\n\
             - Review symbols and connectivity in KiCad before trusting manufacturing output.\r\n\r\n\
             Gate: prototype-review, not order-ready."
        ),
        1 => format!(
            "PCB Layout\r\n\
             Project folder:\r\n\
             {project_dir}\r\n\r\n\
             Open PCB:\r\n\
             {project_dir}\\chatpcb3-esp32s3.kicad_pcb\r\n\r\n\
             Current preview:\r\n\
             - 50mm x 50mm Edge.Cuts outline.\r\n\
             - Placement and routing are still preview-stage.\r\n\
             - Use Open PCB to inspect the saved board outline with KiCad 10 when installed.\r\n\r\n\
             Gate: prototype-review, not order-ready."
        ),
        2 => format!(
            "KiCad ERC/DRC reports\r\n\
             Project folder:\r\n\
             {project_dir}\r\n\r\n\
             Reports to inspect:\r\n\
             - {project_dir}\\kicad-pcb-check.txt\r\n\
             - {project_dir}\\erc-report.json\r\n\
             - {project_dir}\\drc-report.json\r\n\
             - {project_dir}\\kicad-validation-summary.txt\r\n\r\n\
             Validation must be reviewed before manufacturing output can be trusted.\r\n\
             Gate: prototype-review, not order-ready."
        ),
        3 => format!(
            "Manufacturing Preview\r\n\
             Project folder:\r\n\
             {project_dir}\r\n\r\n\
             JLCPCB upload remains blocked until these are generated and reviewed:\r\n\
             - Gerber zip\r\n\
             - Drill files\r\n\
             - BOM with JLCPCB/LCSC fields\r\n\
             - CPL/position file\r\n\
             - Release evidence report\r\n\r\n\
             The app must stop before real ordering and ask for user signoff.\r\n\
             Gate: prototype-review, not order-ready."
        ),
        _ => saved_preview_tab_body(0, project_dir),
    }
}

pub fn preview_workspace_body(project_dir: &str, release_report_file: &str) -> String {
    format!(
        "Preview workspace saved\r\n\
         Project folder:\r\n\
         {project_dir}\r\n\r\n\
         Files created:\r\n\
         - chatpcb3-esp32s3.kicad_pro\r\n\
         - chatpcb3-esp32s3.kicad_sch\r\n\
         - chatpcb3-esp32s3.kicad_pcb\r\n\
         - sym-lib-table\r\n\
         - fp-lib-table\r\n\
         - prompt.txt\r\n\
         - artifact-manifest.json\r\n\
         - FIRST-RUN-SUMMARY.txt\r\n\
         - release-evidence-preview.md\r\n\r\n\
         PCB preview:\r\n\
         50mm x 50mm Edge.Cuts outline only; no placement or routing yet.\r\n\r\n\
         Click Open PCB to inspect chatpcb3-esp32s3.kicad_pcb with KiCad 10 when installed.\r\n\r\n\
         Release evidence:\r\n\
         {release_report_file}\r\n\r\n\
         Gate: prototype-review, not order-ready."
    )
}

pub fn preview_workspace_body_with_kicad_check(
    project_dir: &str,
    release_report_file: &str,
    check_report_file: &str,
    check_summary: &str,
) -> String {
    format!(
        "{}\r\n\r\n\
         KiCad CLI check:\r\n\
         {check_summary}\r\n\
         Report:\r\n\
         {check_report_file}",
        preview_workspace_body(project_dir, release_report_file)
    )
}

pub fn preview_workspace_body_with_validation_reports(
    project_dir: &str,
    release_report_file: &str,
    check_report_file: &str,
    check_summary: &str,
    erc_report_file: &str,
    drc_report_file: &str,
    validation_summary_file: &str,
    validation_summary: &str,
) -> String {
    format!(
        "{}\r\n\r\n\
         KiCad ERC/DRC reports:\r\n\
         {validation_summary}\r\n\
         ERC report:\r\n\
         {erc_report_file}\r\n\
         DRC report:\r\n\
         {drc_report_file}\r\n\
         Summary:\r\n\
         {validation_summary_file}",
        preview_workspace_body_with_kicad_check(
            project_dir,
            release_report_file,
            check_report_file,
            check_summary
        )
    )
}

pub fn kicad_cli_check_transcript(check_report_file: &str, check_summary: &str) -> String {
    format!(
        "KiCad CLI check\r\n\
         - {check_summary}\r\n\
         - Report: {check_report_file}\r\n"
    )
}

pub fn erc_drc_validation_transcript(
    erc_report_file: &str,
    drc_report_file: &str,
    validation_summary_file: &str,
    validation_summary: &str,
) -> String {
    format!(
        "KiCad ERC/DRC reports\r\n\
         - {validation_summary}\r\n\
         - ERC report: {erc_report_file}\r\n\
         - DRC report: {drc_report_file}\r\n\
         - Summary: {validation_summary_file}\r\n"
    )
}

pub fn recovered_preview_workspace_left_status(project_dir: &str) -> String {
    format!("Previous preview workspace found: {project_dir} | prototype-review, not order-ready.")
}

pub fn recovered_preview_workspace_body(project_dir: &str) -> String {
    let release_report_file = format!("{project_dir}\\release-evidence-preview.md");

    format!(
        "Previous preview workspace found\r\n\
         Project folder:\r\n\
         {project_dir}\r\n\r\n\
         Click Open evidence to inspect the saved files before sending another design.\r\n\
         Click Open PCB to inspect the saved board outline with KiCad 10 when installed.\r\n\r\n\
         Expected files:\r\n\
         - prompt.txt\r\n\
         - artifact-manifest.json\r\n\
         - FIRST-RUN-SUMMARY.txt\r\n\
         - release-evidence-preview.md\r\n\
         - kicad-pcb-check.txt\r\n\
         - erc-report.json\r\n\
         - drc-report.json\r\n\
         - kicad-validation-summary.txt\r\n\r\n\
         Release evidence:\r\n\
         {release_report_file}\r\n\r\n\
         Gate: prototype-review, not order-ready."
    )
}

pub fn recovered_preview_workspace_transcript(project_dir: &str) -> String {
    format!(
        "Previous preview workspace found\r\n\
         - Project folder: {project_dir}\r\n\
         - Click Open evidence to inspect saved files.\r\n\
         - Click Open PCB to inspect the saved board outline with KiCad 10 when installed.\r\n\
         Status: prototype-review, not order-ready.\r\n"
    )
}

pub fn preview_workspace_failed_transcript(error: &str) -> String {
    format!(
        "Preview workspace was not saved\r\n\
         - Reason: {error}\r\n\
         Status: keep this design at preview only.\r\n"
    )
}

pub fn provider_login_transcript(statuses: &[ProviderUiStatus]) -> String {
    let mut transcript = String::from("Provider Login\r\n");
    transcript.push_str("Local CLI provider status:\r\n");

    for status in statuses {
        if status.available {
            let version = status.version.as_deref().unwrap_or("available");
            transcript.push_str(&format!(
                " - {}: available ({version})\r\n",
                status.display_name
            ));
        } else {
            transcript.push_str(&format!(" - {}: not found\r\n", status.display_name));
            transcript.push_str(&format!("   {}\r\n", status.login_hint));
        }
    }

    if let Some(model) = selected_provider_model(statuses) {
        transcript.push_str(&format!("Selected model: {model}\r\n"));
        transcript.push_str(
            "Pick an available provider in the model selector, then type a board idea and press Enter or click Send design.\r\n",
        );
    } else {
        transcript.push_str("No local provider is ready yet.\r\n");
        transcript.push_str(
            "You can still press Send design to create the built-in ESP32-S3 preview.\r\n",
        );
        transcript.push_str(
            "Provider-backed design will require CLI login later; complete a local CLI login, then click Provider Login again.\r\n",
        );
        transcript.push_str(
            "Use built-in-preview now, then type a board idea and press Enter or click Send design.\r\n",
        );
    }

    transcript.push_str("Provider credentials are not stored in ChatPCB3.\r\n");
    transcript
}

pub fn selected_provider_model(statuses: &[ProviderUiStatus]) -> Option<&'static str> {
    statuses
        .iter()
        .filter(|status| status.available)
        .find_map(|status| {
            let name = status.display_name.to_ascii_lowercase();

            if name.contains("codex") {
                Some("codex:auto")
            } else if name.contains("claude") {
                Some("claude:auto")
            } else if name.contains("gemini") {
                Some("gemini:auto")
            } else {
                None
            }
        })
}
