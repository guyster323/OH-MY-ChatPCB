use crate::design::{esp32s3_usb_sensor_board_spec, BoardSpec};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactManifest {
    pub project_file: String,
    pub schematic_file: String,
    pub pcb_file: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CreatedProject {
    pub board_spec: BoardSpec,
    pub artifact_manifest: ArtifactManifest,
}

pub fn create_esp32s3_project(prompt: &str) -> CreatedProject {
    CreatedProject {
        board_spec: esp32s3_usb_sensor_board_spec(prompt),
        artifact_manifest: ArtifactManifest {
            project_file: "chatpcb3-esp32s3.kicad_pro".to_string(),
            schematic_file: "chatpcb3-esp32s3.kicad_sch".to_string(),
            pcb_file: "chatpcb3-esp32s3.kicad_pcb".to_string(),
            files: vec![
                "chatpcb3-esp32s3.kicad_pro".to_string(),
                "chatpcb3-esp32s3.kicad_sch".to_string(),
                "chatpcb3-esp32s3.kicad_pcb".to_string(),
                "sym-lib-table".to_string(),
                "fp-lib-table".to_string(),
            ],
        },
    }
}
