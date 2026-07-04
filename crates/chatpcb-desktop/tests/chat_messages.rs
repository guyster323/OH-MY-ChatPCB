use chatpcb_desktop::ui_model::{
    append_chat_transcript, design_pipeline_status, erc_drc_validation_transcript,
    example_board_prompt, example_loaded_pipeline_status, initial_left_workspace_status,
    initial_pipeline_status, initial_transcript, kicad_cli_check_transcript, left_tab_body,
    left_tab_status, live_schematic_body, model_selector_display_items, model_selector_items,
    open_evidence_pipeline_status, open_pcb_pipeline_status, preview_result_summary_transcript,
    preview_workspace_body, preview_workspace_body_with_kicad_check,
    preview_workspace_body_with_validation_reports, preview_workspace_failed_transcript,
    preview_workspace_left_status, preview_workspace_saved_transcript,
    provider_login_pipeline_status, provider_login_transcript, recovered_preview_pipeline_status,
    recovered_preview_workspace_body, recovered_preview_workspace_left_status,
    recovered_preview_workspace_transcript, saved_part_selection_review_canvas_lines,
    saved_preview_summary, saved_preview_tab_body, saved_preview_tab_status,
    saved_schematic_render_model, selected_model_for_statuses, selected_provider_model,
    send_design_transcript, validation_pipeline_status, visible_empty_prompt_pipeline_status,
    ProviderUiStatus,
};
use std::fs;

#[test]
fn initial_transcript_invites_a_non_expert_first_chat() {
    let transcript = initial_transcript();
    let non_empty_lines = transcript
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();

    assert!(transcript.contains("ChatPCB KiCad Preview"));
    assert!(transcript.contains("바로 채팅: 만들 보드를 채팅 입력칸에 적고 Enter."));
    assert!(transcript.contains("Provider Login"));
    assert!(transcript.contains("내장 미리보기"));
    assert!(transcript.contains("선택 사항"));
    assert!(transcript.contains("prototype-review"));
    assert!(transcript.contains("JLCPCB"));
    assert!(transcript.contains("주문 준비 파일은 아닙니다"));
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
    assert!(!transcript.contains("built-in-preview"));
    assert!(!transcript.contains("order-ready"));
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
    assert!(transcript.contains("JLCPCB 검토 자료"));
    assert!(transcript.contains("PCB 배치/배선"));
    assert!(transcript.contains("design-quality-report"));
    assert!(transcript.contains("90점 게이트"));
    assert!(transcript.contains("제조 증거를 사람이 확인"));
    assert!(transcript.contains("다음 행동"));
    assert!(transcript.contains("상태: 미리보기 단계, 아직 주문 준비 전입니다."));
    assert!(!transcript.contains("preview only"));
    assert!(!transcript.contains("order-ready"));
    assert!(!transcript.contains("Assistant: What happened"));
    assert!(!transcript.contains("Full KiCad fork integration"));
    assert!(!transcript.contains("Status: preview only, not order-ready yet."));
}

#[test]
fn send_design_transcript_separates_provider_selection_from_preview_engine() {
    let transcript = send_design_transcript("ESP32-S3 board after selecting claude:auto");

    assert!(transcript.contains("미리보기 생성: 앱 안의 기본 생성기를 사용했습니다"));
    assert!(transcript.contains("Provider 선택은 로그인 상태와 모델 확인용"));
    assert!(transcript.contains("로컬 도구를 대신 실행하지 않습니다"));
    assert!(!transcript.contains("built-in local generator"));
    assert!(!transcript.contains("Preview engine:"));
    assert!(!transcript.contains("provider/model"));
    assert!(!transcript.contains("provider CLI"));
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
    let status =
        visible_empty_prompt_pipeline_status("검증 완료: 90점 gate 통과. 검토 목록/후속 입력.");

    assert!(status.starts_with("내장 예시 사용."));
    assert!(status.contains("검증 완료"));
    assert!(status.contains("90점 gate 통과"));
    assert!(status.contains("검토 목록"));
    assert!(status.len() <= 100);
}

#[test]
fn provider_login_transcript_reports_local_cli_status_without_secrets() {
    let transcript = provider_login_transcript(&[
        ProviderUiStatus {
            display_name: "Codex".to_string(),
            available: true,
            logged_in: true,
            version: Some("codex 0.41.0".to_string()),
            login_hint: "Install Codex CLI and complete local login before invoking this provider."
                .to_string(),
            models: vec![chatpcb_desktop::ui_model::ProviderUiModel {
                id: "codex:gpt-5".to_string(),
                display_name: "Codex 0.41.0 · gpt-5".to_string(),
                cli_model: "gpt-5".to_string(),
            }],
        },
        ProviderUiStatus {
            display_name: "Claude Code".to_string(),
            available: false,
            logged_in: false,
            version: None,
            login_hint:
                "Install Claude Code and complete local login before invoking this provider."
                    .to_string(),
            models: vec![],
        },
    ]);

    assert!(transcript.contains("Provider Login"));
    assert!(transcript.contains("로컬 도구 로그인 상태"));
    assert!(transcript.contains("Codex: 사용 가능 / 로그인됨"));
    assert!(transcript.contains("사용 가능 모델: Codex 0.41.0 · gpt-5"));
    assert!(transcript.contains("Claude Code: 찾을 수 없음"));
    assert!(transcript.contains("Claude Code를 설치하고 로컬 로그인을 완료"));
    assert!(transcript.contains("로그인되어 있으면 바로 사용할 수 있습니다"));
    assert!(transcript.contains("모델 선택에서 provider와 모델을 고른 뒤"));
    assert!(transcript.contains("Provider 인증 정보는 ChatPCB3에 저장하지 않습니다."));
    assert!(!transcript.contains("로컬 CLI provider 상태"));
    assert!(!transcript.contains("provider CLI는 호출하지 않습니다"));
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
            logged_in: false,
            version: None,
            login_hint: "Install Codex CLI and complete local login before invoking this provider."
                .to_string(),
            models: vec![],
        },
        ProviderUiStatus {
            display_name: "Claude Code".to_string(),
            available: false,
            logged_in: false,
            version: None,
            login_hint:
                "Install Claude Code and complete local login before invoking this provider."
                    .to_string(),
            models: vec![],
        },
        ProviderUiStatus {
            display_name: "Antigravity CLI".to_string(),
            available: false,
            logged_in: false,
            version: None,
            login_hint:
                "Install Antigravity CLI and complete local login before invoking this provider."
                    .to_string(),
            models: vec![],
        },
    ]);

    assert!(transcript.contains("아직 준비된 로컬 도구가 없습니다"));
    assert!(transcript.contains("그래도 설계 생성으로 ESP32-S3 미리보기를 만들 수 있습니다"));
    assert!(transcript.contains("내장 미리보기로 계속 진행"));
    assert!(transcript.contains("로컬 도구 로그인은 나중에"));
    assert!(transcript.contains("Codex CLI를 설치하고 로컬 로그인을 완료"));
    assert!(transcript.contains("Claude Code를 설치하고 로컬 로그인을 완료"));
    assert!(transcript.contains("Antigravity CLI를 설치하고 로컬 로그인을 완료"));
    assert!(transcript.contains("Provider Login을 다시 누르세요"));
    assert!(!transcript.contains("아직 준비된 로컬 provider가 없습니다"));
    assert!(!transcript.contains("이 provider를 사용하세요"));
    assert!(!transcript.contains("Selected model:"));
    assert!(!transcript.contains("Install Codex CLI"));
    assert!(!transcript.contains("Install Claude Code"));
    assert!(!transcript.contains("Install Antigravity CLI"));
    assert!(!transcript.contains("Gemini CLI"));
    assert!(!transcript.contains("complete local login before invoking this provider"));
    assert!(!transcript.contains("Pick an available provider"));
    assert!(!transcript.contains("No local provider is ready yet"));
    assert!(!transcript.contains("You can still press Send design"));
    assert!(!transcript.contains("Use built-in-preview now"));
    assert!(!transcript.contains("built-in-preview"));
    assert!(!transcript.contains("CLI login은 나중에"));
    assert!(!transcript.contains("local CLI login"));
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
            logged_in: false,
            version: None,
            login_hint: "Install Codex CLI and complete local login before invoking this provider."
                .to_string(),
            models: vec![],
        },
        ProviderUiStatus {
            display_name: "Claude Code".to_string(),
            available: true,
            logged_in: true,
            version: Some("2.1.183".to_string()),
            login_hint:
                "Install Claude Code and complete local login before invoking this provider."
                    .to_string(),
            models: vec![
                chatpcb_desktop::ui_model::ProviderUiModel {
                    id: "claude:sonnet".to_string(),
                    display_name: "Claude 2.1.183 sonnet".to_string(),
                    cli_model: "sonnet".to_string(),
                },
                chatpcb_desktop::ui_model::ProviderUiModel {
                    id: "claude:opus".to_string(),
                    display_name: "Claude 2.1.183 opus".to_string(),
                    cli_model: "opus".to_string(),
                },
            ],
        },
        ProviderUiStatus {
            display_name: "Antigravity CLI".to_string(),
            available: true,
            logged_in: true,
            version: Some("Antigravity CLI 1.0.12".to_string()),
            login_hint:
                "Install Antigravity CLI and complete local login before invoking this provider."
                    .to_string(),
            models: vec![chatpcb_desktop::ui_model::ProviderUiModel {
                id: "antigravity:auto".to_string(),
                display_name: "Antigravity 1.0.12 auto".to_string(),
                cli_model: "auto".to_string(),
            }],
        },
    ];

    assert_eq!(selected_provider_model(&statuses), Some("claude:sonnet"));

    let transcript = provider_login_transcript(&statuses);
    assert!(transcript.contains("선택된 모델: Claude 2.1.183 sonnet"));
    assert!(transcript.contains("사용 가능 모델: Claude 2.1.183 sonnet, Claude 2.1.183 opus"));
    assert!(!transcript.contains("선택된 모델: claude:sonnet"));
    assert!(transcript.contains("로그인되어 있으면 바로 사용할 수 있습니다"));
    assert!(!transcript.contains("built-in local generator"));
    assert!(!transcript.contains("Provider/model"));
    assert!(!transcript.contains("provider CLI"));
    assert!(!transcript.contains("Selected model:"));
}

#[test]
fn model_selector_uses_builtin_preview_when_no_provider_is_ready() {
    let statuses = [
        ProviderUiStatus {
            display_name: "Codex".to_string(),
            available: false,
            logged_in: false,
            version: None,
            login_hint: "Install Codex CLI and complete local login before invoking this provider."
                .to_string(),
            models: vec![],
        },
        ProviderUiStatus {
            display_name: "Claude Code".to_string(),
            available: false,
            logged_in: false,
            version: None,
            login_hint:
                "Install Claude Code and complete local login before invoking this provider."
                    .to_string(),
            models: vec![],
        },
    ];

    let items = model_selector_items();
    let display_items = model_selector_display_items();

    assert_eq!(items[0], "built-in-preview");
    assert!(items.contains(&"codex:auto"));
    assert_eq!(display_items[0], "내장 미리보기");
    assert!(display_items.contains(&"Codex 자동"));
    assert!(display_items.contains(&"Claude Code 자동"));
    assert!(display_items.contains(&"Antigravity 자동"));
    assert!(!display_items.contains(&"Gemini 자동"));
    assert!(!display_items.contains(&"built-in-preview"));
    assert!(!display_items.contains(&"claude:auto"));
    assert_eq!(selected_provider_model(&statuses), None);
    assert_eq!(selected_model_for_statuses(&statuses), "built-in-preview");
}

#[test]
fn model_selector_reflects_logged_in_provider_versions_and_models() {
    let statuses = [
        ProviderUiStatus {
            display_name: "Codex".to_string(),
            available: true,
            logged_in: true,
            version: Some("codex-cli 0.142.3".to_string()),
            login_hint: "Install Codex CLI and complete local login before invoking this provider."
                .to_string(),
            models: vec![
                chatpcb_desktop::ui_model::ProviderUiModel {
                    id: "codex:gpt-5".to_string(),
                    display_name: "Codex 0.142.3 gpt-5".to_string(),
                    cli_model: "gpt-5".to_string(),
                },
                chatpcb_desktop::ui_model::ProviderUiModel {
                    id: "codex:gpt-5-codex".to_string(),
                    display_name: "Codex 0.142.3 gpt-5-codex".to_string(),
                    cli_model: "gpt-5-codex".to_string(),
                },
            ],
        },
        ProviderUiStatus {
            display_name: "Antigravity CLI".to_string(),
            available: true,
            logged_in: true,
            version: Some("Antigravity installed (Windows app)".to_string()),
            login_hint:
                "Install Antigravity CLI and complete local login before invoking this provider."
                    .to_string(),
            models: vec![chatpcb_desktop::ui_model::ProviderUiModel {
                id: "antigravity:auto".to_string(),
                display_name: "Antigravity Windows app auto".to_string(),
                cli_model: "auto".to_string(),
            }],
        },
    ];

    assert_eq!(
        chatpcb_desktop::ui_model::model_selector_items_for_statuses(&statuses),
        vec![
            "built-in-preview",
            "codex:gpt-5",
            "codex:gpt-5-codex",
            "antigravity:auto"
        ]
    );
    assert_eq!(
        chatpcb_desktop::ui_model::model_selector_display_items_for_statuses(&statuses),
        vec![
            "내장 미리보기",
            "Codex 0.142.3 gpt-5",
            "Codex 0.142.3 gpt-5-codex",
            "Antigravity Windows app auto"
        ]
    );
    assert_eq!(selected_provider_model(&statuses), Some("codex:gpt-5"));
    assert_eq!(
        provider_login_pipeline_status(Some("codex:gpt-5"), &statuses),
        "Provider 감지: Codex 0.142.3 gpt-5; 로그인됨, 바로 사용 가능."
    );
}

#[test]
fn chat_transcript_appends_new_turns_without_erasing_context() {
    let existing = provider_login_transcript(&[ProviderUiStatus {
        display_name: "Claude Code".to_string(),
        available: true,
        logged_in: true,
        version: Some("2.1.183".to_string()),
        login_hint: "Install Claude Code and complete local login before invoking this provider."
            .to_string(),
        models: vec![],
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
        provider_login_pipeline_status(Some("claude:sonnet"), &[]),
        "Provider 감지: claude:sonnet; 로그인됨, 바로 사용 가능."
    );
    assert_eq!(
        provider_login_pipeline_status(None, &[]),
        "로컬 도구 없음; 내장 미리보기는 계속 사용 가능합니다."
    );
    assert_eq!(
        design_pipeline_status(),
        "미리보기 계획: 회로도 -> PCB -> 검증 -> JLCPCB 검토."
    );
}

#[test]
fn validation_pipeline_status_keeps_next_actions_visible_for_non_experts() {
    let status = validation_pipeline_status(
        "ERC: 오류 0개, 경고 0개. DRC: 오류 0개, 경고 0개, 미연결 0개. 90점 품질 게이트 통과: Level은 ReleaseCandidate입니다. 검토 목록에서 회로, PCB, 제조 파일을 확인하세요. JLCPCB 주문 전에는 사람 제조 검토가 필요합니다.",
    );

    assert_eq!(status, "검증 완료: 90점 gate 통과. 검토 목록/후속 입력.");
    assert!(status.contains("90점 gate"));
    assert!(status.contains("검토 목록"));
    assert!(status.contains("후속 입력"));
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
        "KiCad PCB Editor에서 미리보기 PCB를 열었습니다."
    );
    assert!(fallback_status.contains("미리보기 PCB 파일을 열었습니다."));
    assert!(fallback_status.contains("KiCad 10"));
    assert!(fallback_status.contains("PCB Editor가 열리지 않았다면"));
    assert_ne!(kicad_status, fallback_status);
}

#[test]
fn open_evidence_pipeline_status_names_the_beginner_next_steps_file() {
    let status = open_evidence_pipeline_status();

    assert_eq!(status, "검토 목록을 열었습니다.");
    assert!(status.contains("검토 목록"));
    assert!(!status.contains("BEGINNER-NEXT-STEPS.txt"));
    assert!(status.len() <= 40);
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
    let visible_lines = transcript
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();

    assert!(transcript.contains("미리보기 저장 완료"));
    assert!(transcript.contains("검토 목록"));
    assert!(transcript.contains("50mm x 50mm 보드"));
    assert!(transcript.contains("풋프린트, 패드, 주요 배선"));
    assert!(transcript.contains("design-quality-report.md"));
    assert!(transcript.contains("90점 게이트"));
    assert!(transcript.contains("PCB 열기"));
    assert!(transcript.contains("KiCad 10"));
    assert!(transcript.contains("후속 입력"));
    assert!(transcript.contains("prototype-review"));
    assert!(transcript.contains("주문 준비 전"));
    assert!(!transcript.contains("order-ready"));
    assert!(!transcript.contains("PCB preview"));
    assert!(visible_lines <= 7);
    assert!(!transcript.contains("C:\\Users"));
    assert!(!transcript.contains("chatpcb3-esp32s3-preview"));
    assert!(!transcript.contains("release-evidence-preview.md"));
    assert!(!transcript.contains("KiCad preview scaffold"));
    assert!(!transcript.contains("chatpcb3-esp32s3.kicad_pro"));
    assert!(!transcript.contains("chatpcb3-esp32s3.kicad_sch"));
    assert!(!transcript.contains("chatpcb3-esp32s3.kicad_pcb"));
    assert!(!transcript.contains("BEGINNER-NEXT-STEPS.txt"));
    assert!(!transcript.contains("Preview workspace saved"));
    assert!(!transcript.contains("Ask a follow-up"));
}

#[test]
fn preview_workspace_failure_transcript_is_korean_first() {
    let transcript = preview_workspace_failed_transcript("disk full");

    assert!(transcript.contains("미리보기 저장 실패"));
    assert!(transcript.contains("- 이유: disk full"));
    assert!(transcript.contains("상태: 미리보기 단계로 유지합니다."));
    assert!(!transcript.contains("preview only"));
    assert!(!transcript.contains("Preview workspace was not saved"));
    assert!(!transcript.contains("Reason:"));
    assert!(!transcript.contains("Status: keep this design at preview only."));
}

#[test]
fn left_workspace_status_moves_from_placeholder_to_saved_preview() {
    assert!(initial_left_workspace_status().contains("회로도"));
    assert!(initial_left_workspace_status().contains("만들 보드"));
    assert!(initial_left_workspace_status().contains("미리보기"));
    assert!(!initial_left_workspace_status().contains("chatpcb3-esp32s3.kicad_sch"));
    assert!(!initial_left_workspace_status().contains("Native KiCad editor embedding"));

    let status = preview_workspace_left_status(
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview",
    );

    assert!(status.contains("미리보기 저장 완료"));
    assert!(status.contains("품질 리포트"));
    assert!(status.contains("90점 게이트"));
    assert!(status.contains("prototype-review"));
    assert!(status.contains("주문 준비 전"));
    assert!(!status.contains("order-ready"));
    assert!(!status.contains("C:\\Users"));
    assert!(!status.contains("ChatPCB3\\Projects"));
    assert!(!status.contains("Preview workspace saved"));
}

#[test]
fn left_tab_status_describes_each_current_project_view() {
    let schematic = left_tab_status(0);
    assert!(schematic.contains("회로도"));
    assert!(schematic.contains("미리보기"));
    assert!(!schematic.contains("chatpcb3-esp32s3.kicad_sch"));
    assert!(!schematic.contains("Schematic:"));

    let block = left_tab_status(1);
    assert!(block.contains("블록도"));
    assert!(block.contains("전원"));
    assert!(!block.contains("PCB 레이아웃"));

    let pcb = left_tab_status(2);
    assert!(pcb.contains("PCB 레이아웃"));
    assert!(pcb.contains("보드 외곽선"));
    assert!(!pcb.contains("chatpcb3-esp32s3.kicad_pcb"));
    assert!(!pcb.contains("PCB Layout:"));

    let validation = left_tab_status(3);
    assert!(validation.contains("검증"));
    assert!(validation.contains("ERC/DRC"));
    assert!(validation.contains("아직 실행 전"));
    assert!(!validation.contains("Validation:"));

    let manufacturing = left_tab_status(4);
    assert!(manufacturing.contains("제조 미리보기"));
    assert!(manufacturing.contains("Gerber/BOM/CPL"));
    assert!(manufacturing.contains("아직 생성 전"));
    assert!(manufacturing.contains("주문 준비 전"));
    assert!(!manufacturing.contains("Manufacturing Preview:"));
    assert!(!manufacturing.contains("blocked"));

    assert_eq!(left_tab_status(99), initial_left_workspace_status());
}

#[test]
fn left_tab_body_gives_non_experts_a_visible_design_preview() {
    let schematic = left_tab_body(0);
    let schematic_lines = schematic
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();
    assert!(schematic.contains("KiCad 회로도"));
    assert!(schematic.contains("KICAD_SCHEMATIC_VIEW"));
    assert!(schematic.contains("chatpcb3-esp32s3.kicad_sch"));
    assert!(schematic.contains("ESP32-S3"));
    assert!(schematic.contains("USB-C"));
    assert!(schematic.contains("I2C"));
    assert!(schematic.contains("오른쪽 채팅 입력칸"));
    assert!(schematic.contains("주문 준비 전"));
    assert!(schematic.contains("회로 설계 검토"));
    assert!(schematic.contains("CC1/CC2 5.1k"));
    assert!(schematic.contains("USB ESD"));
    assert!(schematic.contains("I2C 풀업"));
    assert!(schematic_lines <= 18);
    assert!(!schematic.contains("symbol"));
    assert!(!schematic.contains("wire"));
    assert!(!schematic.contains("net label"));
    assert!(!schematic.contains("[USB-C] -- +5V"));
    assert!(!schematic.contains("Native KiCad schematic embedding"));
    assert!(!schematic.contains("Schematic Preview"));
    assert!(!schematic.contains("Gate:"));
    assert!(!schematic.contains("Target:"));
    assert!(!schematic.contains("Expected nets"));
    assert!(!schematic.contains("order-ready"));

    let block = left_tab_body(1);
    assert!(block.contains("블록도"));
    assert!(block.contains("[USB-C] -- +5V"));
    assert!(block.contains("[REG 3V3]"));
    assert!(block.contains("[ESP32-S3]"));
    assert!(block.contains("I2C"));
    assert!(!block.contains("KICAD_SCHEMATIC_VIEW"));

    let pcb = left_tab_body(2);
    assert!(pcb.contains("PCB 레이아웃"));
    assert!(pcb.contains("50mm x 50mm"));
    assert!(pcb.contains("보드 외곽선"));
    assert!(pcb.contains("배치"));
    assert!(pcb.contains("배선"));
    assert!(!pcb.contains("Component placement"));
    assert!(!pcb.contains("Planned flow"));
    assert!(!pcb.contains("Freerouting route data"));
    assert!(!pcb.contains("Gate:"));

    let validation = left_tab_body(3);
    assert!(validation.contains("검증 미리보기"));
    assert!(validation.contains("ERC"));
    assert!(validation.contains("DRC"));
    assert!(!validation.contains("Validation Preview"));
    assert!(!validation.contains("release gate"));
    assert!(!validation.contains("report"));
    assert!(!validation.contains("artifact"));

    let manufacturing = left_tab_body(4);
    assert!(manufacturing.contains("제조 미리보기"));
    assert!(manufacturing.contains("Gerber"));
    assert!(manufacturing.contains("BOM"));
    assert!(manufacturing.contains("CPL"));
    assert!(manufacturing.contains("주문 준비 전"));
    assert!(manufacturing.contains("검토 목록"));
    assert!(!manufacturing.contains("Gerber, Drill, BOM, and CPL files are not generated yet"));
    assert!(!manufacturing.contains("schematic, layout"));
    assert!(!manufacturing.contains("JLCPCB upload"));
    assert!(!manufacturing.contains("blocked"));
    assert!(!manufacturing.contains("Gate:"));

    assert_eq!(left_tab_body(99), left_tab_body(0));
}

#[test]
fn schematic_tab_surfaces_design_review_items_instead_of_mock_process() {
    let schematic = left_tab_body(0);

    for required in [
        "회로 설계 검토",
        "CC1/CC2 5.1k",
        "USB ESD",
        "3V3 LDO",
        "입출력 커패시터",
        "ESP_EN",
        "BOOT",
        "I2C 풀업",
        "센서 디커플링",
    ] {
        assert!(
            schematic.contains(required),
            "schematic tab must expose `{required}` so the result reads like a circuit design"
        );
    }

    assert!(
        !schematic.contains("symbol") && !schematic.contains("wire") && !schematic.contains("net label"),
        "schematic tab must not present the final result as a symbol/wire/net-label process: {schematic}"
    );
}

#[test]
fn live_schematic_body_shows_kicad_schematic_creation_process() {
    let body = live_schematic_body(
        "ESP32-S3와 터치 디스플레이를 가지고 H2 Sensor를 포함하며 USB-C로 전원을 인가받는 회로",
        "미리보기 저장 완료",
    );

    assert!(body.contains("KiCad 회로도"));
    assert!(body.contains("KICAD_SCHEMATIC_VIEW"));
    assert!(body.contains("chatpcb3-esp32s3.kicad_sch"));
    assert!(body.contains("채팅 입력"));
    assert!(body.contains("Agent 답변"));
    assert!(body.contains("적용 결과"));
    assert!(body.contains("ESP32-S3"));
    assert!(body.contains("H2 Sensor"));
    assert!(body.contains("Touch Display"));
    assert!(body.contains("회로 설계 검토"));
    assert!(body.contains("CC1/CC2 5.1k"));
    assert!(body.contains("USB ESD"));
    assert!(body.contains("I2C 풀업"));
    assert!(body.contains("소자 선택"));
    assert!(!body.contains("symbol"));
    assert!(!body.contains("wire"));
    assert!(!body.contains("net label"));
    assert!(body.contains("I2C"));
    assert!(body.contains("미리보기 저장 완료"));
    assert!(body.contains("prototype-review"));
    assert!(!body.contains("[USB-C] -- +5V"));
    assert!(!body.contains("C:\\Users"));
    assert!(!body.contains("order-ready"));
}

#[test]
fn live_schematic_body_shows_real_design_review_after_chat() {
    let body = live_schematic_body(
        "ESP32-S3 USB-C 온습도 센서 보드, I2C 센서, JLCPCB 조립",
        "ERC 오류 0개, DRC 오류 0개",
    );

    assert!(body.contains("회로 설계 검토"));
    assert!(body.contains("CC1/CC2 5.1k"));
    assert!(body.contains("USB ESD"));
    assert!(body.contains("ESP32-S3"));
    assert!(body.contains("I2C 풀업"));
    assert!(body.contains("소자 선택"));
    assert!(body.contains("남은 검토"));
    assert!(!body.contains("symbol"));
    assert!(!body.contains("wire"));
    assert!(!body.contains("net label"));
}

#[test]
fn saved_preview_tabs_keep_workspace_context_after_send_design() {
    let project_root = std::env::temp_dir().join(format!(
        "chatpcb3-desktop-missing-saved-preview-{}",
        std::process::id()
    ));
    if project_root.exists() {
        fs::remove_dir_all(&project_root).unwrap();
    }
    let project_dir = project_root.to_string_lossy();

    let schematic_status = saved_preview_tab_status(0, &project_dir);
    assert!(schematic_status.contains("회로도"));
    assert!(schematic_status.contains("저장된 미리보기"));
    assert!(schematic_status.contains("검토 목록"));
    assert!(!schematic_status.contains(project_dir.as_ref()));
    assert!(!schematic_status.contains("C:\\Users"));

    let schematic = saved_preview_tab_body(0, &project_dir);
    assert!(schematic.contains("KiCad 회로도"));
    assert!(schematic.contains("KICAD_SCHEMATIC_VIEW"));
    assert!(schematic.contains("SAVED_KICAD_EVIDENCE_VIEW"));
    assert!(schematic.contains("저장된 KiCad 산출물 기반"));
    assert!(schematic.contains("schematic-review.svg"));
    assert!(schematic.contains("design-quality-report.md"));
    assert!(schematic.contains("chat-to-circuit-trace.md"));
    assert!(schematic.contains("요구 추적"));
    assert!(schematic.contains("채팅 입력"));
    assert!(schematic.contains("Agent 답변"));
    assert!(schematic.contains("적용 결과"));
    assert!(schematic.contains("회로 설계 검토"));
    assert!(schematic.contains("CC1/CC2 5.1k"));
    assert!(schematic.contains("USB ESD"));
    assert!(schematic.contains("I2C 풀업"));
    assert!(!schematic.contains("symbol"));
    assert!(!schematic.contains("wire"));
    assert!(!schematic.contains("net label"));
    assert!(schematic.contains("chatpcb3-esp32s3.kicad_sch"));
    assert!(schematic.contains("검토 목록"));
    assert!(!schematic.contains(project_dir.as_ref()));
    assert!(!schematic.contains("C:\\Users"));
    assert!(!schematic.contains("Gate:"));
    assert!(!schematic.contains("Expected nets"));
    assert!(!schematic.contains("[USB-C] -- +5V"));
    assert!(!schematic.contains("order-ready"));

    let block = saved_preview_tab_body(1, &project_dir);
    assert!(block.contains("블록도"));
    assert!(block.contains("[USB-C] -- +5V"));

    let pcb = saved_preview_tab_body(2, &project_dir);
    assert!(pcb.contains("PCB 레이아웃"));
    assert!(pcb.contains("50mm x 50mm 보드 외곽선"));
    assert!(pcb.contains("PCB 열기"));
    assert!(pcb.contains("풋프린트와 주요 배선"));
    assert!(pcb.contains("저장된 보드"));
    assert!(pcb.contains("보드 외곽선"));
    assert!(!pcb.contains("chatpcb3-esp32s3.kicad_pcb"));
    assert!(!pcb.contains(project_dir.as_ref()));
    assert!(!pcb.contains("C:\\Users"));
    assert!(!pcb.contains("board outline"));
    assert!(!pcb.contains("preview 단계"));
    assert!(!pcb.contains("Gate:"));

    let validation = saved_preview_tab_body(3, &project_dir);
    assert!(validation.contains("KiCad ERC/DRC 검증"));
    assert!(validation.contains("검토 목록"));
    assert!(validation.contains("회로 적정성"));
    assert!(validation.contains("전원"));
    assert!(validation.contains("USB-C"));
    assert!(validation.contains("I2C"));
    assert!(validation.contains("부트"));
    assert!(validation.contains("prototype-review"));
    assert!(validation.contains("자세한 검토 자료"));
    assert!(validation.contains("Improvement Actions"));
    assert!(validation.contains("order gate"));
    assert!(!validation.contains("kicad-pcb-check.txt"));
    assert!(!validation.contains("erc-report.json"));
    assert!(!validation.contains("drc-report.json"));
    assert!(!validation.contains("kicad-validation-summary.txt"));
    assert!(!validation.contains(project_dir.as_ref()));
    assert!(!validation.contains("C:\\Users"));
    assert!(!validation.contains("board outline"));
    assert!(!validation.contains("Gate:"));

    let manufacturing = saved_preview_tab_body(4, &project_dir);
    assert!(manufacturing.contains("제조 미리보기"));
    assert!(manufacturing.contains("JLCPCB"));
    assert!(manufacturing.contains("주문 준비 전"));
    assert!(manufacturing.contains("Gerber"));
    assert!(manufacturing.contains("소자 선정"));
    assert!(manufacturing.contains("JLCPCB/LCSC"));
    assert!(manufacturing.contains("대체 검토"));
    assert!(manufacturing.contains("회로 적정성"));
    assert!(manufacturing.contains("요구 추적"));
    assert!(manufacturing.contains("design-quality-report.md"));
    assert!(manufacturing.contains("90점 게이트"));
    assert!(manufacturing.contains("검토 목록"));
    assert!(manufacturing.contains("prototype-review"));
    assert!(manufacturing.contains("주문 준비 전"));
    assert!(!manufacturing.contains("order-ready"));
    assert!(!manufacturing.contains("jlcpcb-bom-preview.csv"));
    assert!(!manufacturing.contains("jlcpcb-cpl-preview.csv"));
    assert!(!manufacturing.contains("manufacturing-readiness-preview.txt"));
    assert!(!manufacturing.contains(project_dir.as_ref()));
    assert!(!manufacturing.contains("C:\\Users"));
    assert!(!manufacturing.contains("Release evidence report"));
    assert!(!manufacturing.contains("Gate:"));

    assert_eq!(
        saved_preview_tab_body(99, &project_dir),
        saved_preview_tab_body(0, &project_dir)
    );
}

#[test]
fn saved_preview_tabs_reflect_prompt_variant_and_quality_from_workspace_artifacts() {
    let root = std::env::temp_dir().join(format!(
        "chatpcb3-desktop-saved-summary-{}",
        std::process::id()
    ));
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }
    fs::create_dir_all(root.join("visual-review")).unwrap();

    fs::write(
        root.join("prompt.txt"),
        "ESP32-S3와 터치 디스플레이를 가지고 H2 Sensor를 포함하며 USB-C로 전원을 인가받는 회로",
    )
    .unwrap();
    fs::write(
        root.join("chat-to-circuit-trace.md"),
        "| H2 Sensor | COVERED | U5 MQ-8 analog module, 5V heater, H2_ADC |\r\n| Touch Display | COVERED | DS1 Waveshare 2.8inch TFT Touch Shield, ST7789V/XPT2046 SPI |\r\n",
    )
    .unwrap();
    fs::write(
        root.join("part-selection-review.md"),
        "| U5 | H2 module interface 1x4 2.54mm header | ZHOURI PZ2.54-1x4-11.2 | C29779969 | Through Hole 1x4 2.54mm header | Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical | JLCPCB-assembled 1x4 header for manual MQ-8 module wiring | verify header orientation, manual MQ-8 module pinout, heater current, airflow, and safety constraints |\r\n| R7,R8 | H2 ADC divider | 0603WAF1002T5E | C25804 | 0603 | Resistor_SMD:R_0603_1608Metric | H2 AOUT 5V-to-ESP32 ADC divider | verify ADC range, source impedance, sampling time, and firmware calibration |\r\n| DS1 | Touch display interface 1x12 2.54mm header | hanxia HX PZ2.54-1x12P ZZ | C42372504 | Through Hole 1x12 2.54mm header | Connector_PinHeader_2.54mm:PinHeader_1x12_P2.54mm_Vertical | JLCPCB-assembled 1x12 header for manual SPI touch-display connection | verify header orientation, ST7789V/XPT2046 pinout, 5V/backlight load, firmware pins, and clearance |\r\n\r\n## Manual-install external modules\r\n\r\n- MQ-8 analog H2 module: plugs/wires to U5 after PCBA; uses 5V heater/VCC and AOUT into the R7/R8/C6 ADC front end; not included in the JLCPCB assembly BOM or CPL.\r\n- Waveshare 2.8inch TFT Touch Shield: ST7789V LCD and XPT2046 touch module connects to DS1 after PCBA; verify 5V/backlight load and pinout; not included in the JLCPCB assembly BOM or CPL.\r\n",
    )
    .unwrap();
    fs::write(
        root.join("circuit-review-findings.md"),
        "# ChatPCB3 Circuit Adequacy Review\r\n\r\n\
         | Area | Result | Evidence | Review risk |\r\n\
         | --- | --- | --- | --- |\r\n\
         | H2 ADC range | PASS | MQ-8 AOUT worst-case 5.0V scaled by R7/R8 10k divider: 5.0V AOUT / 2 = 2.5V, so 2.5V < ESP32 3.3V ADC limit; C6 100nF adds low-pass filtering | Verify MQ-8 heater current, warm-up, calibration curve, ESP32 ADC attenuation, source impedance, and firmware thresholds before manufacture |\r\n\
         | Touch display power/logic | PASS | DS1 uses 3V3 SPI logic nets including DISPLAY_SPI_SCK/DISPLAY_SPI_MOSI/DISPLAY_SPI_MISO plus XPT2046 touch signals; connector is separated from 5V heater rail | Verify module revision, pinout, backlight current, regulator thermal margin, firmware pin map, and clearance before manufacture |\r\n",
    )
    .unwrap();
    fs::write(
        root.join("design-quality-report.md"),
        "# ChatPCB3 Design Quality Report\r\n\r\nTotal score: 100 / 100\r\nTarget score: 90\r\nLevel: ReleaseCandidate\r\nOrder readiness: BLOCKED_HUMAN_SIGNOFF_REQUIRED\r\n\r\n## Metrics\r\n\r\n- required design items: 24/24\r\n- circuit review risk-rationale findings: 6\r\n- part selection risk-rationale groups: 8\r\n- prompt-specific selection blockers: 0\r\n\r\n## Improvement Actions\r\n\r\n1. Keep the order gate blocked until human manufacturing signoff reviews KiCad, BOM/CPL orientation, live stock, substitutions, and JLCPCB upload preview.\r\n",
    )
    .unwrap();
    fs::write(
        root.join("visual-review").join("pcb-review.svg"),
        "<text>U5 H2</text><text>DS1 Touch</text>",
    )
    .unwrap();

    let project_dir = root.to_string_lossy();
    let summary = saved_preview_summary(&project_dir);
    assert_eq!(
        summary.prompt,
        "ESP32-S3와 터치 디스플레이를 가지고 H2 Sensor를 포함하며 USB-C로 전원을 인가받는 회로"
    );
    assert!(summary.has_h2_sensor);
    assert!(summary.has_touch_display);
    assert!(summary
        .quality_summary
        .contains("Design score: <=90/100 until human signoff"));
    assert!(summary
        .quality_summary
        .contains("required design items: 24/24"));
    assert!(summary
        .quality_summary
        .contains("circuit review risk-rationale findings: 6"));
    assert!(summary
        .quality_summary
        .contains("part selection risk-rationale groups: 8"));
    assert!(summary
        .quality_summary
        .contains("prompt-specific selection blockers: 0"));
    assert!(summary.quality_summary.contains("Level: ReleaseCandidate"));

    let schematic = saved_preview_tab_body(0, &project_dir);
    assert!(schematic.contains("H2 Sensor"));
    assert!(schematic.contains("U5 1x4 헤더"));
    assert!(schematic.contains("MQ-8 analog module"));
    assert!(schematic.contains("5V heater"));
    assert!(schematic.contains("H2_ADC"));
    assert!(schematic.contains("DS1 1x12 헤더"));
    assert!(schematic.contains("ST7789V"));
    assert!(schematic.contains("XPT2046"));
    assert!(schematic.contains("Design score: <=90/100 until human signoff"));
    assert!(schematic.contains("required design items: 24/24"));
    assert!(schematic.contains("circuit review risk-rationale findings: 6"));
    assert!(schematic.contains("part selection risk-rationale groups: 8"));
    assert!(schematic.contains("prompt-specific selection blockers: 0"));
    assert!(schematic.contains("ReleaseCandidate"));
    assert!(schematic.contains("회로 적정성 근거"));
    assert!(schematic.contains("H2 ADC range"));
    assert!(schematic.contains("5.0V AOUT / 2 = 2.5V"));
    assert!(schematic.contains("2.5V < ESP32 3.3V ADC limit"));
    assert!(schematic.contains("Touch display power/logic"));
    assert!(schematic.contains("backlight current"));
    assert!(!schematic.contains("H2_SENSE"));
    assert!(!schematic.contains("DISPLAY_SCL"));
    assert!(!schematic.contains(example_board_prompt()));

    let block = saved_preview_tab_body(1, &project_dir);
    assert!(block.contains("H2 Sensor"));
    assert!(block.contains("Touch Display"));

    let pcb = saved_preview_tab_body(2, &project_dir);
    assert!(pcb.contains("H2 module interface header"));
    assert!(pcb.contains("touch-display interface header"));
    assert!(pcb.contains("visual-review/pcb-review.svg"));

    let validation = saved_preview_tab_body(3, &project_dir);
    assert!(validation.contains("Improvement Actions"));
    assert!(validation.contains("order gate"));
    assert!(validation.contains("circuit review risk-rationale findings: 6"));
    assert!(validation.contains("회로 적정성 근거"));
    assert!(validation.contains("H2 ADC range"));
    assert!(validation.contains("Touch display power/logic"));

    let manufacturing = saved_preview_tab_body(4, &project_dir);
    assert!(manufacturing.contains("MQ-8 analog H2 module"));
    assert!(manufacturing.contains("H2 module interface 1x4 2.54mm header"));
    assert!(manufacturing.contains("Touch display interface 1x12 2.54mm header"));
    assert!(manufacturing.contains("Waveshare 2.8inch TFT Touch Shield"));
    assert!(manufacturing.contains("Improvement Actions"));
    assert!(manufacturing.contains("part selection risk-rationale groups: 8"));
    assert!(manufacturing.contains("회로 적정성 근거"));
    assert!(manufacturing.contains("5.0V AOUT / 2 = 2.5V"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn saved_preview_tabs_surface_part_selection_mpn_lcsc_basis_and_risk() {
    let root = std::env::temp_dir().join(format!(
        "chatpcb3-desktop-part-selection-ui-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join("visual-review")).unwrap();

    fs::write(
        root.join("prompt.txt"),
        "USB-C ESP32-S3 H2 Sensor touch display board",
    )
    .unwrap();
    fs::write(
        root.join("part-selection-review.md"),
        "# ChatPCB3 Part Selection Review\r\n\r\n\
         | Designator | Function | MPN | JLCPCB/LCSC | Package | Footprint | Selection basis | Review risk |\r\n\
         | --- | --- | --- | --- | --- | --- | --- | --- |\r\n\
         | U1 | ESP32-S3-WROOM-1-N8R8 | ESP32-S3-WROOM-1-N8R8 | C2913204 | Module | RF_Module:ESP32-S3-WROOM-1 | target MCU module with integrated RF | verify stock, footprint, and substitution policy |\r\n\
         | U5 | H2 module interface 1x4 2.54mm header | ZHOURI PZ2.54-1x4-11.2 | C29779969 | Through Hole 1x4 2.54mm header | Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical | JLCPCB-assembled 1x4 header for manual MQ-8 module wiring | verify header orientation, manual MQ-8 module pinout, heater current, airflow, and safety constraints |\r\n\
         | DS1 | Touch display interface 1x12 2.54mm header | hanxia HX PZ2.54-1x12P ZZ | C42372504 | Through Hole 1x12 2.54mm header | Connector_PinHeader_2.54mm:PinHeader_1x12_P2.54mm_Vertical | JLCPCB-assembled 1x12 header for manual SPI touch-display connection | verify header orientation, ST7789V/XPT2046 pinout, 5V/backlight load, firmware pins, and clearance |\r\n\
         \r\n## Manual-install external modules\r\n\r\n- MQ-8 analog H2 module: plugs/wires to U5 after PCBA; not included in the JLCPCB assembly BOM or CPL.\r\n- Waveshare 2.8inch TFT Touch Shield: connects to DS1 after PCBA; not included in the JLCPCB assembly BOM or CPL.\r\n",
    )
    .unwrap();
    fs::write(
        root.join("design-quality-report.md"),
        "# ChatPCB3 Design Quality Report\r\n\r\nTotal score: 100 / 100\r\nTarget score: 90\r\nLevel: ReleaseCandidate\r\nOrder readiness: BLOCKED_HUMAN_SIGNOFF_REQUIRED\r\n\r\n## Metrics\r\n\r\n- required design items: 24/24\r\n- circuit review risk-rationale findings: 6\r\n- part selection risk-rationale groups: 8\r\n- prompt-specific selection blockers: 0\r\n",
    )
    .unwrap();

    let project_dir = root.to_string_lossy();
    let schematic = saved_preview_tab_body(0, &project_dir);
    assert!(schematic.contains("부품 선정 근거"));
    assert!(schematic.contains("U1 ESP32-S3-WROOM-1-N8R8"));
    assert!(schematic.contains("MPN: ESP32-S3-WROOM-1-N8R8"));
    assert!(schematic.contains("LCSC: C2913204"));

    let manufacturing = saved_preview_tab_body(4, &project_dir);
    assert!(manufacturing.contains("부품 선정 근거"));
    assert!(manufacturing.contains("U5 H2 module interface 1x4 2.54mm header"));
    assert!(manufacturing.contains("MPN: ZHOURI PZ2.54-1x4-11.2"));
    assert!(manufacturing.contains("LCSC: C29779969"));
    assert!(manufacturing.contains("근거: JLCPCB-assembled 1x4 header"));
    assert!(manufacturing.contains("리스크: verify header orientation"));
    assert!(manufacturing.contains("DS1 Touch display interface 1x12 2.54mm header"));
    assert!(manufacturing.contains("LCSC: C42372504"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn part_selection_canvas_lines_are_compact_and_prioritize_prompt_specific_parts() {
    let root = std::env::temp_dir().join(format!(
        "chatpcb3-desktop-part-selection-canvas-lines-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();

    fs::write(
        root.join("part-selection-review.md"),
        "# ChatPCB3 Part Selection Review\r\n\r\n\
         | Designator | Function | MPN | JLCPCB/LCSC | Package | Footprint | Selection basis | Review risk |\r\n\
         | --- | --- | --- | --- | --- | --- | --- | --- |\r\n\
         | U1 | ESP32-S3-WROOM-1-N8R8 | ESP32-S3-WROOM-1-N8R8 | C2913204 | Module | RF_Module:ESP32-S3-WROOM-1 | target MCU module with integrated RF and antenna keepout review | verify stock, footprint, and substitution policy |\r\n\
         | U5 | H2 module interface 1x4 2.54mm header | ZHOURI PZ2.54-1x4-11.2 | C29779969 | Through Hole 1x4 2.54mm header | Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical | JLCPCB-assembled 1x4 header for manual MQ-8 module wiring | verify header orientation, manual MQ-8 module pinout, heater current, airflow, and safety constraints |\r\n\
         | DS1 | Touch display interface 1x12 2.54mm header | hanxia HX PZ2.54-1x12P ZZ | C42372504 | Through Hole 1x12 2.54mm header | Connector_PinHeader_2.54mm:PinHeader_1x12_P2.54mm_Vertical | JLCPCB-assembled 1x12 header for manual SPI touch-display connection | verify header orientation, ST7789V/XPT2046 pinout, 5V/backlight load, firmware pins, and clearance |\r\n",
    )
    .unwrap();

    let project_dir = root.to_string_lossy();
    let lines = saved_part_selection_review_canvas_lines(&project_dir, 2);
    assert_eq!(lines.len(), 4);
    assert!(lines[0].contains("U5 H2 module interface"));
    assert!(lines.iter().any(|line| line.contains("DS1 Touch display")));
    assert!(lines
        .iter()
        .any(|line| line.contains("risk: verify header")));
    assert!(
        lines.iter().all(|line| line.chars().count() <= 118),
        "canvas lines must stay short enough for the native preview: {lines:#?}"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn saved_schematic_render_model_reads_symbols_and_nets_from_kicad_sch() {
    let root = std::env::temp_dir().join(format!(
        "chatpcb3-saved-schematic-render-model-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    fs::write(
        root.join("chatpcb3-esp32s3.kicad_sch"),
        r#"(kicad_sch
  (lib_symbols
    (symbol "ChatPCB3:H2_SENSOR_REVIEW"
      (pin power_in line (at -10.16 -5.08 0) (length 2.54) (name "VBUS_5V" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
      (pin output line (at -10.16 0 0) (length 2.54) (name "H2_AOUT_RAW" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27)))))
      (pin power_in line (at -10.16 5.08 0) (length 2.54) (name "GND" (effects (font (size 1.27 1.27)))) (number "4" (effects (font (size 1.27 1.27)))))
    )
    (symbol "ChatPCB3:TOUCH_DISPLAY_REVIEW"
      (pin input line (at -10.16 0 0) (length 2.54) (name "DISPLAY_SPI_SCK" (effects (font (size 1.27 1.27)))) (number "SCK" (effects (font (size 1.27 1.27)))))
      (pin bidirectional line (at -10.16 5.08 0) (length 2.54) (name "TOUCH_IRQ" (effects (font (size 1.27 1.27)))) (number "IRQ" (effects (font (size 1.27 1.27)))))
    )
  )
  (symbol (lib_id "ChatPCB3:H2_SENSOR_REVIEW") (at 132.08 129.54 0)
    (property "Reference" "U5" (at 132.08 119.38 0))
    (property "Value" "MQ-8 analog H2 module" (at 132.08 139.70 0)))
  (symbol (lib_id "ChatPCB3:PASSIVE_2PIN") (at 104.14 127.00 0)
    (property "Reference" "R7" (at 104.14 121.92 0))
    (property "Value" "H2 ADC divider top" (at 104.14 132.08 0)))
  (symbol (lib_id "ChatPCB3:TOUCH_DISPLAY_REVIEW") (at 170.18 139.70 0)
    (property "Reference" "DS1" (at 170.18 129.54 0))
    (property "Value" "Waveshare 2.8inch TFT Touch Shield" (at 170.18 149.86 0)))
  (label "H2_AOUT_RAW" (at 121.92 132.08 0))
  (label "H2_ADC" (at 96.52 132.08 0))
  (global_label "DISPLAY_SPI_SCK" (shape input) (at 172.72 88.90 0))
  (global_label "TOUCH_IRQ" (shape input) (at 172.72 109.22 0))
  (text "Prompt option: MQ-8 analog H2 module with R7/R8 divider and C6 filter." (at 25.4 55.88 0))
)"#,
    )
    .unwrap();

    let model = saved_schematic_render_model(root.to_str().unwrap());

    assert_eq!(model.source_file, "chatpcb3-esp32s3.kicad_sch");
    assert!(model.references.contains(&"U5".to_string()));
    assert!(model.references.contains(&"R7".to_string()));
    assert!(model.references.contains(&"DS1".to_string()));
    assert!(model.values.contains(&"MQ-8 analog H2 module".to_string()));
    assert!(model
        .values
        .contains(&"Waveshare 2.8inch TFT Touch Shield".to_string()));
    assert!(model.nets.contains(&"H2_AOUT_RAW".to_string()));
    assert!(model.nets.contains(&"H2_ADC".to_string()));
    assert!(model.nets.contains(&"DISPLAY_SPI_SCK".to_string()));
    assert!(model.nets.contains(&"TOUCH_IRQ".to_string()));
    assert!(model.pin_names.contains(&"VBUS_5V".to_string()));
    assert!(model.pin_names.contains(&"GND".to_string()));
    assert!(model.pin_names.contains(&"H2_AOUT_RAW".to_string()));
    assert!(model.pin_names.contains(&"DISPLAY_SPI_SCK".to_string()));
    assert!(model.pin_names.contains(&"TOUCH_IRQ".to_string()));
    assert!(model
        .notes
        .iter()
        .any(|note| note.contains("R7/R8 divider")));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn saved_schematic_render_model_ignores_library_symbol_reference_templates() {
    let root = std::env::temp_dir().join(format!(
        "chatpcb3-saved-schematic-render-model-lib-symbols-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    fs::write(
        root.join("chatpcb3-esp32s3.kicad_sch"),
        r#"(kicad_sch
  (lib_symbols
    (symbol "ChatPCB3:PASSIVE_2PIN"
      (property "Reference" "R" (at 0 0 0))
      (property "Value" "passive" (at 0 2 0))
    )
    (symbol "ChatPCB3:TOUCH_DISPLAY_REVIEW"
      (property "Reference" "DS" (at 0 0 0))
      (property "Value" "template display" (at 0 2 0))
    )
  )
  (symbol (lib_id "ChatPCB3:PASSIVE_2PIN") (at 104.14 127.00 0)
    (property "Reference" "R7" (at 104.14 124.46 0))
    (property "Value" "10k H2 ADC divider top" (at 104.14 129.54 0))
  )
  (symbol (lib_id "ChatPCB3:TOUCH_DISPLAY_REVIEW") (at 170.18 139.70 0)
    (property "Reference" "DS1" (at 170.18 127.00 0))
    (property "Value" "Waveshare 2.8inch TFT Touch Shield" (at 170.18 129.54 0))
  )
  (global_label "DISPLAY_SPI_SCK" (shape input) (at 160.02 147.32 180))
)"#,
    )
    .unwrap();

    let model = saved_schematic_render_model(root.to_str().unwrap());

    assert_eq!(model.references, vec!["R7".to_string(), "DS1".to_string()]);
    assert!(!model.references.contains(&"R".to_string()));
    assert!(!model.references.contains(&"DS".to_string()));
    assert!(model.values.contains(&"10k H2 ADC divider top".to_string()));
    assert!(model
        .values
        .contains(&"Waveshare 2.8inch TFT Touch Shield".to_string()));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn preview_workspace_body_points_to_saved_artifacts_without_order_ready_claims() {
    let body = preview_workspace_body(
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\release-evidence-preview.md",
    );
    let visible_lines = body.lines().filter(|line| !line.trim().is_empty()).count();

    assert!(body.contains("미리보기 저장 완료"));
    assert!(body.contains("검토 목록"));
    assert!(body.contains("품질 리포트"));
    assert!(body.contains("design-quality-report.md"));
    assert!(body.contains("90점 게이트"));
    assert!(body.contains("ERC/DRC blocker"));
    assert!(body.contains("채팅 입력칸"));
    assert!(body.contains("50mm x 50mm 보드"));
    assert!(body.contains("주요 배선"));
    assert!(body.contains("PCB 열기"));
    assert!(body.contains("KiCad 10"));
    assert!(body.contains("후속 입력"));
    assert!(body.contains("prototype-review"));
    assert!(body.contains("주문 준비 전"));
    assert!(!body.contains("order-ready"));
    assert!(visible_lines <= 10);
    assert!(!body.contains("생성된 파일:"));
    assert!(!body.contains("artifact-manifest.json"));
    assert!(!body.contains("FIRST-RUN-SUMMARY.txt"));
    assert!(!body.contains("jlcpcb-bom-preview.csv"));
    assert!(!body.contains("jlcpcb-cpl-preview.csv"));
    assert!(!body.contains("manufacturing-readiness-preview.txt"));
    assert!(!body.contains("release-evidence-preview.md"));
    assert!(!body.contains("beginner next steps"));
    assert!(!body.contains("Click Review checklist"));
}

#[test]
fn preview_workspace_body_surfaces_kicad_cli_check_for_non_experts() {
    let body = preview_workspace_body_with_kicad_check(
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\release-evidence-preview.md",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\kicad-pcb-check.txt",
        "KiCad 확인: 미리보기 PCB를 열 수 있습니다. 검토 목록에서 주문 전 검토를 끝내기 전까지 prototype-review입니다.",
    );

    assert!(body.contains("KiCad CLI 확인"));
    assert!(body.contains("미리보기 PCB를 열 수 있습니다"));
    assert!(body.contains("자세한 보고서는 검토 목록"));
    assert!(body.contains("prototype-review"));
    assert!(body.contains("주문 준비 전"));
    assert!(!body.contains("order-ready"));
    assert!(!body.contains("kicad-pcb-check.txt"));
    assert!(!body.contains("C:\\Users"));
    assert!(!body.contains("KiCad accepted the preview PCB"));
    assert!(!body.contains("preview PCB"));
    assert!(!body.contains("Gate remains"));
}

#[test]
fn kicad_cli_check_transcript_points_to_local_report_without_order_ready_claims() {
    let transcript = kicad_cli_check_transcript(
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\kicad-pcb-check.txt",
        "KiCad 확인: 미리보기 PCB를 열 수 있습니다. 검토 목록에서 주문 전 검토를 끝내기 전까지 prototype-review입니다.",
    );

    assert!(transcript.contains("KiCad CLI 확인"));
    assert!(transcript.contains("미리보기 PCB를 열 수 있습니다"));
    assert!(transcript.contains("자세한 보고서는 검토 목록"));
    assert!(transcript.contains("prototype-review"));
    assert!(!transcript.contains("C:\\Users"));
    assert!(!transcript.contains("kicad-pcb-check.txt"));
    assert!(!transcript.contains("KiCad accepted the preview PCB"));
    assert!(!transcript.contains("preview PCB"));
    assert!(!transcript.contains("Gate remains"));
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
        "KiCad 확인: 미리보기 PCB를 열 수 있습니다. 검토 목록에서 주문 전 검토를 끝내기 전까지 prototype-review입니다.",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\erc-report.json",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\drc-report.json",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\kicad-validation-summary.txt",
        "ERC: 오류 0개, 경고 0개. DRC: 오류 0개, 경고 0개, 미연결 0개. 90점 품질 게이트 통과: Level은 ReleaseCandidate입니다. 검토 목록에서 회로, PCB, 제조 파일을 확인하세요. JLCPCB 주문 전에는 사람 제조 검토가 필요합니다.",
    );

    assert!(body.contains("KiCad ERC/DRC 검증"));
    assert!(body.contains("자세한 ERC/DRC 보고서는 검토 목록"));
    assert!(body.contains("ERC: 오류 0개, 경고 0개"));
    assert!(body.contains("DRC: 오류 0개, 경고 0개"));
    assert!(body.contains("미연결 0개"));
    assert!(body.contains("90점 품질 게이트 통과"));
    assert!(body.contains("ReleaseCandidate"));
    assert!(body.contains("사람 제조 검토"));
    assert!(!body.contains("order-ready"));
    assert!(!body.contains("erc-report.json"));
    assert!(!body.contains("drc-report.json"));
    assert!(!body.contains("kicad-validation-summary.txt"));
    assert!(!body.contains("C:\\Users"));
    assert!(!body.contains("preview PCB"));
    assert!(!body.contains("ERC: 0 errors"));
    assert!(!body.contains("DRC: 0 errors"));
    assert!(!body.contains("Gate remains"));
}

#[test]
fn erc_drc_validation_transcript_points_to_saved_reports_without_order_ready_claims() {
    let transcript = erc_drc_validation_transcript(
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\erc-report.json",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\drc-report.json",
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview\\kicad-validation-summary.txt",
        "ERC: 오류 0개, 경고 0개. DRC: 오류 0개, 경고 0개, 미연결 0개. 90점 품질 게이트 통과: Level은 ReleaseCandidate입니다. 검토 목록에서 회로, PCB, 제조 파일을 확인하세요. JLCPCB 주문 전에는 사람 제조 검토가 필요합니다.",
    );

    assert!(transcript.contains("KiCad ERC/DRC 검증"));
    assert!(transcript.contains("자세한 ERC/DRC 보고서는 검토 목록"));
    assert!(transcript.contains("ERC: 오류 0개, 경고 0개"));
    assert!(transcript.contains("미연결 0개"));
    assert!(transcript.contains("90점 품질 게이트 통과"));
    assert!(transcript.contains("ReleaseCandidate"));
    assert!(!transcript.contains("C:\\Users"));
    assert!(!transcript.contains("erc-report.json"));
    assert!(!transcript.contains("drc-report.json"));
    assert!(!transcript.contains("kicad-validation-summary.txt"));
    assert!(!transcript.contains("ERC: 0 errors"));
    assert!(!transcript.contains("Gate remains"));
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
    let visible_lines = body.lines().filter(|line| !line.trim().is_empty()).count();

    assert!(status.contains("이전 미리보기 발견"));
    assert!(status.contains("검토 목록"));
    assert!(status.contains("저장 위치"));
    assert!(status.contains("prototype-review"));
    assert!(status.contains("주문 준비 전"));
    assert!(!status.contains("order-ready"));
    assert!(!status.contains("C:\\Users"));
    assert!(!status.contains("chatpcb3-esp32s3-preview"));
    assert!(body.contains("이전 미리보기 발견"));
    assert!(body.contains("검토 목록으로 저장 위치, 파일, 품질 리포트를 확인"));
    assert!(body.contains("주요 배선"));
    assert!(body.contains("채팅 입력칸"));
    assert!(body.contains("PCB 열기"));
    assert!(body.contains("주문 준비 전"));
    assert!(visible_lines <= 8);
    assert!(!body.contains("C:\\Users"));
    assert!(!body.contains("예상 파일:"));
    assert!(!body.contains("release-evidence-preview.md"));
    assert!(!body.contains("FIRST-RUN-SUMMARY.txt"));
    assert!(!body.contains("BEGINNER-NEXT-STEPS.txt"));
    assert!(!body.contains("kicad-pcb-check.txt"));
    assert!(!body.contains("jlcpcb-bom-preview.csv"));
    assert!(!body.contains("Previous preview workspace found"));
    assert!(!body.contains("Click Review checklist"));
    assert!(!body.contains("board outline"));
    assert!(!body.contains("order-ready"));
}

#[test]
fn recovered_preview_workspace_chat_turn_orients_relaunch_users() {
    let project_dir =
        "C:\\Users\\windo\\AppData\\Local\\ChatPCB3\\Projects\\chatpcb3-esp32s3-preview";
    let transcript = recovered_preview_workspace_transcript(project_dir);

    assert!(transcript.contains("이전 미리보기 발견"));
    assert!(transcript.contains("검토 목록"));
    assert!(transcript.contains("PCB 열기"));
    assert!(transcript.contains("prototype-review"));
    assert!(transcript.contains("주문 준비 전"));
    assert!(!transcript.contains("C:\\Users"));
    assert!(!transcript.contains("chatpcb3-esp32s3-preview"));
    assert!(!transcript.contains("프로젝트 폴더:"));
    assert!(!transcript.contains("Status:"));
    assert!(!transcript.contains("Previous preview workspace found"));
    assert!(!transcript
        .to_ascii_lowercase()
        .contains("order-ready evidence"));
    assert!(!transcript.contains("board outline"));
    assert!(!transcript.contains("order-ready"));
}
