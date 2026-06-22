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
        "ERC: {} {}, {} {}. DRC: {} {}, {} {}, {} unconnected. Gate remains prototype-review until schematic, layout, DRC, Gerber, BOM, and CPL evidence are reviewed.",
        erc.error_count,
        plural(erc.error_count, "error", "errors"),
        erc.warning_count,
        plural(erc.warning_count, "warning", "warnings"),
        drc.error_count,
        plural(drc.error_count, "error", "errors"),
        drc.warning_count,
        plural(drc.warning_count, "warning", "warnings"),
        drc.unconnected_count
    )
}

fn plural(count: usize, one: &'static str, many: &'static str) -> &'static str {
    if count == 1 {
        one
    } else {
        many
    }
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
            "KiCad accepted the preview PCB. Gate remains prototype-review until schematic, DRC, Gerber, BOM, and CPL evidence exist."
        }
        KicadCliCheckStatus::Rejected => {
            "KiCad rejected the preview PCB. Gate remains prototype-review; inspect kicad-pcb-check.txt before continuing."
        }
        KicadCliCheckStatus::ToolMissing => {
            "KiCad CLI was not found. Gate remains prototype-review; install KiCad 10 to run the local compatibility check."
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
