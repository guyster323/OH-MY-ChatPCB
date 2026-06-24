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
    "Schematic: 만들 보드를 입력한 뒤 Enter. chatpcb3-esp32s3.kicad_sch 미리보기를 생성합니다."
}

pub fn left_tab_status(index: usize) -> &'static str {
    match index {
        0 => initial_left_workspace_status(),
        1 => "PCB Layout: chatpcb3-esp32s3.kicad_pcb 미리보기. 배치/배선은 아직 생성 전입니다.",
        2 => "Validation: ERC/DRC 아직 실행 전. Send design은 prototype-review 증거만 만듭니다.",
        3 => "Manufacturing Preview: Gerber/BOM/CPL 아직 생성 전. JLCPCB 업로드 패키지는 계속 blocked입니다.",
        _ => initial_left_workspace_status(),
    }
}

pub fn left_tab_body(index: usize) -> &'static str {
    match index {
        0 => "Schematic Preview\r\n\
              - 오른쪽 Chat prompt에 만들 보드를 적고 Enter.\r\n\
              - Target: ESP32-S3 USB-C sensor board.\r\n\
              - Nets: USB_D+, USB_D-, 5V, 3V3, GND, I2C_SCL, I2C_SDA.\r\n\
              - Gate: prototype-review, order-ready 아님.",
        1 => "PCB Layout Preview\r\n\
              - 50mm x 50mm Edge.Cuts 보드 외곽선을 preview로 생성합니다.\r\n\
              - Component placement와 Freerouting route data는 아직 생성 전입니다.\r\n\
              - Planned flow: component placement -> DSN export -> Freerouting -> SES import.\r\n\
              - 제조 출력은 DRC 통과 후에만 신뢰할 수 있습니다.",
        2 => "Validation Preview\r\n\
              - ERC는 아직 실행 전입니다.\r\n\
              - DRC는 아직 실행 전입니다.\r\n\
              - KiCad report와 artifact가 생길 때까지 release gate는 prototype-review입니다.",
        3 => "Manufacturing Preview\r\n\
              - Gerber/Drill 파일은 아직 생성 전입니다.\r\n\
              - BOM/CPL preview 파일은 Send design 후 확인용으로 생성되지만 업로드 가능 상태가 아님.\r\n\
              - schematic, layout, ERC, DRC, Gerber, drill, placement-reviewed CPL 증거 전까지 JLCPCB upload는 blocked입니다.\r\n\
              - 실제 주문 전에는 반드시 멈추고 사용자 확인을 받아야 합니다.",
        _ => left_tab_body(0),
    }
}

pub fn initial_pipeline_status() -> &'static str {
    "Ready: 만들 보드 입력 후 Enter. 빈칸=ESP32-S3 example."
}

pub fn example_loaded_pipeline_status() -> &'static str {
    "Example loaded: edit, press Enter, or Send design."
}

pub fn provider_login_pipeline_status(selected_model: Option<&str>) -> String {
    match selected_model {
        Some(model) => format!("Provider detected: {model}; preview still local."),
        None => "No local provider found; built-in preview still works.".to_string(),
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
    "Preview plan queued: schematic -> layout -> DRC -> JLCPCB."
}

pub fn validation_pipeline_status(validation_summary: &str) -> String {
    if validation_summary.contains("ERC: 0 errors, 0 warnings")
        && validation_summary.contains("DRC: 0 errors, 0 warnings, 0 unconnected")
    {
        return "검증 완료: Open PCB/checklist 또는 후속 입력. 아직 prototype-review.".to_string();
    }

    "검증 확인 필요: checklist에서 ERC/DRC 확인. 아직 prototype-review.".to_string()
}

pub fn visible_empty_prompt_pipeline_status(status: &str) -> String {
    if status.contains("검증 완료") {
        return "내장 예시 사용. 검증 완료: Open PCB/checklist. 아직 prototype-review.".to_string();
    }

    format!("내장 예시 사용. {status}")
}

pub fn open_pcb_pipeline_status(opened_with_kicad: bool) -> &'static str {
    if opened_with_kicad {
        "Opened preview PCB in KiCad PCB Editor."
    } else {
        "Opened preview PCB file. Install KiCad 10 if PCB Editor did not open."
    }
}

pub fn open_evidence_pipeline_status() -> &'static str {
    "Opened BEGINNER-NEXT-STEPS.txt for checklist review."
}

pub fn recovered_preview_pipeline_status() -> &'static str {
    "Recovered: 이어서 입력 후 Enter. Open PCB/Review checklist."
}

pub fn example_board_prompt() -> &'static str {
    "USB-C ESP32-S3 온습도 센서 보드, I2C 센서, JLCPCB 조립"
}

pub fn initial_transcript() -> String {
    "Welcome to ChatPCB KiCad Preview\r\n\
     바로 채팅: 만들 보드를 Chat prompt에 적고 Enter.\r\n\
     Provider Login is optional; built-in-preview creates prototype-review evidence, not JLCPCB order-ready files.\r\n"
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
         Preview engine: built-in local generator; provider/model selection is readiness only. No provider CLI is invoked for this preview slice.\r\n\
         다음 행동\r\n\
         - Open PCB 또는 Review checklist로 저장된 preview를 확인하세요.\r\n\
         - order-ready 파일은 실제 KiCad fork 통합과 제조 증거 검토가 필요합니다.\r\n\
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
        "미리보기 저장 완료\r\n\
         - 프로젝트 폴더: {project_dir}\r\n\
         - KiCad preview scaffold: chatpcb3-esp32s3.kicad_pro, chatpcb3-esp32s3.kicad_sch, chatpcb3-esp32s3.kicad_pcb\r\n\
         - 다음 단계: BEGINNER-NEXT-STEPS.txt와 Open PCB/Review checklist 확인 후 chat에서 후속 입력.\r\n\
         - JLCPCB 확인 파일: manufacturing-readiness-preview.txt, jlcpcb-bom-preview.csv, jlcpcb-cpl-preview.csv.\r\n\
         - PCB preview: 50mm x 50mm Edge.Cuts 외곽선만 있음. 배치/배선은 아직 없음.\r\n\
         - Open PCB로 KiCad 10에서 chatpcb3-esp32s3.kicad_pcb를 확인하세요.\r\n\
         - Release evidence: {release_report_file}\r\n\
         Status: prototype-review, order-ready 아님.\r\n"
    )
}

pub fn preview_result_summary_transcript() -> &'static str {
    "결과: 미리보기 저장 완료\r\n\
     - Open PCB 또는 Review checklist로 확인하세요.\r\n\
     - 아직 JLCPCB 주문 금지: prototype-review 상태입니다.\r\n"
}

pub fn preview_workspace_left_status(project_dir: &str) -> String {
    format!("미리보기 저장 완료: {project_dir} | prototype-review, order-ready 아님.")
}

pub fn saved_preview_tab_status(index: usize, project_dir: &str) -> String {
    match index {
        0 => format!(
            "Schematic: 저장된 미리보기 {project_dir}. chatpcb3-esp32s3.kicad_sch를 prototype-review로 확인하세요."
        ),
        1 => format!(
            "PCB Layout: 저장된 미리보기 {project_dir}. chatpcb3-esp32s3.kicad_pcb 50mm x 50mm outline 확인."
        ),
        2 => format!(
            "Validation: 저장된 미리보기 {project_dir}. KiCad ERC/DRC report를 확인하세요; gate는 prototype-review."
        ),
        3 => format!(
            "Manufacturing Preview: 저장된 미리보기 {project_dir}. Gerber/BOM/CPL은 아직 order-ready 아님."
        ),
        _ => saved_preview_tab_status(0, project_dir),
    }
}

pub fn saved_preview_tab_body(index: usize, project_dir: &str) -> String {
    match index {
        0 => format!(
            "미리보기 저장 완료\r\n\
             Schematic\r\n\
             프로젝트 폴더:\r\n\
             {project_dir}\r\n\r\n\
             열 파일:\r\n\
             {project_dir}\\chatpcb3-esp32s3.kicad_sch\r\n\r\n\
             Expected nets:\r\n\
             - USB_D+, USB_D-, 5V, 3V3, GND, I2C_SCL, and I2C_SDA.\r\n\
             - 제조 출력을 믿기 전 KiCad에서 symbol과 연결을 확인하세요.\r\n\r\n\
             Gate: prototype-review, order-ready 아님."
        ),
        1 => format!(
            "PCB Layout\r\n\
             프로젝트 폴더:\r\n\
             {project_dir}\r\n\r\n\
             Open PCB:\r\n\
             {project_dir}\\chatpcb3-esp32s3.kicad_pcb\r\n\r\n\
             현재 preview:\r\n\
             - 50mm x 50mm Edge.Cuts outline.\r\n\
             - 배치와 배선은 아직 preview 단계입니다.\r\n\
             - Open PCB로 KiCad 10에서 저장된 board outline을 확인하세요.\r\n\r\n\
             Gate: prototype-review, order-ready 아님."
        ),
        2 => format!(
            "KiCad ERC/DRC reports\r\n\
             프로젝트 폴더:\r\n\
             {project_dir}\r\n\r\n\
             확인할 report:\r\n\
             - {project_dir}\\kicad-pcb-check.txt\r\n\
             - {project_dir}\\erc-report.json\r\n\
             - {project_dir}\\drc-report.json\r\n\
             - {project_dir}\\kicad-validation-summary.txt\r\n\r\n\
             제조 출력을 믿기 전 validation을 검토해야 합니다.\r\n\
             Gate: prototype-review, order-ready 아님."
        ),
        3 => format!(
            "Manufacturing Preview\r\n\
             프로젝트 폴더:\r\n\
             {project_dir}\r\n\r\n\
             JLCPCB 업로드는 아직 막힌 상태입니다. 먼저 이 preview 파일을 확인하세요:\r\n\
             - {project_dir}\\jlcpcb-bom-preview.csv\r\n\
             - {project_dir}\\jlcpcb-cpl-preview.csv\r\n\
             - {project_dir}\\manufacturing-readiness-preview.txt\r\n\r\n\
             업로드 전 아직 필요한 것:\r\n\
             - Gerber zip\r\n\
             - Drill files\r\n\
             - Placement-reviewed CPL/position file\r\n\
             - Release evidence report\r\n\r\n\
             실제 주문 전에는 앱이 멈추고 사용자 확인을 받아야 합니다.\r\n\
             Gate: prototype-review, order-ready 아님."
        ),
        _ => saved_preview_tab_body(0, project_dir),
    }
}

pub fn preview_workspace_body(project_dir: &str, release_report_file: &str) -> String {
    format!(
        "미리보기 저장 완료\r\n\
         프로젝트 폴더:\r\n\
         {project_dir}\r\n\r\n\
         생성된 파일:\r\n\
         - chatpcb3-esp32s3.kicad_pro\r\n\
         - chatpcb3-esp32s3.kicad_sch\r\n\
         - chatpcb3-esp32s3.kicad_pcb\r\n\
         - sym-lib-table\r\n\
         - fp-lib-table\r\n\
         - prompt.txt\r\n\
         - artifact-manifest.json\r\n\
         - FIRST-RUN-SUMMARY.txt\r\n\
         - BEGINNER-NEXT-STEPS.txt\r\n\
         - jlcpcb-bom-preview.csv\r\n\
         - jlcpcb-cpl-preview.csv\r\n\
         - manufacturing-readiness-preview.txt\r\n\
         - release-evidence-preview.md\r\n\r\n\
         PCB preview:\r\n\
         50mm x 50mm Edge.Cuts 외곽선만 있음. 배치/배선은 아직 없습니다.\r\n\r\n\
         Open PCB로 KiCad 10에서 chatpcb3-esp32s3.kicad_pcb를 확인하세요.\r\n\r\n\
         Review checklist로 BEGINNER-NEXT-STEPS.txt를 읽고 chat에서 후속 입력을 하세요.\r\n\r\n\
         Release evidence:\r\n\
         {release_report_file}\r\n\r\n\
         Gate: prototype-review, order-ready 아님."
    )
}

pub fn preview_workspace_body_with_kicad_check(
    project_dir: &str,
    release_report_file: &str,
    check_report_file: &str,
    check_summary: &str,
) -> String {
    format!(
        "{}\r\n\r\n\
         KiCad CLI check:\r\n\
         {check_summary}\r\n\
         Report:\r\n\
         {check_report_file}",
        preview_workspace_body(project_dir, release_report_file)
    )
}

pub fn preview_workspace_body_with_validation_reports(
    project_dir: &str,
    release_report_file: &str,
    check_report_file: &str,
    check_summary: &str,
    erc_report_file: &str,
    drc_report_file: &str,
    validation_summary_file: &str,
    validation_summary: &str,
) -> String {
    format!(
        "{}\r\n\r\n\
         KiCad ERC/DRC reports:\r\n\
         {validation_summary}\r\n\
         ERC report:\r\n\
         {erc_report_file}\r\n\
         DRC report:\r\n\
         {drc_report_file}\r\n\
         Summary:\r\n\
         {validation_summary_file}",
        preview_workspace_body_with_kicad_check(
            project_dir,
            release_report_file,
            check_report_file,
            check_summary
        )
    )
}

pub fn kicad_cli_check_transcript(check_report_file: &str, check_summary: &str) -> String {
    format!(
        "KiCad CLI check\r\n\
         - {check_summary}\r\n\
         - Report: {check_report_file}\r\n"
    )
}

pub fn erc_drc_validation_transcript(
    erc_report_file: &str,
    drc_report_file: &str,
    validation_summary_file: &str,
    validation_summary: &str,
) -> String {
    format!(
        "KiCad ERC/DRC reports\r\n\
         - {validation_summary}\r\n\
         - ERC report: {erc_report_file}\r\n\
         - DRC report: {drc_report_file}\r\n\
         - Summary: {validation_summary_file}\r\n"
    )
}

pub fn recovered_preview_workspace_left_status(project_dir: &str) -> String {
    format!("이전 미리보기 발견: {project_dir} | prototype-review, order-ready 아님.")
}

pub fn recovered_preview_workspace_body(project_dir: &str) -> String {
    let release_report_file = format!("{project_dir}\\release-evidence-preview.md");

    format!(
        "이전 미리보기 발견\r\n\
         프로젝트 폴더:\r\n\
         {project_dir}\r\n\r\n\
         Review checklist로 저장 파일을 확인한 뒤 다음 설계를 보내세요.\r\n\
         Open PCB로 KiCad 10에서 저장된 board outline을 확인하세요.\r\n\r\n\
         예상 파일:\r\n\
         - prompt.txt\r\n\
         - artifact-manifest.json\r\n\
         - FIRST-RUN-SUMMARY.txt\r\n\
         - BEGINNER-NEXT-STEPS.txt\r\n\
         - release-evidence-preview.md\r\n\
         - kicad-pcb-check.txt\r\n\
         - erc-report.json\r\n\
         - drc-report.json\r\n\
         - kicad-validation-summary.txt\r\n\r\n\
         - jlcpcb-bom-preview.csv\r\n\
         - jlcpcb-cpl-preview.csv\r\n\
         - manufacturing-readiness-preview.txt\r\n\
         \r\n\
         Release evidence:\r\n\
         {release_report_file}\r\n\r\n\
         Gate: prototype-review, order-ready 아님."
    )
}

pub fn recovered_preview_workspace_transcript(project_dir: &str) -> String {
    format!(
        "이전 미리보기 발견\r\n\
         - 프로젝트 폴더: {project_dir}\r\n\
         - Review checklist로 저장 파일을 확인하세요.\r\n\
         - Open PCB로 KiCad 10에서 저장된 board outline을 확인하세요.\r\n\
         Status: prototype-review, order-ready 아님.\r\n"
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
            transcript.push_str(&format!("   {}\r\n", status.login_hint));
        }
    }

    if let Some(model) = selected_provider_model(statuses) {
        transcript.push_str(&format!("Selected model: {model}\r\n"));
        transcript.push_str(
            "Provider/model selection is readiness only; preview generation still uses the built-in local generator. No provider CLI is invoked for this preview slice.\r\n",
        );
        transcript.push_str(
            "Pick an available provider in the model selector, then type a board idea and press Enter or click Send design.\r\n",
        );
    } else {
        transcript.push_str("No local provider is ready yet.\r\n");
        transcript.push_str(
            "You can still press Send design to create the built-in ESP32-S3 preview.\r\n",
        );
        transcript.push_str(
            "Provider-backed design will require CLI login later; complete a local CLI login, then click Provider Login again.\r\n",
        );
        transcript.push_str(
            "Use built-in-preview now, then type a board idea and press Enter or click Send design.\r\n",
        );
    }

    transcript.push_str("Provider credentials are not stored in ChatPCB3.\r\n");
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
