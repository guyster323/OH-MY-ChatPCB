use crate::design::{esp32s3_usb_sensor_board_spec, BoardSpec};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::Path;

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreviewWorkspace {
    pub project_dir: String,
    pub manifest_file: String,
    pub release_report_file: String,
    pub prompt_file: String,
    pub files: Vec<String>,
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

pub fn create_preview_workspace(
    prompt: &str,
    root: impl AsRef<Path>,
) -> io::Result<PreviewWorkspace> {
    let created = create_esp32s3_project(prompt);
    let project_dir = root.as_ref().join("chatpcb3-esp32s3-preview");
    fs::create_dir_all(&project_dir)?;

    let manifest_file = project_dir.join("artifact-manifest.json");
    let release_report_file = project_dir.join("release-evidence-preview.md");
    let prompt_file = project_dir.join("prompt.txt");

    fs::write(&prompt_file, prompt.trim())?;

    let manifest_json = serde_json::to_string_pretty(&created)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    fs::write(&manifest_file, manifest_json)?;

    fs::write(
        &release_report_file,
        preview_release_report(prompt, &created.artifact_manifest),
    )?;

    Ok(PreviewWorkspace {
        project_dir: path_to_string(&project_dir),
        manifest_file: path_to_string(&manifest_file),
        release_report_file: path_to_string(&release_report_file),
        prompt_file: path_to_string(&prompt_file),
        files: vec![
            path_to_string(&manifest_file),
            path_to_string(&release_report_file),
            path_to_string(&prompt_file),
        ],
        artifact_manifest: created.artifact_manifest,
    })
}

fn preview_release_report(prompt: &str, manifest: &ArtifactManifest) -> String {
    format!(
        "# ChatPCB3 Preview Evidence\r\n\
         \r\n\
         Status: prototype-review, not order-ready.\r\n\
         \r\n\
         User prompt: {prompt}\r\n\
         \r\n\
         Planned KiCad files:\r\n\
         - {project_file}\r\n\
         - {schematic_file}\r\n\
         - {pcb_file}\r\n\
         \r\n\
         Current boundary:\r\n\
         - KiCad fork integration is still required before these planned artifacts can be trusted.\r\n\
         - No Gerber, drill, BOM, CPL, ERC, or DRC result has been generated yet.\r\n\
         - Keep this package at prototype-review until real KiCad validation evidence exists.\r\n",
        prompt = prompt.trim(),
        project_file = manifest.project_file.as_str(),
        schematic_file = manifest.schematic_file.as_str(),
        pcb_file = manifest.pcb_file.as_str()
    )
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}
