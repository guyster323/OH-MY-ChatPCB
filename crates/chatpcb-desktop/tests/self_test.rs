use serde_json::Value;
use std::process::Command;

#[test]
fn desktop_self_test_describes_non_web_native_workspace() {
    let exe = option_env!("CARGO_BIN_EXE_chatpcb-desktop")
        .expect("chatpcb-desktop binary must be built by Cargo");
    let output = Command::new(exe).arg("--self-test").output().unwrap();

    assert!(output.status.success());
    let contract: Value = serde_json::from_slice(&output.stdout).unwrap();

    assert_eq!(contract["app_name"], "ChatPCB KiCad Preview");
    assert_eq!(contract["ui_runtime"], "native-win32");
    assert_eq!(contract["transport"], "stdio-jsonl");
    assert_eq!(contract["chat_transcript"]["multiline"], true);
    assert_eq!(contract["chat_transcript"]["read_only"], true);
    assert_eq!(contract["chat_actions"]["send_design_uses_prompt"], true);
    assert_eq!(contract["chat_actions"]["send_design_clears_prompt"], true);
    assert_eq!(contract["chat_actions"]["use_example_fills_prompt"], true);
    assert_eq!(
        contract["chat_actions"]["provider_login_selects_available_model"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["pipeline_status_updates_after_actions"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["send_design_writes_preview_workspace"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["send_design_updates_left_workspace_status"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["open_evidence_opens_preview_workspace"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["provider_login_reports_cli_status"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["left_tabs_update_workspace_status"],
        true
    );
    assert_eq!(contract["layout"]["left_ratio"], 0.7);
    assert_eq!(contract["layout"]["right_ratio"], 0.3);
    assert_eq!(
        contract["left_tabs"].as_array().unwrap(),
        &vec![
            Value::String("Schematic".to_string()),
            Value::String("PCB Layout".to_string()),
            Value::String("Validation".to_string()),
            Value::String("Manufacturing Preview".to_string())
        ]
    );
    assert!(contract["right_panel"]
        .as_array()
        .unwrap()
        .contains(&Value::String("Provider Login".to_string())));
    assert!(contract["right_panel"]
        .as_array()
        .unwrap()
        .contains(&Value::String("Model selector".to_string())));
    assert!(contract["right_panel"]
        .as_array()
        .unwrap()
        .contains(&Value::String("Chat input".to_string())));
    assert!(contract["right_panel"]
        .as_array()
        .unwrap()
        .contains(&Value::String("Use example".to_string())));
    assert!(contract["right_panel"]
        .as_array()
        .unwrap()
        .contains(&Value::String("Send design".to_string())));
    assert!(contract["right_panel"]
        .as_array()
        .unwrap()
        .contains(&Value::String("Open evidence".to_string())));

    let serialized = String::from_utf8(output.stdout)
        .unwrap()
        .to_ascii_lowercase();
    assert!(!serialized.contains("webview"));
    assert!(!serialized.contains("electron"));
    assert!(!serialized.contains("tauri"));
    assert!(!serialized.contains("localhost"));
    assert!(!serialized.contains("http://"));
    assert!(!serialized.contains("https://"));
}
