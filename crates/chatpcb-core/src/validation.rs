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
