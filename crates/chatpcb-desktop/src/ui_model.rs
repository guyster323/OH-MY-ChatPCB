use serde::Serialize;
use std::{fs, path::Path};

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
    pub live_schematic_visible_in_left_pane: bool,
    pub chat_send_updates_live_schematic: bool,
    pub live_schematic_shows_apply_result: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderUiModel {
    pub id: String,
    pub display_name: String,
    pub cli_model: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderUiStatus {
    pub display_name: String,
    pub available: bool,
    pub logged_in: bool,
    pub version: Option<String>,
    pub models: Vec<ProviderUiModel>,
    pub login_hint: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedPreviewSummary {
    pub prompt: String,
    pub has_h2_sensor: bool,
    pub has_touch_display: bool,
    pub quality_summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedSchematicRenderModel {
    pub source_file: String,
    pub references: Vec<String>,
    pub values: Vec<String>,
    pub nets: Vec<String>,
    pub pin_names: Vec<String>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PartSelectionReviewRow {
    designator: String,
    function: String,
    mpn: String,
    lcsc: String,
    selection_basis: String,
    review_risk: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CircuitReviewRow {
    area: String,
    evidence: String,
    review_risk: String,
}

impl SavedSchematicRenderModel {
    pub fn has_reference(&self, reference: &str) -> bool {
        self.references
            .iter()
            .any(|candidate| candidate == reference)
    }

    pub fn has_net(&self, net: &str) -> bool {
        self.nets.iter().any(|candidate| candidate == net)
    }
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
        live_schematic_visible_in_left_pane: true,
        chat_send_updates_live_schematic: true,
        live_schematic_shows_apply_result: true,
    }
}

pub fn initial_left_workspace_status() -> &'static str {
    "회로도: 만들 보드를 입력한 뒤 Enter. 회로 설계 검토 미리보기를 표시합니다."
}

pub fn left_tab_status(index: usize) -> &'static str {
    match index {
        0 => initial_left_workspace_status(),
        1 => "블록도: 전원, MCU, 센서 연결을 초보자용 흐름으로 표시합니다.",
        2 => "PCB 레이아웃: 보드 외곽선 미리보기. 배치/배선은 아직 생성 전입니다.",
        3 => "검증: ERC/DRC 아직 실행 전. 설계 생성은 prototype-review 증거만 만듭니다.",
        4 => "제조 미리보기: Gerber/BOM/CPL 아직 생성 전. JLCPCB 주문 준비 전입니다.",
        _ => initial_left_workspace_status(),
    }
}

pub fn left_tab_body(index: usize) -> &'static str {
    match index {
        0 => INITIAL_LIVE_SCHEMATIC_BODY,
        1 => INITIAL_BLOCK_DIAGRAM_BODY,
        2 => {
            "PCB 레이아웃 미리보기\r\n\
              - 50mm x 50mm 보드 외곽선을 미리보기로 생성합니다.\r\n\
              - 부품 배치와 배선은 아직 생성 전입니다.\r\n\
              - 다음 단계: 부품 배치, 자동 배선, KiCad 검증.\r\n\
              - 제조 출력은 DRC 통과 후에만 신뢰할 수 있습니다."
        }
        3 => {
            "검증 미리보기\r\n\
              - ERC는 아직 실행 전입니다.\r\n\
              - DRC는 아직 실행 전입니다.\r\n\
              - 검토 목록에서 KiCad 검토 자료를 확인할 때까지 prototype-review입니다."
        }
        4 => {
            "제조 미리보기\r\n\
              - Gerber/Drill 파일은 아직 생성 전입니다.\r\n\
              - BOM/CPL 미리보기는 설계 생성 후 확인용으로만 만듭니다.\r\n\
              - 검토 목록에서 회로, PCB, 제조 자료를 확인하기 전까지 주문 준비 전입니다.\r\n\
              - 실제 주문 전에는 반드시 멈추고 사용자 확인을 받아야 합니다."
        }
        _ => left_tab_body(0),
    }
}

const INITIAL_LIVE_SCHEMATIC_BODY: &str = "KiCad 회로도\r\n\
KICAD_SCHEMATIC_VIEW\r\n\
파일: chatpcb3-esp32s3.kicad_sch\r\n\
채팅 입력: 오른쪽 채팅 입력칸에 만들 보드를 적고 Enter.\r\n\
Agent 답변: 회로 설계 검토를 시작할 준비가 되어 있습니다.\r\n\
\r\n\
회로 설계 검토\r\n\
- USB-C: J1, CC1/CC2 5.1k, VBUS fuse, USB ESD 필요\r\n\
- 전원: 3V3 LDO, 입출력 커패시터, ESP32-S3 디커플링 필요\r\n\
- MCU: ESP_EN, BOOT 스트랩, USB D+/D- 연결 검토 필요\r\n\
- I2C: I2C 풀업, 센서 디커플링, BME280 전원 검토 필요\r\n\
- 소자 선택: ESP32-S3-WROOM-1, ME6211, BME280, 0603 수동소자 후보\r\n\
\r\n\
남은 검토: 채팅 입력 후 ERC/DRC 결과와 KiCad 파일을 검토해야 합니다.\r\n\
적용 결과: 입력 대기. 현재 prototype-review, 주문 준비 전.";

const INITIAL_BLOCK_DIAGRAM_BODY: &str = "블록도\r\n\
채팅 입력: 오른쪽 채팅 입력칸에 만들 보드를 적고 Enter.\r\n\
Agent 답변: 입력을 회로 블록으로 즉시 반영할 준비가 되어 있습니다.\r\n\
\r\n\
[USB-C] -- +5V --> [REG 3V3] -- +3V3 --> [ESP32-S3]\r\n\
   |                         |                 |\r\n\
  GND ---------------------- GND -------------- GND\r\n\
                                             I2C SCL/SDA\r\n\
                                                |\r\n\
                                        [I2C Sensor]\r\n\
\r\n\
적용 결과: 입력 대기. 현재 prototype-review, 주문 준비 전.";

pub fn live_schematic_body(prompt: &str, apply_result: &str) -> String {
    let prompt = if prompt.trim().is_empty() {
        example_board_prompt()
    } else {
        prompt.trim()
    };
    let sensor_label = live_sensor_label(prompt);
    let display_line = if prompt_mentions_touch_display(prompt) {
        "- 표시장치: DS1 Touch Display, ST7789V/XPT2046 SPI 표시 인터페이스 검토 항목 포함\r\n"
    } else {
        ""
    };

    format!(
        "KiCad 회로도\r\n\
         KICAD_SCHEMATIC_VIEW\r\n\
         파일: chatpcb3-esp32s3.kicad_sch\r\n\
         채팅 입력: {prompt}\r\n\
         Agent 답변: 회로 설계 검토와 소자 선택을 반영했습니다.\r\n\
         \r\n\
         회로 설계 검토\r\n\
         - USB-C: J1, CC1/CC2 5.1k, VBUS fuse, USB ESD 포함\r\n\
         - 전원: 3V3 LDO, 입출력 커패시터, ESP32-S3 디커플링 포함\r\n\
         - MCU: ESP_EN, BOOT 스트랩, USB D+/D- 검토 항목 포함\r\n\
         - I2C: I2C 풀업, {sensor_label}, 센서 디커플링 포함\r\n\
         {display_line}\
         - 소자 선택: ESP32-S3-WROOM-1, ME6211, BME280, 0603 수동소자 후보\r\n\
         남은 검토: KiCad ERC/DRC zero-finding 증거와 사람 검토 필요\r\n\
         적용 결과: {apply_result}. 검토 목록과 KiCad preview에 반영됨.\r\n\
         상태: prototype-review, 주문 준비 전."
    )
}

pub fn live_block_diagram_body(prompt: &str, apply_result: &str) -> String {
    let prompt = if prompt.trim().is_empty() {
        example_board_prompt()
    } else {
        prompt.trim()
    };
    let sensor_label = live_sensor_label(prompt);
    let display_line = if prompt_mentions_touch_display(prompt) {
        "                                       SPI TFT/Touch --> [Touch Display]\r\n"
    } else {
        ""
    };

    format!(
        "블록도\r\n\
         채팅 입력: {prompt}\r\n\
         Agent 답변: ESP32-S3 전원, 센서, 표시 장치를 회로 블록에 반영했습니다.\r\n\
         \r\n\
         [USB-C] -- +5V --> [REG 3V3] -- +3V3 --> [ESP32-S3]\r\n\
            |                         |                 |\r\n\
           GND ---------------------- GND -------------- GND\r\n\
                                              I2C SCL/SDA\r\n\
                                                 |\r\n\
                                         [{sensor_label}]\r\n\
         {display_line}\
         적용 결과: {apply_result}. 검토 목록과 KiCad preview에 반영됨.\r\n\
         상태: prototype-review, 주문 준비 전."
    )
}

fn live_sensor_label(prompt: &str) -> &'static str {
    let prompt = prompt.to_ascii_lowercase();
    if prompt.contains("h2") || prompt.contains("hydrogen") || prompt.contains("수소") {
        "H2 Sensor"
    } else if prompt.contains("온습도")
        || prompt.contains("humidity")
        || prompt.contains("temperature")
    {
        "Temp/Humidity Sensor"
    } else if prompt.contains("조도") || prompt.contains("light") {
        "Light Sensor"
    } else if prompt.contains("압력") || prompt.contains("pressure") {
        "Pressure Sensor"
    } else {
        "I2C Sensor"
    }
}

fn prompt_mentions_touch_display(prompt: &str) -> bool {
    let prompt = prompt.to_ascii_lowercase();
    prompt.contains("touch")
        || prompt.contains("display")
        || prompt.contains("터치")
        || prompt.contains("디스플레이")
}

pub fn initial_pipeline_status() -> &'static str {
    "준비: 만들 보드 입력 후 Enter. 빈칸=ESP32-S3 예시."
}

pub fn example_loaded_pipeline_status() -> &'static str {
    "예시 입력됨: 고치고 Enter 또는 설계 생성."
}

pub fn provider_login_pipeline_status(
    selected_model: Option<&str>,
    statuses: &[ProviderUiStatus],
) -> String {
    match selected_model {
        Some(model) => format!(
            "Provider 감지: {}; 로그인됨, 바로 사용 가능.",
            provider_model_display_name_for_statuses(model, statuses)
        ),
        None => "로컬 도구 없음; 내장 미리보기는 계속 사용 가능합니다.".to_string(),
    }
}

pub fn model_selector_items() -> [&'static str; 4] {
    [
        "built-in-preview",
        "codex:auto",
        "claude:auto",
        "antigravity:auto",
    ]
}

pub fn model_selector_display_items() -> [&'static str; 4] {
    [
        "내장 미리보기",
        "Codex 자동",
        "Claude Code 자동",
        "Antigravity 자동",
    ]
}

pub fn provider_model_display_name(model: &str) -> &str {
    match model {
        "built-in-preview" => "내장 미리보기",
        "codex:auto" => "Codex 자동",
        "claude:auto" => "Claude Code 자동",
        "antigravity:auto" => "Antigravity 자동",
        _ => model,
    }
}

pub fn provider_model_display_name_for_statuses<'a>(
    model: &'a str,
    statuses: &'a [ProviderUiStatus],
) -> &'a str {
    statuses
        .iter()
        .flat_map(|status| status.models.iter())
        .find(|candidate| candidate.id == model)
        .map(|candidate| candidate.display_name.as_str())
        .unwrap_or_else(|| provider_model_display_name(model))
}

pub fn model_selector_index(model: &str) -> Option<usize> {
    model_selector_items()
        .iter()
        .position(|item| *item == model)
}

pub fn model_selector_items_for_statuses(statuses: &[ProviderUiStatus]) -> Vec<String> {
    let mut items = vec!["built-in-preview".to_string()];
    items.extend(
        statuses
            .iter()
            .filter(|status| status.available && status.logged_in)
            .flat_map(|status| status.models.iter().map(|model| model.id.clone())),
    );
    items
}

pub fn model_selector_display_items_for_statuses(statuses: &[ProviderUiStatus]) -> Vec<String> {
    let mut items = vec!["내장 미리보기".to_string()];
    items.extend(
        statuses
            .iter()
            .filter(|status| status.available && status.logged_in)
            .flat_map(|status| status.models.iter().map(|model| model.display_name.clone())),
    );
    items
}

pub fn model_selector_index_for_statuses(
    model: &str,
    statuses: &[ProviderUiStatus],
) -> Option<usize> {
    model_selector_items_for_statuses(statuses)
        .iter()
        .position(|item| item == model)
}

pub fn selected_model_for_statuses<'a>(statuses: &'a [ProviderUiStatus]) -> &'a str {
    selected_provider_model(statuses).unwrap_or("built-in-preview")
}

pub fn design_pipeline_status() -> &'static str {
    "미리보기 계획: 회로도 -> PCB -> 검증 -> JLCPCB 검토."
}

pub fn validation_pipeline_status(validation_summary: &str) -> String {
    if validation_summary.contains("90점 품질 게이트 통과")
        || validation_summary.contains("ReleaseCandidate")
        || (validation_summary.contains("ERC: 오류 0개, 경고 0개")
            && validation_summary.contains("DRC: 오류 0개, 경고 0개, 미연결 0개"))
    {
        return "검증 완료: 90점 gate 통과. 검토 목록/후속 입력.".to_string();
    }

    "검증 확인 필요: checklist에서 ERC/DRC 확인. prototype-review.".to_string()
}

pub fn visible_empty_prompt_pipeline_status(status: &str) -> String {
    if status.contains("검증 완료") {
        return "내장 예시 사용. 검증 완료: 90점 gate 통과. 검토 목록.".to_string();
    }

    format!("내장 예시 사용. {status}")
}

pub fn open_pcb_pipeline_status(opened_with_kicad: bool) -> &'static str {
    if opened_with_kicad {
        "KiCad PCB Editor에서 미리보기 PCB를 열었습니다."
    } else {
        "미리보기 PCB 파일을 열었습니다. PCB Editor가 열리지 않았다면 KiCad 10을 설치하세요."
    }
}

pub fn open_kicad_editor_pipeline_status(opened_with_kicad: bool) -> &'static str {
    if opened_with_kicad {
        "실제 KiCad 편집기에서 저장된 회로도/프로젝트를 열었습니다."
    } else {
        "저장된 KiCad 회로도 파일을 열었습니다. KiCad 앱이 열리지 않았다면 KiCad 10 설치/연결을 확인하세요."
    }
}

pub fn open_evidence_pipeline_status() -> &'static str {
    "검토 목록을 열었습니다."
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
     Provider Login은 선택 사항입니다. 내장 미리보기로 prototype-review 증거를 만들며 JLCPCB 주문 준비 파일은 아닙니다.\r\n"
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
         - 회로도, PCB 배치/배선, KiCad 검증, JLCPCB 검토 자료를 만들었습니다.\r\n\
         - design-quality-report에서 90점 게이트와 ERC/DRC blocker를 확인합니다.\r\n\
         미리보기 생성: 앱 안의 기본 생성기를 사용했습니다. Provider 선택은 로그인 상태와 모델 확인용입니다. 이 미리보기에서는 Codex, Claude Code, Antigravity 로컬 도구를 대신 실행하지 않습니다.\r\n\
         다음 행동\r\n\
         - PCB 열기 또는 검토 목록으로 저장된 미리보기를 확인하세요.\r\n\
         - blocker가 없어도 실제 주문 전에는 제조 증거를 사람이 확인해야 합니다.\r\n\
         상태: 미리보기 단계, 아직 주문 준비 전입니다.\r\n"
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
         - PCB: 50mm x 50mm 보드에 풋프린트, 패드, 주요 배선이 있습니다.\r\n\
         - 품질 리포트: design-quality-report.md에서 90점 게이트와 ERC/DRC blocker를 확인하세요.\r\n\
         - PCB 열기로 KiCad 10에서 보드를 확인하세요.\r\n\
         - 바꿀 점을 채팅 입력칸에 적고 Enter로 후속 입력을 보내세요.\r\n\
         상태: prototype-review, 주문 준비 전.\r\n"
    )
}

pub fn preview_result_summary_transcript() -> &'static str {
    "결과: 미리보기 저장 완료\r\n\
     - PCB 열기 또는 검토 목록에서 품질 리포트를 확인하세요.\r\n\
     - 아직 JLCPCB 주문 금지: prototype-review 상태입니다.\r\n"
}

pub fn preview_workspace_left_status(_project_dir: &str) -> String {
    "미리보기 저장 완료 | 품질 리포트 90점 게이트 확인 | prototype-review, 주문 준비 전."
        .to_string()
}

pub fn saved_preview_tab_status(index: usize, _project_dir: &str) -> String {
    match index {
        0 => {
            "회로도: 저장된 미리보기. 검토 목록에서 KiCad 회로도 작성 과정 확인; prototype-review."
                .to_string()
        }
        1 => "블록도: 저장된 전원/MCU/센서 흐름. 초보자용 구조 확인.".to_string(),
        2 => "PCB 레이아웃: 저장된 미리보기. PCB 열기로 배치/배선과 50mm x 50mm 외곽선 확인."
            .to_string(),
        3 => "검증: 저장된 미리보기. 검토 목록에서 KiCad ERC/DRC 결과 확인; prototype-review."
            .to_string(),
        4 => "제조 미리보기: 저장된 미리보기. Gerber/Drill/BOM/CPL과 품질 리포트 확인.".to_string(),
        _ => saved_preview_tab_status(0, _project_dir),
    }
}

pub fn saved_preview_summary(project_dir: &str) -> SavedPreviewSummary {
    let root = Path::new(project_dir);
    let prompt = read_workspace_file(root, "prompt.txt")
        .filter(|body| !body.trim().is_empty())
        .unwrap_or_else(|| example_board_prompt().to_string());
    let evidence = saved_workspace_evidence_text(root, &prompt);
    let evidence_lower = evidence.to_ascii_lowercase();
    let has_h2_sensor = evidence_lower.contains("h2 sensor")
        || evidence_lower.contains("h2 gas")
        || evidence_lower.contains("h2_sense")
        || evidence.contains("수소");
    let has_touch_display = evidence_lower.contains("touch display")
        || evidence_lower.contains("touch display connector")
        || evidence_lower.contains("ds1 touch")
        || evidence.contains("터치")
        || evidence.contains("디스플레이");

    SavedPreviewSummary {
        prompt: prompt.trim().to_string(),
        has_h2_sensor,
        has_touch_display,
        quality_summary: saved_quality_summary(root),
    }
}

pub fn saved_schematic_render_model(project_dir: &str) -> SavedSchematicRenderModel {
    let root = Path::new(project_dir);
    let source_file = "chatpcb3-esp32s3.kicad_sch";
    let body = read_workspace_file(root, source_file).unwrap_or_default();
    let mut model = SavedSchematicRenderModel {
        source_file: source_file.to_string(),
        references: Vec::new(),
        values: Vec::new(),
        nets: Vec::new(),
        pin_names: Vec::new(),
        notes: Vec::new(),
    };

    let mut lib_symbols_depth = 0usize;
    for line in body.lines().map(str::trim) {
        if lib_symbols_depth > 0 || line.starts_with("(lib_symbols") {
            if let Some(pin_name) = symbol_pin_name(line) {
                push_unique(&mut model.pin_names, &pin_name);
            }
            lib_symbols_depth = s_expression_depth_after_line(lib_symbols_depth, line);
            continue;
        }

        let fields = quoted_fields(line);
        if fields.is_empty() {
            continue;
        }

        if line.starts_with("(property ") && fields.first().map(String::as_str) == Some("Reference")
        {
            if let Some(reference) = fields.get(1) {
                push_unique(&mut model.references, reference);
            }
        } else if line.starts_with("(property ")
            && fields.first().map(String::as_str) == Some("Value")
        {
            if let Some(value) = fields.get(1) {
                push_unique(&mut model.values, value);
            }
        } else if line.starts_with("(label ") || line.starts_with("(global_label ") {
            if let Some(net) = fields.first() {
                push_unique(&mut model.nets, net);
            }
        } else if line.starts_with("(text ") {
            if let Some(note) = fields.first() {
                push_unique(&mut model.notes, note);
            }
        }
    }

    model
}

fn symbol_pin_name(line: &str) -> Option<String> {
    if !line.starts_with("(pin ") {
        return None;
    }

    let fields = quoted_fields(line);
    fields
        .windows(2)
        .find(|pair| pair.first().map(String::as_str) == Some("name"))
        .and_then(|pair| pair.get(1))
        .cloned()
        .or_else(|| fields.first().cloned())
}

fn s_expression_depth_after_line(current_depth: usize, line: &str) -> usize {
    let open_count = line.chars().filter(|candidate| *candidate == '(').count();
    let close_count = line.chars().filter(|candidate| *candidate == ')').count();

    current_depth
        .saturating_add(open_count)
        .saturating_sub(close_count)
}

fn saved_workspace_evidence_text(root: &Path, prompt: &str) -> String {
    let mut evidence = prompt.to_string();
    for relative in [
        "chat-to-circuit-trace.md",
        "part-selection-review.md",
        "chatpcb3-esp32s3.kicad_sch",
        "chatpcb3-esp32s3.kicad_pcb",
        "visual-review/schematic-review.svg",
        "visual-review/pcb-review.svg",
    ] {
        if let Some(body) = read_workspace_file(root, relative) {
            evidence.push('\n');
            evidence.push_str(&body);
        }
    }
    evidence
}

fn quoted_fields(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quote = false;
    let mut escaped = false;

    for ch in line.chars() {
        if in_quote {
            if escaped {
                current.push(ch);
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                fields.push(std::mem::take(&mut current));
                in_quote = false;
            } else {
                current.push(ch);
            }
        } else if ch == '"' {
            in_quote = true;
        }
    }

    fields
}

fn push_unique(values: &mut Vec<String>, value: &str) {
    if !value.trim().is_empty() && !values.iter().any(|existing| existing == value) {
        values.push(value.to_string());
    }
}

fn read_workspace_file(root: &Path, relative: &str) -> Option<String> {
    fs::read_to_string(root.join(relative)).ok()
}

fn saved_quality_summary(root: &Path) -> String {
    let report = read_workspace_file(root, "design-quality-report.md");
    let raw_total = report
        .as_deref()
        .and_then(|body| body.lines().find(|line| line.starts_with("Total score:")))
        .unwrap_or("Total score: pending");
    let level = report
        .as_deref()
        .and_then(|body| body.lines().find(|line| line.starts_with("Level:")))
        .unwrap_or("Level: pending");
    let order_readiness = report
        .as_deref()
        .and_then(|body| {
            body.lines()
                .find(|line| line.starts_with("Order readiness:"))
        })
        .unwrap_or("Order readiness: pending");
    let total = if order_readiness.contains("BLOCKED") {
        "Design score: <=90/100 until human signoff"
    } else {
        raw_total
    };
    let required_design_items = report
        .as_deref()
        .and_then(|body| {
            body.lines()
                .map(str::trim)
                .find(|line| line.starts_with("- required design items:"))
        })
        .map(|line| line.trim_start_matches("- "))
        .unwrap_or("required design items: pending");
    let circuit_review_risk_rationale = report
        .as_deref()
        .and_then(|body| {
            body.lines()
                .map(str::trim)
                .find(|line| line.starts_with("- circuit review risk-rationale findings:"))
        })
        .map(|line| line.trim_start_matches("- "))
        .unwrap_or("circuit review risk-rationale findings: pending");
    let part_selection_risk_rationale = report
        .as_deref()
        .and_then(|body| {
            body.lines()
                .map(str::trim)
                .find(|line| line.starts_with("- part selection risk-rationale groups:"))
        })
        .map(|line| line.trim_start_matches("- "))
        .unwrap_or("part selection risk-rationale groups: pending");
    let prompt_specific_selection_blockers = report
        .as_deref()
        .and_then(|body| {
            body.lines()
                .map(str::trim)
                .find(|line| line.starts_with("- prompt-specific selection blockers:"))
        })
        .map(|line| line.trim_start_matches("- "))
        .unwrap_or("prompt-specific selection blockers: pending");

    format!(
        "{total} | Target score: 90 | {level} | {order_readiness} | {required_design_items} | {circuit_review_risk_rationale} | {part_selection_risk_rationale} | {prompt_specific_selection_blockers}"
    )
}

pub fn saved_part_selection_review_canvas_lines(project_dir: &str, max_rows: usize) -> Vec<String> {
    let root = Path::new(project_dir);
    let Some(review) = read_workspace_file(root, "part-selection-review.md") else {
        return Vec::new();
    };

    let mut rows = parse_part_selection_review_rows(&review);
    rows.sort_by_key(|row| part_selection_canvas_priority(&row.designator));

    rows.into_iter()
        .take(max_rows)
        .flat_map(|row| {
            let heading = format!(
                "{} {} | MPN {} | LCSC {}",
                row.designator,
                compact_canvas_text(&row.function, 34),
                compact_canvas_text(&row.mpn, 34),
                row.lcsc
            );
            let basis_risk = format!(
                "  basis: {} | risk: {}",
                compact_canvas_text(&row.selection_basis, 42),
                compact_canvas_text(&row.review_risk, 42)
            );
            [heading, basis_risk]
        })
        .collect()
}

fn part_selection_canvas_priority(designator: &str) -> u8 {
    if designator == "U5" || designator == "DS1" || designator == "R7,R8" || designator == "C6" {
        0
    } else {
        1
    }
}

fn compact_canvas_text(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }

    let keep = max_chars.saturating_sub(3);
    let mut shortened: String = value.chars().take(keep).collect();
    shortened.push_str("...");
    shortened
}

fn part_selection_review_summary(root: &Path, max_rows: usize) -> String {
    let Some(review) = read_workspace_file(root, "part-selection-review.md") else {
        return String::new();
    };
    let rows = parse_part_selection_review_rows(&review);
    if rows.is_empty() {
        return String::new();
    }

    let mut summary = String::from("부품 선정 근거\r\n");
    for row in rows.into_iter().take(max_rows) {
        summary.push_str(&format!(
            "- {} {} | MPN: {} | LCSC: {} | 근거: {} | 리스크: {}\r\n",
            row.designator, row.function, row.mpn, row.lcsc, row.selection_basis, row.review_risk
        ));
    }
    summary
}

fn circuit_review_summary(root: &Path, max_rows: usize) -> String {
    let Some(review) = read_workspace_file(root, "circuit-review-findings.md") else {
        return String::new();
    };
    let mut rows = parse_circuit_review_rows(&review);
    if rows.is_empty() {
        return String::new();
    }

    rows.sort_by_key(|row| circuit_review_priority(&row.area));

    let mut summary = String::from("회로 적정성 근거\r\n");
    for row in rows.into_iter().take(max_rows) {
        summary.push_str(&format!(
            "- {}: {} | 리스크: {}\r\n",
            row.area, row.evidence, row.review_risk
        ));
    }
    summary
}

fn circuit_review_priority(area: &str) -> u8 {
    if area.contains("H2") || area.contains("Touch") || area.contains("display") {
        0
    } else {
        1
    }
}

fn parse_part_selection_review_rows(review: &str) -> Vec<PartSelectionReviewRow> {
    review
        .lines()
        .filter_map(|line| {
            let cells = markdown_table_cells(line);
            if cells.len() < 8
                || cells[0] == "Designator"
                || cells.iter().all(|cell| cell.chars().all(|ch| ch == '-'))
            {
                return None;
            }

            Some(PartSelectionReviewRow {
                designator: cells[0].clone(),
                function: cells[1].clone(),
                mpn: cells[2].clone(),
                lcsc: cells[3].clone(),
                selection_basis: cells[6].clone(),
                review_risk: cells[7].clone(),
            })
        })
        .collect()
}

fn parse_circuit_review_rows(review: &str) -> Vec<CircuitReviewRow> {
    review
        .lines()
        .filter_map(|line| {
            let cells = markdown_table_cells(line);
            if cells.len() < 4
                || cells[0] == "Area"
                || cells.iter().all(|cell| cell.chars().all(|ch| ch == '-'))
            {
                return None;
            }

            Some(CircuitReviewRow {
                area: cells[0].clone(),
                evidence: cells[2].clone(),
                review_risk: cells[3].clone(),
            })
        })
        .collect()
}

fn markdown_table_cells(line: &str) -> Vec<String> {
    let trimmed = line.trim();
    if !trimmed.starts_with('|') || !trimmed.ends_with('|') {
        return Vec::new();
    }

    trimmed
        .trim_matches('|')
        .split('|')
        .map(|cell| cell.trim().replace("\\|", "|"))
        .collect()
}

pub fn saved_preview_tab_body(index: usize, project_dir: &str) -> String {
    let summary = saved_preview_summary(project_dir);
    let root = Path::new(project_dir);
    match index {
        0 => {
            let sensor_line = if summary.has_h2_sensor {
                "- H2: U5 1x4 헤더에 수동 장착 MQ-8 analog module 연결, 5V heater, H2_AOUT_RAW, R7/R8 divider, C6 filter, H2_ADC 검토 포함\r\n"
            } else {
                "- I2C: I2C 풀업, BME280 I2C sensor, 센서 디커플링 포함\r\n"
            };
            let display_line = if summary.has_touch_display {
                "- 표시장치: DS1 1x12 헤더에 수동 장착 Waveshare 2.8inch TFT Touch Shield 연결, ST7789V LCD, XPT2046 touch, SPI 핀맵 검토 포함\r\n"
            } else {
                ""
            };
            let part_line = if summary.has_h2_sensor || summary.has_touch_display {
                "- 소자 선택: JLCPCB BOM은 U5/DS1 헤더와 수동소자를 실장하고, MQ-8/Waveshare 모듈은 수동 장착으로 분리\r\n"
            } else {
                "- 소자 선택: ESP32-S3-WROOM-1, ME6211, BME280, 0603 수동소자 후보\r\n"
            };
            let part_selection_summary = part_selection_review_summary(root, 3);
            let circuit_review_summary = circuit_review_summary(root, 2);
            format!(
                "KiCad 회로도\r\n\
                 KICAD_SCHEMATIC_VIEW\r\n\
                 SAVED_KICAD_EVIDENCE_VIEW\r\n\
                 파일: chatpcb3-esp32s3.kicad_sch\r\n\
                 검토 그림: visual-review/schematic-review.svg\r\n\
                 품질 리포트: design-quality-report.md\r\n\
                 요구 추적: chat-to-circuit-trace.md\r\n\
                 품질 요약: {quality_summary}\r\n\
                 채팅 입력: {}\r\n\
                 Agent 답변: 저장된 KiCad 산출물 기반으로 회로 설계 검토와 소자 선택을 표시합니다.\r\n\
                 \r\n\
                 회로 설계 검토\r\n\
                 - USB-C: J1, CC1/CC2 5.1k, VBUS fuse, USB ESD 포함\r\n\
                 - 전원: 3V3 LDO, 입출력 커패시터, ESP32-S3 디커플링 포함\r\n\
                 - MCU: ESP_EN, BOOT 스트랩, USB D+/D- 검토 항목 포함\r\n\
                 {sensor_line}\
                 {display_line}\
                 {part_line}\
                 {circuit_review_summary}\
                 {part_selection_summary}\
                 남은 검토: 검토 목록에서 schematic-review.svg와 design-quality-report.md 확인\r\n\
                 적용 결과: 저장된 KiCad 산출물 기반. 검토 목록에서 저장 위치 확인.\r\n\
                 상태: prototype-review, 주문 준비 전.",
                summary.prompt,
                quality_summary = summary.quality_summary,
                sensor_line = sensor_line,
                display_line = display_line,
                part_line = part_line,
                circuit_review_summary = circuit_review_summary,
                part_selection_summary = part_selection_summary
            )
        }
        1 => live_block_diagram_body(
            &summary.prompt,
            "저장된 블록도 미리보기. 검토 목록에서 저장 위치 확인",
        ),
        2 => {
            let h2_line = if summary.has_h2_sensor {
                "- U5 H2 module interface header footprint, R7/R8 H2 ADC divider, C6 filter 검토 배치가 있습니다.\r\n"
            } else {
                ""
            };
            let touch_line = if summary.has_touch_display {
                "- DS1 touch-display interface header footprint와 ST7789V/XPT2046 SPI 핀맵 검토 배치가 있습니다.\r\n"
            } else {
                ""
            };
            format!(
                "PCB 레이아웃\r\n\
                 현재 미리보기:\r\n\
                 - 50mm x 50mm 보드 외곽선.\r\n\
                 - ESP32-S3, USB-C, 전원, I2C 센서 풋프린트와 주요 배선이 있습니다.\r\n\
                 {h2_line}\
                 {touch_line}\
                 - 검토 그림: visual-review/pcb-review.svg\r\n\
                 - PCB 열기로 KiCad 10에서 저장된 보드를 확인하세요.\r\n\r\n\
                 상태: prototype-review, 주문 준비 전."
            )
        }
        3 => {
            let circuit_review_summary = circuit_review_summary(root, 4);
            format!(
                "KiCad ERC/DRC 검증\r\n\
                 - 품질 요약: {quality_summary}\r\n\
                 {circuit_review_summary}\
                 - 개선 액션: design-quality-report.md의 Improvement Actions에서 다음 검증/수정 순서를 확인하세요.\r\n\
                 - order gate: 점수가 90점 이상이어도 사람 제조 사인오프 전까지 차단됩니다.\r\n\
                 - 검토 목록에서 KiCad 확인, ERC/DRC 요약, 자세한 검토 자료를 확인하세요.\r\n\
                 - 회로 적정성은 전원, USB-C, ESP32-S3 부트, I2C 검토까지 함께 확인합니다.\r\n\
                 - PCB 열기로 저장된 보드 외곽선을 직접 열어볼 수 있습니다.\r\n\
                 제조 출력을 믿기 전 validation을 검토해야 합니다.\r\n\
                 상태: prototype-review, 주문 준비 전.",
                quality_summary = summary.quality_summary,
                circuit_review_summary = circuit_review_summary
            )
        }
        4 => {
            let option_lines = if summary.has_h2_sensor || summary.has_touch_display {
                format!(
                    "{}{}",
                    if summary.has_h2_sensor {
                        "- MQ-8 analog H2 module: JLCPCB BOM에는 넣지 않고 U5 헤더에 수동 장착, 5V heater 전류/H2_ADC 보정/안전 한계 검토 필요.\r\n"
                    } else {
                        ""
                    },
                    if summary.has_touch_display {
                        "- Waveshare 2.8inch TFT Touch Shield: JLCPCB BOM에는 넣지 않고 DS1 헤더에 수동 장착, ST7789V/XPT2046 핀맵/기구 간섭/대체품 검토 필요.\r\n"
                    } else {
                        ""
                    }
                )
            } else {
                String::new()
            };
            let part_selection_summary = part_selection_review_summary(root, 8);
            let circuit_review_summary = circuit_review_summary(root, 3);
            format!(
                "제조 미리보기\r\n\
                 JLCPCB 업로드는 사람 검토 전까지 막힌 상태입니다.\r\n\
                 - 검토 목록에서 Gerber/Drill/BOM/CPL preview와 제조 준비 메모를 확인하세요.\r\n\
                 - 요구 추적 리뷰에서 채팅 요청이 회로도/BOM/PCB 증거로 이어졌는지 확인하세요.\r\n\
                 - 소자 선정 리뷰에서 JLCPCB/LCSC 번호와 대체 검토 위험을 확인하세요.\r\n\
                 {circuit_review_summary}\
                 {part_selection_summary}\
                 {option_lines}\
                 - 회로 적정성 리뷰에서 전원, USB-C, I2C, 부트 조건을 다시 확인하세요.\r\n\
                 - 품질 요약: {quality_summary}\r\n\
                 - Improvement Actions: design-quality-report.md의 순서대로 남은 검증과 order gate 확인을 진행하세요.\r\n\
                 - design-quality-report.md에서 90점 게이트와 ERC/DRC blocker를 확인하세요.\r\n\
                 - 점수가 높아도 최종 제조 조건과 부품 대체를 사람이 확인해야 합니다.\r\n\r\n\
                실제 주문 전에는 앱이 멈추고 사용자 확인을 받아야 합니다.\r\n\
                 상태: prototype-review, 주문 준비 전.",
                quality_summary = summary.quality_summary,
                circuit_review_summary = circuit_review_summary,
                part_selection_summary = part_selection_summary
            )
        }
        _ => saved_preview_tab_body(0, project_dir),
    }
}

pub fn preview_workspace_body(_project_dir: &str, _release_report_file: &str) -> String {
    format!(
        "미리보기 저장 완료\r\n\
         다음 행동\r\n\
         - PCB 열기로 KiCad 10에서 50mm x 50mm 보드와 주요 배선을 확인하세요.\r\n\
         - 검토 목록으로 저장 위치, 파일 목록, 품질 리포트를 확인하세요.\r\n\
         - design-quality-report.md: 90점 게이트, ERC/DRC blocker, 남은 경고.\r\n\
         - 채팅 입력칸에 바꿀 점을 적고 Enter로 후속 입력을 보내세요.\r\n\r\n\
         상태: prototype-review, 주문 준비 전."
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
    "이전 미리보기 발견 | 검토 목록에서 저장 위치 확인 | prototype-review, 주문 준비 전."
        .to_string()
}

pub fn recovered_preview_workspace_body(_project_dir: &str) -> String {
    format!(
        "이전 미리보기 발견\r\n\
         이어가기\r\n\
         - 검토 목록으로 저장 위치, 파일, 품질 리포트를 확인한 뒤 다음 설계를 보내세요.\r\n\
         - PCB 열기로 KiCad 10에서 저장된 보드와 주요 배선을 확인하세요.\r\n\
         - 채팅 입력칸에 바꿀 점을 적고 Enter로 후속 입력을 보내세요.\r\n\r\n\
         상태: prototype-review, 주문 준비 전."
    )
}

pub fn recovered_preview_workspace_transcript(_project_dir: &str) -> String {
    format!(
        "이전 미리보기 발견\r\n\
         - 검토 목록으로 저장 위치와 파일을 확인하세요.\r\n\
         - PCB 열기로 KiCad 10에서 저장된 보드 외곽선을 확인하세요.\r\n\
         - 채팅 입력칸에 바꿀 점을 적고 Enter로 이어가세요.\r\n\
         상태: prototype-review, 주문 준비 전.\r\n"
    )
}

pub fn preview_workspace_failed_transcript(error: &str) -> String {
    format!(
        "미리보기 저장 실패\r\n\
         - 이유: {error}\r\n\
         상태: 미리보기 단계로 유지합니다.\r\n"
    )
}

pub fn provider_login_transcript(statuses: &[ProviderUiStatus]) -> String {
    let mut transcript = String::from("Provider Login\r\n");
    transcript.push_str("로컬 도구 로그인 상태:\r\n");

    for status in statuses {
        if status.available && status.logged_in {
            let version = status.version.as_deref().unwrap_or("사용 가능");
            transcript.push_str(&format!(
                " - {}: 사용 가능 / 로그인됨 ({version})\r\n",
                status.display_name
            ));
            if !status.models.is_empty() {
                let models = status
                    .models
                    .iter()
                    .map(|model| model.display_name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                transcript.push_str(&format!("   사용 가능 모델: {models}\r\n"));
            }
        } else if status.available {
            let version = status.version.as_deref().unwrap_or("사용 가능");
            transcript.push_str(&format!(
                " - {}: 설치됨 / 로그인 필요 ({version})\r\n",
                status.display_name
            ));
            transcript.push_str(&format!("   {}\r\n", localized_login_hint(status)));
        } else {
            transcript.push_str(&format!(" - {}: 찾을 수 없음\r\n", status.display_name));
            transcript.push_str(&format!("   {}\r\n", localized_login_hint(status)));
        }
    }

    if let Some(model) = selected_provider_model(statuses) {
        transcript.push_str(&format!(
            "선택된 모델: {}\r\n",
            provider_model_display_name_for_statuses(model, statuses)
        ));
        transcript.push_str(
            "로그인되어 있으면 바로 사용할 수 있습니다. 모델 선택에서 provider와 모델을 고른 뒤 만들 보드를 입력하고 Enter 또는 설계 생성을 누르세요.\r\n",
        );
    } else {
        transcript.push_str("아직 준비된 로컬 도구가 없습니다.\r\n");
        transcript.push_str("그래도 설계 생성으로 ESP32-S3 미리보기를 만들 수 있습니다.\r\n");
        transcript.push_str(
            "로컬 도구 로그인은 나중에 해도 됩니다. 로그인을 마친 뒤 Provider Login을 다시 누르세요.\r\n",
        );
        transcript.push_str(
            "지금은 내장 미리보기로 계속 진행하고, 만들 보드를 입력한 뒤 Enter 또는 설계 생성을 누르세요.\r\n",
        );
    }

    transcript.push_str("Provider 인증 정보는 ChatPCB3에 저장하지 않습니다.\r\n");
    transcript
}

fn localized_login_hint(status: &ProviderUiStatus) -> String {
    let name = status.display_name.to_ascii_lowercase();
    if name.contains("codex") {
        "Codex CLI를 설치하고 로컬 로그인을 완료한 뒤 이 도구를 사용하세요.".to_string()
    } else if name.contains("claude") {
        "Claude Code를 설치하고 로컬 로그인을 완료한 뒤 이 도구를 사용하세요.".to_string()
    } else if name.contains("antigravity") {
        "Antigravity CLI를 설치하고 로컬 로그인을 완료한 뒤 이 도구를 사용하세요.".to_string()
    } else {
        status.login_hint.clone()
    }
}

pub fn selected_provider_model<'a>(statuses: &'a [ProviderUiStatus]) -> Option<&'a str> {
    statuses
        .iter()
        .filter(|status| status.available && status.logged_in)
        .flat_map(|status| status.models.iter())
        .map(|model| model.id.as_str())
        .next()
}
