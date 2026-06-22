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
    violations: Vec<Violation>,
}

pub fn parse_kicad_report(input: &str) -> Result<KicadReport, serde_json::Error> {
    let raw: RawKicadReport = serde_json::from_str(input)?;
    let error_count = raw
        .violations
        .iter()
        .filter(|violation| violation.severity == Severity::Error)
        .count();
    let warning_count = raw
        .violations
        .iter()
        .filter(|violation| violation.severity == Severity::Warning)
        .count();

    Ok(KicadReport {
        violations: raw.violations,
        error_count,
        warning_count,
    })
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
