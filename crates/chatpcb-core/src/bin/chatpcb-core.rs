use chatpcb_core::rpc::handle_json_rpc_line_with_probe;
use std::io::{self, BufRead, Write};
use std::process::Command;

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let Ok(line) = line else {
            break;
        };

        if line.trim().is_empty() {
            continue;
        }

        let response = handle_json_rpc_line_with_probe(&line, probe_command_version)
            .unwrap_or_else(|error| {
                format!(r#"{{"id":null,"error":{{"code":-32700,"message":"{error}"}}}}"#)
            });

        if writeln!(stdout, "{response}").is_err() {
            break;
        }

        if stdout.flush().is_err() {
            break;
        }
    }
}

fn probe_command_version(command: &str) -> Option<String> {
    let output = match Command::new(command).arg("--version").output() {
        Ok(output) => output,
        Err(_) => return probe_windows_provider_install(command),
    };

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !stdout.is_empty() {
        Some(stdout)
    } else if !stderr.is_empty() {
        Some(stderr)
    } else if command == "antigravity" {
        probe_windows_provider_install(command).or_else(|| Some(format!("{command} available")))
    } else {
        Some(format!("{command} available"))
    }
}

#[cfg(windows)]
fn probe_windows_provider_install(command: &str) -> Option<String> {
    if command == "codex" {
        let user_profile = std::env::var("USERPROFILE").ok()?;
        for candidate in [
            std::path::Path::new(&user_profile).join(".local\\bin\\codex.cmd"),
            std::path::Path::new(&user_profile).join(".local\\bin\\codex.exe"),
        ] {
            if candidate.is_file() {
                let output = Command::new(candidate).arg("--version").output().ok()?;
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

                    if !stdout.is_empty() {
                        return Some(stdout);
                    }
                    if !stderr.is_empty() {
                        return Some(stderr);
                    }
                }

                return Some("Codex installed (Windows user bin)".to_string());
            }
        }
    }

    if command == "antigravity" {
        let local_app_data = std::env::var("LOCALAPPDATA").ok()?;
        let executable =
            std::path::Path::new(&local_app_data).join("Programs\\Antigravity\\Antigravity.exe");

        if executable.is_file() {
            return Some("Antigravity installed (Windows app)".to_string());
        }
    }

    None
}

#[cfg(not(windows))]
fn probe_windows_provider_install(_command: &str) -> Option<String> {
    None
}
