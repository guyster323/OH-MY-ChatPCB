use chatpcb_core::{
    project::create_preview_workspace,
    quality::{evaluate_workspace_quality, quality_report_markdown, QualityLevel},
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

fn schematic_text_position(schematic: &str, text_snippet: &str) -> (f32, f32) {
    let text_start = schematic
        .find(text_snippet)
        .unwrap_or_else(|| panic!("schematic text not found: {text_snippet}"));
    let text_tail = &schematic[text_start..];
    let at_start = text_tail
        .find("(at ")
        .unwrap_or_else(|| panic!("schematic text lacks position: {text_snippet}"));
    let at_tail = &text_tail[at_start + 4..];
    let at_end = at_tail
        .find(')')
        .unwrap_or_else(|| panic!("schematic text position is unterminated: {text_snippet}"));
    let mut parts = at_tail[..at_end].split_whitespace();
    let x = parts
        .next()
        .unwrap_or("missing-x")
        .parse::<f32>()
        .unwrap_or_else(|_| panic!("schematic text x is not numeric: {text_snippet}"));
    let y = parts
        .next()
        .unwrap_or("missing-y")
        .parse::<f32>()
        .unwrap_or_else(|_| panic!("schematic text y is not numeric: {text_snippet}"));
    (x, y)
}

#[derive(Debug)]
struct SchematicSymbolPosition {
    reference: String,
    lib_id: String,
    x: f32,
    y: f32,
}

fn schematic_symbol_positions(schematic: &str) -> Vec<SchematicSymbolPosition> {
    let mut positions = Vec::new();
    let mut lines = schematic.lines().peekable();
    while let Some(line) = lines.next() {
        let Some(lib_start) = line.find("(symbol (lib_id \"") else {
            continue;
        };
        let lib_tail = &line[lib_start + "(symbol (lib_id \"".len()..];
        let Some(lib_end) = lib_tail.find('"') else {
            continue;
        };
        let lib_id = lib_tail[..lib_end].to_string();
        let Some(at_start) = line.find("(at ") else {
            continue;
        };
        let at_tail = &line[at_start + 4..];
        let Some(at_end) = at_tail.find(')') else {
            continue;
        };
        let mut at_parts = at_tail[..at_end].split_whitespace();
        let Some(x) = at_parts.next().and_then(|part| part.parse::<f32>().ok()) else {
            continue;
        };
        let Some(y) = at_parts.next().and_then(|part| part.parse::<f32>().ok()) else {
            continue;
        };
        let Some(reference_line) = lines.peek() else {
            continue;
        };
        let Some(reference_start) = reference_line.find("(property \"Reference\" \"") else {
            continue;
        };
        let reference_tail =
            &reference_line[reference_start + "(property \"Reference\" \"".len()..];
        let Some(reference_end) = reference_tail.find('"') else {
            continue;
        };
        positions.push(SchematicSymbolPosition {
            reference: reference_tail[..reference_end].to_string(),
            lib_id,
            x,
            y,
        });
    }
    positions
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
    assert!(
        report.contains("quantifiable schematic, PCB, manufacturing, and visual-review evidence")
    );

    let first_run_summary = fs::read_to_string(&workspace.first_run_summary_file).unwrap();
    assert!(first_run_summary.contains("처음 확인할 내용"));
    assert!(first_run_summary.contains("PCB 열기"));
    assert!(first_run_summary.contains("검토 목록"));
    assert!(first_run_summary.contains("후속 입력"));
    assert!(first_run_summary.contains("JLCPCB에 업로드하지 마세요"));
    assert!(first_run_summary.contains("prototype-review"));
    assert!(first_run_summary.contains("주문 준비 전"));
    assert!(!first_run_summary.contains("Start here"));
    assert!(!first_run_summary.contains("Open PCB"));
    assert!(!first_run_summary.contains("Review checklist"));
    assert!(!first_run_summary.contains("type a follow-up"));
    assert!(!first_run_summary.contains("Do not upload this preview to JLCPCB"));
    assert!(workspace.files.contains(&workspace.first_run_summary_file));

    let bom_preview_file = project_dir.join("jlcpcb-bom-preview.csv");
    let cpl_preview_file = project_dir.join("jlcpcb-cpl-preview.csv");
    let part_selection_review_file = project_dir.join("part-selection-review.md");
    let circuit_review_file = project_dir.join("circuit-review-findings.md");
    let chat_trace_file = project_dir.join("chat-to-circuit-trace.md");
    let manufacturing_readiness_file = project_dir.join("manufacturing-readiness-preview.txt");
    assert!(bom_preview_file.exists());
    assert!(cpl_preview_file.exists());
    assert!(part_selection_review_file.exists());
    assert!(circuit_review_file.exists());
    assert!(chat_trace_file.exists());
    assert!(manufacturing_readiness_file.exists());
    assert!(workspace
        .files
        .contains(&bom_preview_file.to_string_lossy().to_string()));
    assert!(workspace
        .files
        .contains(&cpl_preview_file.to_string_lossy().to_string()));
    assert!(workspace
        .files
        .contains(&part_selection_review_file.to_string_lossy().to_string()));
    assert!(workspace
        .files
        .contains(&circuit_review_file.to_string_lossy().to_string()));
    assert!(workspace
        .files
        .contains(&chat_trace_file.to_string_lossy().to_string()));
    assert!(workspace
        .files
        .contains(&manufacturing_readiness_file.to_string_lossy().to_string()));

    let bom_preview = fs::read_to_string(bom_preview_file).unwrap();
    assert!(bom_preview.contains("Designator,Footprint,Quantity,Value,LCSC Part #"));
    assert!(bom_preview.contains("ESP32-S3-WROOM-1-N8R8"));
    assert!(bom_preview.contains("C2913204"));

    let cpl_preview = fs::read_to_string(cpl_preview_file).unwrap();
    assert!(cpl_preview.contains("Designator,Mid X,Mid Y,Rotation,Layer"));
    assert!(cpl_preview.contains("U1,40.00,25.00,0,Top"));
    assert!(!cpl_preview.contains("UNPLACED"));

    let part_selection_review = fs::read_to_string(part_selection_review_file).unwrap();
    assert!(part_selection_review.contains("# ChatPCB3 Part Selection Review"));
    assert!(part_selection_review.contains("ESP32-S3-WROOM-1-N8R8"));
    assert!(part_selection_review.contains("ME6211C33M5G-N"));
    assert!(part_selection_review.contains("BME280"));
    assert!(part_selection_review.contains("USBLC6-2SC6"));
    assert!(part_selection_review.contains("JLCPCB/LCSC"));
    assert!(part_selection_review.contains("Selection basis"));
    assert!(part_selection_review.contains("Review risk"));
    assert!(part_selection_review.contains("Human substitution check required"));

    let circuit_review = fs::read_to_string(circuit_review_file).unwrap();
    assert!(circuit_review.contains("# ChatPCB3 Circuit Adequacy Review"));
    assert!(circuit_review.contains("Power budget"));
    assert!(circuit_review.contains("USB-C entry"));
    assert!(circuit_review.contains("ESP32-S3 boot"));
    assert!(circuit_review.contains("I2C sensor"));
    assert!(circuit_review.contains("Decoupling"));
    assert!(circuit_review.contains("PASS"));
    assert!(circuit_review.contains("Review risk"));
    assert!(circuit_review.contains("Human electrical review required"));

    let chat_trace = fs::read_to_string(chat_trace_file).unwrap();
    assert!(chat_trace.contains("# ChatPCB3 Chat-to-Circuit Trace"));
    assert!(chat_trace.contains("User prompt"));
    assert!(chat_trace.contains("USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB package"));
    assert!(chat_trace.contains("Trace status: COVERED"));
    assert!(chat_trace.contains("USB-C"));
    assert!(chat_trace.contains("ESP32-S3"));
    assert!(chat_trace.contains("I2C sensor"));
    assert!(chat_trace.contains("JLCPCB assembly"));
    assert!(chat_trace.contains("COVERED"));
    assert!(chat_trace.contains("chatpcb3-esp32s3.kicad_sch"));
    assert!(chat_trace.contains("jlcpcb-bom-preview.csv"));
    assert!(chat_trace.contains("Human review still required"));

    let manufacturing_readiness = fs::read_to_string(manufacturing_readiness_file).unwrap();
    assert!(manufacturing_readiness.contains("JLCPCB Manufacturing Preview"));
    assert!(manufacturing_readiness.contains("BOM preview: jlcpcb-bom-preview.csv"));
    assert!(manufacturing_readiness.contains("Part selection review: part-selection-review.md"));
    assert!(manufacturing_readiness.contains("Circuit review findings: circuit-review-findings.md"));
    assert!(manufacturing_readiness.contains("Chat-to-circuit trace: chat-to-circuit-trace.md"));
    assert!(manufacturing_readiness.contains("CPL preview: jlcpcb-cpl-preview.csv"));
    assert!(manufacturing_readiness.contains("Gerber/drill review files"));
    assert!(manufacturing_readiness.contains("Design quality report: design-quality-report.json"));
    assert!(manufacturing_readiness.contains("Design quality report: design-quality-report.md"));
    assert!(manufacturing_readiness.contains("Improvement Actions"));
    assert!(manufacturing_readiness.contains("Order readiness"));
    assert!(manufacturing_readiness.contains("BLOCKED_HUMAN_SIGNOFF_REQUIRED"));
    assert!(manufacturing_readiness.contains("주문 차단"));
    assert!(manufacturing_readiness.contains("Do not upload this preview to JLCPCB"));
    assert!(manufacturing_readiness.contains("not unattended order-ready"));

    let beginner_next_steps_file = project_dir.join("BEGINNER-NEXT-STEPS.txt");
    assert!(beginner_next_steps_file.exists());
    assert!(workspace
        .files
        .contains(&beginner_next_steps_file.to_string_lossy().to_string()));
    let beginner_next_steps = fs::read_to_string(beginner_next_steps_file).unwrap();
    assert!(beginner_next_steps.contains("ChatPCB3 첫 검토 목록"));
    assert!(beginner_next_steps.contains("먼저 할 일"));
    assert!(beginner_next_steps.contains("PCB 열기"));
    assert!(beginner_next_steps.contains("검토 목록"));
    assert!(beginner_next_steps.contains("후속 채팅"));
    assert!(beginner_next_steps.contains("아직 주문하지 마세요"));
    assert!(beginner_next_steps.contains("Gerber"));
    assert!(beginner_next_steps.contains("BOM 미리보기"));
    assert!(beginner_next_steps.contains("part-selection-review.md"));
    assert!(beginner_next_steps.contains("circuit-review-findings.md"));
    assert!(beginner_next_steps.contains("chat-to-circuit-trace.md"));
    assert!(beginner_next_steps.contains("CPL 미리보기"));
    assert!(!beginner_next_steps.contains("First thing to do"));
    assert!(!beginner_next_steps.contains("Open PCB"));
    assert!(!beginner_next_steps.contains("Review checklist"));
    assert!(!beginner_next_steps.contains("Ask a follow-up in chat"));
    assert!(!beginner_next_steps.contains("Do not order yet"));

    let prompt = fs::read_to_string(&workspace.prompt_file).unwrap();
    assert!(prompt.contains("USB-C ESP32-S3"));

    for file in &workspace.files {
        assert!(PathBuf::from(file).exists(), "{file} should exist");
    }

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn generated_kicad_schematic_keeps_long_review_notes_below_circuit_area() {
    let root = unique_test_root().with_extension("schematic-review-band");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace =
        create_preview_workspace("ESP32-S3 USB-C H2 Sensor touch display board", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let schematic = fs::read_to_string(project_dir.join("chatpcb3-esp32s3.kicad_sch")).unwrap();

    for snippet in [
        "Design intent:",
        "Required design items:",
        "Power design:",
        "MCU straps:",
        "Sensor design:",
        "Prompt option: MQ-8 analog H2 module",
        "H2 ADC range:",
        "Prompt option: Waveshare 2.8inch TFT Touch Shield",
        "Touch display power/logic:",
    ] {
        let (_x, y) = schematic_text_position(&schematic, snippet);
        assert!(
            y >= 160.0,
            "long schematic review note '{snippet}' must stay in the lower review band, not over the circuit at y={y}"
        );
    }

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn generated_kicad_schematic_keeps_standard_readable_text_for_embedded_svg_review() {
    let root = unique_test_root().with_extension("schematic-readable-fonts");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace =
        create_preview_workspace("ESP32-S3 USB-C H2 Sensor touch display board", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let schematic = fs::read_to_string(project_dir.join("chatpcb3-esp32s3.kicad_sch")).unwrap();

    assert!(
        schematic.contains("(font (size 1.27 1.27))"),
        "generated KiCad schematic should keep standard KiCad text large enough for embedded SVG review"
    );
    assert!(
        !schematic.contains("(font (size 0.9 0.9))"),
        "0.9mm fonts make the embedded KiCad SVG too hard to judge on the 회로도 tab"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn generated_kicad_schematic_keeps_optional_io_review_block_out_of_circuit_area() {
    let root = unique_test_root().with_extension("schematic-optional-io-review-band");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace =
        create_preview_workspace("ESP32-S3 USB-C H2 Sensor touch display board", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let schematic = fs::read_to_string(project_dir.join("chatpcb3-esp32s3.kicad_sch")).unwrap();
    let positions = schematic_symbol_positions(&schematic);
    let optional_io = positions
        .iter()
        .find(|position| position.reference == "X1")
        .expect("optional IO assignment review symbol should remain available in the schematic");

    assert!(
        optional_io.y >= 160.0,
        "X1 optional IO assignment is review metadata, not circuit topology, and should not crowd the embedded circuit viewport: {optional_io:#?}"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn generated_kicad_schematic_spreads_usb_power_and_mcu_symbols_for_readability() {
    let root = unique_test_root().with_extension("schematic-main-symbol-spacing");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace =
        create_preview_workspace("ESP32-S3 USB-C H2 Sensor touch display board", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let schematic = fs::read_to_string(project_dir.join("chatpcb3-esp32s3.kicad_sch")).unwrap();
    let positions = schematic_symbol_positions(&schematic);

    for (left_ref, right_ref, min_gap) in [
        ("J1", "F1", 36.0),
        ("F1", "U4", 28.0),
        ("U4", "U2", 36.0),
        ("U2", "U1", 46.0),
    ] {
        let left = positions
            .iter()
            .find(|position| position.reference == left_ref)
            .unwrap_or_else(|| panic!("missing symbol {left_ref}: {positions:#?}"));
        let right = positions
            .iter()
            .find(|position| position.reference == right_ref)
            .unwrap_or_else(|| panic!("missing symbol {right_ref}: {positions:#?}"));
        let gap = right.x - left.x;
        assert!(
            gap >= min_gap,
            "{left_ref}->{right_ref} gap {gap:.2}mm is too tight for readable embedded schematic labels: {positions:#?}"
        );
    }

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn generated_kicad_schematic_spreads_passive_symbols_for_embedded_readability() {
    let root = unique_test_root().with_extension("schematic-passive-spacing");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace =
        create_preview_workspace("ESP32-S3 USB-C H2 Sensor touch display board", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let schematic = fs::read_to_string(project_dir.join("chatpcb3-esp32s3.kicad_sch")).unwrap();
    let positions = schematic_symbol_positions(&schematic);
    let mut passives = positions
        .iter()
        .filter(|position| position.lib_id.ends_with("PASSIVE_2PIN"))
        .collect::<Vec<_>>();
    passives.sort_by(|left, right| {
        left.x
            .partial_cmp(&right.x)
            .unwrap()
            .then(left.y.partial_cmp(&right.y).unwrap())
    });

    for pair in passives.windows(2) {
        let same_column = (pair[0].x - pair[1].x).abs() < 1.0;
        let vertical_gap = (pair[0].y - pair[1].y).abs();
        assert!(
            !same_column || vertical_gap >= 8.0,
            "passive symbols {} and {} are too tightly stacked for embedded KiCad SVG readability: gap={vertical_gap}, positions={positions:#?}",
            pair[0].reference,
            pair[1].reference
        );
    }

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn beginner_review_checklist_surfaces_quality_actions_and_order_gate() {
    let root = unique_test_root().with_extension("beginner-quality-actions");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace(
        "USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB assembly",
        &root,
    )
    .unwrap();

    let first_run_summary = fs::read_to_string(&workspace.first_run_summary_file).unwrap();
    assert!(first_run_summary.contains("Improvement Actions"));
    assert!(first_run_summary.contains("BLOCKED_HUMAN_SIGNOFF_REQUIRED"));
    assert!(first_run_summary.contains("주문 차단"));
    assert!(!first_run_summary.contains("주문 준비 완료"));

    let beginner_next_steps = fs::read_to_string(&workspace.beginner_next_steps_file).unwrap();
    assert!(beginner_next_steps.contains("design-quality-report.md"));
    assert!(beginner_next_steps.contains("90점"));
    assert!(beginner_next_steps.contains("Improvement Actions"));
    assert!(beginner_next_steps.contains("Order readiness"));
    assert!(beginner_next_steps.contains("BLOCKED_HUMAN_SIGNOFF_REQUIRED"));
    assert!(beginner_next_steps.contains("주문 차단"));
    assert!(!beginner_next_steps.contains("주문 준비 완료"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn preview_workspace_writes_quantified_quality_report_with_validation_gate_pending() {
    let root = unique_test_root().with_extension("quality-report");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace(
        "USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB assembly",
        &root,
    )
    .unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let report_file = project_dir.join("design-quality-report.json");
    let markdown_file = project_dir.join("design-quality-report.md");

    assert!(
        report_file.exists(),
        "JSON quality report should be written"
    );
    assert!(
        markdown_file.exists(),
        "Markdown quality report should be written for checklist review"
    );
    assert!(workspace
        .files
        .contains(&report_file.to_string_lossy().to_string()));
    assert!(workspace
        .files
        .contains(&markdown_file.to_string_lossy().to_string()));

    let report = evaluate_workspace_quality(&project_dir).unwrap();
    assert_eq!(report.level, QualityLevel::PrototypeReview);
    assert!(
        report.total_score < report.target_score,
        "quality score must stay below target until KiCad reports are present: {report:#?}"
    );
    assert_eq!(report.target_score, 90);
    assert!(
        report
            .blockers
            .iter()
            .any(|blocker| blocker.contains("ERC report")),
        "missing ERC report must be a blocker: {report:#?}"
    );
    assert!(
        report
            .blockers
            .iter()
            .any(|blocker| blocker.contains("DRC report")),
        "missing DRC report must be a blocker: {report:#?}"
    );
    assert!(report.metrics.schematic_symbol_count >= 5);
    assert!(report.metrics.schematic_net_label_count >= 8);
    assert!(report.metrics.pcb_footprint_count >= 5);
    assert!(report.metrics.pcb_pad_count >= 20);
    assert!(report.metrics.pcb_track_count >= 8);
    assert_eq!(report.metrics.cpl_unplaced_count, 0);
    assert!(report.metrics.manufacturing_files_present);
    assert!(report.metrics.visual_review_files_present);

    let markdown = fs::read_to_string(markdown_file).unwrap();
    assert!(markdown.contains("# ChatPCB3 Design Quality Report"));
    assert!(markdown.contains("Total score:"));
    assert!(markdown.contains("PrototypeReview"));
    assert!(markdown.contains("90"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quality_report_lists_ranked_improvement_actions_for_missing_evidence() {
    let root = unique_test_root().with_extension("quality-report-improvement-actions");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace(
        "USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB assembly",
        &root,
    )
    .unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);

    let report = evaluate_workspace_quality(&project_dir).unwrap();
    assert!(
        report
            .improvement_actions
            .iter()
            .any(|action| action.contains("Run KiCad ERC")),
        "missing ERC evidence should become an explicit next action: {report:#?}"
    );
    assert!(
        report
            .improvement_actions
            .iter()
            .any(|action| action.contains("Run KiCad DRC")),
        "missing DRC evidence should become an explicit next action: {report:#?}"
    );
    assert!(
        report
            .improvement_actions
            .iter()
            .any(|action| action.contains("order gate")),
        "quality improvement actions must keep the human order gate visible: {report:#?}"
    );

    let markdown = quality_report_markdown(&report);
    assert!(markdown.contains("## Improvement Actions"));
    assert!(markdown.contains("1. Run KiCad ERC"));
    assert!(markdown.contains("2. Run KiCad DRC"));
    assert!(markdown.contains("human manufacturing signoff"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quality_report_blocks_90_point_claim_when_kicad_reports_have_findings() {
    let root = unique_test_root().with_extension("quality-report-findings");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace(
        "USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB assembly",
        &root,
    )
    .unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);

    fs::write(
        project_dir.join("erc-report.json"),
        r#"{
          "violations": [
            { "severity": "error", "message": "Label is not connected to a pin" },
            { "severity": "warning", "message": "Power pin is not driven" }
          ],
          "unconnected_items": []
        }"#,
    )
    .unwrap();
    fs::write(
        project_dir.join("drc-report.json"),
        r#"{
          "violations": [
            { "severity": "warning", "message": "Courtyard spacing needs review" }
          ],
          "unconnected_items": [{ "description": "Net I2C_SCL is unrouted" }]
        }"#,
    )
    .unwrap();

    let report = evaluate_workspace_quality(&project_dir).unwrap();
    assert_ne!(report.level, QualityLevel::ReleaseCandidate);
    assert!(
        report.total_score < report.target_score,
        "KiCad findings must keep the quality score below target: {report:#?}"
    );
    assert!(
        report
            .blockers
            .iter()
            .any(|blocker| blocker.contains("ERC") && blocker.contains("error")),
        "ERC errors must be hard blockers: {report:#?}"
    );
    assert!(
        report
            .blockers
            .iter()
            .any(|blocker| blocker.contains("DRC") && blocker.contains("unconnected")),
        "DRC unrouted or unconnected findings must be hard blockers: {report:#?}"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quality_report_blocks_90_point_claim_when_erc_has_warning_only() {
    let root = unique_test_root().with_extension("quality-report-erc-warning");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace("ESP32-S3 USB-C sensor board", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);

    fs::write(
        project_dir.join("erc-report.json"),
        r#"{
          "violations": [
            { "severity": "warning", "message": "Power input is not explicitly driven" }
          ],
          "unconnected_items": []
        }"#,
    )
    .unwrap();

    let report = evaluate_workspace_quality(&project_dir).unwrap();
    assert_ne!(report.level, QualityLevel::ReleaseCandidate);
    assert!(
        report.total_score < report.target_score,
        "ERC warnings must keep the quality score below target: {report:#?}"
    );
    assert!(
        report
            .blockers
            .iter()
            .any(|blocker| blocker.contains("ERC") && blocker.contains("warning")),
        "ERC warnings must be review blockers: {report:#?}"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quality_report_blocks_90_point_claim_when_part_selection_review_is_missing() {
    let root = unique_test_root().with_extension("quality-report-missing-parts-review");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace("ESP32-S3 USB-C sensor board", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let _ = fs::remove_file(project_dir.join("part-selection-review.md"));

    let report = evaluate_workspace_quality(&project_dir).unwrap();
    assert_ne!(report.level, QualityLevel::ReleaseCandidate);
    assert!(
        report.total_score < report.target_score,
        "missing part-selection review must keep quality below target: {report:#?}"
    );
    assert!(
        report
            .blockers
            .iter()
            .any(|blocker| blocker.contains("part selection review")),
        "missing part-selection review must be a hard blocker: {report:#?}"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quality_report_blocks_90_point_claim_when_circuit_review_is_missing() {
    let root = unique_test_root().with_extension("quality-report-missing-circuit-review");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace("ESP32-S3 USB-C sensor board", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let _ = fs::remove_file(project_dir.join("circuit-review-findings.md"));

    let report = evaluate_workspace_quality(&project_dir).unwrap();
    assert_ne!(report.level, QualityLevel::ReleaseCandidate);
    assert!(
        report.total_score < report.target_score,
        "missing circuit review must keep quality below target: {report:#?}"
    );
    assert!(
        report
            .blockers
            .iter()
            .any(|blocker| blocker.contains("circuit review")),
        "missing circuit review must be a hard blocker: {report:#?}"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quality_report_blocks_90_point_claim_when_reviews_omit_risk_rationale() {
    let root = unique_test_root().with_extension("quality-report-thin-risk-review");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace("ESP32-S3 USB-C sensor board", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);

    fs::write(
        project_dir.join("erc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();
    fs::write(
        project_dir.join("drc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();
    fs::write(
        project_dir.join("circuit-review-findings.md"),
        "# Thin Circuit Review\r\n\r\n| Area | Result | Evidence |\r\n| --- | --- | --- |\r\n| Power | PASS | present |\r\n| USB-C | PASS | present |\r\n| Boot | PASS | present |\r\n| I2C | PASS | present |\r\n| Decoupling | PASS | present |\r\n| Manufacturing | PASS | present |\r\n",
    )
    .unwrap();
    fs::write(
        project_dir.join("part-selection-review.md"),
        "# Thin Part Review\r\n\r\n| Designator | MPN | LCSC |\r\n| --- | --- | --- |\r\n| U1 | ESP32-S3-WROOM-1-N8R8 | C2913204 |\r\n| U2 | ME6211C33M5G-N | C82942 |\r\n| U3 | BME280 | C92489 |\r\n| J1 | USB4085-GF-A | C428687 |\r\n| U4 | USBLC6-2SC6 | C7519 |\r\n| F1 | 1206L050WR | C70076 |\r\n| R1,R2 | 5.1k 1% | C23186 |\r\n| C1,C2 | 10uF | C19702 |\r\n",
    )
    .unwrap();

    let report = evaluate_workspace_quality(&project_dir).unwrap();
    assert_ne!(report.level, QualityLevel::ReleaseCandidate);
    assert!(
        report.total_score < report.target_score,
        "thin reviews without risk rationale must keep quality below target: {report:#?}"
    );
    assert!(
        report
            .blockers
            .iter()
            .any(|blocker| blocker.contains("circuit review") && blocker.contains("risk")),
        "circuit review must require row-level risk rationale: {report:#?}"
    );
    assert!(
        report
            .blockers
            .iter()
            .any(|blocker| blocker.contains("part selection") && blocker.contains("risk")),
        "part selection review must require selection basis and risk rationale: {report:#?}"
    );
    assert!(
        report
            .improvement_actions
            .iter()
            .any(|action| action.contains("risk rationale")),
        "improvement actions should tell the user to add risk rationale: {report:#?}"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quality_report_blocks_90_point_claim_when_chat_trace_is_missing() {
    let root = unique_test_root().with_extension("quality-report-missing-chat-trace");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace("ESP32-S3 USB-C sensor board", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let _ = fs::remove_file(project_dir.join("chat-to-circuit-trace.md"));

    let report = evaluate_workspace_quality(&project_dir).unwrap();
    assert_ne!(report.level, QualityLevel::ReleaseCandidate);
    assert!(
        report.total_score < report.target_score,
        "missing chat-to-circuit trace must keep quality below target: {report:#?}"
    );
    assert!(
        report
            .blockers
            .iter()
            .any(|blocker| blocker.contains("chat-to-circuit trace")),
        "missing chat-to-circuit trace must be a hard blocker: {report:#?}"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quality_report_surfaces_erc_open_pin_connectivity_count() {
    let root = unique_test_root().with_extension("quality-report-erc-open-pin-count");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace("ESP32-S3 USB-C sensor board", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);

    fs::write(
        project_dir.join("erc-report.json"),
        r#"{"violations":[],"unconnected_items":[{"description":"U1 GPIO floating"}]}"#,
    )
    .unwrap();
    fs::write(
        project_dir.join("drc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();

    let report = evaluate_workspace_quality(&project_dir).unwrap();
    assert_eq!(report.metrics.erc_unconnected_count, 1);
    assert_ne!(report.level, QualityLevel::ReleaseCandidate);
    assert!(
        report
            .blockers
            .iter()
            .any(|blocker| blocker.contains("ERC") && blocker.contains("open/unconnected")),
        "ERC open pins must block the release-candidate quality claim: {report:#?}"
    );

    let markdown = quality_report_markdown(&report);
    assert!(markdown.contains("ERC errors/warnings/open-unconnected: 0/0/1"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quality_report_blocks_90_point_claim_when_prompt_requested_options_are_missing() {
    let root = unique_test_root().with_extension("quality-report-missing-prompt-options");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace(
        "ESP32-S3와 터치 디스플레이를 가지고 H2 Sensor를 포함하며 USB-C로 전원을 인가받는 회로",
        &root,
    )
    .unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);

    fs::write(
        project_dir.join("erc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();
    fs::write(
        project_dir.join("drc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();

    for relative in [
        "chatpcb3-esp32s3.kicad_sch",
        "jlcpcb-bom-preview.csv",
        "chat-to-circuit-trace.md",
        "part-selection-review.md",
        "visual-review/schematic-review.svg",
    ] {
        let path = project_dir.join(relative);
        let scrubbed = fs::read_to_string(&path)
            .unwrap()
            .lines()
            .filter(|line| {
                !line.contains("H2")
                    && !line.contains("Touch")
                    && !line.contains("DISPLAY")
                    && !line.contains("DS1")
                    && !line.contains("U5")
            })
            .collect::<Vec<_>>()
            .join("\r\n");
        fs::write(path, scrubbed).unwrap();
    }

    let report = evaluate_workspace_quality(&project_dir).unwrap();
    assert_ne!(report.level, QualityLevel::ReleaseCandidate);
    assert!(
        report.total_score < report.target_score,
        "missing prompt-requested H2/touch evidence must keep quality below target: {report:#?}"
    );
    assert!(
        report
            .missing_required_design_items
            .iter()
            .any(|item| item.contains("H2")),
        "H2 prompt request must become a required design item: {report:#?}"
    );
    assert!(
        report
            .missing_required_design_items
            .iter()
            .any(|item| item.contains("Touch") || item.contains("DISPLAY")),
        "touch display prompt request must become a required design item: {report:#?}"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quality_report_blocks_90_point_claim_when_prompt_specific_part_selection_is_placeholder() {
    let root = unique_test_root().with_extension("quality-report-placeholder-parts");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace(
        "ESP32-S3와 터치 디스플레이를 가지고 H2 Sensor를 포함하며 USB-C로 전원을 인가받는 회로",
        &root,
    )
    .unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);

    fs::write(
        project_dir.join("erc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();
    fs::write(
        project_dir.join("drc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();
    fs::write(
        project_dir.join("jlcpcb-bom-preview.csv"),
        "Designator,Footprint,Quantity,Value,LCSC Part #\r\nU5,PinHeader_1x04,1,H2 gas sensor interface,C492405\r\nDS1,PinHeader_1x06,1,Touch display connector,C492407\r\n",
    )
    .unwrap();
    fs::write(
        project_dir.join("part-selection-review.md"),
        "| Designator | Function | MPN | JLCPCB/LCSC |\r\n| --- | --- | --- | --- |\r\n| U5 | H2 gas sensor interface | H2-SENSOR-MODULE-HEADER | C492405 |\r\n| DS1 | Touch display connector | TOUCH-DISPLAY-HEADER | C492407 |\r\n",
    )
    .unwrap();

    let report = evaluate_workspace_quality(&project_dir).unwrap();
    assert_ne!(report.level, QualityLevel::ReleaseCandidate);
    assert!(
        report.total_score < report.target_score,
        "placeholder H2/touch selections must keep quality below target: {report:#?}"
    );
    assert!(
        report
            .blockers
            .iter()
            .any(|blocker| blocker.contains("H2 sensor") && blocker.contains("selection")),
        "placeholder H2 sensor selection must be a hard blocker: {report:#?}"
    );
    assert!(
        report
            .blockers
            .iter()
            .any(|blocker| blocker.contains("touch display") && blocker.contains("selection")),
        "placeholder touch display selection must be a hard blocker: {report:#?}"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quality_report_blocks_90_point_claim_when_prompt_parts_are_external_module_assembly_claims() {
    let root = unique_test_root().with_extension("quality-report-external-module-assembly");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace(
        "ESP32-S3와 터치 디스플레이를 가지고 H2 Sensor를 포함하며 USB-C로 전원을 인가받는 회로, JLCPCB 조립 검토",
        &root,
    )
    .unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);

    fs::write(
        project_dir.join("erc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();
    fs::write(
        project_dir.join("drc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();
    fs::write(
        project_dir.join("jlcpcb-bom-preview.csv"),
        "Designator,Footprint,Quantity,Value,LCSC Part #\r\nU5,Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical,1,MQ-8 analog H2 module,C492405\r\nDS1,Connector_PinHeader_2.54mm:PinHeader_1x12_P2.54mm_Vertical,1,Waveshare 2.8inch TFT Touch Shield connector,C492411\r\n",
    )
    .unwrap();
    fs::write(
        project_dir.join("part-selection-review.md"),
        "# Bad Part Selection Review\r\n\r\n| Designator | Function | MPN | JLCPCB/LCSC | Package | Footprint | Selection basis | Review risk |\r\n| --- | --- | --- | --- | --- | --- | --- | --- |\r\n| U5 | MQ-8 analog H2 module | Winsen MQ-8 analog H2 module profile | C492405 | 1x04 external module header | Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical | prompt-requested module | should not be claimed as assembled |\r\n| DS1 | Waveshare 2.8inch TFT Touch Shield connector | Waveshare 2.8inch TFT Touch Shield ST7789V XPT2046 profile | C492411 | 1x12 external module header | Connector_PinHeader_2.54mm:PinHeader_1x12_P2.54mm_Vertical | prompt-requested module | should not be claimed as assembled |\r\n",
    )
    .unwrap();

    let bom = fs::read_to_string(project_dir.join("jlcpcb-bom-preview.csv")).unwrap();
    let part_review = fs::read_to_string(project_dir.join("part-selection-review.md")).unwrap();
    assert!(
        bom.contains("MQ-8 analog H2 module")
            && part_review.contains("1x04 external module header"),
        "test setup should contain the current H2 external-module assembly claim"
    );
    assert!(
        bom.contains("Waveshare 2.8inch TFT Touch Shield connector")
            && part_review.contains("1x12 external module header"),
        "test setup should contain the current touch-display external-module assembly claim"
    );

    let report = evaluate_workspace_quality(&project_dir).unwrap();
    assert_ne!(report.level, QualityLevel::ReleaseCandidate);
    assert!(
        report.total_score < report.target_score,
        "external H2/display modules must not be treated as JLCPCB-assembled part selections: {report:#?}"
    );
    assert!(
        report.metrics.external_module_assembly_blocker_count >= 2,
        "H2 and touch display external-module claims should be counted separately: {report:#?}"
    );
    assert!(
        report.blockers.iter().any(|blocker| {
            blocker.contains("external module") && blocker.contains("JLCPCB assembly")
        }),
        "quality gate must explain the external-module assembly problem: {report:#?}"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quality_report_allows_90_point_claim_when_prompt_modules_are_separated_from_assembly_bom() {
    let root = unique_test_root().with_extension("quality-report-prompt-modules-separated");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace(
        "ESP32-S3와 터치 디스플레이를 가지고 H2 Sensor를 포함하며 USB-C로 전원을 인가받는 회로, JLCPCB 조립 검토",
        &root,
    )
    .unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);

    fs::write(
        project_dir.join("erc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();
    fs::write(
        project_dir.join("drc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();

    let bom = fs::read_to_string(project_dir.join("jlcpcb-bom-preview.csv")).unwrap();
    let part_review = fs::read_to_string(project_dir.join("part-selection-review.md")).unwrap();
    assert!(
        bom.contains("H2 module interface 1x4 2.54mm header"),
        "JLCPCB BOM should assemble the H2 interface header, not the external sensor module: {bom}"
    );
    assert!(
        bom.contains("Touch display interface 1x12 2.54mm header"),
        "JLCPCB BOM should assemble the touch-display interface header, not the external display module: {bom}"
    );
    assert!(
        !bom.contains("MQ-8 analog H2 module")
            && !bom.contains("Waveshare 2.8inch TFT Touch Shield connector"),
        "external modules must be kept out of the JLCPCB assembly BOM: {bom}"
    );
    assert!(part_review.contains("Manual-install external modules"));
    assert!(part_review.contains("MQ-8 analog H2 module"));
    assert!(part_review.contains("Waveshare 2.8inch TFT Touch Shield"));
    assert!(part_review.contains("not included in the JLCPCB assembly BOM"));

    let report = evaluate_workspace_quality(&project_dir).unwrap();
    assert_eq!(report.metrics.external_module_assembly_blocker_count, 0);
    assert_eq!(report.level, QualityLevel::ReleaseCandidate);
    assert!(
        report.total_score >= report.target_score,
        "separated external modules plus clean ERC/DRC should meet the 90 point target: {report:#?}"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quality_report_allows_90_point_claim_when_assembly_parts_have_no_external_module_claims() {
    let root = unique_test_root().with_extension("quality-report-concrete-assembly-parts");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace(
        "USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB assembly",
        &root,
    )
    .unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);

    fs::write(
        project_dir.join("erc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();
    fs::write(
        project_dir.join("drc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();

    let report = evaluate_workspace_quality(&project_dir).unwrap();
    assert_eq!(report.metrics.prompt_specific_selection_blocker_count, 0);
    assert_eq!(report.metrics.external_module_assembly_blocker_count, 0);
    assert_eq!(report.level, QualityLevel::ReleaseCandidate);
    assert!(
        report.total_score >= report.target_score,
        "concrete assembly selections plus clean ERC/DRC should meet the 90 point target: {report:#?}"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quality_report_keeps_order_gate_blocked_even_for_90_point_candidate() {
    let root = unique_test_root().with_extension("quality-report-order-gate");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace(
        "USB-C ESP32-S3 sensor board with I2C sensor and JLCPCB assembly",
        &root,
    )
    .unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);

    fs::write(
        project_dir.join("erc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();
    fs::write(
        project_dir.join("drc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();

    let report = evaluate_workspace_quality(&project_dir).unwrap();
    assert_eq!(report.level, QualityLevel::ReleaseCandidate);
    assert!(
        report.total_score >= report.target_score,
        "clean evidence should still be allowed to meet the numeric target: {report:#?}"
    );
    assert_eq!(
        report.total_score, report.target_score,
        "human-signoff-blocked ReleaseCandidate should be capped at 90, not shown as 100/100: {report:#?}"
    );
    assert!(
        !report.order_ready,
        "90+ score must not become unattended JLCPCB order readiness: {report:#?}"
    );
    assert_eq!(report.order_gate, "BLOCKED_HUMAN_SIGNOFF_REQUIRED");

    let markdown = quality_report_markdown(&report);
    assert!(markdown.contains("Order readiness: BLOCKED_HUMAN_SIGNOFF_REQUIRED"));
    assert!(markdown.contains("human manufacturing signoff"));

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
        "chatpcb3.kicad_sym",
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
    assert!(schematic.contains("(lib_id \"ChatPCB3:ESP32S3_REVIEW\""));
    assert!(schematic.contains("(label \"+3V3\""));
    assert!(schematic.contains("(label \"I2C_SCL\""));
    assert!(!schematic.contains("Components and nets are not generated yet"));

    let symbol_table = fs::read_to_string(project_dir.join("sym-lib-table")).unwrap();
    assert!(symbol_table.contains("ChatPCB3"));
    assert!(symbol_table.contains("chatpcb3.kicad_sym"));

    let symbol_library = fs::read_to_string(project_dir.join("chatpcb3.kicad_sym")).unwrap();
    assert!(symbol_library.contains("(symbol \"ESP32S3_REVIEW\""));
    assert!(symbol_library.contains("(symbol \"BME280_I2C_REVIEW\""));

    let pcb = fs::read_to_string(project_dir.join("chatpcb3-esp32s3.kicad_pcb")).unwrap();
    assert!(pcb.contains("(layers"));
    assert!(pcb.contains("\"Edge.Cuts\""));
    assert!(pcb.contains("(footprint \"ChatPCB3_ESP32-S3-WROOM-1_REVIEW\""));
    assert!(pcb.contains("(property \"SourceFootprint\" \"RF_Module:ESP32-S3-WROOM-1\""));
    assert!(pcb.contains("(segment"));
    assert!(pcb.contains("(pad \"1\""));

    let report = fs::read_to_string(&workspace.release_report_file).unwrap();
    assert!(report.contains("Generated KiCad design-review files"));
    assert!(report.contains("design-quality-report.json"));
    assert!(report.contains("JLCPCB manufacturing preview files"));
    assert!(report.contains("jlcpcb-bom-preview.csv"));
    assert!(report.contains("manufacturing-readiness-preview.txt"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn generated_schematic_captures_esp32s3_usb_c_sensor_design_requirements() {
    let root = unique_test_root().with_extension("schematic-requirements");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace("ESP32-S3 USB-C 온습도 센서 보드", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let schematic = fs::read_to_string(project_dir.join("chatpcb3-esp32s3.kicad_sch")).unwrap();
    let visual_review = fs::read_to_string(
        project_dir
            .join("visual-review")
            .join("schematic-review.svg"),
    )
    .unwrap();

    for required in [
        "J1 USB-C",
        "CC1 5.1k",
        "CC2 5.1k",
        "VBUS fuse",
        "USB ESD",
        "USB D+ 22R series",
        "USB D- 22R series",
        "U2 3V3 regulator",
        "LDO input capacitor",
        "LDO output capacitor",
        "ESP32-S3-WROOM-1",
        "ESP32 local decoupling",
        "ESP_EN pull-up",
        "BOOT strap",
        "I2C_SCL pull-up",
        "I2C_SDA pull-up",
        "BME280 I2C sensor",
        "sensor decoupling",
    ] {
        assert!(
            schematic.contains(required) || visual_review.contains(required),
            "schematic review output must expose required design item `{required}`"
        );
    }

    assert!(
        !visual_review.contains("Library symbols and net labels preview"),
        "visual schematic review must not describe a mock symbol/net-label preview"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn generated_schematic_exposes_usb_series_resistors_and_local_decoupling() {
    let root = unique_test_root().with_extension("schematic-usb-series-decoupling");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace("ESP32-S3 USB-C 온습도 센서 보드", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let schematic = fs::read_to_string(project_dir.join("chatpcb3-esp32s3.kicad_sch")).unwrap();
    let pcb = fs::read_to_string(project_dir.join("chatpcb3-esp32s3.kicad_pcb")).unwrap();
    let bom = fs::read_to_string(project_dir.join("jlcpcb-bom-preview.csv")).unwrap();
    let part_review = fs::read_to_string(project_dir.join("part-selection-review.md")).unwrap();

    for required in [
        "R9",
        "USB D+ 22R series",
        "USB_D_P_SER",
        "R10",
        "USB D- 22R series",
        "USB_D_N_SER",
        "C5",
        "ESP32 local decoupling",
    ] {
        assert!(
            schematic.contains(required),
            "schematic must expose `{required}` instead of hiding it in PCB/BOM only"
        );
    }

    assert!(pcb.contains("(property \"Reference\" \"R9\""));
    assert!(pcb.contains("(property \"Reference\" \"R10\""));
    assert!(pcb.contains("(property \"Reference\" \"C5\""));
    assert!(bom.contains("R9,R10"));
    assert!(bom.contains("USB data 22R series resistor"));
    assert!(bom.contains("C5"));
    assert!(part_review.contains("USB data 22R series resistor"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn generated_schematic_uses_capacitor_symbols_and_shows_passive_electrical_ratings() {
    let root = unique_test_root().with_extension("schematic-capacitor-ratings");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace("ESP32-S3 USB-C 온습도 센서 보드", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let schematic = fs::read_to_string(project_dir.join("chatpcb3-esp32s3.kicad_sch")).unwrap();
    let symbol_library = fs::read_to_string(project_dir.join("chatpcb3.kicad_sym")).unwrap();
    let bom = fs::read_to_string(project_dir.join("jlcpcb-bom-preview.csv")).unwrap();
    let part_review = fs::read_to_string(project_dir.join("part-selection-review.md")).unwrap();

    assert!(symbol_library.contains(r#"(symbol "CAPACITOR_2PIN""#));
    assert!(
        symbol_library.contains("(polyline")
            && symbol_library.contains("(pts (xy -1.27 -3.81) (xy -1.27 3.81))")
            && symbol_library.contains("(pts (xy 1.27 -3.81) (xy 1.27 3.81))"),
        "capacitors should render as two plate symbols, not generic rectangular passives"
    );

    for reference in ["C1", "C2", "C3", "C4", "C5"] {
        assert!(
            schematic.contains(&format!(r#"(lib_id "ChatPCB3:CAPACITOR_2PIN")"#))
                && schematic.contains(&format!(r#"(property "Reference" "{reference}""#)),
            "{reference} should use the capacitor symbol library entry"
        );
    }
    assert!(schematic.matches("10uF 10V X5R 0603 +/-10%").count() >= 2);
    assert!(schematic.contains("1uF 6.3V X5R 0603 +/-10%"));
    assert!(schematic.matches("100nF 6.3V X7R 0603 +/-10%").count() >= 2);
    assert!(schematic.matches("22R 0603 +/-5%").count() >= 2);
    assert!(bom.contains("10uF 10V X5R 0603 +/-10%"));
    assert!(bom.contains("100nF 6.3V X7R 0603 +/-10%"));
    assert!(part_review.contains("Voltage rating"));
    assert!(part_review.contains("Tolerance"));
    assert!(part_review.contains("0603"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn prompt_requested_h2_sensor_and_touch_display_are_reflected_in_generated_outputs() {
    let root = unique_test_root().with_extension("prompt-variant-h2-touch");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace(
        "ESP32-S3와 터치 디스플레이를 가지고 H2 Sensor를 포함하며 USB-C로 전원을 인가받는 회로",
        &root,
    )
    .unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let schematic = fs::read_to_string(project_dir.join("chatpcb3-esp32s3.kicad_sch")).unwrap();
    let pcb = fs::read_to_string(project_dir.join("chatpcb3-esp32s3.kicad_pcb")).unwrap();
    let visual_review = fs::read_to_string(
        project_dir
            .join("visual-review")
            .join("schematic-review.svg"),
    )
    .unwrap();
    let pcb_visual =
        fs::read_to_string(project_dir.join("visual-review").join("pcb-review.svg")).unwrap();
    let bom = fs::read_to_string(project_dir.join("jlcpcb-bom-preview.csv")).unwrap();
    let circuit_review =
        fs::read_to_string(project_dir.join("circuit-review-findings.md")).unwrap();
    let part_review = fs::read_to_string(project_dir.join("part-selection-review.md")).unwrap();
    let trace = fs::read_to_string(project_dir.join("chat-to-circuit-trace.md")).unwrap();

    assert!(schematic.contains("MQ-8 analog H2 module"));
    assert!(schematic.contains("Touch display"));
    assert!(schematic.contains("VBUS_5V"));
    assert!(schematic.contains("H2_AOUT_RAW"));
    assert!(schematic.contains("H2_ADC"));
    assert!(schematic.contains("H2 ADC divider top"));
    assert!(schematic.contains("H2 ADC divider bottom"));
    assert!(schematic.contains("H2 ADC filter"));
    assert!(schematic.contains("5V heater/VCC"));
    assert!(schematic.contains("Waveshare 2.8inch TFT Touch Shield"));
    assert!(schematic.contains("DISPLAY_SPI_SCK"));
    assert!(schematic.contains("DISPLAY_SPI_MOSI"));
    assert!(schematic.contains("TOUCH_CS"));
    assert!(schematic.contains("TOUCH_IRQ"));
    assert!(schematic.contains("H2 ADC range"));
    assert!(schematic.contains("5.0V AOUT / 2 = 2.5V"));
    assert!(schematic.contains("2.5V < ESP32 3.3V ADC limit"));
    assert!(schematic.contains("R7/R8 10k"));
    assert!(schematic.contains("C6 100nF"));
    assert!(schematic.contains("Touch display power/logic"));
    assert!(schematic.contains("3V3 SPI logic"));
    assert!(schematic.contains("backlight current"));
    assert!(!schematic.contains("H2_SENSE, I2C_SCL, I2C_SDA"));
    assert!(pcb.contains("(property \"Reference\" \"U5\""));
    assert!(pcb.contains("(property \"Value\" \"MQ-8 analog H2 module\""));
    assert!(pcb.contains("(property \"SourceFootprint\" \"Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical\""));
    assert!(pcb.contains("(property \"Reference\" \"R7\""));
    assert!(pcb.contains("(property \"Value\" \"H2 ADC divider top\""));
    assert!(pcb.contains("(property \"Reference\" \"R8\""));
    assert!(pcb.contains("(property \"Value\" \"H2 ADC divider bottom\""));
    assert!(pcb.contains("(property \"Reference\" \"C6\""));
    assert!(pcb.contains("(net 12 \"H2_ADC\""));
    assert!(pcb.contains("(property \"Reference\" \"DS1\""));
    assert!(pcb.contains("(property \"Value\" \"Waveshare 2.8inch TFT Touch Shield connector\""));
    assert!(pcb.contains("(property \"SourceFootprint\" \"Connector_PinHeader_2.54mm:PinHeader_1x12_P2.54mm_Vertical\""));
    assert!(pcb.contains("(gr_text \"H2 sensor\""));
    assert!(pcb.contains("(gr_text \"Touch display\""));
    assert!(visual_review.contains(r#"<rect x="620" y="336" width="170""#));
    assert!(visual_review.contains(r#"<rect x="820" y="336" width="240""#));
    assert!(visual_review.contains(r#"<rect x="620" y="456" width="440""#));
    assert!(visual_review.contains("H2_ADC"));
    assert!(visual_review.contains("DISPLAY_SPI_SCK"));
    assert!(visual_review.contains("MQ-8 analog H2 module"));
    assert!(visual_review.contains("Waveshare 2.8inch TFT Touch Shield"));
    assert!(visual_review.contains(r#"data-chatpcb-visual-clarity="schematic-review-v2""#));
    assert!(visual_review.contains("visual-schematic-clarity-pass"));
    assert!(visual_review.contains("H2 ADC front-end"));
    assert!(visual_review.contains("U5 AOUT -> R7/R8 -> C6 -> GPIO1"));
    assert!(visual_review.contains("Touch SPI/touch connector separated from H2 ADC lane"));
    assert!(
        !visual_review.contains(r#"<rect x="900""#),
        "prompt-specific schematic review blocks must not be drawn partly outside the 1100-wide viewBox"
    );
    assert!(pcb_visual.contains("U5 H2"));
    assert!(pcb_visual.contains("DS1 Touch"));
    assert!(bom.contains("H2 module interface 1x4 2.54mm header"));
    assert!(bom.contains("H2 ADC divider"));
    assert!(bom.contains("Touch display interface 1x12 2.54mm header"));
    assert!(!bom.contains("MQ-8 analog H2 module"));
    assert!(!bom.contains("Waveshare 2.8inch TFT Touch Shield connector"));
    assert!(!bom.contains("H2-SENSOR-MODULE-HEADER"));
    assert!(!bom.contains("TOUCH-DISPLAY-HEADER"));
    assert!(part_review.contains("H2 module interface 1x4 2.54mm header"));
    assert!(circuit_review.contains("H2 ADC range"));
    assert!(circuit_review.contains("5.0V AOUT / 2 = 2.5V"));
    assert!(circuit_review.contains("2.5V < ESP32 3.3V ADC limit"));
    assert!(circuit_review.contains("R7/R8 10k"));
    assert!(circuit_review.contains("C6 100nF"));
    assert!(circuit_review.contains("MQ-8 heater current"));
    assert!(circuit_review.contains("Touch display power/logic"));
    assert!(circuit_review.contains("3V3 SPI logic"));
    assert!(circuit_review.contains("DISPLAY_SPI_SCK"));
    assert!(circuit_review.contains("backlight current"));
    assert!(part_review.contains("MQ-8"));
    assert!(part_review.contains("5V heater"));
    assert!(part_review.contains("ADC divider"));
    assert!(part_review.contains("Touch display interface 1x12 2.54mm header"));
    assert!(part_review.contains("Manual-install external modules"));
    assert!(part_review.contains("Waveshare 2.8inch TFT Touch Shield"));
    assert!(part_review.contains("not included in the JLCPCB assembly BOM"));
    assert!(part_review.contains("ST7789V"));
    assert!(part_review.contains("XPT2046"));
    assert!(trace.contains("| H2 Sensor | COVERED |"));
    assert!(trace.contains("MQ-8 analog module"));
    assert!(trace.contains("5V heater"));
    assert!(trace.contains("H2_ADC"));
    assert!(trace.contains("| Touch Display | COVERED |"));
    assert!(trace.contains("SPI"));
    assert!(trace.contains("ST7789V"));
    assert!(trace.contains("XPT2046"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quality_report_blocks_90_point_claim_when_visual_schematic_review_lacks_readable_prompt_layout()
{
    let root = unique_test_root().with_extension("quality-report-thin-visual-schematic-review");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace(
        "ESP32-S3와 터치 디스플레이를 가지고 H2 Sensor를 포함하며 USB-C로 전원을 인가받는 회로",
        &root,
    )
    .unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);

    fs::write(
        project_dir.join("erc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();
    fs::write(
        project_dir.join("drc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();
    fs::write(
        project_dir
            .join("visual-review")
            .join("schematic-review.svg"),
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="680">
<text>MQ-8 analog H2 module</text>
<text>H2_ADC</text>
<text>DISPLAY_SPI_SCK</text>
<text>Waveshare 2.8inch TFT Touch Shield</text>
</svg>"#,
    )
    .unwrap();

    let report = evaluate_workspace_quality(&project_dir).unwrap();
    assert_ne!(report.level, QualityLevel::ReleaseCandidate);
    assert!(
        report.total_score < report.target_score,
        "a present but unreadable schematic review SVG must not be called 90+ quality: {report:#?}"
    );
    assert!(
        report.metrics.visual_schematic_clarity_blocker_count > 0,
        "the quality report should count visual schematic clarity blockers separately: {report:#?}"
    );
    assert!(
        report
            .blockers
            .iter()
            .any(|blocker| blocker.contains("visual schematic clarity")),
        "quality gate must name the missing readable schematic layout: {report:#?}"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quality_report_blocks_90_point_claim_when_schematic_symbols_are_tightly_stacked() {
    let root = unique_test_root().with_extension("quality-report-tight-schematic-layout");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace =
        create_preview_workspace("ESP32-S3 USB-C H2 Sensor touch display board", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let schematic_file = project_dir.join("chatpcb3-esp32s3.kicad_sch");
    let schematic = fs::read_to_string(&schematic_file).unwrap().replace(
        r#"(symbol (lib_id "ChatPCB3:CAPACITOR_2PIN") (at 139.70 40.64 0)"#,
        r#"(symbol (lib_id "ChatPCB3:CAPACITOR_2PIN") (at 116.84 45.72 0)"#,
    );
    fs::write(&schematic_file, schematic).unwrap();

    let report = evaluate_workspace_quality(&project_dir).unwrap();
    assert!(
        report.metrics.schematic_layout_spacing_blocker_count > 0,
        "quality metrics should count tightly stacked schematic symbols: {report:#?}"
    );
    assert!(
        report
            .blockers
            .iter()
            .any(|blocker| blocker.contains("schematic layout spacing")),
        "quality gate must name schematic layout spacing blockers: {report:#?}"
    );

    let markdown = quality_report_markdown(&report);
    assert!(markdown.contains("schematic layout spacing blockers:"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quality_report_blocks_prompt_specific_circuit_reviews_without_electrical_calculations() {
    let root = unique_test_root().with_extension("quality-report-thin-prompt-circuit-review");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace(
        "ESP32-S3와 터치 디스플레이를 가지고 H2 Sensor를 포함하며 USB-C로 전원을 인가받는 회로",
        &root,
    )
    .unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);

    fs::write(
        project_dir.join("erc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();
    fs::write(
        project_dir.join("drc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();

    let circuit_review_file = project_dir.join("circuit-review-findings.md");
    let scrubbed = fs::read_to_string(&circuit_review_file)
        .unwrap()
        .lines()
        .filter(|line| {
            !line.contains("H2 ADC range") && !line.contains("Touch display power/logic")
        })
        .collect::<Vec<_>>()
        .join("\r\n");
    fs::write(circuit_review_file, scrubbed).unwrap();

    let report = evaluate_workspace_quality(&project_dir).unwrap();
    assert_ne!(report.level, QualityLevel::ReleaseCandidate);
    assert!(
        report.total_score < report.target_score,
        "prompt-specific circuit review without electrical calculations must stay below target: {report:#?}"
    );
    assert!(
        report.metrics.prompt_specific_circuit_review_blocker_count >= 2,
        "H2 and touch prompts should require matching electrical review checks: {report:#?}"
    );
    assert!(
        report
            .blockers
            .iter()
            .any(|blocker| blocker.contains("prompt-specific electrical checks")),
        "quality gate must name the missing prompt-specific electrical review: {report:#?}"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quality_report_blocks_prompt_specific_schematic_without_embedded_electrical_notes() {
    let root = unique_test_root().with_extension("quality-report-thin-prompt-schematic-review");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace(
        "ESP32-S3와 터치 디스플레이를 가지고 H2 Sensor를 포함하며 USB-C로 전원을 인가받는 회로",
        &root,
    )
    .unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);

    fs::write(
        project_dir.join("erc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();
    fs::write(
        project_dir.join("drc-report.json"),
        r#"{"violations":[],"unconnected_items":[]}"#,
    )
    .unwrap();

    let schematic_file = project_dir.join("chatpcb3-esp32s3.kicad_sch");
    let scrubbed = fs::read_to_string(&schematic_file)
        .unwrap()
        .lines()
        .filter(|line| {
            !line.contains("H2 ADC range") && !line.contains("Touch display power/logic")
        })
        .collect::<Vec<_>>()
        .join("\r\n");
    fs::write(schematic_file, scrubbed).unwrap();

    let report = evaluate_workspace_quality(&project_dir).unwrap();
    assert_ne!(report.level, QualityLevel::ReleaseCandidate);
    assert!(
        report.total_score < report.target_score,
        "schematic without embedded prompt-specific calculations must stay below target: {report:#?}"
    );
    assert!(
        report
            .metrics
            .prompt_specific_schematic_review_blocker_count
            >= 2,
        "H2 and touch prompts should require embedded schematic review notes: {report:#?}"
    );
    assert!(
        report.blockers.iter().any(|blocker| {
            blocker.contains("schematic")
                && blocker.contains("prompt-specific")
                && blocker.contains("electrical")
        }),
        "quality gate must name the missing embedded schematic review: {report:#?}"
    );
    assert!(
        report.improvement_actions.iter().any(|action| {
            action.contains("chatpcb3-esp32s3.kicad_sch")
                && action.contains("prompt-specific electrical calculations")
        }),
        "quality gate must tell the user to embed the calculations in the schematic: {report:#?}"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn prompt_variant_h2_touch_pcb_has_no_local_kicad_drc_findings_when_available() {
    let Some(kicad_cli) = local_kicad_cli() else {
        eprintln!("Skipping KiCad CLI DRC check because kicad-cli.exe was not found.");
        return;
    };

    let root = unique_test_root().with_extension("kicad-drc-h2-touch");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace(
        "ESP32-S3와 터치 디스플레이를 가지고 H2 Sensor를 포함하며 USB-C로 전원을 인가받는 회로",
        &root,
    )
    .unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let pcb = project_dir.join("chatpcb3-esp32s3.kicad_pcb");
    let drc_report = project_dir.join("drc-report.json");
    let pcb_text = fs::read_to_string(&pcb).unwrap();
    assert!(pcb_text.contains("(property \"Reference\" \"U5\""));
    assert!(pcb_text.contains("(property \"Reference\" \"DS1\""));

    let drc_status = Command::new(&kicad_cli)
        .args(["pcb", "drc", "--format", "json", "--output"])
        .arg(&drc_report)
        .arg(&pcb)
        .status()
        .unwrap();
    assert!(drc_status.success());

    let report = fs::read_to_string(&drc_report).unwrap();
    let parsed = parse_kicad_report(&report).unwrap();
    assert_eq!(parsed.error_count, 0, "DRC errors must be fixed: {report}");
    assert_eq!(
        parsed.warning_count, 0,
        "DRC warnings must be fixed: {report}"
    );
    assert_eq!(
        parsed.unconnected_count, 0,
        "DRC unconnected items must not appear in the prompt variant PCB: {report}"
    );

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
    assert!(pcb.contains("(gr_text \"50mm x 50mm review candidate - not unattended order-ready\""));
    assert!(!pcb.contains("(gr_text \"ChatPCB3 ESP32-S3 USB-C Sensor Board\""));

    let report = fs::read_to_string(&workspace.release_report_file).unwrap();
    assert!(report.contains("50mm x 50mm PCB outline"));

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
fn generated_schematic_has_no_local_kicad_erc_findings_when_available() {
    let Some(kicad_cli) = local_kicad_cli() else {
        eprintln!("Skipping KiCad CLI ERC check because kicad-cli.exe was not found.");
        return;
    };

    let root = unique_test_root().with_extension("kicad-erc");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace("ESP32-S3 USB-C I2C sensor board", &root).unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let schematic = project_dir.join("chatpcb3-esp32s3.kicad_sch");
    let erc_report = project_dir.join("erc-report.json");

    let erc_status = Command::new(&kicad_cli)
        .args(["sch", "erc", "--format", "json", "--output"])
        .arg(&erc_report)
        .arg(&schematic)
        .status()
        .unwrap();

    let report = fs::read_to_string(&erc_report).unwrap_or_default();
    assert!(erc_status.success(), "KiCad ERC command failed: {report}");

    let parsed = parse_kicad_report(&report).unwrap();
    assert_eq!(parsed.error_count, 0, "ERC errors must be fixed: {report}");
    assert_eq!(
        parsed.warning_count, 0,
        "ERC warnings must not be hidden in the first-run schematic: {report}"
    );
    assert_eq!(
        parsed.unconnected_count, 0,
        "ERC unconnected items must not appear in the first-run schematic: {report}"
    );
    assert!(
        parsed
            .violations
            .iter()
            .all(|violation| violation.severity != Severity::Warning),
        "ERC warnings should not appear in the first-run schematic: {report}"
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

#[test]
fn prompt_variant_h2_touch_schematic_has_no_local_kicad_erc_findings_when_available() {
    let Some(kicad_cli) = local_kicad_cli() else {
        eprintln!("Skipping KiCad CLI ERC check because kicad-cli.exe was not found.");
        return;
    };

    let root = unique_test_root().with_extension("kicad-erc-h2-touch");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let workspace = create_preview_workspace(
        "ESP32-S3와 터치 디스플레이를 가지고 H2 Sensor를 포함하며 USB-C로 전원을 인가받는 회로",
        &root,
    )
    .unwrap();
    let project_dir = PathBuf::from(&workspace.project_dir);
    let schematic = project_dir.join("chatpcb3-esp32s3.kicad_sch");
    let erc_report = project_dir.join("erc-report.json");

    let erc_status = Command::new(&kicad_cli)
        .args(["sch", "erc", "--format", "json", "--output"])
        .arg(&erc_report)
        .arg(&schematic)
        .status()
        .unwrap();

    let report = fs::read_to_string(&erc_report).unwrap_or_default();
    assert!(
        erc_status.success(),
        "KiCad ERC command failed for prompt variant: {report}"
    );

    let parsed = parse_kicad_report(&report).unwrap();
    assert_eq!(parsed.error_count, 0, "ERC errors must be fixed: {report}");
    assert_eq!(
        parsed.warning_count, 0,
        "ERC warnings must be fixed: {report}"
    );
    assert_eq!(
        parsed.unconnected_count, 0,
        "ERC unconnected items must not appear in the prompt variant schematic: {report}"
    );

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
