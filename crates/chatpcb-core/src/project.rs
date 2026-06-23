use crate::design::{esp32s3_usb_sensor_board_spec, BoardSpec};
use crate::manufacturing::{build_jlcpcb_package, PartSelection};
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
    pub first_run_summary_file: String,
    pub beginner_next_steps_file: String,
    pub bom_preview_file: String,
    pub cpl_preview_file: String,
    pub manufacturing_readiness_file: String,
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
                "jlcpcb-bom-preview.csv".to_string(),
                "jlcpcb-cpl-preview.csv".to_string(),
                "manufacturing-readiness-preview.txt".to_string(),
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
    let first_run_summary_file = project_dir.join("FIRST-RUN-SUMMARY.txt");
    let beginner_next_steps_file = project_dir.join("BEGINNER-NEXT-STEPS.txt");
    let bom_preview_file = project_dir.join("jlcpcb-bom-preview.csv");
    let cpl_preview_file = project_dir.join("jlcpcb-cpl-preview.csv");
    let manufacturing_readiness_file = project_dir.join("manufacturing-readiness-preview.txt");
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

    let manufacturing_package = build_jlcpcb_package(&created.board_spec);
    fs::write(
        &bom_preview_file,
        jlcpcb_bom_preview_csv(&manufacturing_package.parts),
    )?;
    fs::write(
        &cpl_preview_file,
        jlcpcb_cpl_preview_csv(&manufacturing_package.parts),
    )?;
    fs::write(
        &manufacturing_readiness_file,
        manufacturing_readiness_preview(prompt),
    )?;

    let manifest_json = serde_json::to_string_pretty(&created)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    fs::write(&manifest_file, manifest_json)?;

    fs::write(
        &release_report_file,
        preview_release_report(prompt, &created.artifact_manifest),
    )?;
    fs::write(&first_run_summary_file, first_run_summary(prompt))?;
    fs::write(&beginner_next_steps_file, beginner_next_steps(prompt))?;

    Ok(PreviewWorkspace {
        project_dir: path_to_string(&project_dir),
        manifest_file: path_to_string(&manifest_file),
        release_report_file: path_to_string(&release_report_file),
        first_run_summary_file: path_to_string(&first_run_summary_file),
        beginner_next_steps_file: path_to_string(&beginner_next_steps_file),
        bom_preview_file: path_to_string(&bom_preview_file),
        cpl_preview_file: path_to_string(&cpl_preview_file),
        manufacturing_readiness_file: path_to_string(&manufacturing_readiness_file),
        prompt_file: path_to_string(&prompt_file),
        files: vec![
            path_to_string(&project_file),
            path_to_string(&schematic_file),
            path_to_string(&pcb_file),
            path_to_string(&symbol_table_file),
            path_to_string(&footprint_table_file),
            path_to_string(&manifest_file),
            path_to_string(&release_report_file),
            path_to_string(&first_run_summary_file),
            path_to_string(&beginner_next_steps_file),
            path_to_string(&bom_preview_file),
            path_to_string(&cpl_preview_file),
            path_to_string(&manufacturing_readiness_file),
            path_to_string(&prompt_file),
        ],
        artifact_manifest: created.artifact_manifest,
    })
}

fn first_run_summary(prompt: &str) -> String {
    format!(
        "ChatPCB3 First Run Summary\r\n\
         ==========================\r\n\
         \r\n\
         Start here after your first Send design click.\r\n\
         \r\n\
         What was created:\r\n\
         - A native ChatPCB3 preview workspace for: {prompt}\r\n\
         - A KiCad project shell with schematic and PCB preview files.\r\n\
         - A 50mm x 50mm PCB outline for visual inspection.\r\n\
         - JLCPCB BOM/CPL preview files for review, not upload.\r\n\
         \r\n\
         What to click next in the app:\r\n\
         - BEGINNER-NEXT-STEPS.txt: read the short checklist if you are not sure what happened.\r\n\
         - Open PCB: inspect the generated board outline in KiCad.\r\n\
         - Review checklist: return to this folder and review saved reports.\r\n\
         - Or return to the focused prompt, type a follow-up, and press Enter.\r\n\
         \r\n\
         Current gate:\r\n\
         - prototype-review\r\n\
         - not order-ready\r\n\
         \r\n\
         Why it is not order-ready yet:\r\n\
         - Component placement and routing are not generated yet.\r\n\
         - Gerber and drill files are not generated yet.\r\n\
         - BOM/CPL preview files are not placement-reviewed upload files yet.\r\n\
         - A human must review real manufacturing evidence before ordering.\r\n\
         - Do not upload this preview to JLCPCB.\r\n",
        prompt = prompt.trim()
    )
}

fn beginner_next_steps(prompt: &str) -> String {
    format!(
        "ChatPCB3 Beginner Next Steps\r\n\
         ============================\r\n\
         \r\n\
         Your first request:\r\n\
         {prompt}\r\n\
         \r\n\
         First thing to do:\r\n\
         1. Click Open PCB in ChatPCB KiCad Preview.\r\n\
         2. Confirm KiCad opens the 50mm x 50mm board outline.\r\n\
         3. Click Review checklist and keep this folder open while you review.\r\n\
         \r\n\
         What the files mean:\r\n\
         - chatpcb3-esp32s3.kicad_sch is the schematic preview scaffold.\r\n\
         - chatpcb3-esp32s3.kicad_pcb is the PCB outline preview.\r\n\
         - kicad-validation-summary.txt is the local ERC/DRC summary when KiCad CLI is available.\r\n\
         - jlcpcb-bom-preview.csv is a BOM preview with LCSC/JLCPCB part evidence.\r\n\
         - jlcpcb-cpl-preview.csv is a CPL preview with placeholder UNPLACED coordinates.\r\n\
         - manufacturing-readiness-preview.txt explains why upload is blocked.\r\n\
         - FIRST-RUN-SUMMARY.txt explains the prototype-review boundary.\r\n\
         \r\n\
         Ask a follow-up in chat:\r\n\
         - Ask for the missing sensor, connector, board size, or power change next.\r\n\
         - Keep using chat until the app can generate real placement, routing, and manufacturing files.\r\n\
         \r\n\
         Do not order yet:\r\n\
         - Gerber files are not generated yet.\r\n\
         - BOM preview and CPL preview files are for review only, not JLCPCB upload.\r\n\
         - Human review is still required before JLCPCB upload.\r\n",
        prompt = prompt.trim()
    )
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
         - BEGINNER-NEXT-STEPS.txt\r\n\
         \r\n\
         JLCPCB manufacturing preview files:\r\n\
         - jlcpcb-bom-preview.csv\r\n\
         - jlcpcb-cpl-preview.csv\r\n\
         - manufacturing-readiness-preview.txt\r\n\
         \r\n\
         Current boundary:\r\n\
         - The KiCad project shell is parseable preview scaffolding, not a completed circuit or PCB layout.\r\n\
         - 50mm x 50mm preview PCB outline on Edge.Cuts is included for visual orientation.\r\n\
         - KiCad fork integration is still required before these scaffold artifacts can be trusted.\r\n\
         - No Gerber or drill file has been generated yet.\r\n\
         - BOM/CPL preview files are review evidence only, not upload-ready placement files.\r\n\
         - Keep this package at prototype-review until real KiCad validation evidence exists.\r\n",
        prompt = prompt.trim(),
        project_file = manifest.project_file.as_str(),
        schematic_file = manifest.schematic_file.as_str(),
        pcb_file = manifest.pcb_file.as_str()
    )
}

fn jlcpcb_bom_preview_csv(parts: &[PartSelection]) -> String {
    let mut csv = "Designator,Footprint,Quantity,Value,LCSC Part #\r\n".to_string();

    for part in parts {
        csv.push_str(&format!(
            "{},{},{},{},{}\r\n",
            csv_field(&part.designator),
            csv_field(&part.footprint),
            part_quantity(&part.designator),
            csv_field(&part.value),
            csv_field(&part.lcsc_part_number)
        ));
    }

    csv
}

fn jlcpcb_cpl_preview_csv(parts: &[PartSelection]) -> String {
    let mut csv = "Designator,Mid X,Mid Y,Rotation,Layer\r\n".to_string();

    for part in parts {
        csv.push_str(&format!(
            "{},UNPLACED,UNPLACED,0,{}\r\n",
            csv_field(&part.designator),
            csv_field(&part.placement_layer)
        ));
    }

    csv
}

fn manufacturing_readiness_preview(prompt: &str) -> String {
    format!(
        "JLCPCB Manufacturing Preview\r\n\
         =============================\r\n\
         \r\n\
         Request:\r\n\
         {prompt}\r\n\
         \r\n\
         Files in this preview:\r\n\
         - BOM preview: jlcpcb-bom-preview.csv\r\n\
         - CPL preview: jlcpcb-cpl-preview.csv\r\n\
         \r\n\
         Upload blockers:\r\n\
         - Gerber zip: blocked until PCB layout and plot output exist.\r\n\
         - Drill file: blocked until PCB layout output exists.\r\n\
         - BOM: preview only until schematic symbols and quantities are reviewed.\r\n\
         - CPL: preview only; UNPLACED coordinates must be replaced by real placement.\r\n\
         - Release gate: prototype-review, not order-ready.\r\n\
         \r\n\
         Do not upload this preview to JLCPCB.\r\n",
        prompt = prompt.trim()
    )
}

fn part_quantity(designator: &str) -> usize {
    designator
        .split(',')
        .filter(|part| !part.trim().is_empty())
        .count()
        .max(1)
}

fn csv_field(value: &str) -> String {
    if value.contains([',', '"', '\r', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
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
      (gr_text \"ChatPCB3 ESP32-S3\"\r\n\
        (at 35 16 0)\r\n\
        (layer \"F.SilkS\")\r\n\
        (effects\r\n\
          (font\r\n\
            (size 1.0 1.0)\r\n\
            (thickness 0.1)\r\n\
          )\r\n\
        )\r\n\
        (uuid \"77777777-7777-4777-8777-777777777777\")\r\n\
      )\r\n\
      (gr_text \"USB-C Sensor Preview\"\r\n\
        (at 35 19 0)\r\n\
        (layer \"F.SilkS\")\r\n\
        (effects\r\n\
          (font\r\n\
            (size 0.9 0.9)\r\n\
            (thickness 0.09)\r\n\
          )\r\n\
        )\r\n\
        (uuid \"88888888-8888-4888-8888-888888888888\")\r\n\
      )\r\n\
      (gr_text \"50mm x 50mm preview - not order-ready\"\r\n\
        (at 35 22 0)\r\n\
        (layer \"F.SilkS\")\r\n\
        (effects\r\n\
          (font\r\n\
            (size 0.8 0.8)\r\n\
            (thickness 0.08)\r\n\
          )\r\n\
        )\r\n\
        (uuid \"99999999-9999-4999-8999-999999999999\")\r\n\
      )\r\n\
    )\r\n"
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}
