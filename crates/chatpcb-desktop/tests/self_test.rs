use serde_json::Value;
use std::{fs, process::Command};

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
    assert_eq!(
        contract["chat_actions"]["prompt_input_has_visible_label"],
        true
    );
    assert_eq!(contract["chat_actions"]["prompt_input_has_empty_cue"], true);
    assert_eq!(
        contract["chat_actions"]["empty_prompt_uses_visible_builtin_example"],
        true
    );
    assert_eq!(contract["chat_actions"]["use_example_fills_prompt"], true);
    assert_eq!(
        contract["chat_actions"]["use_example_focuses_prompt_input"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["use_example_selects_prompt_for_overwrite"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["provider_login_selects_available_model"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["provider_model_selection_is_readiness_only_for_preview"],
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
        contract["chat_actions"]["kicad_cli_check_runs_after_send_design"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["erc_drc_reports_run_after_send_design"],
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
        contract["chat_actions"]["open_evidence_selects_beginner_next_steps_file"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["open_pcb_opens_preview_board"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["open_saved_artifacts_disabled_until_workspace"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["open_saved_artifacts_enabled_after_preview"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["provider_login_reports_cli_status"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["provider_login_shows_local_cli_login_hints"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["left_tabs_update_workspace_status"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["left_tabs_update_workspace_preview"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["send_design_appends_chat_transcript"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["chat_transcript_scrolls_to_latest"],
        true
    );
    assert_eq!(contract["chat_actions"]["prompt_enter_sends_design"], true);
    assert_eq!(
        contract["chat_actions"]["app_launch_focuses_prompt_input"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["app_launch_has_korean_first_chat_cue"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["app_launch_selects_available_provider_model"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["provider_login_appends_chat_transcript"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["provider_login_returns_focus_to_prompt"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["open_evidence_recovers_previous_workspace"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["app_launch_shows_recovered_workspace_status"],
        true
    );
    assert_eq!(
        contract["chat_actions"]["app_launch_mentions_recovered_workspace_in_chat"],
        true
    );
    assert_eq!(contract["layout"]["left_ratio"], 0.7);
    assert_eq!(contract["layout"]["right_ratio"], 0.3);
    assert_eq!(
        contract["left_tabs"].as_array().unwrap(),
        &vec![
            Value::String("회로도".to_string()),
            Value::String("PCB 레이아웃".to_string()),
            Value::String("검증".to_string()),
            Value::String("제조 미리보기".to_string())
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
        .contains(&Value::String("채팅 입력 라벨".to_string())));
    assert!(contract["right_panel"]
        .as_array()
        .unwrap()
        .contains(&Value::String("채팅 입력칸".to_string())));
    assert!(contract["right_panel"]
        .as_array()
        .unwrap()
        .contains(&Value::String("예시 사용".to_string())));
    assert!(contract["right_panel"]
        .as_array()
        .unwrap()
        .contains(&Value::String("설계 생성".to_string())));
    assert!(contract["right_panel"]
        .as_array()
        .unwrap()
        .contains(&Value::String("검토 목록".to_string())));
    assert!(contract["right_panel"]
        .as_array()
        .unwrap()
        .contains(&Value::String("PCB 열기".to_string())));
    assert!(!contract["right_panel"]
        .as_array()
        .unwrap()
        .contains(&Value::String("Use example".to_string())));
    assert!(!contract["right_panel"]
        .as_array()
        .unwrap()
        .contains(&Value::String("Send design".to_string())));
    assert!(!contract["right_panel"]
        .as_array()
        .unwrap()
        .contains(&Value::String("Review checklist".to_string())));
    assert!(!contract["right_panel"]
        .as_array()
        .unwrap()
        .contains(&Value::String("Open PCB".to_string())));
    assert!(!contract["right_panel"]
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

#[test]
fn desktop_self_test_summary_is_readable_for_first_run_users() {
    let exe = option_env!("CARGO_BIN_EXE_chatpcb-desktop")
        .expect("chatpcb-desktop binary must be built by Cargo");
    let output = Command::new(exe)
        .arg("--self-test-summary")
        .output()
        .unwrap();

    assert!(output.status.success());
    let summary = String::from_utf8(output.stdout).unwrap();

    assert!(summary.contains("ChatPCB KiCad Preview Self Test"));
    assert!(summary.contains("PASS native Windows app"));
    assert!(summary.contains("PASS Provider Login shows local CLI login hints"));
    assert!(summary.contains("PASS model selector falls back to built-in preview"));
    assert!(
        summary.contains("PASS provider/model selection is readiness-only for preview generation")
    );
    assert!(summary.contains("PASS app launch focuses the prompt for immediate first chat"));
    assert!(summary.contains("PASS first screen shows a Korean first-chat cue"));
    assert!(summary.contains("PASS prompt input has a visible label and empty cue"));
    assert!(summary.contains("PASS pressing Enter sends the first design"));
    assert!(summary.contains("PASS empty prompt visibly uses the built-in ESP32-S3 example"));
    assert!(summary.contains("PASS Send design returns focus for follow-up chat"));
    assert!(summary.contains("PASS first chat can create the built-in ESP32-S3 preview"));
    assert!(summary.contains("PASS Use example selects prompt text for immediate overwrite"));
    assert!(summary.contains("PASS Open PCB/checklist wait for a saved preview"));
    assert!(summary.contains("PASS first-run evidence points back to follow-up chat"));
    assert!(summary.contains("PASS first-run evidence blocks JLCPCB upload"));
    assert!(summary.contains("Boundary: prototype-review, not order-ready"));
    assert!(!summary.contains("provider_login_shows_local_cli_login_hints"));
    assert!(!summary.trim_start().starts_with('{'));
}

#[test]
fn desktop_first_chat_smoke_test_creates_preview_evidence_for_installed_users() {
    let exe = option_env!("CARGO_BIN_EXE_chatpcb-desktop")
        .expect("chatpcb-desktop binary must be built by Cargo");
    let root = std::env::temp_dir().join(format!(
        "chatpcb3-first-chat-smoke-test-{}",
        std::process::id()
    ));
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let output = Command::new(exe)
        .arg("--first-chat-smoke")
        .env("CHATPCB_FIRST_CHAT_SMOKE_ROOT", &root)
        .output()
        .unwrap();

    assert!(output.status.success());
    let summary = String::from_utf8(output.stdout).unwrap();

    assert!(summary.contains("ChatPCB First Chat Smoke Test"));
    assert!(summary.contains("PASS beginner prompt accepted"));
    assert!(summary.contains("PASS preview workspace saved"));
    assert!(summary.contains("PASS generated KiCad preview scaffold"));
    assert!(summary.contains("PASS beginner next steps written"));
    assert!(summary.contains("PASS JLCPCB manufacturing preview blockers written"));
    assert!(summary.contains("PASS KiCad compatibility report written"));
    assert!(summary.contains("PASS ERC/DRC validation summary written"));
    assert!(summary.contains("PASS first-run summary points back to follow-up chat"));
    assert!(summary.contains("PASS first-run summary blocks JLCPCB upload"));
    assert!(summary.contains("Prompt: built-in ESP32-S3 example prompt accepted"));
    assert!(!summary.contains("Prompt: USB-C ESP32-S3"));
    assert!(summary.contains("Boundary: prototype-review, not order-ready"));
    assert!(!summary.trim_start().starts_with('{'));

    let workspace = root.join("chatpcb3-esp32s3-preview");
    assert!(workspace.join("prompt.txt").exists());
    assert!(workspace.join("artifact-manifest.json").exists());
    assert!(workspace.join("chatpcb3-esp32s3.kicad_pro").exists());
    assert!(workspace.join("chatpcb3-esp32s3.kicad_sch").exists());
    assert!(workspace.join("chatpcb3-esp32s3.kicad_pcb").exists());
    assert!(workspace.join("BEGINNER-NEXT-STEPS.txt").exists());
    assert!(workspace.join("jlcpcb-bom-preview.csv").exists());
    assert!(workspace.join("jlcpcb-cpl-preview.csv").exists());
    assert!(workspace
        .join("manufacturing-readiness-preview.txt")
        .exists());
    assert!(workspace.join("kicad-pcb-check.txt").exists());
    assert!(workspace.join("kicad-validation-summary.txt").exists());
    let pcb_check = fs::read_to_string(workspace.join("kicad-pcb-check.txt")).unwrap();
    assert!(pcb_check.contains("ChatPCB3 KiCad CLI PCB check"));
    let validation_summary =
        fs::read_to_string(workspace.join("kicad-validation-summary.txt")).unwrap();
    assert!(validation_summary.contains("ChatPCB3 KiCad ERC/DRC validation"));
    assert!(validation_summary.contains("Boundary:"));
    let first_run_summary = fs::read_to_string(workspace.join("FIRST-RUN-SUMMARY.txt")).unwrap();
    assert!(first_run_summary.contains("후속 입력"));
    assert!(first_run_summary.contains("JLCPCB에 업로드하지 마세요"));
    assert!(!first_run_summary.contains("type a follow-up"));
    assert!(!first_run_summary.contains("Do not upload this preview to JLCPCB"));
    let next_steps = fs::read_to_string(workspace.join("BEGINNER-NEXT-STEPS.txt")).unwrap();
    assert!(next_steps.contains("ChatPCB3 첫 검토 목록"));
    assert!(next_steps.contains("먼저 할 일"));
    assert!(next_steps.contains("PCB 열기"));
    assert!(next_steps.contains("후속 채팅"));
    assert!(next_steps.contains("아직 주문하지 마세요"));
    assert!(!next_steps.contains("First thing to do"));
    assert!(!next_steps.contains("Open PCB"));
    assert!(!next_steps.contains("Ask a follow-up in chat"));
    assert!(!next_steps.contains("Do not order yet"));
    let manufacturing_readiness =
        fs::read_to_string(workspace.join("manufacturing-readiness-preview.txt")).unwrap();
    assert!(manufacturing_readiness.contains("Do not upload this preview to JLCPCB"));
    assert!(manufacturing_readiness.contains("prototype-review, not order-ready"));

    fs::remove_dir_all(&root).unwrap();
}
