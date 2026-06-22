use chatpcb_desktop::ui_model::{
    provider_login_transcript, send_design_transcript, ProviderUiStatus,
};

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
    assert!(!transcript.to_ascii_lowercase().contains("token"));
    assert!(!transcript.to_ascii_lowercase().contains("api_key"));
    assert!(!transcript.to_ascii_lowercase().contains("secret"));
}
