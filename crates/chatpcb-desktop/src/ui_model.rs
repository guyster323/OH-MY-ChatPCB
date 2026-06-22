use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChatActionsContract {
    pub send_design_uses_prompt: bool,
    pub send_design_clears_prompt: bool,
    pub use_example_fills_prompt: bool,
    pub provider_login_selects_available_model: bool,
    pub pipeline_status_updates_after_actions: bool,
    pub send_design_writes_preview_workspace: bool,
    pub send_design_updates_left_workspace_status: bool,
    pub open_evidence_opens_preview_workspace: bool,
    pub provider_login_reports_cli_status: bool,
    pub left_tabs_update_workspace_status: bool,
    pub left_tabs_update_workspace_preview: bool,
    pub send_design_appends_chat_transcript: bool,
    pub chat_transcript_scrolls_to_latest: bool,
    pub prompt_enter_sends_design: bool,
    pub app_launch_focuses_prompt_input: bool,
    pub app_launch_selects_available_provider_model: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderUiStatus {
    pub display_name: String,
    pub available: bool,
    pub version: Option<String>,
}

pub fn chat_actions_contract() -> ChatActionsContract {
    ChatActionsContract {
        send_design_uses_prompt: true,
        send_design_clears_prompt: true,
        use_example_fills_prompt: true,
        provider_login_selects_available_model: true,
        pipeline_status_updates_after_actions: true,
        send_design_writes_preview_workspace: true,
        send_design_updates_left_workspace_status: true,
        open_evidence_opens_preview_workspace: true,
        provider_login_reports_cli_status: true,
        left_tabs_update_workspace_status: true,
        left_tabs_update_workspace_preview: true,
        send_design_appends_chat_transcript: true,
        chat_transcript_scrolls_to_latest: true,
        prompt_enter_sends_design: true,
        app_launch_focuses_prompt_input: true,
        app_launch_selects_available_provider_model: true,
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
              - Board outline, placement, and Freerouting route data are not generated yet.\r\n\
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
        None => "Provider needed: install or login to a local CLI.".to_string(),
    }
}

pub fn design_pipeline_status() -> &'static str {
    "Preview plan queued: schematic -> layout -> DRC -> JLCPCB."
}

pub fn example_board_prompt() -> &'static str {
    "USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB package"
}

pub fn initial_transcript() -> String {
    "Welcome to ChatPCB KiCad Preview\r\n\
     Type a board idea, then press Enter or click Send design.\r\n\
     Click Use example to refill the starter board request.\r\n\
     You can start with: ESP32-S3 USB-C sensor board with OLED display.\r\n\
     Provider Login checks local Codex, Claude Code, and Gemini CLI status without storing credentials.\r\n\
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
         - Release evidence: {release_report_file}\r\n\
         Status: prototype-review, not order-ready.\r\n"
    )
}

pub fn preview_workspace_left_status(project_dir: &str) -> String {
    format!("Preview workspace saved: {project_dir} | prototype-review, not order-ready.")
}

pub fn preview_workspace_body(project_dir: &str, release_report_file: &str) -> String {
    format!(
        "Preview workspace saved\r\n\
         Project folder:\r\n\
         {project_dir}\r\n\r\n\
         Files created:\r\n\
         - prompt.txt\r\n\
         - artifact-manifest.json\r\n\
         - release-evidence-preview.md\r\n\r\n\
         Release evidence:\r\n\
         {release_report_file}\r\n\r\n\
         Gate: prototype-review, not order-ready."
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
        }
    }

    if let Some(model) = selected_provider_model(statuses) {
        transcript.push_str(&format!("Selected model: {model}\r\n"));
    }

    transcript.push_str("Provider credentials are not stored in ChatPCB3.\r\n");
    transcript.push_str(
        "Pick an available provider in the model selector, then type a board idea and press Enter or click Send design.\r\n",
    );
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
