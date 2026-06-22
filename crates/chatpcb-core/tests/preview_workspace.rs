use chatpcb_core::project::create_preview_workspace;
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
    assert!(pcb.contains("ChatPCB3 ESP32-S3 USB-C Sensor Board"));
    assert!(pcb.contains("50mm x 50mm preview outline"));

    let report = fs::read_to_string(&workspace.release_report_file).unwrap();
    assert!(report.contains("50mm x 50mm preview PCB outline"));

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
