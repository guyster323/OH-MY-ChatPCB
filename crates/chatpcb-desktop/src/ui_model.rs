use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChatActionsContract {
    pub send_design_uses_prompt: bool,
    pub send_design_clears_prompt: bool,
    pub use_example_fills_prompt: bool,
    pub provider_login_selects_available_model: bool,
    pub provider_login_reports_cli_status: bool,
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
        provider_login_reports_cli_status: true,
    }
}

pub fn example_board_prompt() -> &'static str {
    "USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB package"
}

pub fn initial_transcript() -> String {
    "Welcome to ChatPCB KiCad Preview\r\n\
     Type a board idea, then click Send design.\r\n\
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
        "Pick an available provider in the model selector, then type a board idea and click Send design.\r\n",
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
