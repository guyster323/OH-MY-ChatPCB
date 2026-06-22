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
    let output = Command::new(command).arg("--version").output().ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !stdout.is_empty() {
        Some(stdout)
    } else if !stderr.is_empty() {
        Some(stderr)
    } else {
        Some(format!("{command} available"))
    }
}
