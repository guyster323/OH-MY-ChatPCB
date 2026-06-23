use chatpcb_core::{
    project::create_preview_workspace,
    validation::{parse_kicad_report, Severity},
};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn unique_test_root() -> PathBuf {
    std::env::temp_dir().join(format!(
        "chatpcb3-preview-workspace-test-{}",
        std::process::id()
    ))
}

#[test]
fn creates_preview_workspace_evidence_without_claiming_order_ready() {
    let root = unique_test_root();
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace(
        "USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB package",
        &root,
    )
    .unwrap();

    let project_dir = PathBuf::from(&workspace.project_dir);
    assert!(project_dir.exists());
    assert!(project_dir.ends_with("chatpcb3-esp32s3-preview"));

    let manifest = fs::read_to_string(&workspace.manifest_file).unwrap();
    assert!(manifest.contains("ChatPCB3 ESP32-S3 USB-C Sensor Board"));
    assert!(manifest.contains("chatpcb3-esp32s3.kicad_pro"));

    let report = fs::read_to_string(&workspace.release_report_file).unwrap();
    assert!(report.contains("prototype-review"));
    assert!(report.contains("not order-ready"));
    assert!(report.contains("KiCad fork integration is still required"));

    let first_run_summary = fs::read_to_string(&workspace.first_run_summary_file).unwrap();
    assert!(first_run_summary.contains("Start here"));
    assert!(first_run_summary.contains("Open PCB"));
    assert!(first_run_summary.contains("Open evidence"));
    assert!(first_run_summary.contains("type a follow-up"));
    assert!(first_run_summary.contains("Do not upload this preview to JLCPCB"));
    assert!(first_run_summary.contains("prototype-review"));
    assert!(first_run_summary.contains("not order-ready"));
    assert!(workspace.files.contains(&workspace.first_run_summary_file));

    let bom_preview_file = project_dir.join("jlcpcb-bom-preview.csv");
    let cpl_preview_file = project_dir.join("jlcpcb-cpl-preview.csv");
    let manufacturing_readiness_file = project_dir.join("manufacturing-readiness-preview.txt");
    assert!(bom_preview_file.exists());
    assert!(cpl_preview_file.exists());
    assert!(manufacturing_readiness_file.exists());
    assert!(workspace
        .files
        .contains(&bom_preview_file.to_string_lossy().to_string()));
    assert!(workspace
        .files
        .contains(&cpl_preview_file.to_string_lossy().to_string()));
    assert!(workspace
        .files
        .contains(&manufacturing_readiness_file.to_string_lossy().to_string()));

    let bom_preview = fs::read_to_string(bom_preview_file).unwrap();
    assert!(bom_preview.contains("Designator,Footprint,Quantity,Value,LCSC Part #"));
    assert!(bom_preview.contains("ESP32-S3-WROOM-1-N8R8"));
    assert!(bom_preview.contains("C2913204"));

    let cpl_preview = fs::read_to_string(cpl_preview_file).unwrap();
    assert!(cpl_preview.contains("Designator,Mid X,Mid Y,Rotation,Layer"));
    assert!(cpl_preview.contains("U1,UNPLACED,UNPLACED,0,Top"));

    let manufacturing_readiness = fs::read_to_string(manufacturing_readiness_file).unwrap();
    assert!(manufacturing_readiness.contains("JLCPCB Manufacturing Preview"));
    assert!(manufacturing_readiness.contains("BOM preview: jlcpcb-bom-preview.csv"));
    assert!(manufacturing_readiness.contains("CPL preview: jlcpcb-cpl-preview.csv"));
    assert!(manufacturing_readiness.contains("Gerber zip: blocked"));
    assert!(manufacturing_readiness.contains("Do not upload this preview to JLCPCB"));
    assert!(manufacturing_readiness.contains("prototype-review, not order-ready"));

    let beginner_next_steps_file = project_dir.join("BEGINNER-NEXT-STEPS.txt");
    assert!(beginner_next_steps_file.exists());
    assert!(workspace
        .files
        .contains(&beginner_next_steps_file.to_string_lossy().to_string()));
    let beginner_next_steps = fs::read_to_string(beginner_next_steps_file).unwrap();
    assert!(beginner_next_steps.contains("First thing to do"));
    assert!(beginner_next_steps.contains("Open PCB"));
    assert!(beginner_next_steps.contains("Open evidence"));
    assert!(beginner_next_steps.contains("Ask a follow-up in chat"));
    assert!(beginner_next_steps.contains("Do not order yet"));
    assert!(beginner_next_steps.contains("Gerber"));
    assert!(beginner_next_steps.contains("BOM preview"));
    assert!(beginner_next_steps.contains("CPL preview"));

    let prompt = fs::read_to_string(&workspace.prompt_file).unwrap();
    assert!(prompt.contains("USB-C ESP32-S3"));

    for file in &workspace.files {
        assert!(PathBuf::from(file).exists(), "{file} should exist");
    }

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn creates_real_kicad_project_scaffold_files() {
    let root = unique_test_root().with_extension("kicad-files");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace("ESP32-S3 starter board", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let expected_files = [
        "chatpcb3-esp32s3.kicad_pro",
        "chatpcb3-esp32s3.kicad_sch",
        "chatpcb3-esp32s3.kicad_pcb",
        "sym-lib-table",
        "fp-lib-table",
    ];

    for name in expected_files {
        let path = project_dir.join(name);
        assert!(path.exists(), "{name} should be written to the workspace");
        assert!(workspace
            .files
            .contains(&path.to_string_lossy().to_string()));
    }

    let schematic = fs::read_to_string(project_dir.join("chatpcb3-esp32s3.kicad_sch")).unwrap();
    assert!(schematic.contains("ChatPCB3 ESP32-S3 USB-C Sensor Board"));
    assert!(schematic.contains("Preview KiCad schematic scaffold"));

    let pcb = fs::read_to_string(project_dir.join("chatpcb3-esp32s3.kicad_pcb")).unwrap();
    assert!(pcb.contains("(layers"));
    assert!(pcb.contains("\"Edge.Cuts\""));
    assert!(pcb.contains("Preview scaffold only; not order-ready."));

    let report = fs::read_to_string(&workspace.release_report_file).unwrap();
    assert!(report.contains("Generated KiCad preview scaffold files"));
    assert!(report.contains("JLCPCB manufacturing preview files"));
    assert!(report.contains("jlcpcb-bom-preview.csv"));
    assert!(report.contains("manufacturing-readiness-preview.txt"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn generated_pcb_scaffold_has_preview_board_outline_and_silkscreen_label() {
    let root = unique_test_root().with_extension("pcb-outline");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace("ESP32-S3 starter board", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let pcb = fs::read_to_string(project_dir.join("chatpcb3-esp32s3.kicad_pcb")).unwrap();

    assert!(pcb.contains("(gr_line"));
    assert!(pcb.contains("(layer \"Edge.Cuts\")"));
    assert!(pcb.contains("(start 10 10)"));
    assert!(pcb.contains("(end 60 10)"));
    assert!(pcb.contains("(end 60 60)"));
    assert!(pcb.contains("(end 10 60)"));
    assert!(pcb.contains("(layer \"F.SilkS\")"));
    assert!(pcb.contains("(gr_text \"ChatPCB3 ESP32-S3\""));
    assert!(pcb.contains("(gr_text \"USB-C Sensor Preview\""));
    assert!(pcb.contains("(gr_text \"50mm x 50mm preview - not order-ready\""));
    assert!(!pcb.contains("(gr_text \"ChatPCB3 ESP32-S3 USB-C Sensor Board\""));

    let report = fs::read_to_string(&workspace.release_report_file).unwrap();
    assert!(report.contains("50mm x 50mm preview PCB outline"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn generated_pcb_scaffold_has_no_local_kicad_drc_violations_when_available() {
    let Some(kicad_cli) = local_kicad_cli() else {
        eprintln!("Skipping KiCad CLI DRC check because kicad-cli.exe was not found.");
        return;
    };

    let root = unique_test_root().with_extension("kicad-drc");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace("ESP32-S3 starter board", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let pcb = project_dir.join("chatpcb3-esp32s3.kicad_pcb");
    let drc_report = project_dir.join("drc-report.json");

    let drc_status = Command::new(&kicad_cli)
        .args(["pcb", "drc", "--format", "json", "--output"])
        .arg(&drc_report)
        .arg(&pcb)
        .status()
        .unwrap();
    assert!(drc_status.success());

    let report = fs::read_to_string(&drc_report).unwrap();
    let parsed = parse_kicad_report(&report).unwrap();
    assert_eq!(parsed.error_count, 0);
    assert_eq!(parsed.warning_count, 0);
    assert_eq!(parsed.unconnected_count, 0);
    assert!(
        parsed
            .violations
            .iter()
            .all(|violation| violation.severity != Severity::Warning),
        "DRC warnings should not appear in the first-run preview scaffold: {report}"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn generated_kicad_scaffold_is_parseable_by_local_kicad_cli_when_available() {
    let Some(kicad_cli) = local_kicad_cli() else {
        eprintln!("Skipping KiCad CLI parse check because kicad-cli.exe was not found.");
        return;
    };

    let root = unique_test_root().with_extension("kicad-cli");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace("ESP32-S3 starter board", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let schematic = project_dir.join("chatpcb3-esp32s3.kicad_sch");
    let pcb = project_dir.join("chatpcb3-esp32s3.kicad_pcb");

    let schematic_status = Command::new(&kicad_cli)
        .args(["sch", "upgrade"])
        .arg(&schematic)
        .status()
        .unwrap();
    assert!(schematic_status.success());

    let pcb_status = Command::new(&kicad_cli)
        .args(["pcb", "upgrade"])
        .arg(&pcb)
        .status()
        .unwrap();
    assert!(pcb_status.success());

    fs::remove_dir_all(root).unwrap();
}

fn local_kicad_cli() -> Option<PathBuf> {
    let local_app_data = std::env::var_os("LOCALAPPDATA")?;
    let candidate = PathBuf::from(local_app_data)
        .join("Programs")
        .join("KiCad")
        .join("10.0")
        .join("bin")
        .join("kicad-cli.exe");

    candidate.exists().then_some(candidate)
}
