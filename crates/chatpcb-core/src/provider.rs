use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProviderKind {
    Codex,
    Claude,
    Gemini,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LoginMode {
    LocalCli,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderStatus {
    pub kind: ProviderKind,
    pub display_name: String,
    pub command: String,
    pub login_mode: LoginMode,
    pub available: bool,
    pub version: Option<String>,
    pub login_hint: String,
}

pub fn catalog_with_probe<F>(mut probe: F) -> Vec<ProviderStatus>
where
    F: FnMut(&str) -> Option<String>,
{
    provider_specs()
        .into_iter()
        .map(|(kind, display_name, command, login_hint)| {
            let version = probe(command);

            ProviderStatus {
                kind,
                display_name: display_name.to_string(),
                command: command.to_string(),
                login_mode: LoginMode::LocalCli,
                available: version.is_some(),
                version,
                login_hint: login_hint.to_string(),
            }
        })
        .collect()
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
            ProviderKind::Gemini,
            "Gemini CLI",
            "gemini",
            "Install Gemini CLI and complete local login before invoking this provider.",
        ),
    ]
}
