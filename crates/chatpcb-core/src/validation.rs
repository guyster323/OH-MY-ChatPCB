use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
    Exclusion,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Violation {
    pub severity: Severity,
    pub message: String,
    #[serde(default)]
    pub items: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KicadReport {
    pub violations: Vec<Violation>,
    pub error_count: usize,
    pub warning_count: usize,
    pub unconnected_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum KicadCliCheckStatus {
    Accepted,
    Rejected,
    ToolMissing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KicadCliCheckReport {
    pub status: KicadCliCheckStatus,
    pub summary: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Deserialize)]
struct RawKicadReport {
    #[serde(default)]
    violations: Vec<RawViolation>,
    #[serde(default)]
    sheets: Vec<RawSheet>,
    #[serde(default)]
    unconnected_items: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct RawSheet {
    #[serde(default)]
    violations: Vec<RawViolation>,
}

#[derive(Debug, Deserialize)]
struct RawViolation {
    severity: Severity,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    items: Vec<serde_json::Value>,
}

pub fn parse_kicad_report(input: &str) -> Result<KicadReport, serde_json::Error> {
    let raw: RawKicadReport = serde_json::from_str(input)?;
    let violations = raw
        .violations
        .into_iter()
        .chain(
            raw.sheets
                .into_iter()
                .flat_map(|sheet| sheet.violations.into_iter()),
        )
        .map(normalize_violation)
        .collect::<Vec<_>>();
    let error_count = violations
        .iter()
        .filter(|violation| violation.severity == Severity::Error)
        .count();
    let warning_count = violations
        .iter()
        .filter(|violation| violation.severity == Severity::Warning)
        .count();

    Ok(KicadReport {
        violations,
        error_count,
        warning_count,
        unconnected_count: raw.unconnected_items.len(),
    })
}

fn normalize_violation(raw: RawViolation) -> Violation {
    Violation {
        severity: raw.severity,
        message: raw
            .message
            .or(raw.description)
            .unwrap_or_else(|| "KiCad violation".to_string()),
        items: raw.items.into_iter().filter_map(item_description).collect(),
    }
}

fn item_description(value: serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => Some(text),
        serde_json::Value::Object(object) => object
            .get("description")
            .and_then(|description| description.as_str())
            .map(ToString::to_string),
        _ => None,
    }
}

pub fn summarize_erc_drc_reports(erc: &KicadReport, drc: &KicadReport) -> String {
    format!(
        "ERC: 오류 {}개, 경고 {}개. DRC: 오류 {}개, 경고 {}개, 미연결 {}개. 검토 목록에서 회로, PCB, 제조 파일을 확인하세요. 아직 주문 준비 상태가 아닙니다; 상태는 prototype-review입니다.",
        erc.error_count,
        erc.warning_count,
        drc.error_count,
        drc.warning_count,
        drc.unconnected_count
    )
}

pub fn summarize_kicad_cli_check(
    exit_code: Option<i32>,
    stdout: &str,
    stderr: &str,
) -> KicadCliCheckReport {
    let status = match exit_code {
        Some(0) => KicadCliCheckStatus::Accepted,
        Some(_) => KicadCliCheckStatus::Rejected,
        None => KicadCliCheckStatus::ToolMissing,
    };

    let summary = match status {
        KicadCliCheckStatus::Accepted => {
            "KiCad 확인: preview PCB를 열 수 있습니다. 검토 목록에서 주문 전 검토를 끝내기 전까지 prototype-review입니다."
        }
        KicadCliCheckStatus::Rejected => {
            "KiCad 확인 실패: preview PCB를 열 수 없습니다. 검토 목록의 보고서를 확인하세요. prototype-review입니다."
        }
        KicadCliCheckStatus::ToolMissing => {
            "KiCad 10 실행 파일을 찾지 못했습니다. KiCad 10 설치 후 로컬 확인을 실행하세요. 현재는 prototype-review입니다."
        }
    };

    KicadCliCheckReport {
        status,
        summary: summary.to_string(),
        exit_code,
        stdout: stdout.trim().to_string(),
        stderr: stderr.trim().to_string(),
    }
}
