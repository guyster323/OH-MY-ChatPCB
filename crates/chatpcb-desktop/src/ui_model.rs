use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChatActionsContract {
    pub send_design_uses_prompt: bool,
    pub send_design_clears_prompt: bool,
    pub prompt_input_has_visible_label: bool,
    pub prompt_input_has_empty_cue: bool,
    pub empty_prompt_uses_visible_builtin_example: bool,
    pub use_example_fills_prompt: bool,
    pub use_example_focuses_prompt_input: bool,
    pub use_example_selects_prompt_for_overwrite: bool,
    pub provider_login_selects_available_model: bool,
    pub provider_model_selection_is_readiness_only_for_preview: bool,
    pub provider_login_keeps_builtin_preview_unblocked: bool,
    pub pipeline_status_updates_after_actions: bool,
    pub send_design_writes_preview_workspace: bool,
    pub send_design_returns_focus_to_prompt: bool,
    pub kicad_cli_check_runs_after_send_design: bool,
    pub erc_drc_reports_run_after_send_design: bool,
    pub send_design_updates_left_workspace_status: bool,
    pub open_evidence_opens_preview_workspace: bool,
    pub open_evidence_selects_beginner_next_steps_file: bool,
    pub open_pcb_opens_preview_board: bool,
    pub open_saved_artifacts_disabled_until_workspace: bool,
    pub open_saved_artifacts_enabled_after_preview: bool,
    pub provider_login_reports_cli_status: bool,
    pub provider_login_shows_local_cli_login_hints: bool,
    pub left_tabs_update_workspace_status: bool,
    pub left_tabs_update_workspace_preview: bool,
    pub send_design_appends_chat_transcript: bool,
    pub chat_transcript_scrolls_to_latest: bool,
    pub prompt_enter_sends_design: bool,
    pub app_launch_focuses_prompt_input: bool,
    pub app_launch_has_korean_first_chat_cue: bool,
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
        prompt_input_has_visible_label: true,
        prompt_input_has_empty_cue: true,
        empty_prompt_uses_visible_builtin_example: true,
        use_example_fills_prompt: true,
        use_example_focuses_prompt_input: true,
        use_example_selects_prompt_for_overwrite: true,
        provider_login_selects_available_model: true,
        provider_model_selection_is_readiness_only_for_preview: true,
        provider_login_keeps_builtin_preview_unblocked: true,
        pipeline_status_updates_after_actions: true,
        send_design_writes_preview_workspace: true,
        send_design_returns_focus_to_prompt: true,
        kicad_cli_check_runs_after_send_design: true,
        erc_drc_reports_run_after_send_design: true,
        send_design_updates_left_workspace_status: true,
        open_evidence_opens_preview_workspace: true,
        open_evidence_selects_beginner_next_steps_file: true,
        open_pcb_opens_preview_board: true,
        open_saved_artifacts_disabled_until_workspace: true,
        open_saved_artifacts_enabled_after_preview: true,
        provider_login_reports_cli_status: true,
        provider_login_shows_local_cli_login_hints: true,
        left_tabs_update_workspace_status: true,
        left_tabs_update_workspace_preview: true,
        send_design_appends_chat_transcript: true,
        chat_transcript_scrolls_to_latest: true,
        prompt_enter_sends_design: true,
        app_launch_focuses_prompt_input: true,
        app_launch_has_korean_first_chat_cue: true,
        app_launch_selects_available_provider_model: true,
        provider_login_appends_chat_transcript: true,
        provider_login_returns_focus_to_prompt: true,
        open_evidence_recovers_previous_workspace: true,
        app_launch_shows_recovered_workspace_status: true,
        app_launch_mentions_recovered_workspace_in_chat: true,
    }
}

pub fn initial_left_workspace_status() -> &'static str {
    "회로도: 만들 보드를 입력한 뒤 Enter. chatpcb3-esp32s3.kicad_sch 미리보기를 생성합니다."
}

pub fn left_tab_status(index: usize) -> &'static str {
    match index {
        0 => initial_left_workspace_status(),
        1 => "PCB 레이아웃: chatpcb3-esp32s3.kicad_pcb 미리보기. 배치/배선은 아직 생성 전입니다.",
        2 => "검증: ERC/DRC 아직 실행 전. 설계 생성은 prototype-review 증거만 만듭니다.",
        3 => {
            "제조 미리보기: Gerber/BOM/CPL 아직 생성 전. JLCPCB 업로드 패키지는 계속 blocked입니다."
        }
        _ => initial_left_workspace_status(),
    }
}

pub fn left_tab_body(index: usize) -> &'static str {
    match index {
        0 => "회로도 미리보기\r\n\
              - 오른쪽 채팅 입력칸에 만들 보드를 적고 Enter.\r\n\
              - Target: ESP32-S3 USB-C sensor board.\r\n\
              - Nets: USB_D+, USB_D-, 5V, 3V3, GND, I2C_SCL, I2C_SDA.\r\n\
              - 상태: prototype-review, order-ready 아님.",
        1 => "PCB 레이아웃 미리보기\r\n\
              - 50mm x 50mm Edge.Cuts 보드 외곽선을 preview로 생성합니다.\r\n\
              - Component placement와 Freerouting route data는 아직 생성 전입니다.\r\n\
              - Planned flow: component placement -> DSN export -> Freerouting -> SES import.\r\n\
              - 제조 출력은 DRC 통과 후에만 신뢰할 수 있습니다.",
        2 => "검증 미리보기\r\n\
              - ERC는 아직 실행 전입니다.\r\n\
              - DRC는 아직 실행 전입니다.\r\n\
              - 검토 목록에서 KiCad report와 artifact를 확인할 때까지 prototype-review입니다.",
        3 => "제조 미리보기\r\n\
              - Gerber/Drill 파일은 아직 생성 전입니다.\r\n\
              - BOM/CPL preview 파일은 설계 생성 후 확인용으로 생성되지만 업로드 가능 상태가 아님.\r\n\
              - schematic, layout, ERC, DRC, Gerber, drill, placement-reviewed CPL 증거 전까지 JLCPCB upload는 blocked입니다.\r\n\
              - 실제 주문 전에는 반드시 멈추고 사용자 확인을 받아야 합니다.",
        _ => left_tab_body(0),
    }
}

pub fn initial_pipeline_status() -> &'static str {
    "준비: 만들 보드 입력 후 Enter. 빈칸=ESP32-S3 예시."
}

pub fn example_loaded_pipeline_status() -> &'static str {
    "예시 입력됨: 고치고 Enter 또는 설계 생성."
}

pub fn provider_login_pipeline_status(selected_model: Option<&str>) -> String {
    match selected_model {
        Some(model) => format!("Provider 감지: {model}; preview 생성은 아직 로컬입니다."),
        None => "로컬 provider 없음; built-in-preview는 계속 사용 가능합니다.".to_string(),
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
    "미리보기 계획: schematic -> layout -> DRC -> JLCPCB."
}

pub fn validation_pipeline_status(validation_summary: &str) -> String {
    if validation_summary.contains("ERC: 오류 0개, 경고 0개")
        && validation_summary.contains("DRC: 오류 0개, 경고 0개, 미연결 0개")
    {
        return "검증 완료: PCB 열기/검토 목록 또는 후속 입력. 아직 prototype-review.".to_string();
    }

    "검증 확인 필요: checklist에서 ERC/DRC 확인. 아직 prototype-review.".to_string()
}

pub fn visible_empty_prompt_pipeline_status(status: &str) -> String {
    if status.contains("검증 완료") {
        return "내장 예시 사용. 검증 완료: PCB 열기/검토 목록. 아직 prototype-review.".to_string();
    }

    format!("내장 예시 사용. {status}")
}

pub fn open_pcb_pipeline_status(opened_with_kicad: bool) -> &'static str {
    if opened_with_kicad {
        "KiCad PCB Editor에서 preview PCB를 열었습니다."
    } else {
        "preview PCB 파일을 열었습니다. PCB Editor가 열리지 않았다면 KiCad 10을 설치하세요."
    }
}

pub fn open_evidence_pipeline_status() -> &'static str {
    "검토 목록: BEGINNER-NEXT-STEPS.txt를 열었습니다."
}

pub fn recovered_preview_pipeline_status() -> &'static str {
    "이전 미리보기: 이어서 입력 후 Enter. PCB 열기/검토 목록."
}

pub fn example_board_prompt() -> &'static str {
    "USB-C ESP32-S3 온습도 센서 보드, I2C 센서, JLCPCB 조립"
}

pub fn initial_transcript() -> String {
    "ChatPCB KiCad Preview\r\n\
     바로 채팅: 만들 보드를 채팅 입력칸에 적고 Enter.\r\n\
     Provider Login은 선택 사항입니다. built-in-preview로 prototype-review 증거를 만들며 JLCPCB order-ready 파일은 아닙니다.\r\n"
        .to_string()
}

pub fn send_design_transcript(prompt: &str) -> String {
    let prompt = prompt.trim();
    let prompt_was_empty = prompt.is_empty();
    let prompt = if prompt_was_empty {
        example_board_prompt()
    } else {
        prompt
    };
    let input_note = if prompt_was_empty {
        "입력 안내: prompt가 비어 있어 내장 ESP32-S3 예시를 사용했습니다. 다음에는 prompt를 고친 뒤 Enter를 누르세요.\r\n"
    } else {
        ""
    };

    format!(
        "User: {prompt}\r\n\
         {input_note}\
         Assistant: 결과 요약\r\n\
         - ESP32-S3 기본 보드 사양을 만들었습니다.\r\n\
         - JLCPCB 검토용 package contract를 선택했습니다.\r\n\
         - schematic -> placement -> Freerouting autoroute -> DRC -> manufacturing package 흐름을 준비했습니다.\r\n\
         미리보기 엔진: built-in local generator; provider/model 선택은 준비 상태 확인용입니다. 이 미리보기에서는 provider CLI를 호출하지 않습니다.\r\n\
         다음 행동\r\n\
         - PCB 열기 또는 검토 목록으로 저장된 preview를 확인하세요.\r\n\
         - order-ready 파일은 실제 KiCad fork 통합과 제조 증거 검토가 필요합니다.\r\n\
         상태: preview only, 아직 order-ready 아님.\r\n"
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

pub fn preview_workspace_saved_transcript(
    _project_dir: &str,
    _release_report_file: &str,
) -> String {
    format!(
        "미리보기 저장 완료\r\n\
         - 검토 목록에서 저장 위치와 생성 파일을 확인하세요.\r\n\
         - PCB preview: 50mm x 50mm Edge.Cuts 외곽선. 배치/배선은 아직 없음.\r\n\
         - PCB 열기로 KiCad 10에서 보드 외곽선을 확인하세요.\r\n\
         - 바꿀 점을 채팅 입력칸에 적고 Enter로 후속 입력을 보내세요.\r\n\
         상태: prototype-review, order-ready 아님.\r\n"
    )
}

pub fn preview_result_summary_transcript() -> &'static str {
    "결과: 미리보기 저장 완료\r\n\
     - PCB 열기 또는 검토 목록으로 확인하세요.\r\n\
     - 아직 JLCPCB 주문 금지: prototype-review 상태입니다.\r\n"
}

pub fn preview_workspace_left_status(_project_dir: &str) -> String {
    "미리보기 저장 완료 | 검토 목록에서 저장 위치 확인 | prototype-review, order-ready 아님."
        .to_string()
}

pub fn saved_preview_tab_status(index: usize, _project_dir: &str) -> String {
    match index {
        0 => "회로도: 저장된 미리보기. 검토 목록에서 저장 위치 확인; prototype-review.".to_string(),
        1 => "PCB 레이아웃: 저장된 미리보기. PCB 열기로 50mm x 50mm outline 확인.".to_string(),
        2 => "검증: 저장된 미리보기. 검토 목록에서 KiCad ERC/DRC report 확인; prototype-review."
            .to_string(),
        3 => "제조 미리보기: 저장된 미리보기. Gerber/BOM/CPL은 아직 order-ready 아님.".to_string(),
        _ => saved_preview_tab_status(0, _project_dir),
    }
}

pub fn saved_preview_tab_body(index: usize, project_dir: &str) -> String {
    match index {
        0 => ("미리보기 저장 완료\r\n\
             회로도\r\n\
             - 검토 목록에서 저장 위치와 회로 파일을 확인하세요.\r\n\
             - Expected nets:\r\n\
             - USB_D+, USB_D-, 5V, 3V3, GND, I2C_SCL, and I2C_SDA.\r\n\
             - 제조 출력을 믿기 전 KiCad에서 symbol과 연결을 확인하세요.\r\n\r\n\
             상태: prototype-review, order-ready 아님.")
            .to_string(),
        1 => ("PCB 레이아웃\r\n\
             현재 preview:\r\n\
             - 50mm x 50mm Edge.Cuts outline.\r\n\
             - 배치와 배선은 아직 preview 단계입니다.\r\n\
             - PCB 열기로 KiCad 10에서 저장된 board outline을 확인하세요.\r\n\r\n\
             상태: prototype-review, order-ready 아님.")
            .to_string(),
        2 => ("KiCad ERC/DRC 검증\r\n\
             - 검토 목록에서 KiCad 확인, ERC/DRC 요약, 자세한 보고서를 확인하세요.\r\n\
             - PCB 열기로 저장된 board outline을 직접 열어볼 수 있습니다.\r\n\
             제조 출력을 믿기 전 validation을 검토해야 합니다.\r\n\
             상태: prototype-review, order-ready 아님.")
            .to_string(),
        3 => ("제조 미리보기\r\n\
             JLCPCB 업로드는 아직 막힌 상태입니다.\r\n\
             - 검토 목록에서 BOM/CPL preview와 제조 준비 메모를 확인하세요.\r\n\
             업로드 전 아직 필요한 것:\r\n\
             - Gerber zip\r\n\
             - Drill files\r\n\
             - Placement-reviewed CPL/position file\r\n\
             - Release evidence report\r\n\r\n\
             실제 주문 전에는 앱이 멈추고 사용자 확인을 받아야 합니다.\r\n\
             상태: prototype-review, order-ready 아님.")
            .to_string(),
        _ => saved_preview_tab_body(0, project_dir),
    }
}

pub fn preview_workspace_body(_project_dir: &str, _release_report_file: &str) -> String {
    format!(
        "미리보기 저장 완료\r\n\
         다음 행동\r\n\
         - PCB 열기로 KiCad 10에서 50mm x 50mm Edge.Cuts 외곽선을 확인하세요.\r\n\
         - 검토 목록으로 저장 위치, 파일 목록, beginner next steps를 확인하세요.\r\n\
         - 채팅 입력칸에 바꿀 점을 적고 Enter로 후속 입력을 보내세요.\r\n\r\n\
         상태: prototype-review, order-ready 아님."
    )
}

pub fn preview_workspace_body_with_kicad_check(
    project_dir: &str,
    release_report_file: &str,
    _check_report_file: &str,
    check_summary: &str,
) -> String {
    format!(
        "{}\r\n\r\n\
         KiCad CLI 확인:\r\n\
         {check_summary}\r\n\
         자세한 보고서는 검토 목록에서 확인하세요.",
        preview_workspace_body(project_dir, release_report_file)
    )
}

pub fn preview_workspace_body_with_validation_reports(
    project_dir: &str,
    release_report_file: &str,
    check_report_file: &str,
    check_summary: &str,
    _erc_report_file: &str,
    _drc_report_file: &str,
    _validation_summary_file: &str,
    validation_summary: &str,
) -> String {
    format!(
        "{}\r\n\r\n\
         KiCad ERC/DRC 검증:\r\n\
         {validation_summary}\r\n\
         자세한 ERC/DRC 보고서는 검토 목록에서 확인하세요.",
        preview_workspace_body_with_kicad_check(
            project_dir,
            release_report_file,
            check_report_file,
            check_summary
        )
    )
}

pub fn kicad_cli_check_transcript(_check_report_file: &str, check_summary: &str) -> String {
    format!(
        "KiCad CLI 확인\r\n\
         - {check_summary}\r\n\
         - 자세한 보고서는 검토 목록에서 확인하세요.\r\n"
    )
}

pub fn erc_drc_validation_transcript(
    _erc_report_file: &str,
    _drc_report_file: &str,
    _validation_summary_file: &str,
    validation_summary: &str,
) -> String {
    format!(
        "KiCad ERC/DRC 검증\r\n\
         - {validation_summary}\r\n\
         - 자세한 ERC/DRC 보고서는 검토 목록에서 확인하세요.\r\n"
    )
}

pub fn recovered_preview_workspace_left_status(_project_dir: &str) -> String {
    "이전 미리보기 발견 | 검토 목록에서 저장 위치 확인 | prototype-review, order-ready 아님."
        .to_string()
}

pub fn recovered_preview_workspace_body(_project_dir: &str) -> String {
    format!(
        "이전 미리보기 발견\r\n\
         이어가기\r\n\
         - 검토 목록으로 저장 위치와 파일을 확인한 뒤 다음 설계를 보내세요.\r\n\
         - PCB 열기로 KiCad 10에서 저장된 board outline을 확인하세요.\r\n\
         - 채팅 입력칸에 바꿀 점을 적고 Enter로 후속 입력을 보내세요.\r\n\r\n\
         상태: prototype-review, order-ready 아님."
    )
}

pub fn recovered_preview_workspace_transcript(_project_dir: &str) -> String {
    format!(
        "이전 미리보기 발견\r\n\
         - 검토 목록으로 저장 위치와 파일을 확인하세요.\r\n\
         - PCB 열기로 KiCad 10에서 저장된 board outline을 확인하세요.\r\n\
         - 채팅 입력칸에 바꿀 점을 적고 Enter로 이어가세요.\r\n\
         상태: prototype-review, order-ready 아님.\r\n"
    )
}

pub fn preview_workspace_failed_transcript(error: &str) -> String {
    format!(
        "미리보기 저장 실패\r\n\
         - 이유: {error}\r\n\
         상태: preview only로 유지합니다.\r\n"
    )
}

pub fn provider_login_transcript(statuses: &[ProviderUiStatus]) -> String {
    let mut transcript = String::from("Provider Login\r\n");
    transcript.push_str("로컬 CLI provider 상태:\r\n");

    for status in statuses {
        if status.available {
            let version = status.version.as_deref().unwrap_or("사용 가능");
            transcript.push_str(&format!(
                " - {}: 사용 가능 ({version})\r\n",
                status.display_name
            ));
        } else {
            transcript.push_str(&format!(" - {}: 찾을 수 없음\r\n", status.display_name));
            transcript.push_str(&format!("   {}\r\n", localized_login_hint(status)));
        }
    }

    if let Some(model) = selected_provider_model(statuses) {
        transcript.push_str(&format!("선택된 모델: {model}\r\n"));
        transcript.push_str(
            "Provider/model 선택은 준비 상태 확인용입니다; preview 생성은 built-in local generator를 사용하며 provider CLI는 호출하지 않습니다.\r\n",
        );
        transcript.push_str(
            "사용 가능한 provider를 모델 선택에서 고르세요. 그런 다음 만들 보드를 입력하고 Enter 또는 설계 생성을 누르세요.\r\n",
        );
    } else {
        transcript.push_str("아직 준비된 로컬 provider가 없습니다.\r\n");
        transcript.push_str("그래도 설계 생성으로 ESP32-S3 preview를 만들 수 있습니다.\r\n");
        transcript.push_str(
            "CLI login은 나중에 해도 됩니다; provider-backed design은 local CLI login을 마친 뒤 Provider Login을 다시 누르세요.\r\n",
        );
        transcript.push_str(
            "지금은 built-in-preview로 계속 진행하고, 만들 보드를 입력한 뒤 Enter 또는 설계 생성을 누르세요.\r\n",
        );
    }

    transcript.push_str("Provider 인증 정보는 ChatPCB3에 저장하지 않습니다.\r\n");
    transcript
}

fn localized_login_hint(status: &ProviderUiStatus) -> String {
    let name = status.display_name.to_ascii_lowercase();
    if name.contains("codex") {
        "Codex CLI를 설치하고 로컬 로그인을 완료한 뒤 이 provider를 사용하세요.".to_string()
    } else if name.contains("claude") {
        "Claude Code를 설치하고 로컬 로그인을 완료한 뒤 이 provider를 사용하세요.".to_string()
    } else if name.contains("gemini") {
        "Gemini CLI를 설치하고 로컬 로그인을 완료한 뒤 이 provider를 사용하세요.".to_string()
    } else {
        status.login_hint.clone()
    }
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
