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
    let project_file = project_dir.join(&created.artifact_manifest.project_file);
    let schematic_file = project_dir.join(&created.artifact_manifest.schematic_file);
    let pcb_file = project_dir.join(&created.artifact_manifest.pcb_file);
    let symbol_table_file = project_dir.join("sym-lib-table");
    let footprint_table_file = project_dir.join("fp-lib-table");

    fs::write(&prompt_file, prompt.trim())?;
    fs::write(&project_file, kicad_project_file())?;
    fs::write(&schematic_file, kicad_schematic_file())?;
    fs::write(&pcb_file, kicad_pcb_file())?;
    fs::write(&symbol_table_file, "(sym_lib_table)\r\n")?;
    fs::write(&footprint_table_file, "(fp_lib_table)\r\n")?;

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
            path_to_string(&project_file),
            path_to_string(&schematic_file),
            path_to_string(&pcb_file),
            path_to_string(&symbol_table_file),
            path_to_string(&footprint_table_file),
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
         Generated KiCad preview scaffold files:\r\n\
         - {project_file}\r\n\
         - {schematic_file}\r\n\
         - {pcb_file}\r\n\
         - sym-lib-table\r\n\
         - fp-lib-table\r\n\
         \r\n\
         Current boundary:\r\n\
         - The KiCad project shell is parseable preview scaffolding, not a completed circuit or PCB layout.\r\n\
         - 50mm x 50mm preview PCB outline on Edge.Cuts is included for visual orientation.\r\n\
         - KiCad fork integration is still required before these scaffold artifacts can be trusted.\r\n\
         - No Gerber, drill, BOM, CPL, ERC, or DRC result has been generated yet.\r\n\
         - Keep this package at prototype-review until real KiCad validation evidence exists.\r\n",
        prompt = prompt.trim(),
        project_file = manifest.project_file.as_str(),
        schematic_file = manifest.schematic_file.as_str(),
        pcb_file = manifest.pcb_file.as_str()
    )
}

fn kicad_project_file() -> &'static str {
    "{\r\n\
      \"board\": {\r\n\
        \"design_settings\": {\r\n\
          \"defaults\": {},\r\n\
          \"diff_pair_dimensions\": [],\r\n\
          \"drc_exclusions\": [],\r\n\
          \"rules\": {},\r\n\
          \"track_widths\": [],\r\n\
          \"via_dimensions\": []\r\n\
        }\r\n\
      },\r\n\
      \"boards\": [],\r\n\
      \"libraries\": {\r\n\
        \"pinned_footprint_libs\": [],\r\n\
        \"pinned_symbol_libs\": []\r\n\
      },\r\n\
      \"meta\": {\r\n\
        \"filename\": \"chatpcb3-esp32s3.kicad_pro\",\r\n\
        \"version\": 1\r\n\
      },\r\n\
      \"net_settings\": {\r\n\
        \"classes\": [],\r\n\
        \"meta\": {\r\n\
          \"version\": 0\r\n\
        }\r\n\
      },\r\n\
      \"pcbnew\": {\r\n\
        \"page_layout_descr_file\": \"\"\r\n\
      },\r\n\
      \"sheets\": [],\r\n\
      \"text_variables\": {}\r\n\
    }\r\n"
}

fn kicad_schematic_file() -> &'static str {
    "(kicad_sch\r\n\
      (version 20250610)\r\n\
      (generator \"chatpcb3\")\r\n\
      (generator_version \"0.1.0\")\r\n\
      (uuid \"11111111-1111-4111-8111-111111111111\")\r\n\
      (paper \"A4\")\r\n\
      (title_block\r\n\
        (title \"ChatPCB3 ESP32-S3 USB-C Sensor Board\")\r\n\
        (comment 1 \"Preview scaffold only; not order-ready.\")\r\n\
      )\r\n\
      (lib_symbols)\r\n\
      (text \"Preview KiCad schematic scaffold. Components and nets are not generated yet.\"\r\n\
        (exclude_from_sim no)\r\n\
        (at 25.4 25.4 0)\r\n\
        (effects\r\n\
          (font\r\n\
            (size 1.27 1.27)\r\n\
          )\r\n\
          (justify left)\r\n\
        )\r\n\
        (uuid \"22222222-2222-4222-8222-222222222222\")\r\n\
      )\r\n\
      (sheet_instances\r\n\
        (path \"/\"\r\n\
          (page \"1\")\r\n\
        )\r\n\
      )\r\n\
    )\r\n"
}

fn kicad_pcb_file() -> &'static str {
    "(kicad_pcb\r\n\
      (version 20250513)\r\n\
      (generator \"chatpcb3\")\r\n\
      (generator_version \"0.1.0\")\r\n\
      (general\r\n\
        (thickness 1.6)\r\n\
        (legacy_teardrops no)\r\n\
      )\r\n\
      (paper \"A4\")\r\n\
      (title_block\r\n\
        (title \"ChatPCB3 ESP32-S3 USB-C Sensor Board\")\r\n\
        (comment 1 \"Preview scaffold only; not order-ready.\")\r\n\
      )\r\n\
      (layers\r\n\
        (0 \"F.Cu\" signal)\r\n\
        (2 \"B.Cu\" signal)\r\n\
        (9 \"F.Adhes\" user \"F.Adhesive\")\r\n\
        (11 \"B.Adhes\" user \"B.Adhesive\")\r\n\
        (13 \"F.Paste\" user)\r\n\
        (15 \"B.Paste\" user)\r\n\
        (5 \"F.SilkS\" user \"F.Silkscreen\")\r\n\
        (7 \"B.SilkS\" user \"B.Silkscreen\")\r\n\
        (1 \"F.Mask\" user)\r\n\
        (3 \"B.Mask\" user)\r\n\
        (17 \"Dwgs.User\" user \"User.Drawings\")\r\n\
        (19 \"Cmts.User\" user \"User.Comments\")\r\n\
        (21 \"Eco1.User\" user \"User.Eco1\")\r\n\
        (23 \"Eco2.User\" user \"User.Eco2\")\r\n\
        (25 \"Edge.Cuts\" user)\r\n\
        (27 \"Margin\" user)\r\n\
        (31 \"F.CrtYd\" user \"F.Courtyard\")\r\n\
        (29 \"B.CrtYd\" user \"B.Courtyard\")\r\n\
        (35 \"F.Fab\" user)\r\n\
        (33 \"B.Fab\" user)\r\n\
      )\r\n\
      (setup\r\n\
        (pad_to_mask_clearance 0)\r\n\
        (allow_soldermask_bridges_in_footprints no)\r\n\
        (tenting front back)\r\n\
        (pcbplotparams)\r\n\
      )\r\n\
      (net 0 \"\")\r\n\
      (gr_line\r\n\
        (start 10 10)\r\n\
        (end 60 10)\r\n\
        (stroke\r\n\
          (width 0.1)\r\n\
          (type solid)\r\n\
        )\r\n\
        (layer \"Edge.Cuts\")\r\n\
        (uuid \"33333333-3333-4333-8333-333333333333\")\r\n\
      )\r\n\
      (gr_line\r\n\
        (start 60 10)\r\n\
        (end 60 60)\r\n\
        (stroke\r\n\
          (width 0.1)\r\n\
          (type solid)\r\n\
        )\r\n\
        (layer \"Edge.Cuts\")\r\n\
        (uuid \"44444444-4444-4444-8444-444444444444\")\r\n\
      )\r\n\
      (gr_line\r\n\
        (start 60 60)\r\n\
        (end 10 60)\r\n\
        (stroke\r\n\
          (width 0.1)\r\n\
          (type solid)\r\n\
        )\r\n\
        (layer \"Edge.Cuts\")\r\n\
        (uuid \"55555555-5555-4555-8555-555555555555\")\r\n\
      )\r\n\
      (gr_line\r\n\
        (start 10 60)\r\n\
        (end 10 10)\r\n\
        (stroke\r\n\
          (width 0.1)\r\n\
          (type solid)\r\n\
        )\r\n\
        (layer \"Edge.Cuts\")\r\n\
        (uuid \"66666666-6666-4666-8666-666666666666\")\r\n\
      )\r\n\
      (gr_text \"ChatPCB3 ESP32-S3 USB-C Sensor Board\"\r\n\
        (at 12 16 0)\r\n\
        (layer \"F.SilkS\")\r\n\
        (effects\r\n\
          (font\r\n\
            (size 1.5 1.5)\r\n\
            (thickness 0.15)\r\n\
          )\r\n\
          (justify left)\r\n\
        )\r\n\
        (uuid \"77777777-7777-4777-8777-777777777777\")\r\n\
      )\r\n\
      (gr_text \"50mm x 50mm preview outline - not order-ready\"\r\n\
        (at 12 20 0)\r\n\
        (layer \"F.SilkS\")\r\n\
        (effects\r\n\
          (font\r\n\
            (size 1.2 1.2)\r\n\
            (thickness 0.12)\r\n\
          )\r\n\
          (justify left)\r\n\
        )\r\n\
        (uuid \"88888888-8888-4888-8888-888888888888\")\r\n\
      )\r\n\
    )\r\n"
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}
