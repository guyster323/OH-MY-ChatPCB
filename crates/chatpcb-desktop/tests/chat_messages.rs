use chatpcb_desktop::ui_model::{
    append_chat_transcript, design_pipeline_status, erc_drc_validation_transcript,
    example_board_prompt, example_loaded_pipeline_status, initial_left_workspace_status,
    initial_pipeline_status, initial_transcript, kicad_cli_check_transcript, left_tab_body,
    left_tab_status, model_selector_items, open_evidence_pipeline_status, open_pcb_pipeline_status,
    preview_result_summary_transcript, preview_workspace_body,
    preview_workspace_body_with_kicad_check, preview_workspace_body_with_validation_reports,
    preview_workspace_failed_transcript, preview_workspace_left_status,
    preview_workspace_saved_transcript, provider_login_pipeline_status, provider_login_transcript,
    recovered_preview_pipeline_status, recovered_preview_workspace_body,
    recovered_preview_workspace_left_status, recovered_preview_workspace_transcript,
    saved_preview_tab_body, saved_preview_tab_status, selected_model_for_statuses,
    selected_provider_model, send_design_transcript, validation_pipeline_status,
    visible_empty_prompt_pipeline_status, ProviderUiStatus,
};

#[test]
fn initial_transcript_invites_a_non_expert_first_chat() {
    let transcript = initial_transcript();
    let non_empty_lines = transcript
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();

    assert!(transcript.contains("ChatPCB KiCad Preview"));
    assert!(transcript.contains("바로 채팅: 만들 보드를 Chat prompt에 적고 Enter."));
    assert!(transcript.contains("Provider Login"));
    assert!(transcript.contains("built-in-preview"));
    assert!(transcript.contains("선택 사항"));
    assert!(transcript.contains("prototype-review"));
    assert!(transcript.contains("JLCPCB"));
    assert!(transcript.contains("order-ready 파일은 아닙니다"));
    assert!(
        non_empty_lines <= 3,
        "first-run chat should stay concise, got {non_empty_lines} lines: {transcript}"
    );
    assert!(!transcript.contains("Welcome to ChatPCB KiCad Preview"));
    assert!(!transcript.contains("Provider Login is optional"));
    assert!(!transcript.contains("creates prototype-review evidence"));
    assert!(!transcript.contains("works before"));
    assert!(!transcript.contains("Saved evidence"));
    assert!(!transcript.contains("Click Open PCB"));
    assert!(!transcript.contains("Click Use example"));
    assert!(!transcript.contains("KiCad 10 when installed"));
    assert!(!transcript.contains("no provider is ready"));
}

#[test]
fn initial_pipeline_status_gives_a_korean_first_action_without_extra_text() {
    let status = initial_pipeline_status();

    assert_eq!(status, "준비: 만들 보드 입력 후 Enter. 빈칸=ESP32-S3 예시.");
    assert!(status.contains("Enter"));
    assert!(status.contains("ESP32-S3"));
    assert!(!status.contains("Click"));
    assert!(!status.contains("Provider Login"));
}

#[test]
fn example_board_prompt_is_korean_first_but_keeps_manufacturing_terms() {
    let prompt = example_board_prompt();

    assert!(prompt.contains("온습도 센서 보드"));
    assert!(prompt.contains("ESP32-S3"));
    assert!(prompt.contains("USB-C"));
    assert!(prompt.contains("I2C"));
    assert!(prompt.contains("JLCPCB"));
    assert!(prompt.len() <= 90);
    assert!(!prompt.contains("sensor board with I2C sensor"));
}

#[test]
fn send_design_transcript_uses_the_user_prompt() {
    let transcript =
        send_design_transcript("Battery powered ESP32-S3 board with OLED and JLCPCB assembly");

    assert!(
        transcript.contains("User: Battery powered ESP32-S3 board with OLED and JLCPCB assembly")
    );
    assert!(transcript.contains("Assistant: 결과 요약"));
    assert!(transcript.contains("ESP32-S3 기본 보드 사양"));
    assert!(transcript.contains("JLCPCB 검토용 package contract"));
    assert!(transcript.contains("Freerouting autoroute"));
    assert!(transcript.contains("실제 KiCad fork 통합"));
    assert!(transcript.contains("다음 행동"));
    assert!(transcript.contains("상태: preview only, 아직 order-ready 아님."));
    assert!(transcript.contains("order-ready"));
    assert!(!transcript.contains("Assistant: What happened"));
    assert!(!transcript.contains("Full KiCad fork integration"));
    assert!(!transcript.contains("Status: preview only, not order-ready yet."));
}

#[test]
fn send_design_transcript_separates_provider_selection_from_preview_engine() {
    let transcript = send_design_transcript("ESP32-S3 board after selecting claude:auto");

    assert!(transcript.contains("미리보기 엔진: built-in local generator"));
    assert!(transcript.contains("provider/model 선택은 준비 상태 확인용"));
    assert!(transcript.contains("이 미리보기에서는 provider CLI를 호출하지 않습니다"));
    assert!(!transcript.contains("Preview engine:"));
    assert!(!transcript.contains("provider/model selection is readiness only"));
    assert!(!transcript.contains("No provider CLI is invoked"));
}

#[test]
fn send_design_transcript_explains_empty_prompt_builtin_example() {
    let transcript = send_design_transcript("  ");

    assert!(transcript.contains(&format!("User: {}", example_board_prompt())));
    assert!(transcript.contains("입력 안내: prompt가 비어 있어 내장 ESP32-S3 예시를 사용했습니다."));
    assert!(transcript.contains("다음에는 prompt를 고친 뒤 Enter"));
    assert!(!transcript.contains("No prompt was typed"));
    assert!(!transcript.contains("User:   "));
}

#[test]
fn empty_prompt_pipeline_status_keeps_builtin_example_visible_after_validation() {
    let status = visible_empty_prompt_pipeline_status(
        "검증 완료: PCB 열기/검토 목록 또는 후속 입력. 아직 prototype-review.",
    );

    assert!(status.starts_with("내장 예시 사용."));
    assert!(status.contains("검증 완료"));
    assert!(status.contains("PCB 열기/검토 목록"));
    assert!(status.contains("아직 prototype-review"));
    assert!(status.len() <= 100);
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
    assert!(transcript.contains("로컬 CLI provider 상태"));
    assert!(transcript.contains("Codex: 사용 가능"));
    assert!(transcript.contains("Claude Code: 찾을 수 없음"));
    assert!(transcript.contains("Claude Code를 설치하고 로컬 로그인을 완료"));
    assert!(transcript.contains("사용 가능한 provider를 모델 선택에서 고르세요"));
    assert!(transcript.contains("provider CLI는 호출하지 않습니다"));
    assert!(transcript.contains("Provider 인증 정보는 ChatPCB3에 저장하지 않습니다."));
    assert!(!transcript.contains("Codex: available"));
    assert!(!transcript.contains("Claude Code: not found"));
    assert!(!transcript.contains("Install Claude Code"));
    assert!(!transcript.contains("complete local login before invoking this provider"));
    assert!(!transcript.contains("Local CLI provider status"));
    assert!(!transcript.contains("Pick an available provider"));
    assert!(!transcript.contains("No provider CLI is invoked"));
    assert!(!transcript.contains("Provider credentials are not stored"));
    assert!(!transcript.contains("Provider credentials는"));
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

    assert!(transcript.contains("아직 준비된 로컬 provider가 없습니다"));
    assert!(transcript.contains("그래도 설계 생성으로 ESP32-S3 preview를 만들 수 있습니다"));
    assert!(transcript.contains("built-in-preview로 계속 진행"));
    assert!(transcript.contains("CLI login은 나중에"));
    assert!(transcript.contains("Codex CLI를 설치하고 로컬 로그인을 완료"));
    assert!(transcript.contains("Claude Code를 설치하고 로컬 로그인을 완료"));
    assert!(transcript.contains("Gemini CLI를 설치하고 로컬 로그인을 완료"));
    assert!(transcript.contains("Provider Login을 다시 누르세요"));
    assert!(!transcript.contains("Selected model:"));
    assert!(!transcript.contains("Install Codex CLI"));
    assert!(!transcript.contains("Install Claude Code"));
    assert!(!transcript.contains("Install Gemini CLI"));
    assert!(!transcript.contains("complete local login before invoking this provider"));
    assert!(!transcript.contains("Pick an available provider"));
    assert!(!transcript.contains("No local provider is ready yet"));
    assert!(!transcript.contains("You can still press Send design"));
    assert!(!transcript.contains("Use built-in-preview now"));
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
    assert!(transcript.contains("선택된 모델: claude:auto"));
    assert!(transcript.contains("준비 상태 확인용"));
    assert!(transcript.contains("built-in local generator"));
    assert!(!transcript.contains("Selected model:"));
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
    assert!(combined.contains("Claude Code: 사용 가능"));
    assert!(combined.contains("User: ESP32-S3 board with USB-C and IMU"));
    assert!(combined.contains("Assistant: 결과 요약"));
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
        "준비: 만들 보드 입력 후 Enter. 빈칸=ESP32-S3 예시."
    );
    assert_eq!(
        example_loaded_pipeline_status(),
        "예시 입력됨: 고치고 Enter 또는 설계 생성."
    );
    assert_eq!(
        provider_login_pipeline_status(Some("claude:auto")),
        "Provider 감지: claude:auto; preview 생성은 아직 로컬입니다."
    );
    assert_eq!(
        provider_login_pipeline_status(None),
        "로컬 provider 없음; built-in-preview는 계속 사용 가능합니다."
    );
    assert_eq!(
        design_pipeline_status(),
        "미리보기 계획: schematic -> layout -> DRC -> JLCPCB."
    );
}

#[test]
fn validation_pipeline_status_keeps_next_actions_visible_for_non_experts() {
    let status = validation_pipeline_status(
        "ERC: 0 errors, 0 warnings. DRC: 0 errors, 0 warnings, 0 unconnected. Gate remains prototype-review until schematic, layout, DRC, Gerber, BOM, and CPL evidence are reviewed.",
    );

    assert_eq!(
        status,
        "검증 완료: PCB 열기/검토 목록 또는 후속 입력. 아직 prototype-review."
    );
    assert!(status.contains("PCB 열기"));
    assert!(status.contains("검토 목록"));
    assert!(status.contains("후속 입력"));
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

    assert_eq!(
        kicad_status,
        "KiCad PCB Editor에서 preview PCB를 열었습니다."
    );
    assert!(fallback_status.contains("preview PCB 파일을 열었습니다."));
    assert!(fallback_status.contains("KiCad 10"));
    assert!(fallback_status.contains("PCB Editor가 열리지 않았다면"));
    assert_ne!(kicad_status, fallback_status);
}

#[test]
fn open_evidence_pipeline_status_names_the_beginner_next_steps_file() {
    let status = open_evidence_pipeline_status();

    assert_eq!(status, "검토 목록: BEGINNER-NEXT-STEPS.txt를 열었습니다.");
    assert!(status.contains("BEGINNER-NEXT-STEPS.txt"));
    assert!(status.contains("검토 목록"));
    assert!(status.len() <= 70);
}

#[test]
fn recovered_preview_pipeline_status_keeps_relaunch_next_action_visible() {
    let status = recovered_preview_pipeline_status();

    assert_eq!(
        status,
        "이전 미리보기: 이어서 입력 후 Enter. PCB 열기/검토 목록."
    );
    assert!(status.contains("이어서 입력 후 Enter"));
    assert!(status.contains("PCB 열기"));
    assert!(status.contains("검토 목록"));
    assert!(status.len() <= 80);
    assert!(!status.contains("C:\\"));
    assert!(!status.contains("AppData"));
}

#[test]
fn preview_workspace_transcript_points_to_saved_local_evidence() {
    let transcript = preview_workspace_saved_transcript(
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\release-evidence-preview.md",
    );

    assert!(transcript.contains("미리보기 저장 완료"));
    assert!(transcript.contains("chatpcb3-esp32s3-preview"));
    assert!(transcript.contains("release-evidence-preview.md"));
    assert!(transcript.contains("KiCad preview scaffold"));
    assert!(transcript.contains("50mm x 50mm Edge.Cuts"));
    assert!(transcript.contains("PCB 열기"));
    assert!(transcript.contains("검토 목록"));
    assert!(transcript.contains("KiCad 10"));
    assert!(transcript.contains("chatpcb3-esp32s3.kicad_pro"));
    assert!(transcript.contains("chatpcb3-esp32s3.kicad_sch"));
    assert!(transcript.contains("chatpcb3-esp32s3.kicad_pcb"));
    assert!(transcript.contains("BEGINNER-NEXT-STEPS.txt"));
    assert!(transcript.contains("후속 입력"));
    assert!(transcript.contains("prototype-review"));
    assert!(transcript.contains("order-ready 아님"));
    assert!(!transcript.contains("Preview workspace saved"));
    assert!(!transcript.contains("Ask a follow-up"));
}

#[test]
fn preview_workspace_failure_transcript_is_korean_first() {
    let transcript = preview_workspace_failed_transcript("disk full");

    assert!(transcript.contains("미리보기 저장 실패"));
    assert!(transcript.contains("- 이유: disk full"));
    assert!(transcript.contains("상태: preview only로 유지합니다."));
    assert!(!transcript.contains("Preview workspace was not saved"));
    assert!(!transcript.contains("Reason:"));
    assert!(!transcript.contains("Status: keep this design at preview only."));
}

#[test]
fn left_workspace_status_moves_from_placeholder_to_saved_preview() {
    assert!(initial_left_workspace_status().contains("Schematic"));
    assert!(initial_left_workspace_status().contains("만들 보드"));
    assert!(initial_left_workspace_status().contains("chatpcb3-esp32s3.kicad_sch"));
    assert!(!initial_left_workspace_status().contains("Native KiCad editor embedding"));

    let status = preview_workspace_left_status(
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview",
    );

    assert!(status.contains("미리보기 저장 완료"));
    assert!(status.contains("ChatPCB3\\Projects"));
    assert!(status.contains("prototype-review"));
    assert!(status.contains("order-ready 아님"));
    assert!(!status.contains("Preview workspace saved"));
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
    assert!(validation.contains("아직 실행 전"));

    let manufacturing = left_tab_status(3);
    assert!(manufacturing.contains("Manufacturing Preview"));
    assert!(manufacturing.contains("Gerber/BOM/CPL"));
    assert!(manufacturing.contains("아직 생성 전"));

    assert_eq!(left_tab_status(99), initial_left_workspace_status());
}

#[test]
fn left_tab_body_gives_non_experts_a_visible_design_preview() {
    let schematic = left_tab_body(0);
    let schematic_lines = schematic
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();
    assert!(schematic.contains("Schematic"));
    assert!(schematic.contains("ESP32-S3"));
    assert!(schematic.contains("USB-C"));
    assert!(schematic.contains("I2C_SCL"));
    assert!(schematic.contains("오른쪽 Chat prompt"));
    assert!(schematic.contains("order-ready 아님"));
    assert!(schematic_lines <= 5);
    assert!(!schematic.contains("Native KiCad schematic embedding"));

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
    assert!(manufacturing.contains("Gerber/Drill 파일은 아직 생성 전"));
    assert!(manufacturing.contains("BOM/CPL preview 파일은 설계 생성 후 확인용으로 생성"));
    assert!(manufacturing.contains("업로드 가능 상태가 아님"));
    assert!(!manufacturing.contains("Gerber, Drill, BOM, and CPL files are not generated yet"));

    assert_eq!(left_tab_body(99), left_tab_body(0));
}

#[test]
fn saved_preview_tabs_keep_workspace_context_after_send_design() {
    let project_dir =
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview";

    let schematic_status = saved_preview_tab_status(0, project_dir);
    assert!(schematic_status.contains("Schematic"));
    assert!(schematic_status.contains("저장된 미리보기"));
    assert!(schematic_status.contains(project_dir));

    let schematic = saved_preview_tab_body(0, project_dir);
    assert!(schematic.contains("미리보기 저장 완료"));
    assert!(schematic.contains("chatpcb3-esp32s3.kicad_sch"));
    assert!(schematic.contains(project_dir));

    let pcb = saved_preview_tab_body(1, project_dir);
    assert!(pcb.contains("PCB Layout"));
    assert!(pcb.contains("chatpcb3-esp32s3.kicad_pcb"));
    assert!(pcb.contains("50mm x 50mm Edge.Cuts"));
    assert!(pcb.contains("PCB 열기"));
    assert!(pcb.contains("배치와 배선은 아직 preview 단계"));

    let validation = saved_preview_tab_body(2, project_dir);
    assert!(validation.contains("KiCad ERC/DRC reports"));
    assert!(validation.contains("kicad-pcb-check.txt"));
    assert!(validation.contains("erc-report.json"));
    assert!(validation.contains("drc-report.json"));
    assert!(validation.contains("kicad-validation-summary.txt"));
    assert!(validation.contains("prototype-review"));

    let manufacturing = saved_preview_tab_body(3, project_dir);
    assert!(manufacturing.contains("Manufacturing Preview"));
    assert!(manufacturing.contains("JLCPCB 업로드는 아직 막힌 상태"));
    assert!(manufacturing.contains("Gerber"));
    assert!(manufacturing.contains("jlcpcb-bom-preview.csv"));
    assert!(manufacturing.contains("jlcpcb-cpl-preview.csv"));
    assert!(manufacturing.contains("manufacturing-readiness-preview.txt"));
    assert!(manufacturing.contains("prototype-review"));
    assert!(manufacturing.contains("order-ready 아님"));

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

    assert!(body.contains("미리보기 저장 완료"));
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
    assert!(body.contains("PCB 열기"));
    assert!(body.contains("KiCad 10"));
    assert!(body.contains("검토 목록"));
    assert!(body.contains("후속 입력"));
    assert!(body.contains("prototype-review"));
    assert!(body.contains("order-ready 아님"));
    assert!(!body.contains("Click Review checklist"));
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
    assert!(body.contains("order-ready 아님"));
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
    assert!(body.contains("order-ready 아님"));
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
fn preview_result_summary_transcript_gives_korean_next_action_for_latest_chat_view() {
    let transcript = preview_result_summary_transcript();

    assert!(transcript.contains("결과: 미리보기 저장 완료"));
    assert!(transcript.contains("PCB 열기"));
    assert!(transcript.contains("검토 목록"));
    assert!(transcript.contains("JLCPCB 주문 금지"));
    assert!(transcript.contains("prototype-review"));
    assert!(
        transcript
            .lines()
            .filter(|line| !line.trim().is_empty())
            .count()
            <= 3
    );
}

#[test]
fn recovered_preview_workspace_text_orients_relaunch_users() {
    let project_dir =
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview";
    let status = recovered_preview_workspace_left_status(project_dir);
    let body = recovered_preview_workspace_body(project_dir);

    assert!(status.contains("이전 미리보기 발견"));
    assert!(status.contains("chatpcb3-esp32s3-preview"));
    assert!(status.contains("prototype-review"));
    assert!(status.contains("order-ready 아님"));
    assert!(body.contains("이전 미리보기 발견"));
    assert!(body.contains("검토 목록으로 저장 파일을 확인"));
    assert!(body.contains("PCB 열기"));
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
    assert!(body.contains("order-ready 아님"));
    assert!(!body.contains("Previous preview workspace found"));
    assert!(!body.contains("Click Review checklist"));
}

#[test]
fn recovered_preview_workspace_chat_turn_orients_relaunch_users() {
    let project_dir =
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview";
    let transcript = recovered_preview_workspace_transcript(project_dir);

    assert!(transcript.contains("이전 미리보기 발견"));
    assert!(transcript.contains("검토 목록"));
    assert!(transcript.contains("PCB 열기"));
    assert!(transcript.contains("chatpcb3-esp32s3-preview"));
    assert!(transcript.contains("prototype-review"));
    assert!(transcript.contains("order-ready 아님"));
    assert!(!transcript.contains("Previous preview workspace found"));
    assert!(!transcript
        .to_ascii_lowercase()
        .contains("order-ready evidence"));
}
