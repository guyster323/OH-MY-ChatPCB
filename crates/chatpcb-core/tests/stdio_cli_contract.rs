use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

#[test]
fn chatpcb_core_binary_answers_one_json_rpc_line_on_stdio() {
    let exe = option_env!("CARGO_BIN_EXE_chatpcb-core").expect("chatpcb-core binary must be built");
    let mut child = Command::new(exe)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();

    {
        let stdin = child.stdin.as_mut().unwrap();
        writeln!(
            stdin,
            r#"{{"id":"route-cli","method":"layout.autoroute","params":{{}}}}"#
        )
        .unwrap();
    }

    let mut reader = BufReader::new(child.stdout.take().unwrap());
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();

    let response: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(response["id"], "route-cli");
    assert_eq!(response["result"]["engine"], "freerouting");

    child.kill().ok();
}
