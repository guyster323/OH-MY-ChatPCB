use chatpcb_core::rpc::handle_json_rpc_line_with_probe;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn rpc(line: &str) -> Value {
    let response = handle_json_rpc_line_with_probe(line, |command| match command {
        "codex" => Some("codex 0.41.0".to_string()),
        "claude" => None,
        "gemini" => Some("gemini 1.0.0".to_string()),
        _ => None,
    })
    .unwrap();

    serde_json::from_str(&response).unwrap()
}

#[test]
fn json_rpc_dispatches_provider_list_without_network_transport() {
    let response = rpc(r#"{"id":"provider-1","method":"provider.list","params":{}}"#);

    assert_eq!(response["id"], "provider-1");
    assert_eq!(response["result"]["providers"].as_array().unwrap().len(), 3);
    assert_eq!(response["result"]["providers"][0]["kind"], "Codex");
    assert_eq!(response["result"]["transport"], "stdio-jsonl");

    let serialized = response.to_string();
    assert!(!serialized.contains("http://"));
    assert!(!serialized.contains("https://"));
    assert!(!serialized.to_ascii_lowercase().contains("api_key"));
}

#[test]
fn json_rpc_creates_fixed_esp32s3_project_manifest() {
    let response = rpc(
        r#"{"id":"project-1","method":"project.create","params":{"prompt":"USB-C ESP32-S3 sensor board"}}"#,
    );

    assert_eq!(response["id"], "project-1");
    assert_eq!(
        response["result"]["boardSpec"]["product_name"],
        "ChatPCB3 ESP32-S3 USB-C Sensor Board"
    );
    assert_eq!(
        response["result"]["artifactManifest"]["project_file"],
        "chatpcb3-esp32s3.kicad_pro"
    );
    assert!(response["result"]["artifactManifest"]["files"]
        .as_array()
        .unwrap()
        .iter()
        .any(|file| file == "chatpcb3-esp32s3.kicad_pcb"));
}

#[test]
fn json_rpc_creates_preview_workspace_evidence_folder() {
    let root = std::env::temp_dir().join(format!(
        "chatpcb3-rpc-preview-workspace-test-{}",
        std::process::id()
    ));
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let request = serde_json::json!({
        "id": "project-workspace-1",
        "method": "project.createPreviewWorkspace",
        "params": {
            "prompt": "USB-C ESP32-S3 sensor board",
            "rootDir": root
        }
    });
    let response = rpc(&request.to_string());

    assert_eq!(response["id"], "project-workspace-1");
    assert!(PathBuf::from(
        response["result"]["previewWorkspace"]["release_report_file"]
            .as_str()
            .unwrap()
    )
    .exists());
    assert_eq!(
        response["result"]["previewWorkspace"]["artifact_manifest"]["project_file"],
        "chatpcb3-esp32s3.kicad_pro"
    );
    assert!(
        response["result"]["previewWorkspace"]["first_run_summary_file"]
            .as_str()
            .unwrap()
            .ends_with("FIRST-RUN-SUMMARY.txt")
    );
    assert!(PathBuf::from(
        response["result"]["previewWorkspace"]["first_run_summary_file"]
            .as_str()
            .unwrap()
    )
    .exists());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn json_rpc_autoroute_returns_freerouting_dsn_ses_contract() {
    let response = rpc(r#"{"id":"route-1","method":"layout.autoroute","params":{}}"#);

    assert_eq!(response["result"]["engine"], "freerouting");
    assert_eq!(response["result"]["bundled_version"], "v2.2.4");
    assert_eq!(response["result"]["input_dsn"], "chatpcb3-esp32s3.dsn");
    assert_eq!(response["result"]["output_ses"], "chatpcb3-esp32s3.ses");
    assert_eq!(response["result"]["drc_required_after_import"], true);
}

#[test]
fn json_rpc_unknown_method_returns_structured_error() {
    let response = rpc(r#"{"id":"bad-1","method":"unknown.method","params":{}}"#);

    assert_eq!(response["id"], "bad-1");
    assert_eq!(response["error"]["code"], -32601);
    assert!(response["error"]["message"]
        .as_str()
        .unwrap()
        .contains("unknown.method"));
}
