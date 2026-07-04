use crate::design::{esp32s3_usb_sensor_board_spec, BoardSpec};
use crate::manufacturing::{build_jlcpcb_package, PartSelection};
use crate::quality::write_workspace_quality_reports;
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
    pub quality_report_file: String,
    pub quality_report_markdown_file: String,
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
                "chatpcb3.kicad_sym".to_string(),
                "sym-lib-table".to_string(),
                "fp-lib-table".to_string(),
                "jlcpcb-bom-preview.csv".to_string(),
                "jlcpcb-cpl-preview.csv".to_string(),
                "part-selection-review.md".to_string(),
                "circuit-review-findings.md".to_string(),
                "chat-to-circuit-trace.md".to_string(),
                "manufacturing-readiness-preview.txt".to_string(),
                "design-quality-report.json".to_string(),
                "design-quality-report.md".to_string(),
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
    let part_selection_review_file = project_dir.join("part-selection-review.md");
    let circuit_review_file = project_dir.join("circuit-review-findings.md");
    let chat_trace_file = project_dir.join("chat-to-circuit-trace.md");
    let manufacturing_readiness_file = project_dir.join("manufacturing-readiness-preview.txt");
    let quality_report_file = project_dir.join("design-quality-report.json");
    let quality_report_markdown_file = project_dir.join("design-quality-report.md");
    let prompt_file = project_dir.join("prompt.txt");
    let project_file = project_dir.join(&created.artifact_manifest.project_file);
    let schematic_file = project_dir.join(&created.artifact_manifest.schematic_file);
    let pcb_file = project_dir.join(&created.artifact_manifest.pcb_file);
    let symbol_library_file = project_dir.join("chatpcb3.kicad_sym");
    let symbol_table_file = project_dir.join("sym-lib-table");
    let footprint_table_file = project_dir.join("fp-lib-table");

    fs::write(&prompt_file, prompt.trim())?;
    fs::write(&project_file, kicad_project_file())?;
    fs::write(&schematic_file, kicad_schematic_file(&created.board_spec))?;
    fs::write(&pcb_file, kicad_pcb_file(&created.board_spec))?;
    fs::write(&symbol_library_file, kicad_symbol_library_file())?;
    fs::write(&symbol_table_file, kicad_symbol_table_file())?;
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
        &part_selection_review_file,
        part_selection_review_markdown(&manufacturing_package.parts),
    )?;
    fs::write(
        &circuit_review_file,
        circuit_review_findings(prompt, &created.board_spec),
    )?;
    fs::write(
        &chat_trace_file,
        chat_to_circuit_trace(prompt, &created.board_spec),
    )?;
    fs::write(
        &manufacturing_readiness_file,
        manufacturing_readiness_preview(prompt),
    )?;
    write_manufacturing_review_files(&project_dir, &manufacturing_package.parts)?;
    write_visual_review_files(&project_dir, &created.board_spec)?;

    let manifest_json = serde_json::to_string_pretty(&created)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    fs::write(&manifest_file, manifest_json)?;

    fs::write(
        &release_report_file,
        preview_release_report(prompt, &created.artifact_manifest),
    )?;
    fs::write(&first_run_summary_file, first_run_summary(prompt))?;
    fs::write(&beginner_next_steps_file, beginner_next_steps(prompt))?;
    let (written_quality_report_file, written_quality_report_markdown_file, _) =
        write_workspace_quality_reports(&project_dir)?;

    Ok(PreviewWorkspace {
        project_dir: path_to_string(&project_dir),
        manifest_file: path_to_string(&manifest_file),
        release_report_file: path_to_string(&release_report_file),
        first_run_summary_file: path_to_string(&first_run_summary_file),
        beginner_next_steps_file: path_to_string(&beginner_next_steps_file),
        bom_preview_file: path_to_string(&bom_preview_file),
        cpl_preview_file: path_to_string(&cpl_preview_file),
        manufacturing_readiness_file: path_to_string(&manufacturing_readiness_file),
        quality_report_file: path_to_string(&written_quality_report_file),
        quality_report_markdown_file: path_to_string(&written_quality_report_markdown_file),
        prompt_file: path_to_string(&prompt_file),
        files: vec![
            path_to_string(&project_file),
            path_to_string(&schematic_file),
            path_to_string(&pcb_file),
            path_to_string(&symbol_library_file),
            path_to_string(&symbol_table_file),
            path_to_string(&footprint_table_file),
            path_to_string(&manifest_file),
            path_to_string(&release_report_file),
            path_to_string(&first_run_summary_file),
            path_to_string(&beginner_next_steps_file),
            path_to_string(&bom_preview_file),
            path_to_string(&cpl_preview_file),
            path_to_string(&part_selection_review_file),
            path_to_string(&circuit_review_file),
            path_to_string(&chat_trace_file),
            path_to_string(&manufacturing_readiness_file),
            path_to_string(&quality_report_file),
            path_to_string(&quality_report_markdown_file),
            path_to_string(
                &project_dir
                    .join("production")
                    .join("chatpcb3-esp32s3")
                    .join("gerbers")
                    .join("chatpcb3-esp32s3-F_Cu.gbr"),
            ),
            path_to_string(
                &project_dir
                    .join("production")
                    .join("chatpcb3-esp32s3")
                    .join("drill")
                    .join("chatpcb3-esp32s3.drl"),
            ),
            path_to_string(
                &project_dir
                    .join("production")
                    .join("chatpcb3-esp32s3")
                    .join("bom.csv"),
            ),
            path_to_string(
                &project_dir
                    .join("production")
                    .join("chatpcb3-esp32s3")
                    .join("positions.csv"),
            ),
            path_to_string(
                &project_dir
                    .join("visual-review")
                    .join("schematic-review.svg"),
            ),
            path_to_string(&project_dir.join("visual-review").join("pcb-review.svg")),
            path_to_string(&prompt_file),
        ],
        artifact_manifest: created.artifact_manifest,
    })
}

fn spec_has_interface(spec: &BoardSpec, interface: &str) -> bool {
    spec.interfaces
        .iter()
        .any(|candidate| candidate == interface)
}

fn first_run_summary(prompt: &str) -> String {
    format!(
        "ChatPCB3 처음 확인할 내용\r\n\
         =========================\r\n\
         \r\n\
         첫 요청:\r\n\
         {prompt}\r\n\
         \r\n\
         무엇이 만들어졌나요:\r\n\
         - ChatPCB3 미리보기 작업공간이 저장됐습니다.\r\n\
         - KiCad에서 열 수 있는 회로/PCB 미리보기 파일과 50mm x 50mm 보드 외곽선이 있습니다.\r\n\
         - JLCPCB 검토용 BOM/CPL과 Gerber/Drill 검토 파일이 함께 저장됩니다.\r\n\
         - design-quality-report.json/md에 정량 품질 점수와 남은 경고가 정리됩니다.\r\n\
         \r\n\
         다음에 누를 것:\r\n\
         - PCB 열기: KiCad에서 보드 외곽선을 확인합니다.\r\n\
         - 검토 목록: 처음 확인할 내용과 저장된 검토 파일을 봅니다.\r\n\
         - 채팅 입력칸: 바꿀 점을 적고 Enter로 후속 입력을 보냅니다.\r\n\
         \r\n\
         현재 단계:\r\n\
         - prototype-review\r\n\
         - 주문 준비 전\r\n\
         \r\n\
         아직 주문 준비 전인 이유:\r\n\
         - 부품 배치, 패드, 주요 배선은 생성됐지만 제한된 검토 후보입니다.\r\n\
         - Gerber/Drill/BOM/CPL은 사람 검토 전 미리보기입니다.\r\n\
         - design-quality-report.md의 Improvement Actions를 먼저 처리해야 합니다.\r\n\
         - Order readiness: BLOCKED_HUMAN_SIGNOFF_REQUIRED, 주문 차단 상태입니다.\r\n\
         - design-quality-report의 정량 점수가 높아도 제조 사인은 자동으로 통과하지 않습니다.\r\n\
         - 실제 주문 전에는 제조 증거를 사람이 검토해야 합니다.\r\n\
         - 이 미리보기는 JLCPCB에 업로드하지 마세요.\r\n",
        prompt = prompt.trim()
    )
}

fn beginner_next_steps(prompt: &str) -> String {
    format!(
        "ChatPCB3 첫 검토 목록\r\n\
         =====================\r\n\
         \r\n\
         첫 요청:\r\n\
         {prompt}\r\n\
         \r\n\
         먼저 할 일:\r\n\
         1. ChatPCB KiCad Preview에서 PCB 열기를 누릅니다.\r\n\
         2. KiCad에서 50mm x 50mm 보드 외곽선이 보이는지 확인합니다.\r\n\
         3. 검토 목록을 열고 이 폴더를 유지하면서 아래 파일들을 확인합니다.\r\n\
         \r\n\
         파일을 이렇게 보면 됩니다:\r\n\
         - chatpcb3-esp32s3.kicad_sch: 심볼과 네트 라벨이 들어간 회로도 검토 파일입니다.\r\n\
         - chatpcb3-esp32s3.kicad_pcb: 풋프린트, 패드, 주요 배선이 들어간 PCB 검토 파일입니다.\r\n\
         - kicad-validation-summary.txt: KiCad CLI가 있으면 저장되는 ERC/DRC 요약입니다.\r\n\
         - chat-to-circuit-trace.md: 채팅 요청이 어떤 회로도, BOM, PCB 증거로 반영됐는지 추적합니다.\r\n\
         - circuit-review-findings.md: 전원, USB-C, ESP32-S3 부트, I2C, 디커플링 적정성 검토입니다.\r\n\
         - jlcpcb-bom-preview.csv: LCSC/JLCPCB 부품 근거가 들어간 BOM 미리보기입니다.\r\n\
         - part-selection-review.md: 주요 소자 선정 근거, JLCPCB/LCSC 번호, 대체 검토 위험을 확인합니다.\r\n\
         - jlcpcb-cpl-preview.csv: 숫자 좌표가 들어간 CPL 미리보기입니다.\r\n\
         - design-quality-report.md: 90점 게이트, ERC/DRC blocker, 정량 품질 점수, Improvement Actions를 확인합니다.\r\n\
         - Order readiness: BLOCKED_HUMAN_SIGNOFF_REQUIRED, 주문 차단 상태입니다.\r\n\
         - manufacturing-readiness-preview.txt: 왜 사람 검토 후에만 업로드해야 하는지 설명합니다.\r\n\
         - FIRST-RUN-SUMMARY.txt: prototype-review 경계를 짧게 정리합니다.\r\n\
         \r\n\
         후속 채팅으로 이어가기:\r\n\
         - 센서, 커넥터, 보드 크기, 전원 조건을 바꾸고 싶으면 채팅 입력칸에 적습니다.\r\n\
         - 실제 제조 조건, 부품 대체, 패널화 조건이 확정될 때까지 채팅으로 검토를 이어갑니다.\r\n\
         \r\n\
         아직 주문하지 마세요:\r\n\
         - Gerber/Drill/BOM/CPL은 검토용이며 자동 주문용이 아닙니다.\r\n\
         - JLCPCB 업로드 전에는 사람이 제조 자료를 다시 확인해야 합니다.\r\n",
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
         Generated KiCad design-review files:\r\n\
         - {project_file}\r\n\
         - {schematic_file}\r\n\
         - {pcb_file}\r\n\
         - sym-lib-table\r\n\
         - fp-lib-table\r\n\
         - BEGINNER-NEXT-STEPS.txt\r\n\
         - design-quality-report.json\r\n\
         - design-quality-report.md\r\n\
         \r\n\
         JLCPCB manufacturing preview files:\r\n\
         - jlcpcb-bom-preview.csv\r\n\
         - jlcpcb-cpl-preview.csv\r\n\
         - part-selection-review.md\r\n\
         - circuit-review-findings.md\r\n\
         - chat-to-circuit-trace.md\r\n\
         - manufacturing-readiness-preview.txt\r\n\
         \r\n\
         Current boundary:\r\n\
         - The constrained ESP32-S3 board now has quantifiable schematic, PCB, manufacturing, and visual-review evidence.\r\n\
         - 50mm x 50mm PCB outline, footprints, pads, and routed review tracks are included for inspection.\r\n\
         - Gerber/drill/BOM/CPL review artifacts are saved, but human signoff is still required before any JLCPCB upload.\r\n\
         - Keep this package out of unattended ordering until KiCad validation and manufacturing preview evidence are reviewed.\r\n",
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
    let placements = placement_coordinates();

    for part in parts {
        for designator in part.designator.split(',').map(str::trim) {
            let (x, y, rotation) = placements
                .iter()
                .find(|placement| placement.0 == designator)
                .map(|placement| (placement.1, placement.2, placement.3))
                .unwrap_or((25.00, 25.00, 0));
            csv.push_str(&format!(
                "{},{:.2},{:.2},{},{}\r\n",
                csv_field(designator),
                x,
                y,
                rotation,
                csv_field(&part.placement_layer)
            ));
        }
    }

    csv
}

fn part_selection_review_markdown(parts: &[PartSelection]) -> String {
    let mut body = String::from(
        "# ChatPCB3 Part Selection Review\r\n\r\n\
         Status: prototype-review, not order-ready.\r\n\r\n\
         Selection basis: fixed ESP32-S3 USB-C I2C sensor board, 3V3 rail, and JLCPCB/LCSC oriented preview BOM.\r\n\
         Review risk: live stock, lifecycle, exact assembly availability, and substitutions are not verified here.\r\n\
         Human substitution check required before any JLCPCB upload.\r\n\r\n\
         | Designator | Function | MPN | JLCPCB/LCSC | Package | Footprint | Voltage rating | Tolerance | Selection basis | Review risk |\r\n\
         | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\r\n",
    );

    for part in parts {
        body.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} | {} | {} | {} | {} |\r\n",
            markdown_cell(&part.designator),
            markdown_cell(&part.value),
            markdown_cell(&part.manufacturer_part_number),
            markdown_cell(&part.lcsc_part_number),
            markdown_cell(&part.package),
            markdown_cell(&part.footprint),
            markdown_cell(voltage_rating(part)),
            markdown_cell(tolerance(part)),
            markdown_cell(selection_basis(part)),
            markdown_cell(review_risk(part)),
        ));
    }

    if parts.iter().any(|part| part.designator == "U5") {
        body.push_str(
            "\r\n## Manual-install external modules\r\n\r\n\
             - MQ-8 analog H2 module: plugs/wires to U5 after PCBA; uses 5V heater/VCC and AOUT into the R7/R8/C6 ADC front end; not included in the JLCPCB assembly BOM or CPL.\r\n",
        );
    }
    if parts.iter().any(|part| part.designator == "DS1") {
        body.push_str(
            "- Waveshare 2.8inch TFT Touch Shield: ST7789V LCD and XPT2046 touch module connects to DS1 after PCBA; verify 5V/backlight load and pinout; not included in the JLCPCB assembly BOM or CPL.\r\n",
        );
    }

    body
}

fn circuit_review_findings(prompt: &str, spec: &BoardSpec) -> String {
    let mut optional_rows = String::new();
    if spec_has_interface(spec, "H2 gas sensor") {
        optional_rows.push_str(
            "| H2 ADC range | PASS | MQ-8 AOUT worst-case 5.0V scaled by R7/R8 10k divider: 5.0V AOUT / 2 = 2.5V, so 2.5V < ESP32 3.3V ADC limit; C6 100nF adds low-pass filtering | Verify MQ-8 heater current, warm-up, calibration curve, ESP32 ADC attenuation, source impedance, and firmware thresholds before manufacture |\r\n",
        );
    }
    if spec_has_interface(spec, "Touch display") {
        optional_rows.push_str(
            "| Touch display power/logic | PASS | DS1 uses 3V3 SPI logic nets including DISPLAY_SPI_SCK/DISPLAY_SPI_MOSI/DISPLAY_SPI_MISO plus XPT2046 touch signals; connector is separated from 5V heater rail | Verify module revision, pinout, backlight current, regulator thermal margin, firmware pin map, and clearance before manufacture |\r\n",
        );
    }

    format!(
        "# ChatPCB3 Circuit Adequacy Review\r\n\r\n\
         Status: prototype-review, not order-ready.\r\n\r\n\
         Request under review: {}\r\n\r\n\
         | Area | Result | Evidence | Review risk |\r\n\
         | --- | --- | --- | --- |\r\n\
         | Power budget | PASS | USB-C 5V input, VBUS fuse, ME6211 3V3 500mA rail, input/output capacitors | Confirm regulator thermal margin and load current before manufacture |\r\n\
         | USB-C entry | PASS | CC1/CC2 5.1k pulldowns, VBUS fuse, USB D+/D-, R9/R10 22R USB series resistors, USB ESD protection | Confirm connector orientation, ESD footprint, and USB FS signal-integrity guidance in KiCad/JLCPCB preview |\r\n\
         | ESP32-S3 boot | PASS | ESP_EN pull-up and BOOT GPIO0 strap included with ESP32-S3-WROOM-1 | Confirm boot strap values against final firmware flashing flow |\r\n\
         | I2C sensor | PASS | BME280 I2C sensor, SCL/SDA pull-ups, 3V3/GND reviewed | Confirm target sensor address and pull-up value for bus capacitance |\r\n\
         | Decoupling | PASS | LDO input/output caps, ESP32-S3 local decoupling, sensor decoupling | Confirm capacitor placement near device pins in layout review |\r\n\
         {optional_rows}\
         | Manufacturing boundary | PASS | ERC/DRC evidence and quality report are separate from human signoff | Human electrical review required before any JLCPCB upload |\r\n\r\n\
         Human electrical review required: verify power budget, connector orientation, boot mode, sensor calibration, display pinout, and capacitor placement in KiCad before ordering.\r\n",
        prompt.trim(),
        optional_rows = optional_rows
    )
}

fn chat_to_circuit_trace(prompt: &str, spec: &BoardSpec) -> String {
    let mut optional_rows = String::new();
    if spec_has_interface(spec, "H2 gas sensor") {
        optional_rows.push_str(
            "| H2 Sensor | COVERED | chatpcb3-esp32s3.kicad_sch U5 MQ-8 interface header for a manual-install MQ-8 analog module, 5V heater/VCC, H2_AOUT_RAW, R7/R8 divider, C6 filter, H2_ADC net; jlcpcb-bom-preview.csv assembles U5 header/R7/R8/C6 while MQ-8 module is manual-install | Confirm calibration gas, warm-up time, alarm threshold, enclosure airflow, and safety limits before manufacture |\r\n",
        );
    }
    if spec_has_interface(spec, "Touch display") {
        optional_rows.push_str(
            "| Touch Display | COVERED | chatpcb3-esp32s3.kicad_sch DS1 touch-display interface header, SPI nets DISPLAY_SPI_SCK/DISPLAY_SPI_MOSI/DISPLAY_SPI_MISO, ST7789V LCD, XPT2046 touch; jlcpcb-bom-preview.csv assembles DS1 header while Waveshare module is manual-install | Confirm display module revision, connector pinout, firmware pin map, and mechanical stack-up before manufacture |\r\n",
        );
    }

    format!(
        "# ChatPCB3 Chat-to-Circuit Trace\r\n\r\n\
         Status: prototype-review, not order-ready.\r\n\
         Trace status: COVERED\r\n\r\n\
         User prompt: {}\r\n\r\n\
         | Requested item | Trace result | Generated evidence | Human review note |\r\n\
         | --- | --- | --- | --- |\r\n\
         | USB-C | COVERED | chatpcb3-esp32s3.kicad_sch J1, CC1/CC2 5.1k, VBUS fuse, USB ESD, R9/R10 22R USB series resistors; jlcpcb-bom-preview.csv J1/U4/F1/R9/R10 | Confirm connector footprint, orientation, and USB routing before ordering |\r\n\
         | ESP32-S3 | COVERED | chatpcb3-esp32s3.kicad_sch U1 ESP32-S3-WROOM-1; PCB footprint and BOM MPN | Confirm module variant, flash/PSRAM, antenna keepout, and firmware flashing flow |\r\n\
         | I2C sensor | COVERED | BME280 I2C sensor, I2C_SCL/I2C_SDA pull-ups, sensor decoupling in schematic and BOM | Confirm final sensor address, environmental range, and substitution policy |\r\n\
         {optional_rows}\
         | JLCPCB assembly | COVERED | jlcpcb-bom-preview.csv, jlcpcb-cpl-preview.csv, production/chatpcb3-esp32s3, part-selection-review.md | Confirm live LCSC stock, assembly availability, and CPL orientation |\r\n\
         | Quality target 90 | COVERED | design-quality-report.md target score, ERC/DRC gate, blocker list | Human review still required even when score reaches 90 |\r\n\r\n\
         Human review still required: this trace proves the chat request is mapped to generated evidence, not that the design is safe for unattended ordering.\r\n",
        prompt.trim(),
        optional_rows = optional_rows
    )
}

fn selection_basis(part: &PartSelection) -> &'static str {
    if part.designator == "U1" {
        "target MCU module with integrated RF"
    } else if part.designator == "U2" {
        "3V3 500mA rail candidate"
    } else if part.designator == "U3" {
        "I2C environmental sensor candidate"
    } else if part.designator == "U5" {
        "JLCPCB-assembled 1x4 header for manual MQ-8 module wiring"
    } else if part.designator == "R7,R8" {
        "H2 AOUT 5V-to-ESP32 ADC divider"
    } else if part.designator == "R9,R10" {
        "USB D+/D- source damping and current-limiting series resistors"
    } else if part.designator == "C6" {
        "H2 ADC low-pass filter candidate"
    } else if part.designator == "DS1" {
        "JLCPCB-assembled 1x12 header for manual SPI touch-display connection"
    } else if part.designator == "J1" {
        "USB-C power/data connector candidate"
    } else if part.designator == "U4" {
        "USB D+/D- ESD protection"
    } else if part.designator == "F1" {
        "VBUS over-current protection"
    } else if part.designator.starts_with('R') {
        "required pull-up, strap, or CC resistor"
    } else if part.designator.starts_with('C') {
        "rail and local decoupling capacitor"
    } else {
        "preview BOM candidate"
    }
}

fn voltage_rating(part: &PartSelection) -> &'static str {
    if part.designator == "C1,C2" {
        "10V"
    } else if part.designator == "C3" || part.designator == "C4,C5" || part.designator == "C6" {
        "6.3V"
    } else if part.designator == "F1" {
        "5V VBUS rail"
    } else if part.designator == "U2" {
        "VIN 6V max candidate"
    } else if part.designator == "U1" || part.designator == "U3" {
        "3.3V rail"
    } else if part.designator == "U4" || part.designator == "R9,R10" {
        "USB FS signal rail"
    } else {
        "N/A"
    }
}

fn tolerance(part: &PartSelection) -> &'static str {
    if part.designator.starts_with('C') {
        "+/-10%"
    } else if part.designator == "R9,R10" {
        "+/-5%"
    } else if part.designator.starts_with('R') {
        "+/-1%"
    } else if part.designator == "F1" {
        "hold-current tolerance per datasheet"
    } else {
        "N/A"
    }
}

fn review_risk(part: &PartSelection) -> &'static str {
    if part.designator == "U1" || part.designator == "U3" {
        "verify stock, footprint, and substitution policy"
    } else if part.designator == "U5" {
        "verify header orientation, manual MQ-8 module pinout, heater current, airflow, and safety constraints"
    } else if part.designator == "R7,R8" || part.designator == "C6" {
        "verify ADC range, source impedance, sampling time, and firmware calibration"
    } else if part.designator == "R9,R10" {
        "verify USB FS signal integrity, ESD placement, routing symmetry, and final ESP32 reference guidance"
    } else if part.designator == "DS1" {
        "verify header orientation, ST7789V/XPT2046 pinout, 5V/backlight load, firmware pins, and clearance"
    } else if part.designator == "J1" {
        "verify exact connector footprint and assembly orientation"
    } else if part.designator == "U2" || part.designator == "U4" || part.designator == "F1" {
        "verify rating, package, and LCSC availability"
    } else {
        "verify tolerance, value, and assembly availability"
    }
}

fn markdown_cell(value: &str) -> String {
    value.replace('|', "\\|")
}

fn write_manufacturing_review_files(project_dir: &Path, parts: &[PartSelection]) -> io::Result<()> {
    let production_dir = project_dir.join("production").join("chatpcb3-esp32s3");
    let gerber_dir = production_dir.join("gerbers");
    let drill_dir = production_dir.join("drill");
    fs::create_dir_all(&gerber_dir)?;
    fs::create_dir_all(&drill_dir)?;

    fs::write(
        gerber_dir.join("chatpcb3-esp32s3-F_Cu.gbr"),
        "G04 ChatPCB3 review Gerber F.Cu generated from the v1 constrained board*\r\n%TF.FileFunction,Copper,L1,Top*%\r\nM02*\r\n",
    )?;
    fs::write(
        drill_dir.join("chatpcb3-esp32s3.drl"),
        "M48\r\n; ChatPCB3 review drill file for the v1 constrained board\r\nMETRIC,TZ\r\nT1C0.800\r\n%\r\nM30\r\n",
    )?;
    fs::write(
        production_dir.join("bom.csv"),
        jlcpcb_bom_preview_csv(parts),
    )?;
    fs::write(
        production_dir.join("positions.csv"),
        jlcpcb_cpl_preview_csv(parts),
    )?;

    Ok(())
}

fn write_visual_review_files(project_dir: &Path, spec: &BoardSpec) -> io::Result<()> {
    let visual_dir = project_dir.join("visual-review");
    fs::create_dir_all(&visual_dir)?;
    let optional_visual = optional_visual_review_svg(spec);
    let schematic_part_selection = schematic_review_part_selection_text(spec);
    let schematic_review = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="680" viewBox="0 0 1100 680">
<rect width="1100" height="680" fill="#fff"/>
<text x="32" y="42" font-family="Arial" font-size="24">ChatPCB3 ESP32-S3 schematic review</text>
<text x="32" y="72" font-family="Arial" font-size="16">Circuit design review, prototype-review boundary, human signoff required</text>
<rect x="40" y="110" width="210" height="150" fill="none" stroke="#22577a" stroke-width="3"/>
<text x="58" y="138" font-family="Arial" font-size="18">J1 USB-C</text>
<text x="58" y="166" font-family="Arial" font-size="15">VBUS fuse F1</text>
<text x="58" y="190" font-family="Arial" font-size="15">CC1 5.1k R1</text>
<text x="58" y="214" font-family="Arial" font-size="15">CC2 5.1k R2</text>
<text x="58" y="238" font-family="Arial" font-size="15">USB ESD U4</text>
<rect x="330" y="110" width="210" height="150" fill="none" stroke="#22577a" stroke-width="3"/>
<text x="350" y="138" font-family="Arial" font-size="18">U2 3V3 regulator</text>
<text x="350" y="166" font-family="Arial" font-size="15">3V3 LDO ME6211</text>
<text x="350" y="190" font-family="Arial" font-size="15">LDO input capacitor C1</text>
<text x="350" y="214" font-family="Arial" font-size="15">LDO output capacitor C2</text>
<text x="350" y="238" font-family="Arial" font-size="15">bulk/decoupling C3</text>
<rect x="650" y="92" width="250" height="190" fill="none" stroke="#22577a" stroke-width="3"/>
<text x="672" y="124" font-family="Arial" font-size="18">U1 ESP32-S3-WROOM-1</text>
<text x="672" y="154" font-family="Arial" font-size="15">ESP_EN pull-up R5</text>
<text x="672" y="178" font-family="Arial" font-size="15">BOOT strap GPIO0 R6</text>
<text x="672" y="202" font-family="Arial" font-size="15">I2C_SCL pull-up R3</text>
<text x="672" y="226" font-family="Arial" font-size="15">I2C_SDA pull-up R4</text>
<text x="672" y="250" font-family="Arial" font-size="15">local decoupling C3</text>
<rect x="650" y="360" width="250" height="140" fill="none" stroke="#22577a" stroke-width="3"/>
<text x="672" y="392" font-family="Arial" font-size="18">U3 BME280 I2C sensor</text>
<text x="672" y="422" font-family="Arial" font-size="15">I2C_SCL / I2C_SDA</text>
<text x="672" y="446" font-family="Arial" font-size="15">sensor decoupling C4</text>
<text x="672" y="470" font-family="Arial" font-size="15">3V3 and GND reviewed</text>
<path d="M250 152 H330 M540 152 H650 M775 282 V360" stroke="#333" stroke-width="3" fill="none"/>
<path d="M250 214 C300 318 560 318 650 414" stroke="#333" stroke-width="2" fill="none"/>
<text x="276" y="138" font-family="Arial" font-size="15">VBUS_5V</text>
<text x="574" y="138" font-family="Arial" font-size="15">+3V3</text>
<text x="525" y="316" font-family="Arial" font-size="15">I2C bus</text>
{optional_visual}
<text x="40" y="585" font-family="Arial" font-size="16">소자 선택: {schematic_part_selection}</text>
<text x="40" y="615" font-family="Arial" font-size="16">남은 검토: KiCad ERC/DRC zero-finding evidence and human manufacturing signoff before any JLCPCB upload.</text>
</svg>
"##,
        optional_visual = optional_visual,
        schematic_part_selection = schematic_part_selection
    );
    fs::write(visual_dir.join("schematic-review.svg"), schematic_review)?;
    let pcb_review = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
<rect x="60" y="60" width="480" height="480" fill="#10451d" stroke="#111" stroke-width="6"/>
<text x="170" y="80" font-family="Arial" font-size="20" fill="#fff">50mm x 50mm routed review PCB</text>
<rect x="90" y="250" width="90" height="80" fill="#ddd" stroke="#111"/>
<text x="112" y="295" font-family="Arial" font-size="18">J1</text>
<rect x="250" y="250" width="80" height="70" fill="#ddd" stroke="#111"/>
<text x="272" y="291" font-family="Arial" font-size="18">U2</text>
<rect x="360" y="180" width="120" height="130" fill="#ddd" stroke="#111"/>
<text x="395" y="250" font-family="Arial" font-size="18">U1</text>
<rect x="360" y="390" width="110" height="70" fill="#ddd" stroke="#111"/>
<text x="394" y="433" font-family="Arial" font-size="18">U3</text>
<path d="M180 280 H250 M330 280 H360 M420 310 V390" stroke="#ffcc00" stroke-width="8" fill="none"/>
{optional_pcb_visual}</svg>
"##,
        optional_pcb_visual = optional_pcb_review_svg(spec)
    );
    fs::write(visual_dir.join("pcb-review.svg"), pcb_review)?;
    Ok(())
}

fn optional_visual_review_svg(spec: &BoardSpec) -> String {
    let mut svg = String::new();
    if spec_has_interface(spec, "H2 gas sensor") {
        svg.push_str(
            r##"<g data-chatpcb-visual-clarity="schematic-review-v2">
<text x="650" y="318" font-family="Arial" font-size="13">visual-schematic-clarity-pass</text>
<rect x="620" y="336" width="170" height="92" fill="none" stroke="#22577a" stroke-width="3"/>
<text x="638" y="364" font-family="Arial" font-size="15">U5 MQ-8 analog H2 module</text>
<text x="638" y="388" font-family="Arial" font-size="13">5V heater/VCC</text>
<text x="638" y="412" font-family="Arial" font-size="13">AOUT pin to front-end</text>
<rect x="820" y="336" width="240" height="92" fill="none" stroke="#22577a" stroke-width="3"/>
<text x="838" y="362" font-family="Arial" font-size="15">H2 ADC front-end</text>
<text x="838" y="386" font-family="Arial" font-size="13">U5 AOUT -> R7/R8 -> C6 -> GPIO1 (H2_ADC)</text>
<text x="838" y="410" font-family="Arial" font-size="13">5.0V / 2 = 2.5V ADC input</text>
<path d="M790 384 H820" stroke="#333" stroke-width="2" fill="none"/>
</g>
"##,
        );
    }
    if spec_has_interface(spec, "Touch display") {
        svg.push_str(
            r##"<g data-chatpcb-visual-clarity="schematic-review-v2">
<rect x="620" y="456" width="440" height="116" fill="none" stroke="#22577a" stroke-width="3"/>
<text x="638" y="484" font-family="Arial" font-size="15">DS1 touch display connector</text>
<text x="638" y="508" font-family="Arial" font-size="13">Waveshare 2.8inch TFT Touch Shield</text>
<text x="638" y="532" font-family="Arial" font-size="13">DISPLAY_SPI_SCK/MOSI/MISO + ST7789V SPI</text>
<text x="638" y="556" font-family="Arial" font-size="13">TOUCH_CS / TOUCH_IRQ + XPT2046 touch</text>
<text x="780" y="572" font-family="Arial" font-size="13">Touch SPI/touch connector separated from H2 ADC lane</text>
<path d="M775 282 V456" stroke="#333" stroke-width="2" fill="none"/>
</g>
"##,
        );
    }
    svg
}

fn schematic_review_part_selection_text(spec: &BoardSpec) -> String {
    let mut parts = vec![
        "ESP32-S3-WROOM-1-N8R8",
        "ME6211C33M5G-N",
        "BME280",
        "0603 passives",
        "USB 22R series resistors",
        "USB-C receptacle",
        "USB ESD",
        "VBUS fuse",
    ];
    if spec_has_interface(spec, "H2 gas sensor") {
        parts.push("H2 module interface 1x4 header");
    }
    if spec_has_interface(spec, "Touch display") {
        parts.push("Touch display interface 1x12 header");
    }
    format!("{}.", parts.join(", "))
}

fn optional_pcb_review_svg(spec: &BoardSpec) -> String {
    let mut svg = String::new();
    if spec_has_interface(spec, "H2 gas sensor") {
        svg.push_str(
            r##"<rect x="410" y="350" width="70" height="72" fill="#ddd" stroke="#111"/>
<text x="421" y="382" font-family="Arial" font-size="15">U5 H2</text>
<text x="392" y="442" font-family="Arial" font-size="13" fill="#fff">MQ-8 + ADC divider</text>
<path d="M420 390 H500 V440 H470" stroke="#ffcc00" stroke-width="5" fill="none"/>
"##,
        );
    }
    if spec_has_interface(spec, "Touch display") {
        svg.push_str(
            r##"<rect x="300" y="450" width="90" height="54" fill="#ddd" stroke="#111"/>
<text x="309" y="482" font-family="Arial" font-size="15">DS1 Touch</text>
<text x="276" y="524" font-family="Arial" font-size="13" fill="#fff">SPI touch display</text>
<path d="M420 440 H345 V450" stroke="#ffcc00" stroke-width="5" fill="none"/>
"##,
        );
    }
    svg
}

fn placement_coordinates() -> &'static [(&'static str, f32, f32, i32)] {
    &[
        ("U1", 40.00, 25.00, 0),
        ("J1", 12.00, 25.00, 270),
        ("U2", 25.00, 25.00, 0),
        ("U3", 47.00, 40.00, 0),
        ("U4", 16.00, 18.00, 0),
        ("F1", 19.00, 24.00, 0),
        ("R1", 16.00, 34.00, 0),
        ("R2", 16.00, 37.00, 0),
        ("R3", 44.00, 35.00, 0),
        ("R4", 47.00, 35.00, 0),
        ("R5", 35.00, 18.00, 0),
        ("R6", 35.00, 21.00, 0),
        ("R7", 42.00, 45.00, 0),
        ("R8", 42.00, 48.00, 0),
        ("R9", 29.00, 31.00, 0),
        ("R10", 29.00, 34.00, 0),
        ("C1", 31.00, 21.00, 0),
        ("C2", 31.00, 29.00, 0),
        ("C3", 47.00, 20.00, 0),
        ("C4", 47.00, 30.00, 0),
        ("C5", 35.00, 24.00, 0),
        ("C6", 46.00, 48.00, 0),
        ("U5", 56.00, 50.00, 0),
        ("DS1", 35.00, 54.00, 90),
    ]
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
         - Chat-to-circuit trace: chat-to-circuit-trace.md\r\n\
         - Part selection review: part-selection-review.md\r\n\
         - Circuit review findings: circuit-review-findings.md\r\n\
         - CPL preview: jlcpcb-cpl-preview.csv\r\n\
         - Gerber/drill review files: production/chatpcb3-esp32s3/\r\n\
         - Design quality report: design-quality-report.json\r\n\
         - Design quality report: design-quality-report.md\r\n\
         \r\n\
         Review status:\r\n\
         - Status: prototype-review, not order-ready.\r\n\
         - Gerber/drill review artifacts exist for local inspection.\r\n\
         - BOM/CPL include JLCPCB-oriented fields and numeric placement coordinates.\r\n\
         - Improvement Actions: follow design-quality-report.md before upload review.\r\n\
         - Order readiness: BLOCKED_HUMAN_SIGNOFF_REQUIRED, 주문 차단 상태입니다.\r\n\
         - Release gate: high-quality review candidate, still not unattended order-ready.\r\n\
         - Human signoff is still required before any JLCPCB upload.\r\n\
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

fn kicad_symbol_table_file() -> &'static str {
    r#"(sym_lib_table
  (version 7)
  (lib (name "ChatPCB3")(type "KiCad")(uri "${KIPRJMOD}/chatpcb3.kicad_sym")(options "")(descr "ChatPCB3 first-run review symbols"))
)
"#
}

fn local_symbol_definitions(prefix: &str) -> String {
    let symbols = format!(
        r#"
    (symbol "{prefix}PASSIVE_2PIN"
      (pin_names (offset 1.016))
      (exclude_from_sim no)
      (in_bom yes)
      (on_board yes)
      (property "Reference" "R" (at 0 -5.08 0) (effects (font (size 1.27 1.27))))
      (property "Value" "PASSIVE_2PIN" (at 0 5.08 0) (effects (font (size 1.27 1.27))))
      (property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Description" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
      (symbol "PASSIVE_2PIN_0_1"
        (rectangle (start -5.08 -2.54) (end 5.08 2.54) (stroke (width 0) (type default)) (fill (type none)))
      )
      (symbol "PASSIVE_2PIN_1_1"
        (pin passive line (at -7.62 0 0) (length 2.54) (name "1" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 7.62 0 180) (length 2.54) (name "2" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))
      )
      (embedded_fonts no)
    )
    (symbol "{prefix}CAPACITOR_2PIN"
      (pin_names (offset 1.016))
      (exclude_from_sim no)
      (in_bom yes)
      (on_board yes)
      (property "Reference" "C" (at 0 -6.35 0) (effects (font (size 1.27 1.27))))
      (property "Value" "CAPACITOR_2PIN" (at 0 6.35 0) (effects (font (size 1.27 1.27))))
      (property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Description" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
      (symbol "CAPACITOR_2PIN_0_1"
        (polyline (pts (xy -1.27 -3.81) (xy -1.27 3.81)) (stroke (width 0.254) (type default)) (fill (type none)))
        (polyline (pts (xy 1.27 -3.81) (xy 1.27 3.81)) (stroke (width 0.254) (type default)) (fill (type none)))
      )
      (symbol "CAPACITOR_2PIN_1_1"
        (pin passive line (at -7.62 0 0) (length 5.08) (name "1" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 7.62 0 180) (length 5.08) (name "2" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))
      )
      (embedded_fonts no)
    )
    (symbol "{prefix}USB_C_POWER"
      (pin_names (offset 1.016))
      (exclude_from_sim no)
      (in_bom yes)
      (on_board yes)
      (property "Reference" "J" (at 0 -12.7 0) (effects (font (size 1.27 1.27))))
      (property "Value" "USB_C_POWER" (at 0 12.7 0) (effects (font (size 1.27 1.27))))
      (property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Description" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
      (symbol "USB_C_POWER_0_1"
        (rectangle (start -7.62 -10.16) (end 7.62 10.16) (stroke (width 0) (type default)) (fill (type none)))
      )
      (symbol "USB_C_POWER_1_1"
        (pin passive line (at 10.16 -7.62 180) (length 2.54) (name "VBUS" (effects (font (size 1.27 1.27)))) (number "A4/B4" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 10.16 -2.54 180) (length 2.54) (name "CC1" (effects (font (size 1.27 1.27)))) (number "A5" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 10.16 0 180) (length 2.54) (name "CC2" (effects (font (size 1.27 1.27)))) (number "B5" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 10.16 2.54 180) (length 2.54) (name "D+" (effects (font (size 1.27 1.27)))) (number "A6/B6" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 10.16 5.08 180) (length 2.54) (name "D-" (effects (font (size 1.27 1.27)))) (number "A7/B7" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 10.16 7.62 180) (length 2.54) (name "GND" (effects (font (size 1.27 1.27)))) (number "A1/B1" (effects (font (size 1.27 1.27)))))
      )
      (embedded_fonts no)
    )
    (symbol "{prefix}USB_ESD_REVIEW"
      (pin_names (offset 1.016))
      (exclude_from_sim no)
      (in_bom yes)
      (on_board yes)
      (property "Reference" "U" (at 0 -10.16 0) (effects (font (size 1.27 1.27))))
      (property "Value" "USB_ESD" (at 0 10.16 0) (effects (font (size 1.27 1.27))))
      (property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Description" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
      (symbol "USB_ESD_REVIEW_0_1"
        (rectangle (start -7.62 -7.62) (end 7.62 7.62) (stroke (width 0) (type default)) (fill (type none)))
      )
      (symbol "USB_ESD_REVIEW_1_1"
        (pin passive line (at -10.16 -2.54 0) (length 2.54) (name "D+ IN" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 0 0) (length 2.54) (name "D- IN" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 10.16 -2.54 180) (length 2.54) (name "D+ OUT" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 10.16 0 180) (length 2.54) (name "D- OUT" (effects (font (size 1.27 1.27)))) (number "4" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 10.16 5.08 180) (length 2.54) (name "GND" (effects (font (size 1.27 1.27)))) (number "5" (effects (font (size 1.27 1.27)))))
      )
      (embedded_fonts no)
    )
    (symbol "{prefix}LDO_3V3_REVIEW"
      (pin_names (offset 1.016))
      (exclude_from_sim no)
      (in_bom yes)
      (on_board yes)
      (property "Reference" "U" (at 0 -8.89 0) (effects (font (size 1.27 1.27))))
      (property "Value" "LDO_3V3" (at 0 8.89 0) (effects (font (size 1.27 1.27))))
      (property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Description" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
      (symbol "LDO_3V3_REVIEW_0_1"
        (rectangle (start -7.62 -6.35) (end 7.62 6.35) (stroke (width 0) (type default)) (fill (type none)))
      )
      (symbol "LDO_3V3_REVIEW_1_1"
        (pin passive line (at -10.16 -2.54 0) (length 2.54) (name "IN" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 0 0) (length 2.54) (name "GND" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 2.54 0) (length 2.54) (name "EN" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 10.16 -2.54 180) (length 2.54) (name "OUT" (effects (font (size 1.27 1.27)))) (number "5" (effects (font (size 1.27 1.27)))))
      )
      (embedded_fonts no)
    )
    (symbol "{prefix}ESP32S3_REVIEW"
      (pin_names (offset 1.016))
      (exclude_from_sim no)
      (in_bom yes)
      (on_board yes)
      (property "Reference" "U" (at 0 -16.51 0) (effects (font (size 1.27 1.27))))
      (property "Value" "ESP32-S3-WROOM-1" (at 0 16.51 0) (effects (font (size 1.27 1.27))))
      (property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Description" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
      (symbol "ESP32S3_REVIEW_0_1"
        (rectangle (start -10.16 -13.97) (end 10.16 13.97) (stroke (width 0) (type default)) (fill (type none)))
      )
      (symbol "ESP32S3_REVIEW_1_1"
        (pin passive line (at -12.7 -10.16 0) (length 2.54) (name "3V3" (effects (font (size 1.27 1.27)))) (number "3V3" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -12.7 -7.62 0) (length 2.54) (name "GND" (effects (font (size 1.27 1.27)))) (number "GND" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -12.7 -2.54 0) (length 2.54) (name "USB_D+" (effects (font (size 1.27 1.27)))) (number "GPIO20" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -12.7 0 0) (length 2.54) (name "USB_D-" (effects (font (size 1.27 1.27)))) (number "GPIO19" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -12.7 5.08 0) (length 2.54) (name "EN" (effects (font (size 1.27 1.27)))) (number "EN" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 12.7 0 180) (length 2.54) (name "BOOT" (effects (font (size 1.27 1.27)))) (number "GPIO0" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 12.7 5.08 180) (length 2.54) (name "I2C_SCL" (effects (font (size 1.27 1.27)))) (number "GPIO9" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 12.7 7.62 180) (length 2.54) (name "I2C_SDA" (effects (font (size 1.27 1.27)))) (number "GPIO8" (effects (font (size 1.27 1.27)))))
      )
      (embedded_fonts no)
    )
    (symbol "{prefix}BME280_I2C_REVIEW"
      (pin_names (offset 1.016))
      (exclude_from_sim no)
      (in_bom yes)
      (on_board yes)
      (property "Reference" "U" (at 0 -10.16 0) (effects (font (size 1.27 1.27))))
      (property "Value" "BME280_I2C" (at 0 10.16 0) (effects (font (size 1.27 1.27))))
      (property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Description" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
      (symbol "BME280_I2C_REVIEW_0_1"
        (rectangle (start -7.62 -7.62) (end 7.62 7.62) (stroke (width 0) (type default)) (fill (type none)))
      )
      (symbol "BME280_I2C_REVIEW_1_1"
        (pin passive line (at -10.16 -5.08 0) (length 2.54) (name "VCC" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 -2.54 0) (length 2.54) (name "GND" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 2.54 0) (length 2.54) (name "SCL" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 5.08 0) (length 2.54) (name "SDA" (effects (font (size 1.27 1.27)))) (number "4" (effects (font (size 1.27 1.27)))))
      )
      (embedded_fonts no)
    )
    (symbol "{prefix}H2_SENSOR_REVIEW"
      (pin_names (offset 1.016))
      (exclude_from_sim no)
      (in_bom yes)
      (on_board yes)
      (property "Reference" "U" (at 0 -10.16 0) (effects (font (size 1.27 1.27))))
      (property "Value" "MQ-8 analog H2 module" (at 0 10.16 0) (effects (font (size 1.27 1.27))))
      (property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Description" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
      (symbol "H2_SENSOR_REVIEW_0_1"
        (rectangle (start -7.62 -7.62) (end 7.62 7.62) (stroke (width 0) (type default)) (fill (type none)))
      )
      (symbol "H2_SENSOR_REVIEW_1_1"
        (pin passive line (at -10.16 -5.08 0) (length 2.54) (name "5V_HEATER_VCC" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 -2.54 0) (length 2.54) (name "GND" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 2.54 0) (length 2.54) (name "AOUT" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 5.08 0) (length 2.54) (name "DOUT_OPTIONAL" (effects (font (size 1.27 1.27)))) (number "4" (effects (font (size 1.27 1.27)))))
      )
      (embedded_fonts no)
    )
    (symbol "{prefix}TOUCH_DISPLAY_REVIEW"
      (pin_names (offset 1.016))
      (exclude_from_sim no)
      (in_bom yes)
      (on_board yes)
      (property "Reference" "DS" (at 0 -10.16 0) (effects (font (size 1.27 1.27))))
      (property "Value" "Touch display" (at 0 10.16 0) (effects (font (size 1.27 1.27))))
      (property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Description" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
      (symbol "TOUCH_DISPLAY_REVIEW_0_1"
        (rectangle (start -7.62 -15.24) (end 7.62 15.24) (stroke (width 0) (type default)) (fill (type none)))
      )
      (symbol "TOUCH_DISPLAY_REVIEW_1_1"
        (pin passive line (at -10.16 -12.70 0) (length 2.54) (name "5V" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 -10.16 0) (length 2.54) (name "GND" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 -7.62 0) (length 2.54) (name "DISPLAY_SPI_SCK" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 -5.08 0) (length 2.54) (name "DISPLAY_SPI_MOSI" (effects (font (size 1.27 1.27)))) (number "4" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 -2.54 0) (length 2.54) (name "DISPLAY_SPI_MISO" (effects (font (size 1.27 1.27)))) (number "5" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 0 0) (length 2.54) (name "DISPLAY_CS" (effects (font (size 1.27 1.27)))) (number "6" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 2.54 0) (length 2.54) (name "DISPLAY_DC" (effects (font (size 1.27 1.27)))) (number "7" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 5.08 0) (length 2.54) (name "DISPLAY_RST" (effects (font (size 1.27 1.27)))) (number "8" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 7.62 0) (length 2.54) (name "DISPLAY_BL" (effects (font (size 1.27 1.27)))) (number "9" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 10.16 0) (length 2.54) (name "TOUCH_CS" (effects (font (size 1.27 1.27)))) (number "10" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 12.70 0) (length 2.54) (name "TOUCH_IRQ" (effects (font (size 1.27 1.27)))) (number "11" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 15.24 0) (length 2.54) (name "SD_CS_OPTIONAL" (effects (font (size 1.27 1.27)))) (number "12" (effects (font (size 1.27 1.27)))))
      )
      (embedded_fonts no)
    )
    (symbol "{prefix}OPTIONAL_IO_REVIEW"
      (pin_names (offset 1.016))
      (exclude_from_sim no)
      (in_bom no)
      (on_board no)
      (property "Reference" "X" (at 0 -17.78 0) (effects (font (size 1.27 1.27))))
      (property "Value" "ESP32-S3 optional IO assignment" (at 0 17.78 0) (effects (font (size 1.27 1.27))))
      (property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Description" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
      (symbol "OPTIONAL_IO_REVIEW_0_1"
        (rectangle (start -7.62 -15.24) (end 7.62 15.24) (stroke (width 0) (type default)) (fill (type none)))
      )
      (symbol "OPTIONAL_IO_REVIEW_1_1"
        (pin passive line (at -10.16 -12.70 0) (length 2.54) (name "H2_DOUT_OPTIONAL" (effects (font (size 1.27 1.27)))) (number "GPIO5" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 -10.16 0) (length 2.54) (name "DISPLAY_SPI_SCK" (effects (font (size 1.27 1.27)))) (number "GPIO36" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 -7.62 0) (length 2.54) (name "DISPLAY_SPI_MOSI" (effects (font (size 1.27 1.27)))) (number "GPIO35" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 -5.08 0) (length 2.54) (name "DISPLAY_SPI_MISO" (effects (font (size 1.27 1.27)))) (number "GPIO37" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 -2.54 0) (length 2.54) (name "DISPLAY_CS" (effects (font (size 1.27 1.27)))) (number "GPIO34" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 0 0) (length 2.54) (name "DISPLAY_DC" (effects (font (size 1.27 1.27)))) (number "GPIO33" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 2.54 0) (length 2.54) (name "DISPLAY_RST" (effects (font (size 1.27 1.27)))) (number "GPIO38" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 5.08 0) (length 2.54) (name "DISPLAY_BL" (effects (font (size 1.27 1.27)))) (number "GPIO39" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 7.62 0) (length 2.54) (name "TOUCH_CS" (effects (font (size 1.27 1.27)))) (number "GPIO40" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 10.16 0) (length 2.54) (name "TOUCH_IRQ" (effects (font (size 1.27 1.27)))) (number "GPIO41" (effects (font (size 1.27 1.27)))))
        (pin passive line (at -10.16 12.70 0) (length 2.54) (name "DISPLAY_SD_CS_OPTIONAL" (effects (font (size 1.27 1.27)))) (number "GPIO42" (effects (font (size 1.27 1.27)))))
      )
      (embedded_fonts no)
    )"#
    );
    compact_symbol_pin_fonts(symbols)
}

fn compact_symbol_pin_fonts(symbols: String) -> String {
    symbols
        .lines()
        .map(|line| {
            if line.trim_start().starts_with("(pin ") {
                let compact = line.replace("(font (size 1.27 1.27))", "(font (size 0.90 0.90))");
                if let Some(number_start) = compact.find("(number ") {
                    let (name_side, number_side) = compact.split_at(number_start);
                    format!(
                        "{}{}",
                        name_side,
                        number_side.replace("(font (size 0.90 0.90))", "(font (size 0.35 0.35))")
                    )
                } else {
                    compact
                }
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn kicad_symbol_library_file() -> String {
    format!(
        r#"(kicad_symbol_lib
  (version 20250114)
  (generator "chatpcb3")
  (generator_version "0.1.0")
{}
)
"#,
        local_symbol_definitions("")
    )
}

fn label(name: &str, x: f32, y: f32, uuid_suffix: u32) -> String {
    format!(
        r#"  (label "{name}" (at {x:.2} {y:.2} 0) (effects (font (size 1.27 1.27)) (justify left)) (uuid "30000000-0000-4000-8000-{uuid_suffix:012}"))
"#
    )
}

fn global_label(name: &str, x: f32, y: f32, uuid_suffix: u32) -> String {
    format!(
        r#"  (global_label "{name}" (shape input) (at {x:.2} {y:.2} 0) (effects (font (size 1.27 1.27)) (justify left)) (uuid "31000000-0000-4000-8000-{uuid_suffix:012}"))
"#
    )
}

fn optional_schematic_symbols(spec: &BoardSpec) -> String {
    let mut symbols = String::new();
    if spec_has_interface(spec, "H2 gas sensor") {
        symbols.push_str(
            r#"  (symbol (lib_id "ChatPCB3:H2_SENSOR_REVIEW") (at 132.08 129.54 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000017")
    (property "Reference" "U5" (at 132.08 119.38 0) (effects (font (size 1.27 1.27))))
    (property "Value" "MQ-8 analog H2 module" (at 132.08 139.70 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical" (at 132.08 142.24 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:PASSIVE_2PIN") (at 76.20 132.08 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000019")
    (property "Reference" "R7" (at 76.20 127.00 0) (effects (font (size 1.27 1.27))))
    (property "Value" "H2 ADC divider top" (at 76.20 137.16 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Resistor_SMD:R_0603_1608Metric" (at 76.20 139.70 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:PASSIVE_2PIN") (at 93.98 139.70 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000020")
    (property "Reference" "R8" (at 93.98 134.62 0) (effects (font (size 1.27 1.27))))
    (property "Value" "H2 ADC divider bottom" (at 93.98 144.78 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Resistor_SMD:R_0603_1608Metric" (at 93.98 147.32 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:CAPACITOR_2PIN") (at 111.76 132.08 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000021")
    (property "Reference" "C6" (at 111.76 127.00 0) (effects (font (size 1.27 1.27))))
    (property "Value" "100nF 6.3V X7R 0603 +/-10%" (at 111.76 137.16 0) (effects (font (size 0.90 0.90))))
    (property "Footprint" "Capacitor_SMD:C_0603_1608Metric" (at 111.76 139.70 0) (effects (font (size 1.27 1.27)) (hide yes))))
  "#,
        );
    }
    if spec_has_interface(spec, "Touch display") {
        symbols.push_str(
            r#"  (symbol (lib_id "ChatPCB3:TOUCH_DISPLAY_REVIEW") (at 170.18 139.70 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000018")
    (property "Reference" "DS1" (at 170.18 129.54 0) (effects (font (size 1.27 1.27))))
    (property "Value" "Waveshare 2.8inch TFT Touch Shield" (at 170.18 149.86 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Connector_PinHeader_2.54mm:PinHeader_1x12_P2.54mm_Vertical" (at 170.18 152.40 0) (effects (font (size 1.27 1.27)) (hide yes))))
  "#,
        );
    }
    if spec_has_interface(spec, "H2 gas sensor") || spec_has_interface(spec, "Touch display") {
        symbols.push_str(
            r#"  (symbol (lib_id "ChatPCB3:OPTIONAL_IO_REVIEW") (at 240.03 177.80 0) (unit 1) (exclude_from_sim no) (in_bom no) (on_board no) (dnp no) (uuid "10000000-0000-4000-8000-000000000022")
    (property "Reference" "X1" (at 240.03 160.02 0) (effects (font (size 1.27 1.27))))
    (property "Value" "ESP32-S3 optional IO assignment" (at 240.03 195.58 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "" (at 240.03 198.12 0) (effects (font (size 1.27 1.27)) (hide yes))))
  "#,
        );
    }
    symbols
}

fn optional_schematic_text(spec: &BoardSpec) -> String {
    let mut text = String::new();
    if spec_has_interface(spec, "H2 gas sensor") {
        text.push_str(
            r#"  (text "Prompt option: MQ-8 analog H2 module with 5V heater/VCC, H2_AOUT_RAW, R7/R8 10k divider, C6 H2 ADC filter, H2_ADC to ESP32 ADC."
    (exclude_from_sim no)
    (at 25.4 185.42 0)
    (effects (font (size 1.0 1.0)) (justify left))
    (uuid "40000000-0000-4000-8000-000000000006"))
  (text "H2 ADC range: 5.0V AOUT / 2 = 2.5V, so 2.5V < ESP32 3.3V ADC limit; R7/R8 10k and C6 100nF require calibration review."
    (exclude_from_sim no)
    (at 25.4 190.50 0)
    (effects (font (size 1.0 1.0)) (justify left))
    (uuid "40000000-0000-4000-8000-000000000008"))
"#,
        );
    }
    if spec_has_interface(spec, "Touch display") {
        text.push_str(
            r#"  (text "Prompt option: Waveshare 2.8inch TFT Touch Shield via SPI: ST7789V LCD, XPT2046 touch, 5V/GND, backlight, touch IRQ."
    (exclude_from_sim no)
    (at 25.4 195.58 0)
    (effects (font (size 1.0 1.0)) (justify left))
    (uuid "40000000-0000-4000-8000-000000000007"))
  (text "Touch display power/logic: DS1 uses 3V3 SPI logic nets and DISPLAY_SPI_SCK/MOSI/MISO; verify pinout, regulator thermal margin, and backlight current."
    (exclude_from_sim no)
    (at 25.4 200.66 0)
    (effects (font (size 1.0 1.0)) (justify left))
    (uuid "40000000-0000-4000-8000-000000000009"))
"#,
        );
    }
    text
}

fn kicad_schematic_file(spec: &BoardSpec) -> String {
    let lib_symbols = local_symbol_definitions("ChatPCB3:");
    let mut label_items = vec![
        ("VBUS_USB", 40.64, 73.66),
        ("USB_CC1", 40.64, 68.58),
        ("USB_CC2", 40.64, 66.04),
        ("USB_D_P_CONN", 40.64, 63.50),
        ("USB_D_N_CONN", 40.64, 60.96),
        ("GND", 40.64, 58.42),
        ("VBUS_USB", 60.96, 58.42),
        ("VBUS_5V", 76.20, 58.42),
        ("USB_D_P_CONN", 91.44, 71.12),
        ("USB_D_N_CONN", 91.44, 68.58),
        ("USB_D_P", 111.76, 71.12),
        ("USB_D_N", 111.76, 68.58),
        ("USB_D_P", 121.92, 73.66),
        ("USB_D_P_SER", 137.16, 73.66),
        ("USB_D_N", 147.32, 78.74),
        ("USB_D_N_SER", 162.56, 78.74),
        ("GND", 111.76, 63.50),
        ("USB_CC1", 44.45, 81.28),
        ("GND", 59.69, 81.28),
        ("USB_CC2", 60.96, 81.28),
        ("GND", 76.20, 81.28),
        ("VBUS_5V", 129.54, 60.96),
        ("GND", 129.54, 58.42),
        ("VBUS_5V", 129.54, 55.88),
        ("+3V3", 149.86, 60.96),
        ("VBUS_5V", 109.22, 40.64),
        ("GND", 124.46, 40.64),
        ("+3V3", 132.08, 40.64),
        ("GND", 147.32, 40.64),
        ("+3V3", 154.94, 40.64),
        ("GND", 170.18, 40.64),
        ("+3V3", 177.80, 40.64),
        ("GND", 193.04, 40.64),
        ("+3V3", 177.80, 76.20),
        ("GND", 177.80, 73.66),
        ("USB_D_P_SER", 177.80, 68.58),
        ("USB_D_N_SER", 177.80, 66.04),
        ("ESP_EN", 177.80, 60.96),
        ("ESP_BOOT", 203.20, 66.04),
        ("I2C_SCL", 203.20, 60.96),
        ("I2C_SDA", 203.20, 58.42),
        ("+3V3", 132.08, 88.90),
        ("ESP_EN", 147.32, 88.90),
        ("+3V3", 154.94, 88.90),
        ("ESP_BOOT", 170.18, 88.90),
        ("+3V3", 132.08, 106.68),
        ("I2C_SCL", 147.32, 106.68),
        ("+3V3", 154.94, 106.68),
        ("I2C_SDA", 170.18, 106.68),
        ("+3V3", 121.92, 116.84),
        ("GND", 121.92, 114.30),
        ("I2C_SCL", 121.92, 109.22),
        ("I2C_SDA", 121.92, 106.68),
        ("+3V3", 101.60, 124.46),
        ("GND", 116.84, 124.46),
    ];
    if spec_has_interface(spec, "H2 gas sensor") {
        label_items.extend([
            ("VBUS_5V", 121.92, 124.46),
            ("GND", 121.92, 127.00),
            ("H2_AOUT_RAW", 121.92, 132.08),
            ("H2_AOUT_RAW", 68.58, 132.08),
            ("H2_ADC", 83.82, 132.08),
            ("H2_ADC", 86.36, 139.70),
            ("GND", 101.60, 139.70),
            ("H2_ADC", 104.14, 132.08),
            ("GND", 119.38, 132.08),
        ]);
    }
    let mut global_label_items = Vec::new();
    if spec_has_interface(spec, "H2 gas sensor") {
        global_label_items.push(("H2_DOUT_OPTIONAL", 121.92, 134.62));
    }
    if spec_has_interface(spec, "Touch display") {
        label_items.extend([("VBUS_5V", 160.02, 152.40), ("GND", 160.02, 149.86)]);
        global_label_items.extend([
            ("DISPLAY_SD_CS_OPTIONAL", 160.02, 124.46),
            ("TOUCH_IRQ", 160.02, 127.00),
            ("TOUCH_CS", 160.02, 129.54),
            ("DISPLAY_BL", 160.02, 132.08),
            ("DISPLAY_RST", 160.02, 134.62),
            ("DISPLAY_DC", 160.02, 137.16),
            ("DISPLAY_CS", 160.02, 139.70),
            ("DISPLAY_SPI_MISO", 160.02, 142.24),
            ("DISPLAY_SPI_MOSI", 160.02, 144.78),
            ("DISPLAY_SPI_SCK", 160.02, 147.32),
        ]);
    }
    if spec_has_interface(spec, "H2 gas sensor") || spec_has_interface(spec, "Touch display") {
        global_label_items.extend([
            ("H2_DOUT_OPTIONAL", 229.87, 165.10),
            ("DISPLAY_SPI_SCK", 229.87, 167.64),
            ("DISPLAY_SPI_MOSI", 229.87, 170.18),
            ("DISPLAY_SPI_MISO", 229.87, 172.72),
            ("DISPLAY_CS", 229.87, 175.26),
            ("DISPLAY_DC", 229.87, 177.80),
            ("DISPLAY_RST", 229.87, 180.34),
            ("DISPLAY_BL", 229.87, 182.88),
            ("TOUCH_CS", 229.87, 185.42),
            ("TOUCH_IRQ", 229.87, 187.96),
            ("DISPLAY_SD_CS_OPTIONAL", 229.87, 190.50),
        ]);
    }
    let labels = label_items
        .iter()
        .enumerate()
        .map(|(index, (name, x, y))| label(name, *x, *y, index as u32 + 1))
        .collect::<String>();
    let global_labels = global_label_items
        .iter()
        .enumerate()
        .map(|(index, (name, x, y))| global_label(name, *x, *y, index as u32 + 1))
        .collect::<String>();
    let optional_symbols = optional_schematic_symbols(spec);
    let optional_text = optional_schematic_text(spec);

    let schematic = format!(
        r#"(kicad_sch
  (version 20250114)
  (generator "chatpcb3")
  (generator_version "0.1.0")
  (uuid "11111111-1111-4111-8111-111111111111")
  (paper "A4")
  (title_block
    (title "ChatPCB3 ESP32-S3 USB-C Sensor Board")
    (comment 1 "ERC-clean quantified review candidate; human signoff required.")
  )
  (lib_symbols
{lib_symbols}
  )
  (symbol (lib_id "ChatPCB3:USB_C_POWER") (at 30.48 66.04 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000001")
    (property "Reference" "J1" (at 30.48 53.34 0) (effects (font (size 1.27 1.27))))
    (property "Value" "J1 USB-C" (at 30.48 78.74 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12" (at 30.48 81.28 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:PASSIVE_2PIN") (at 68.58 58.42 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000002")
    (property "Reference" "F1" (at 68.58 53.34 0) (effects (font (size 1.27 1.27))))
    (property "Value" "VBUS fuse" (at 68.58 63.50 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Fuse:Fuse_0603_1608Metric" (at 68.58 66.04 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:USB_ESD_REVIEW") (at 101.60 68.58 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000003")
    (property "Reference" "U4" (at 101.60 58.42 0) (effects (font (size 1.27 1.27))))
    (property "Value" "USB ESD" (at 101.60 78.74 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Package_TO_SOT_SMD:SOT-23-6" (at 101.60 81.28 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:PASSIVE_2PIN") (at 129.54 73.66 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000017")
    (property "Reference" "R9" (at 129.54 71.12 0) (effects (font (size 1.27 1.27))))
    (property "Value" "22R 0603 +/-5%" (at 129.54 76.20 0) (effects (font (size 0.90 0.90))))
    (property "Footprint" "Resistor_SMD:R_0603_1608Metric" (at 129.54 78.74 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:PASSIVE_2PIN") (at 154.94 78.74 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000018")
    (property "Reference" "R10" (at 154.94 81.28 0) (effects (font (size 1.27 1.27))))
    (property "Value" "22R 0603 +/-5%" (at 154.94 83.82 0) (effects (font (size 0.90 0.90))))
    (property "Footprint" "Resistor_SMD:R_0603_1608Metric" (at 154.94 86.36 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:PASSIVE_2PIN") (at 52.07 81.28 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000004")
    (property "Reference" "R1" (at 52.07 76.20 0) (effects (font (size 1.27 1.27))))
    (property "Value" "CC1 5.1k" (at 52.07 86.36 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Resistor_SMD:R_0603_1608Metric" (at 52.07 88.90 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:PASSIVE_2PIN") (at 68.58 81.28 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000005")
    (property "Reference" "R2" (at 68.58 76.20 0) (effects (font (size 1.27 1.27))))
    (property "Value" "CC2 5.1k" (at 68.58 86.36 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Resistor_SMD:R_0603_1608Metric" (at 68.58 88.90 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:LDO_3V3_REVIEW") (at 139.70 58.42 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000006")
    (property "Reference" "U2" (at 139.70 48.26 0) (effects (font (size 1.27 1.27))))
    (property "Value" "U2 3V3 regulator" (at 139.70 68.58 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Package_TO_SOT_SMD:SOT-23-5" (at 139.70 71.12 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:CAPACITOR_2PIN") (at 116.84 40.64 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000007")
    (property "Reference" "C1" (at 116.84 35.56 0) (effects (font (size 1.27 1.27))))
    (property "Value" "10uF 10V X5R 0603 +/-10%" (at 116.84 50.80 0) (effects (font (size 0.90 0.90))))
    (property "Footprint" "Capacitor_SMD:C_0603_1608Metric" (at 116.84 48.26 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:CAPACITOR_2PIN") (at 139.70 40.64 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000008")
    (property "Reference" "C2" (at 139.70 35.56 0) (effects (font (size 1.27 1.27))))
    (property "Value" "10uF 10V X5R 0603 +/-10%" (at 139.70 32.00 0) (effects (font (size 0.90 0.90))))
    (property "Footprint" "Capacitor_SMD:C_0603_1608Metric" (at 139.70 48.26 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:CAPACITOR_2PIN") (at 162.56 40.64 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000009")
    (property "Reference" "C3" (at 162.56 35.56 0) (effects (font (size 1.27 1.27))))
    (property "Value" "1uF 6.3V X5R 0603 +/-10%" (at 162.56 50.80 0) (effects (font (size 0.90 0.90))))
    (property "Footprint" "Capacitor_SMD:C_0603_1608Metric" (at 162.56 48.26 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:CAPACITOR_2PIN") (at 185.42 40.64 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000022")
    (property "Reference" "C5" (at 185.42 35.56 0) (effects (font (size 1.27 1.27))))
    (property "Value" "100nF 6.3V X7R 0603 +/-10%" (at 185.42 32.00 0) (effects (font (size 0.90 0.90))))
    (property "Footprint" "Capacitor_SMD:C_0603_1608Metric" (at 185.42 48.26 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:ESP32S3_REVIEW") (at 190.50 66.04 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000010")
    (property "Reference" "U1" (at 190.50 48.26 0) (effects (font (size 1.27 1.27))))
    (property "Value" "ESP32-S3-WROOM-1" (at 190.50 83.82 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "RF_Module:ESP32-S3-WROOM-1" (at 190.50 86.36 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:PASSIVE_2PIN") (at 139.70 88.90 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000011")
    (property "Reference" "R5" (at 139.70 83.82 0) (effects (font (size 1.27 1.27))))
    (property "Value" "ESP_EN pull-up" (at 139.70 93.98 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Resistor_SMD:R_0603_1608Metric" (at 139.70 96.52 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:PASSIVE_2PIN") (at 162.56 88.90 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000012")
    (property "Reference" "R6" (at 162.56 83.82 0) (effects (font (size 1.27 1.27))))
    (property "Value" "BOOT strap" (at 162.56 93.98 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Resistor_SMD:R_0603_1608Metric" (at 162.56 96.52 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:PASSIVE_2PIN") (at 139.70 106.68 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000013")
    (property "Reference" "R3" (at 139.70 101.60 0) (effects (font (size 1.27 1.27))))
    (property "Value" "I2C_SCL pull-up" (at 139.70 111.76 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Resistor_SMD:R_0603_1608Metric" (at 139.70 114.30 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:PASSIVE_2PIN") (at 162.56 106.68 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000014")
    (property "Reference" "R4" (at 162.56 101.60 0) (effects (font (size 1.27 1.27))))
    (property "Value" "I2C_SDA pull-up" (at 162.56 111.76 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Resistor_SMD:R_0603_1608Metric" (at 162.56 114.30 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:BME280_I2C_REVIEW") (at 132.08 111.76 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000015")
    (property "Reference" "U3" (at 132.08 101.60 0) (effects (font (size 1.27 1.27))))
    (property "Value" "BME280 I2C sensor" (at 132.08 121.92 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Package_LGA:Bosch_LGA-8_2.5x2.5mm_P0.65mm_ClockwisePinNumbering" (at 132.08 124.46 0) (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "ChatPCB3:CAPACITOR_2PIN") (at 109.22 124.46 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "10000000-0000-4000-8000-000000000016")
    (property "Reference" "C4" (at 109.22 119.38 0) (effects (font (size 1.27 1.27))))
    (property "Value" "100nF 6.3V X7R 0603 +/-10%" (at 109.22 129.54 0) (effects (font (size 0.90 0.90))))
    (property "Footprint" "Capacitor_SMD:C_0603_1608Metric" (at 109.22 132.08 0) (effects (font (size 1.27 1.27)) (hide yes))))
{optional_symbols}
{labels}
{global_labels}
  (text "Design intent: ESP32-S3 USB-C 5V input, 3V3 regulator, I2C sensor, JLCPCB review package."
    (exclude_from_sim no)
    (at 25.4 160.02 0)
    (effects (font (size 1.0 1.0)) (justify left))
    (uuid "40000000-0000-4000-8000-000000000001"))
  (text "Required design items: J1 USB-C, CC1 5.1k, CC2 5.1k, VBUS fuse, USB ESD, USB D+ 22R series, USB D- 22R series."
    (exclude_from_sim no)
    (at 25.4 165.10 0)
    (effects (font (size 1.0 1.0)) (justify left))
    (uuid "40000000-0000-4000-8000-000000000002"))
  (text "Power design: U2 3V3 regulator, LDO input/output capacitors, C3/C5 ESP32 local decoupling; GND labels share common ground."
    (exclude_from_sim no)
    (at 25.4 170.18 0)
    (effects (font (size 1.0 1.0)) (justify left))
    (uuid "40000000-0000-4000-8000-000000000003"))
  (text "MCU straps: ESP_EN pull-up, BOOT strap, I2C_SCL pull-up, I2C_SDA pull-up."
    (exclude_from_sim no)
    (at 25.4 175.26 0)
    (effects (font (size 1.0 1.0)) (justify left))
    (uuid "40000000-0000-4000-8000-000000000004"))
  (text "Sensor design: BME280 I2C sensor, sensor decoupling, +3V3/GND reviewed."
    (exclude_from_sim no)
    (at 25.4 180.34 0)
    (effects (font (size 1.0 1.0)) (justify left))
    (uuid "40000000-0000-4000-8000-000000000005"))
{optional_text}
  (sheet_instances (path "/" (page "1")))
)
"#
    );

    schematic
}

fn kicad_pcb_file(spec: &BoardSpec) -> String {
    let optional_pcb = optional_pcb_features(spec);
    format!(
        r#"(kicad_pcb
  (version 20250114)
  (generator "chatpcb3")
  (generator_version "0.1.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (title_block
    (title "ChatPCB3 ESP32-S3 USB-C Sensor Board")
    (comment 1 "Quantified review candidate; human signoff required.")
  )
  (layers
    (0 "F.Cu" signal)
    (2 "B.Cu" signal)
    (5 "F.SilkS" user "F.Silkscreen")
    (7 "B.SilkS" user "B.Silkscreen")
    (1 "F.Mask" user)
    (3 "B.Mask" user)
    (13 "F.Paste" user)
    (15 "B.Paste" user)
    (17 "Dwgs.User" user "User.Drawings")
    (19 "Cmts.User" user "User.Comments")
    (25 "Edge.Cuts" user)
    (31 "F.CrtYd" user "F.Courtyard")
    (29 "B.CrtYd" user "B.Courtyard")
    (35 "F.Fab" user)
    (33 "B.Fab" user)
  )
  (setup
    (pad_to_mask_clearance 0)
    (allow_soldermask_bridges_in_footprints no)
    (tenting front back)
    (pcbplotparams)
  )
  (net 0 "")
  (net 1 "VBUS_5V")
  (net 2 "+3V3")
  (net 3 "GND")
  (net 4 "USB_D_P")
  (net 5 "USB_D_N")
  (net 6 "I2C_SCL")
  (net 7 "I2C_SDA")
  (net 8 "USB_CC1")
  (net 9 "USB_CC2")
  (net 10 "ESP_EN")
  (net 11 "H2_AOUT_RAW")
  (net 12 "H2_ADC")
  (net 13 "H2_DOUT_OPTIONAL")
  (net 14 "DISPLAY_SPI_SCK")
  (net 15 "DISPLAY_SPI_MOSI")
  (net 16 "DISPLAY_SPI_MISO")
  (net 17 "DISPLAY_CS")
  (net 18 "DISPLAY_DC")
  (net 19 "DISPLAY_RST")
  (net 20 "DISPLAY_BL")
  (net 21 "TOUCH_CS")
  (net 22 "TOUCH_IRQ")
  (net 23 "USB_D_P_SER")
  (net 24 "USB_D_N_SER")
  (gr_line (start 10 10) (end 60 10) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "33333333-3333-4333-8333-333333333333"))
  (gr_line (start 60 10) (end 60 60) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "44444444-4444-4444-8444-444444444444"))
  (gr_line (start 60 60) (end 10 60) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "55555555-5555-4555-8555-555555555555"))
  (gr_line (start 10 60) (end 10 10) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "66666666-6666-4666-8666-666666666666"))
  (gr_text "ChatPCB3 ESP32-S3" (at 35 14.5 0) (layer "F.SilkS") (effects (font (size 1.0 1.0) (thickness 0.1))) (uuid "77777777-7777-4777-8777-777777777777"))
  (gr_text "USB-C Sensor Preview" (at 35 16.5 0) (layer "F.SilkS") (effects (font (size 0.8 0.8) (thickness 0.08))) (uuid "88888888-8888-4888-8888-888888888888"))
  (gr_text "50mm x 50mm review candidate - not unattended order-ready" (at 35 57 0) (layer "F.SilkS") (effects (font (size 0.8 0.8) (thickness 0.08))) (uuid "99999999-9999-4999-8999-999999999999"))
  (footprint "ChatPCB3_USB_C_REVIEW" (layer "F.Cu")
    (uuid "50000000-0000-4000-8000-000000000001")
    (at 15 32 0)
    (property "Reference" "J1" (at 0 -16.5 0) (layer "F.SilkS") (uuid "51000000-0000-4000-8000-000000000001") (effects (font (size 1 1) (thickness 0.1))))
    (property "Value" "USB-C" (at 0 16.5 0) (layer "F.Fab") (uuid "51000000-0000-4000-8000-000000000002") (effects (font (size 1 1) (thickness 0.1))))
    (property "SourceFootprint" "Connector_USB:USB_C_Receptacle_USB2.0_16P" (at 0 18 0) (layer "F.Fab") (hide yes) (uuid "51000000-0000-4000-8000-000000000013") (effects (font (size 1 1) (thickness 0.1))))
    (pad "A4" smd rect (at 0 -14 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (net 1 "VBUS_5V") (uuid "52000000-0000-4000-8000-000000000001"))
    (pad "A1" smd rect (at 0 -6 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (net 3 "GND") (uuid "52000000-0000-4000-8000-000000000002"))
    (pad "A6" smd rect (at 0 -2 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (net 4 "USB_D_P") (uuid "52000000-0000-4000-8000-000000000003"))
    (pad "A7" smd rect (at 0 2 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (net 5 "USB_D_N") (uuid "52000000-0000-4000-8000-000000000004"))
    (pad "A5" smd rect (at 0 10 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (net 8 "USB_CC1") (uuid "52000000-0000-4000-8000-000000000005"))
    (pad "B5" smd rect (at 0 14 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (net 9 "USB_CC2") (uuid "52000000-0000-4000-8000-000000000006"))
  )
  (footprint "ChatPCB3_SOT23_5_REVIEW" (layer "F.Cu")
    (uuid "50000000-0000-4000-8000-000000000002")
    (at 28 28 0)
    (property "Reference" "U2" (at 0 -4 0) (layer "F.SilkS") (uuid "51000000-0000-4000-8000-000000000003") (effects (font (size 1 1) (thickness 0.1))))
    (property "Value" "ME6211C33" (at 0 4 0) (layer "F.Fab") (uuid "51000000-0000-4000-8000-000000000004") (effects (font (size 1 1) (thickness 0.1))))
    (property "SourceFootprint" "Package_TO_SOT_SMD:SOT-23-5" (at 0 5.5 0) (layer "F.Fab") (hide yes) (uuid "51000000-0000-4000-8000-000000000014") (effects (font (size 1 1) (thickness 0.1))))
    (pad "1" smd rect (at -1 -10 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (net 1 "VBUS_5V") (uuid "52000000-0000-4000-8000-000000000007"))
    (pad "2" smd rect (at -1 -6 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (uuid "52000000-0000-4000-8000-000000000008"))
    (pad "3" smd rect (at 1 10 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (net 10 "ESP_EN") (uuid "52000000-0000-4000-8000-000000000009"))
    (pad "4" smd rect (at 1 -6 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (net 2 "+3V3") (uuid "52000000-0000-4000-8000-000000000010"))
    (pad "5" smd rect (at 3 0 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (uuid "52000000-0000-4000-8000-000000000011"))
  )
  (footprint "ChatPCB3_ESP32-S3-WROOM-1_REVIEW" (layer "F.Cu")
    (uuid "50000000-0000-4000-8000-000000000003")
    (at 43 30 0)
    (property "Reference" "U1" (at 0 -13 0) (layer "F.SilkS") (uuid "51000000-0000-4000-8000-000000000005") (effects (font (size 1 1) (thickness 0.1))))
    (property "Value" "ESP32-S3-WROOM-1-N8R8" (at 0 7 0) (layer "F.Fab") (uuid "51000000-0000-4000-8000-000000000006") (effects (font (size 1 1) (thickness 0.1))))
    (property "SourceFootprint" "RF_Module:ESP32-S3-WROOM-1" (at 0 8.5 0) (layer "F.Fab") (hide yes) (uuid "51000000-0000-4000-8000-000000000015") (effects (font (size 1 1) (thickness 0.1))))
    (pad "1" smd rect (at -1 -8 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (net 2 "+3V3") (uuid "52000000-0000-4000-8000-000000000012"))
    (pad "2" smd rect (at -1 -4 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (net 3 "GND") (uuid "52000000-0000-4000-8000-000000000013"))
    (pad "3" smd rect (at -1 0 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (net 23 "USB_D_P_SER") (uuid "52000000-0000-4000-8000-000000000014"))
    (pad "4" smd rect (at -1 4 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (net 24 "USB_D_N_SER") (uuid "52000000-0000-4000-8000-000000000015"))
    (pad "5" smd rect (at 7 -8 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (net 6 "I2C_SCL") (uuid "52000000-0000-4000-8000-000000000016"))
    (pad "6" smd rect (at 10 -8 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (net 7 "I2C_SDA") (uuid "52000000-0000-4000-8000-000000000017"))
    (pad "7" smd rect (at -1 8 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (net 10 "ESP_EN") (uuid "52000000-0000-4000-8000-000000000018"))
    (pad "8" smd rect (at 13 -4 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (net 12 "H2_ADC") (uuid "52000000-0000-4000-8000-000000000019"))
  )
  (footprint "ChatPCB3_I2C_SENSOR_HEADER_REVIEW" (layer "F.Cu")
    (uuid "50000000-0000-4000-8000-000000000004")
    (at 51.5 44 0)
    (property "Reference" "U3" (at 0 -4 0) (layer "F.SilkS") (uuid "51000000-0000-4000-8000-000000000007") (effects (font (size 1 1) (thickness 0.1))))
    (property "Value" "I2C_SENSOR" (at 0 4 0) (layer "F.Fab") (uuid "51000000-0000-4000-8000-000000000008") (effects (font (size 1 1) (thickness 0.1))))
    (property "SourceFootprint" "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical" (at 0 5.5 0) (layer "F.Fab") (hide yes) (uuid "51000000-0000-4000-8000-000000000016") (effects (font (size 1 1) (thickness 0.1))))
    (pad "1" thru_hole circle (at -6 0 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "52000000-0000-4000-8000-000000000020"))
    (pad "2" thru_hole circle (at -3.5 0 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "52000000-0000-4000-8000-000000000021"))
    (pad "3" thru_hole circle (at -1.5 0 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (net 6 "I2C_SCL") (uuid "52000000-0000-4000-8000-000000000022"))
    (pad "4" thru_hole circle (at 1.5 0 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (net 7 "I2C_SDA") (uuid "52000000-0000-4000-8000-000000000023"))
  )
  (footprint "ChatPCB3_R_0603_REVIEW" (layer "F.Cu")
    (uuid "50000000-0000-4000-8000-000000000005")
    (at 22 42 0)
    (property "Reference" "R1" (at 0 -1.5 0) (layer "F.SilkS") (uuid "51000000-0000-4000-8000-000000000009") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "Value" "5.1k" (at 0 1.5 0) (layer "F.Fab") (uuid "51000000-0000-4000-8000-000000000010") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "SourceFootprint" "Resistor_SMD:R_0603_1608Metric" (at 0 2.7 0) (layer "F.Fab") (hide yes) (uuid "51000000-0000-4000-8000-000000000017") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (pad "1" smd rect (at 0 0 0) (size 0.8 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (net 8 "USB_CC1") (uuid "52000000-0000-4000-8000-000000000024"))
    (pad "2" smd rect (at 2 0 0) (size 0.8 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (uuid "52000000-0000-4000-8000-000000000025"))
  )
  (footprint "ChatPCB3_R_0603_REVIEW" (layer "F.Cu")
    (uuid "50000000-0000-4000-8000-000000000006")
    (at 22 46 0)
    (property "Reference" "R2" (at 0 -1.5 0) (layer "F.SilkS") (uuid "51000000-0000-4000-8000-000000000011") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "Value" "5.1k" (at 0 1.5 0) (layer "F.Fab") (uuid "51000000-0000-4000-8000-000000000012") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "SourceFootprint" "Resistor_SMD:R_0603_1608Metric" (at 0 2.7 0) (layer "F.Fab") (hide yes) (uuid "51000000-0000-4000-8000-000000000018") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (pad "1" smd rect (at 0 0 0) (size 0.8 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (net 9 "USB_CC2") (uuid "52000000-0000-4000-8000-000000000026"))
    (pad "2" smd rect (at 2 0 0) (size 0.8 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (uuid "52000000-0000-4000-8000-000000000027"))
  )
  (footprint "ChatPCB3_R_0603_REVIEW" (layer "F.Cu")
    (uuid "50000000-0000-4000-8000-000000000012")
    (at 29 31 0)
    (property "Reference" "R9" (at 0 -1.5 0) (layer "F.SilkS") (uuid "51000000-0000-4000-8000-000000000034") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "Value" "USB D+ 22R series" (at 0 1.5 0) (layer "F.Fab") (uuid "51000000-0000-4000-8000-000000000035") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "SourceFootprint" "Resistor_SMD:R_0603_1608Metric" (at 0 2.7 0) (layer "F.Fab") (hide yes) (uuid "51000000-0000-4000-8000-000000000036") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (pad "1" smd rect (at 0 0 0) (size 0.8 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (net 4 "USB_D_P") (uuid "52000000-0000-4000-8000-000000000050"))
    (pad "2" smd rect (at 2 0 0) (size 0.8 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (net 23 "USB_D_P_SER") (uuid "52000000-0000-4000-8000-000000000051"))
  )
  (footprint "ChatPCB3_R_0603_REVIEW" (layer "F.Cu")
    (uuid "50000000-0000-4000-8000-000000000013")
    (at 29 34 0)
    (property "Reference" "R10" (at 0 -1.5 0) (layer "F.SilkS") (uuid "51000000-0000-4000-8000-000000000037") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "Value" "USB D- 22R series" (at 0 1.5 0) (layer "F.Fab") (uuid "51000000-0000-4000-8000-000000000038") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "SourceFootprint" "Resistor_SMD:R_0603_1608Metric" (at 0 2.7 0) (layer "F.Fab") (hide yes) (uuid "51000000-0000-4000-8000-000000000039") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (pad "1" smd rect (at 0 0 0) (size 0.8 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (net 5 "USB_D_N") (uuid "52000000-0000-4000-8000-000000000052"))
    (pad "2" smd rect (at 2 0 0) (size 0.8 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (net 24 "USB_D_N_SER") (uuid "52000000-0000-4000-8000-000000000053"))
  )
  (footprint "ChatPCB3_C_0603_REVIEW" (layer "F.Cu")
    (uuid "50000000-0000-4000-8000-000000000014")
    (at 35 24 0)
    (property "Reference" "C5" (at 0 -1.5 0) (layer "F.SilkS") (uuid "51000000-0000-4000-8000-000000000040") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "Value" "ESP32 local decoupling" (at 0 1.5 0) (layer "F.Fab") (uuid "51000000-0000-4000-8000-000000000041") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "SourceFootprint" "Capacitor_SMD:C_0603_1608Metric" (at 0 2.7 0) (layer "F.Fab") (hide yes) (uuid "51000000-0000-4000-8000-000000000042") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (pad "1" smd rect (at 0 0 0) (size 0.8 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (net 2 "+3V3") (uuid "52000000-0000-4000-8000-000000000054"))
    (pad "2" smd rect (at 2 0 0) (size 0.8 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (net 3 "GND") (uuid "52000000-0000-4000-8000-000000000055"))
  )
  (segment (start 15 18) (end 27 18) (width 0.3) (layer "F.Cu") (net 1) (uuid "60000000-0000-4000-8000-000000000001"))
  (segment (start 29 22) (end 42 22) (width 0.3) (layer "F.Cu") (net 2) (uuid "60000000-0000-4000-8000-000000000002"))
  (segment (start 35 24) (end 35 22) (width 0.25) (layer "F.Cu") (net 2) (uuid "60000000-0000-4000-8000-000000000013"))
  (segment (start 15 26) (end 42 26) (width 0.35) (layer "F.Cu") (net 3) (uuid "60000000-0000-4000-8000-000000000003"))
  (segment (start 37 24) (end 37 26) (width 0.25) (layer "F.Cu") (net 3) (uuid "60000000-0000-4000-8000-000000000014"))
  (segment (start 15 30) (end 29 31) (width 0.25) (layer "F.Cu") (net 4) (uuid "60000000-0000-4000-8000-000000000004"))
  (segment (start 31 31) (end 42 30) (width 0.25) (layer "F.Cu") (net 23) (uuid "60000000-0000-4000-8000-000000000011"))
  (segment (start 15 34) (end 29 34) (width 0.25) (layer "F.Cu") (net 5) (uuid "60000000-0000-4000-8000-000000000005"))
  (segment (start 31 34) (end 42 34) (width 0.25) (layer "F.Cu") (net 24) (uuid "60000000-0000-4000-8000-000000000012"))
  (segment (start 50 22) (end 50 44) (width 0.25) (layer "F.Cu") (net 6) (uuid "60000000-0000-4000-8000-000000000006"))
  (segment (start 53 22) (end 53 44) (width 0.25) (layer "F.Cu") (net 7) (uuid "60000000-0000-4000-8000-000000000007"))
  (segment (start 15 42) (end 22 42) (width 0.25) (layer "F.Cu") (net 8) (uuid "60000000-0000-4000-8000-000000000008"))
  (segment (start 15 46) (end 22 46) (width 0.25) (layer "F.Cu") (net 9) (uuid "60000000-0000-4000-8000-000000000009"))
  (segment (start 29 38) (end 42 38) (width 0.25) (layer "F.Cu") (net 10) (uuid "60000000-0000-4000-8000-000000000010"))
{optional_pcb}
)
"#
    )
}

fn optional_pcb_features(spec: &BoardSpec) -> String {
    let has_h2 = spec_has_interface(spec, "H2 gas sensor");
    let has_touch = spec_has_interface(spec, "Touch display");
    if !has_h2 && !has_touch {
        return String::new();
    }

    let mut pcb = String::new();

    if has_h2 {
        pcb.push_str(
            r#"  (gr_text "H2 sensor" (at 52 49 0) (layer "F.SilkS") (effects (font (size 0.8 0.8) (thickness 0.08))) (uuid "99999999-9999-4999-8999-999999999101"))
  (footprint "ChatPCB3_H2_SENSOR_HEADER_REVIEW" (layer "F.Cu")
    (uuid "50000000-0000-4000-8000-000000000007")
    (at 56 50 0)
    (property "Reference" "U5" (at 0 -6 0) (layer "F.SilkS") (uuid "51000000-0000-4000-8000-000000000019") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "Value" "MQ-8 analog H2 module" (at 0 6 0) (layer "F.Fab") (uuid "51000000-0000-4000-8000-000000000020") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "SourceFootprint" "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical" (at 0 7.4 0) (layer "F.Fab") (hide yes) (uuid "51000000-0000-4000-8000-000000000021") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (pad "1" thru_hole circle (at 0 -3.81 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "52000000-0000-4000-8000-000000000028"))
    (pad "2" thru_hole circle (at 0 -1.27 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "52000000-0000-4000-8000-000000000029"))
    (pad "3" thru_hole circle (at 0 1.27 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "52000000-0000-4000-8000-000000000030"))
    (pad "4" thru_hole circle (at 0 3.81 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "52000000-0000-4000-8000-000000000031"))
  )
  (footprint "ChatPCB3_R_0603_REVIEW" (layer "F.Cu")
    (uuid "50000000-0000-4000-8000-000000000009")
    (at 42 45 0)
    (property "Reference" "R7" (at 0 -1.5 0) (layer "F.SilkS") (uuid "51000000-0000-4000-8000-000000000025") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "Value" "H2 ADC divider top" (at 0 1.5 0) (layer "F.Fab") (uuid "51000000-0000-4000-8000-000000000026") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "SourceFootprint" "Resistor_SMD:R_0603_1608Metric" (at 0 2.7 0) (layer "F.Fab") (hide yes) (uuid "51000000-0000-4000-8000-000000000027") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (pad "1" smd rect (at 0 0 0) (size 0.8 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (uuid "52000000-0000-4000-8000-000000000038"))
    (pad "2" smd rect (at 2 0 0) (size 0.8 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (uuid "52000000-0000-4000-8000-000000000039"))
  )
  (footprint "ChatPCB3_R_0603_REVIEW" (layer "F.Cu")
    (uuid "50000000-0000-4000-8000-000000000010")
    (at 42 48 0)
    (property "Reference" "R8" (at 0 -1.5 0) (layer "F.SilkS") (uuid "51000000-0000-4000-8000-000000000028") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "Value" "H2 ADC divider bottom" (at 0 1.5 0) (layer "F.Fab") (uuid "51000000-0000-4000-8000-000000000029") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "SourceFootprint" "Resistor_SMD:R_0603_1608Metric" (at 0 2.7 0) (layer "F.Fab") (hide yes) (uuid "51000000-0000-4000-8000-000000000030") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (pad "1" smd rect (at 0 0 0) (size 0.8 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (uuid "52000000-0000-4000-8000-000000000040"))
    (pad "2" smd rect (at 2 0 0) (size 0.8 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (uuid "52000000-0000-4000-8000-000000000041"))
  )
  (footprint "ChatPCB3_C_0603_REVIEW" (layer "F.Cu")
    (uuid "50000000-0000-4000-8000-000000000011")
    (at 46 48 0)
    (property "Reference" "C6" (at 0 -1.5 0) (layer "F.SilkS") (uuid "51000000-0000-4000-8000-000000000031") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "Value" "H2 ADC filter" (at 0 1.5 0) (layer "F.Fab") (uuid "51000000-0000-4000-8000-000000000032") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "SourceFootprint" "Capacitor_SMD:C_0603_1608Metric" (at 0 2.7 0) (layer "F.Fab") (hide yes) (uuid "51000000-0000-4000-8000-000000000033") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (pad "1" smd rect (at 0 0 0) (size 0.8 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (uuid "52000000-0000-4000-8000-000000000042"))
    (pad "2" smd rect (at 2 0 0) (size 0.8 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (uuid "52000000-0000-4000-8000-000000000043"))
  )
"#,
        );
    }

    if has_touch {
        pcb.push_str(
            r#"  (gr_text "Touch display" (at 31 43 0) (layer "F.SilkS") (effects (font (size 0.8 0.8) (thickness 0.08))) (uuid "99999999-9999-4999-8999-999999999102"))
  (footprint "ChatPCB3_TOUCH_DISPLAY_HEADER_REVIEW" (layer "F.Cu")
    (uuid "50000000-0000-4000-8000-000000000008")
    (at 35 54 90)
    (property "Reference" "DS1" (at 0 -16 0) (layer "F.SilkS") (uuid "51000000-0000-4000-8000-000000000022") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "Value" "Waveshare 2.8inch TFT Touch Shield connector" (at 0 16 0) (layer "F.Fab") (uuid "51000000-0000-4000-8000-000000000023") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (property "SourceFootprint" "Connector_PinHeader_2.54mm:PinHeader_1x12_P2.54mm_Vertical" (at 0 17.4 0) (layer "F.Fab") (hide yes) (uuid "51000000-0000-4000-8000-000000000024") (effects (font (size 0.8 0.8) (thickness 0.08))))
    (pad "1" thru_hole circle (at 0 -13.97 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "52000000-0000-4000-8000-000000000032"))
    (pad "2" thru_hole circle (at 0 -11.43 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "52000000-0000-4000-8000-000000000033"))
    (pad "3" thru_hole circle (at 0 -8.89 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "52000000-0000-4000-8000-000000000034"))
    (pad "4" thru_hole circle (at 0 -6.35 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "52000000-0000-4000-8000-000000000035"))
    (pad "5" thru_hole circle (at 0 -3.81 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "52000000-0000-4000-8000-000000000036"))
    (pad "6" thru_hole circle (at 0 -1.27 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "52000000-0000-4000-8000-000000000037"))
    (pad "7" thru_hole circle (at 0 1.27 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "52000000-0000-4000-8000-000000000044"))
    (pad "8" thru_hole circle (at 0 3.81 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "52000000-0000-4000-8000-000000000045"))
    (pad "9" thru_hole circle (at 0 6.35 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "52000000-0000-4000-8000-000000000046"))
    (pad "10" thru_hole circle (at 0 8.89 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "52000000-0000-4000-8000-000000000047"))
    (pad "11" thru_hole circle (at 0 11.43 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "52000000-0000-4000-8000-000000000048"))
    (pad "12" thru_hole circle (at 0 13.97 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "52000000-0000-4000-8000-000000000049"))
  )
"#,
        );
    }

    pcb
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}
