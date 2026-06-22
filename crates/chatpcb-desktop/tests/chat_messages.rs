use chatpcb_desktop::ui_model::{
    initial_transcript, provider_login_transcript, send_design_transcript, ProviderUiStatus,
};

#[test]
fn initial_transcript_invites_a_non_expert_first_chat() {
    let transcript = initial_transcript();

    assert!(transcript.contains("Welcome to ChatPCB KiCad Preview"));
    assert!(transcript.contains("Type a board idea"));
    assert!(transcript.contains("Use example"));
    assert!(transcript.contains("Provider Login"));
    assert!(transcript.contains("Send design"));
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
