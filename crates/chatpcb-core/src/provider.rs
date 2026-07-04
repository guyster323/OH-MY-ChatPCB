use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProviderKind {
    Codex,
    Claude,
    Antigravity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LoginMode {
    LocalCli,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderModel {
    pub id: String,
    pub display_name: String,
    pub cli_model: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderProbeStatus {
    pub version: Option<String>,
    pub logged_in: bool,
}

impl ProviderProbeStatus {
    pub fn from_version(version: Option<String>) -> Self {
        Self {
            logged_in: version.is_some(),
            version,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderStatus {
    pub kind: ProviderKind,
    pub display_name: String,
    pub command: String,
    pub login_mode: LoginMode,
    pub available: bool,
    pub logged_in: bool,
    pub version: Option<String>,
    pub models: Vec<ProviderModel>,
    pub login_hint: String,
}

pub fn catalog_with_probe<F>(mut probe: F) -> Vec<ProviderStatus>
where
    F: FnMut(&str) -> Option<String>,
{
    catalog_with_status_probe(|command| ProviderProbeStatus::from_version(probe(command)))
}

pub fn catalog_with_status_probe<F>(mut probe: F) -> Vec<ProviderStatus>
where
    F: FnMut(&str) -> ProviderProbeStatus,
{
    provider_specs()
        .into_iter()
        .map(|(kind, display_name, command, login_hint)| {
            let status = probe(command);
            let available = status.version.is_some();
            let models = if available && status.logged_in {
                provider_models(kind, status.version.as_deref())
            } else {
                Vec::new()
            };

            ProviderStatus {
                kind,
                display_name: display_name.to_string(),
                command: command.to_string(),
                login_mode: LoginMode::LocalCli,
                available,
                logged_in: status.logged_in,
                version: status.version,
                models,
                login_hint: login_hint.to_string(),
            }
        })
        .collect()
}

fn provider_models(kind: ProviderKind, version: Option<&str>) -> Vec<ProviderModel> {
    match kind {
        ProviderKind::Codex => ["gpt-5", "gpt-5-codex"]
            .into_iter()
            .map(|model| ProviderModel {
                id: format!("codex:{model}"),
                display_name: format!("Codex {} {model}", short_version(version)),
                cli_model: model.to_string(),
            })
            .collect(),
        ProviderKind::Claude => ["sonnet", "opus"]
            .into_iter()
            .map(|model| ProviderModel {
                id: format!("claude:{model}"),
                display_name: format!("Claude {} {model}", short_version(version)),
                cli_model: model.to_string(),
            })
            .collect(),
        ProviderKind::Antigravity => vec![ProviderModel {
            id: "antigravity:auto".to_string(),
            display_name: format!("Antigravity {} auto", short_version(version)),
            cli_model: "auto".to_string(),
        }],
    }
}

fn short_version(version: Option<&str>) -> String {
    let Some(version) = version else {
        return "사용 가능".to_string();
    };

    let lower = version.to_ascii_lowercase();
    if lower.contains("windows app") {
        return "Windows app".to_string();
    }

    version
        .split_whitespace()
        .find(|part| part.chars().any(|ch| ch.is_ascii_digit()))
        .map(|part| {
            part.trim_matches(|ch: char| ch == '(' || ch == ')')
                .to_string()
        })
        .unwrap_or_else(|| version.to_string())
}

fn provider_specs() -> Vec<(ProviderKind, &'static str, &'static str, &'static str)> {
    vec![
        (
            ProviderKind::Codex,
            "Codex",
            "codex",
            "Install Codex CLI and complete local login before invoking this provider.",
        ),
        (
            ProviderKind::Claude,
            "Claude Code",
            "claude",
            "Install Claude Code and complete local login before invoking this provider.",
        ),
        (
            ProviderKind::Antigravity,
            "Antigravity CLI",
            "antigravity",
            "Install Antigravity CLI and complete local login before invoking this provider.",
        ),
    ]
}
