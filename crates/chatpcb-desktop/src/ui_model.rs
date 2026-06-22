use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChatActionsContract {
    pub send_design_uses_prompt: bool,
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
        provider_login_reports_cli_status: true,
    }
}

pub fn send_design_transcript(prompt: &str) -> String {
    let prompt = prompt.trim();
    let prompt = if prompt.is_empty() {
        "USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB package"
    } else {
        prompt
    };

    format!(
        "User: {prompt}\r\n\
         Assistant: I created the fixed ESP32-S3 target spec, selected the JLCPCB package contract, \
         and queued schematic -> placement -> Freerouting autoroute -> DRC -> manufacturing package.\r\n\
         Status: preview only. Full KiCad fork integration is the next implementation gate.\r\n"
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

    transcript.push_str("No provider credentials are stored in ChatPCB3.\r\n");
    transcript
}
