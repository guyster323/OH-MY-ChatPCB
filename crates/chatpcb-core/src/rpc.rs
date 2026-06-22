use crate::design::esp32s3_usb_sensor_board_spec;
use crate::layout::freerouting_contract;
use crate::manufacturing::build_jlcpcb_package;
use crate::project::{create_esp32s3_project, create_preview_workspace};
use crate::provider::catalog_with_probe;
use serde::Deserialize;
use serde_json::{json, Value};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum RpcError {
    #[error("invalid JSON-RPC request: {0}")]
    InvalidRequest(#[from] serde_json::Error),
}

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

pub fn handle_json_rpc_line_with_probe<F>(line: &str, probe: F) -> Result<String, RpcError>
where
    F: FnMut(&str) -> Option<String>,
{
    let request: JsonRpcRequest = serde_json::from_str(line)?;
    let response = dispatch(request, probe);
    Ok(serde_json::to_string(&response)?)
}

fn dispatch<F>(request: JsonRpcRequest, probe: F) -> Value
where
    F: FnMut(&str) -> Option<String>,
{
    match request.method.as_str() {
        "provider.list" => json!({
            "id": request.id,
            "result": {
                "transport": "stdio-jsonl",
                "providers": catalog_with_probe(probe)
            }
        }),
        "project.create" => {
            let prompt = request
                .params
                .get("prompt")
                .and_then(Value::as_str)
                .unwrap_or("ESP32-S3 USB-C sensor board");
            let created = create_esp32s3_project(prompt);

            json!({
                "id": request.id,
                "result": {
                    "boardSpec": created.board_spec,
                    "artifactManifest": created.artifact_manifest
                }
            })
        }
        "project.createPreviewWorkspace" => {
            let prompt = request
                .params
                .get("prompt")
                .and_then(Value::as_str)
                .unwrap_or("ESP32-S3 USB-C sensor board");
            let root_dir = request
                .params
                .get("rootDir")
                .and_then(Value::as_str)
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| std::env::temp_dir().join("ChatPCB3").join("Projects"));

            match create_preview_workspace(prompt, root_dir) {
                Ok(workspace) => json!({
                    "id": request.id,
                    "result": {
                        "previewWorkspace": workspace
                    }
                }),
                Err(error) => json!({
                    "id": request.id,
                    "error": {
                        "code": -32000,
                        "message": format!("Preview workspace failed: {error}")
                    }
                }),
            }
        }
        "layout.autoroute" => json!({
            "id": request.id,
            "result": freerouting_contract()
        }),
        "manufacturing.package" => {
            let spec = esp32s3_usb_sensor_board_spec("ESP32-S3 USB-C sensor board");

            json!({
                "id": request.id,
                "result": build_jlcpcb_package(&spec)
            })
        }
        unknown => json!({
            "id": request.id,
            "error": {
                "code": -32601,
                "message": format!("Method not found: {unknown}")
            }
        }),
    }
}
