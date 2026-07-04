use crate::validation::parse_kicad_report;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum QualityLevel {
    Scaffold,
    PrototypeReview,
    ReleaseCandidate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QualityMetrics {
    pub schematic_symbol_count: usize,
    pub schematic_net_label_count: usize,
    pub schematic_gnd_label_count: usize,
    pub pcb_footprint_count: usize,
    pub pcb_pad_count: usize,
    pub pcb_track_count: usize,
    pub cpl_unplaced_count: usize,
    pub manufacturing_files_present: bool,
    pub visual_review_files_present: bool,
    pub visual_schematic_clarity_blocker_count: usize,
    pub schematic_layout_spacing_blocker_count: usize,
    pub chat_trace_present: bool,
    pub chat_trace_covered_count: usize,
    pub part_selection_review_present: bool,
    pub part_selection_reviewed_count: usize,
    pub part_selection_risk_rationale_count: usize,
    pub external_module_assembly_blocker_count: usize,
    pub circuit_review_present: bool,
    pub circuit_review_pass_count: usize,
    pub circuit_review_risk_rationale_count: usize,
    pub required_design_items_present: usize,
    pub required_design_item_count: usize,
    pub prompt_specific_selection_blocker_count: usize,
    pub prompt_specific_circuit_review_blocker_count: usize,
    pub prompt_specific_schematic_review_blocker_count: usize,
    pub erc_error_count: usize,
    pub erc_warning_count: usize,
    pub erc_unconnected_count: usize,
    pub erc_report_present: bool,
    pub drc_error_count: usize,
    pub drc_warning_count: usize,
    pub drc_unconnected_count: usize,
    pub drc_report_present: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScoreSection {
    pub name: String,
    pub score: u8,
    pub max_score: u8,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesignQualityReport {
    pub total_score: u8,
    pub target_score: u8,
    pub level: QualityLevel,
    pub order_ready: bool,
    pub order_gate: String,
    pub metrics: QualityMetrics,
    pub sections: Vec<ScoreSection>,
    pub blockers: Vec<String>,
    pub warnings: Vec<String>,
    pub improvement_actions: Vec<String>,
    pub missing_required_design_items: Vec<String>,
}

pub fn evaluate_workspace_quality(
    project_dir: impl AsRef<Path>,
) -> io::Result<DesignQualityReport> {
    let project_dir = project_dir.as_ref();
    let schematic = read_optional(project_dir.join("chatpcb3-esp32s3.kicad_sch"))?;
    let pcb = read_optional(project_dir.join("chatpcb3-esp32s3.kicad_pcb"))?;
    let cpl = read_optional(project_dir.join("jlcpcb-cpl-preview.csv"))?;
    let bom = read_optional(project_dir.join("jlcpcb-bom-preview.csv"))?;
    let prompt = read_optional(project_dir.join("prompt.txt"))?;
    let chat_trace = read_optional(project_dir.join("chat-to-circuit-trace.md"))?;
    let part_selection_review = read_optional(project_dir.join("part-selection-review.md"))?;
    let circuit_review = read_optional(project_dir.join("circuit-review-findings.md"))?;
    let visual_schematic = read_optional(
        project_dir
            .join("visual-review")
            .join("schematic-review.svg"),
    )?;
    let review_corpus = format!("{schematic}\n{bom}\n{visual_schematic}");
    let selection_corpus = format!("{bom}\n{part_selection_review}");
    let required_design_items = required_design_items_for_prompt(&prompt);
    let missing_required_design_items =
        missing_required_design_items(&review_corpus, &required_design_items);
    let prompt_specific_selection_blockers =
        prompt_specific_selection_blockers(&prompt, &selection_corpus);
    let external_module_assembly_blockers = external_module_assembly_blockers(&selection_corpus);
    let prompt_specific_circuit_review_blockers =
        prompt_specific_circuit_review_blockers(&prompt, &circuit_review);
    let prompt_specific_schematic_review_blockers =
        prompt_specific_schematic_review_blockers(&prompt, &schematic);
    let visual_schematic_clarity_blockers =
        visual_schematic_clarity_blockers(&prompt, &visual_schematic);
    let schematic_layout_spacing_blockers = schematic_layout_spacing_blockers(&schematic);
    let required_design_item_count = required_design_items.len();
    let required_design_items_present =
        required_design_item_count.saturating_sub(missing_required_design_items.len());
    let erc = read_kicad_report_counts(project_dir.join("erc-report.json"))?;
    let drc = read_kicad_report_counts(project_dir.join("drc-report.json"))?;

    let metrics = QualityMetrics {
        schematic_symbol_count: schematic.matches("(lib_id").count(),
        schematic_net_label_count: schematic.matches("(global_label").count()
            + schematic.matches("(label").count(),
        schematic_gnd_label_count: schematic.matches("(label \"GND\"").count()
            + schematic.matches("(global_label \"GND\"").count(),
        pcb_footprint_count: pcb.matches("(footprint").count(),
        pcb_pad_count: pcb.matches("(pad").count(),
        pcb_track_count: pcb.matches("(segment").count(),
        cpl_unplaced_count: cpl.matches("UNPLACED").count(),
        manufacturing_files_present: manufacturing_files_present(project_dir),
        visual_review_files_present: project_dir
            .join("visual-review")
            .join("schematic-review.svg")
            .exists()
            && project_dir
                .join("visual-review")
                .join("pcb-review.svg")
                .exists(),
        visual_schematic_clarity_blocker_count: visual_schematic_clarity_blockers.len(),
        schematic_layout_spacing_blocker_count: schematic_layout_spacing_blockers.len(),
        chat_trace_present: project_dir.join("chat-to-circuit-trace.md").exists(),
        chat_trace_covered_count: chat_trace_covered_count(&chat_trace),
        part_selection_review_present: project_dir.join("part-selection-review.md").exists(),
        part_selection_reviewed_count: part_selection_reviewed_count(&part_selection_review),
        part_selection_risk_rationale_count: part_selection_risk_rationale_count(
            &part_selection_review,
        ),
        external_module_assembly_blocker_count: external_module_assembly_blockers.len(),
        circuit_review_present: project_dir.join("circuit-review-findings.md").exists(),
        circuit_review_pass_count: circuit_review_pass_count(&circuit_review),
        circuit_review_risk_rationale_count: circuit_review_risk_rationale_count(&circuit_review),
        required_design_items_present,
        required_design_item_count,
        prompt_specific_selection_blocker_count: prompt_specific_selection_blockers.len(),
        prompt_specific_circuit_review_blocker_count: prompt_specific_circuit_review_blockers.len(),
        prompt_specific_schematic_review_blocker_count: prompt_specific_schematic_review_blockers
            .len(),
        erc_error_count: erc.error_count,
        erc_warning_count: erc.warning_count,
        erc_unconnected_count: erc.unconnected_count,
        erc_report_present: erc.present,
        drc_error_count: drc.error_count,
        drc_warning_count: drc.warning_count,
        drc_unconnected_count: drc.unconnected_count,
        drc_report_present: drc.present,
    };

    let mut blockers = Vec::new();
    if metrics.schematic_symbol_count < 5 {
        blockers.push("schematic has fewer than 5 placed symbols".to_string());
    }
    if metrics.schematic_net_label_count < 8 {
        blockers.push("schematic has fewer than 8 net labels".to_string());
    }
    if metrics.schematic_gnd_label_count < 5 {
        blockers.push(format!(
            "schematic shows only {} GND label(s); common ground connectivity is visually unclear",
            metrics.schematic_gnd_label_count
        ));
    }
    if metrics.pcb_footprint_count < 5 {
        blockers.push("PCB has fewer than 5 footprints".to_string());
    }
    if metrics.pcb_pad_count < 20 {
        blockers.push("PCB has fewer than 20 pads".to_string());
    }
    if metrics.pcb_track_count < 8 {
        blockers.push("PCB has fewer than 8 routed track segments".to_string());
    }
    if metrics.cpl_unplaced_count > 0 {
        blockers.push("CPL still contains UNPLACED coordinates".to_string());
    }
    if !metrics.manufacturing_files_present {
        blockers.push("manufacturing review files are missing".to_string());
    }
    if !metrics.visual_review_files_present {
        blockers.push("visual review files are missing".to_string());
    }
    if !visual_schematic_clarity_blockers.is_empty() {
        blockers.push(format!(
            "visual schematic clarity blockers: {}",
            visual_schematic_clarity_blockers.join(", ")
        ));
    }
    if !schematic_layout_spacing_blockers.is_empty() {
        blockers.push(format!(
            "schematic layout spacing blockers: {}",
            schematic_layout_spacing_blockers.join(", ")
        ));
    }
    if !metrics.chat_trace_present {
        blockers.push("chat-to-circuit trace is missing".to_string());
    }
    if metrics.chat_trace_present && metrics.chat_trace_covered_count < 5 {
        blockers.push(format!(
            "chat-to-circuit trace covers only {} requested item(s)",
            metrics.chat_trace_covered_count
        ));
    }
    if !metrics.part_selection_review_present {
        blockers.push("part selection review is missing".to_string());
    }
    if metrics.part_selection_review_present && metrics.part_selection_reviewed_count < 8 {
        blockers.push(format!(
            "part selection review covers only {} component group(s)",
            metrics.part_selection_reviewed_count
        ));
    }
    if metrics.part_selection_review_present && metrics.part_selection_risk_rationale_count < 8 {
        blockers.push(format!(
            "part selection review includes risk rationale for only {} component group(s)",
            metrics.part_selection_risk_rationale_count
        ));
    }
    if !metrics.circuit_review_present {
        blockers.push("circuit review findings are missing".to_string());
    }
    if metrics.circuit_review_present && metrics.circuit_review_pass_count < 6 {
        blockers.push(format!(
            "circuit review has only {} PASS finding(s)",
            metrics.circuit_review_pass_count
        ));
    }
    if metrics.circuit_review_present && metrics.circuit_review_risk_rationale_count < 6 {
        blockers.push(format!(
            "circuit review includes risk rationale for only {} finding(s)",
            metrics.circuit_review_risk_rationale_count
        ));
    }
    if !metrics.erc_report_present {
        blockers.push("KiCad ERC report is missing".to_string());
    }
    if !metrics.drc_report_present {
        blockers.push("KiCad DRC report is missing".to_string());
    }
    if !missing_required_design_items.is_empty() {
        blockers.push(format!(
            "schematic review is missing required design items: {}",
            missing_required_design_items.join(", ")
        ));
    }
    blockers.extend(prompt_specific_selection_blockers);
    if !external_module_assembly_blockers.is_empty() {
        blockers.push(format!(
            "external module selections are being presented as JLCPCB assembly parts: {}",
            external_module_assembly_blockers.join(", ")
        ));
    }
    if !prompt_specific_circuit_review_blockers.is_empty() {
        blockers.push(format!(
            "circuit review is missing prompt-specific electrical checks: {}",
            prompt_specific_circuit_review_blockers.join(", ")
        ));
    }
    if !prompt_specific_schematic_review_blockers.is_empty() {
        blockers.push(format!(
            "schematic is missing embedded prompt-specific electrical review notes: {}",
            prompt_specific_schematic_review_blockers.join(", ")
        ));
    }
    if metrics.erc_error_count > 0
        || metrics.erc_warning_count > 0
        || metrics.erc_unconnected_count > 0
    {
        blockers.push(format!(
            "ERC has {} error(s), {} warning(s), and {} open/unconnected item(s)",
            metrics.erc_error_count, metrics.erc_warning_count, metrics.erc_unconnected_count
        ));
    }
    if metrics.drc_error_count > 0
        || metrics.drc_warning_count > 0
        || metrics.drc_unconnected_count > 0
    {
        blockers.push(format!(
            "DRC has {} error(s), {} warning(s), and {} unconnected item(s)",
            metrics.drc_error_count, metrics.drc_warning_count, metrics.drc_unconnected_count
        ));
    }

    let mut sections = Vec::new();
    sections.push(score_section(
        "requirements",
        10,
        project_dir.join("artifact-manifest.json").exists()
            && project_dir.join("prompt.txt").exists()
            && metrics.chat_trace_present
            && metrics.chat_trace_covered_count >= 5,
        vec!["prompt, artifact manifest, and chat-to-circuit trace are saved".to_string()],
    ));
    sections.push(score_threshold_section(
        "schematic",
        25,
        metrics.schematic_symbol_count,
        5,
        metrics.schematic_net_label_count,
        8,
        "placed KiCad symbols and net labels",
    ));
    sections.push(score_threshold_section(
        "circuit-design",
        15,
        metrics.required_design_items_present
            + metrics.circuit_review_pass_count
            + metrics.circuit_review_risk_rationale_count,
        metrics.required_design_item_count + 12,
        if metrics.erc_report_present
            && metrics.erc_error_count == 0
            && metrics.erc_warning_count == 0
            && metrics.erc_unconnected_count == 0
        {
            1
        } else {
            0
        },
        1,
        "required ESP32-S3 USB-C circuit items, adequacy review, and clean ERC",
    ));
    sections.push(score_threshold_section(
        "pcb",
        20,
        metrics.pcb_footprint_count + metrics.pcb_track_count,
        13,
        metrics.pcb_pad_count,
        20,
        "footprints, pads, and routed tracks",
    ));
    sections.push(score_threshold_section(
        "part-selection",
        10,
        metrics.part_selection_reviewed_count,
        8,
        metrics.part_selection_risk_rationale_count,
        8,
        "reviewed MPN/LCSC component groups plus selection-basis and risk rationale",
    ));
    sections.push(score_section(
        "manufacturing",
        10,
        metrics.manufacturing_files_present && metrics.cpl_unplaced_count == 0,
        vec!["Gerber/drill/BOM/CPL review files are present".to_string()],
    ));
    sections.push(score_section(
        "visual-review",
        5,
        metrics.visual_review_files_present && metrics.visual_schematic_clarity_blocker_count == 0,
        vec!["schematic and PCB SVG review files are present and readable".to_string()],
    ));
    sections.push(score_section(
        "evidence",
        5,
        project_dir.join("release-evidence-preview.md").exists()
            && project_dir.join("FIRST-RUN-SUMMARY.txt").exists(),
        vec!["release evidence and first-run summary are saved".to_string()],
    ));

    let mut total_score: u8 = sections.iter().map(|section| section.score).sum();
    if !blockers.is_empty() {
        total_score = total_score.min(60);
    } else {
        total_score = total_score.min(90);
    }

    let level = if total_score >= 90 && blockers.is_empty() {
        QualityLevel::ReleaseCandidate
    } else if total_score >= 60 {
        QualityLevel::PrototypeReview
    } else {
        QualityLevel::Scaffold
    };

    let improvement_actions = improvement_actions(&metrics, &blockers);

    Ok(DesignQualityReport {
        total_score,
        target_score: 90,
        level,
        order_ready: false,
        order_gate: "BLOCKED_HUMAN_SIGNOFF_REQUIRED".to_string(),
        metrics,
        sections,
        blockers,
        warnings: vec![
            "ReleaseCandidate still requires human manufacturing signoff before ordering."
                .to_string(),
            "Nonzero KiCad ERC/DRC findings block the 90-point release-candidate claim."
                .to_string(),
        ],
        improvement_actions,
        missing_required_design_items,
    })
}

pub fn write_workspace_quality_reports(
    project_dir: impl AsRef<Path>,
) -> io::Result<(PathBuf, PathBuf, DesignQualityReport)> {
    let project_dir = project_dir.as_ref();
    let report = evaluate_workspace_quality(project_dir)?;
    let json_file = project_dir.join("design-quality-report.json");
    let markdown_file = project_dir.join("design-quality-report.md");
    let json = serde_json::to_string_pretty(&report)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;

    fs::write(&json_file, json)?;
    fs::write(&markdown_file, quality_report_markdown(&report))?;

    Ok((json_file, markdown_file, report))
}

pub fn quality_report_markdown(report: &DesignQualityReport) -> String {
    let mut body = format!(
        "# ChatPCB3 Design Quality Report\r\n\r\nTotal score: {}/100\r\nTarget score: {}\r\nLevel: {:?}\r\nOrder readiness: {}\r\n\r\n",
        report.total_score, report.target_score, report.level, report.order_gate
    );

    body.push_str("## Metrics\r\n\r\n");
    body.push_str(&format!(
        "- schematic symbols: {}\r\n- schematic net labels: {}\r\n- schematic GND labels: {}\r\n- required design items: {}/{}\r\n- chat-to-circuit trace present: {}\r\n- chat-to-circuit COVERED items: {}\r\n- circuit review present: {}\r\n- circuit review PASS findings: {}\r\n- circuit review risk-rationale findings: {}\r\n- prompt-specific circuit review blockers: {}\r\n- prompt-specific schematic review blockers: {}\r\n- part selection review present: {}\r\n- part selection reviewed groups: {}\r\n- part selection risk-rationale groups: {}\r\n- prompt-specific selection blockers: {}\r\n- external-module assembly blockers: {}\r\n- visual schematic clarity blockers: {}\r\n- schematic layout spacing blockers: {}\r\n- ERC report present: {}\r\n- ERC errors/warnings/open-unconnected: {}/{}/{}\r\n- DRC report present: {}\r\n- DRC errors/warnings/unconnected: {}/{}/{}\r\n- PCB footprints: {}\r\n- PCB pads: {}\r\n- PCB routed tracks: {}\r\n- CPL UNPLACED rows: {}\r\n- manufacturing files present: {}\r\n- visual review files present: {}\r\n\r\n",
        report.metrics.schematic_symbol_count,
        report.metrics.schematic_net_label_count,
        report.metrics.schematic_gnd_label_count,
        report.metrics.required_design_items_present,
        report.metrics.required_design_item_count,
        report.metrics.chat_trace_present,
        report.metrics.chat_trace_covered_count,
        report.metrics.circuit_review_present,
        report.metrics.circuit_review_pass_count,
        report.metrics.circuit_review_risk_rationale_count,
        report
            .metrics
            .prompt_specific_circuit_review_blocker_count,
        report
            .metrics
            .prompt_specific_schematic_review_blocker_count,
        report.metrics.part_selection_review_present,
        report.metrics.part_selection_reviewed_count,
        report.metrics.part_selection_risk_rationale_count,
        report.metrics.prompt_specific_selection_blocker_count,
        report.metrics.external_module_assembly_blocker_count,
        report.metrics.visual_schematic_clarity_blocker_count,
        report.metrics.schematic_layout_spacing_blocker_count,
        report.metrics.erc_report_present,
        report.metrics.erc_error_count,
        report.metrics.erc_warning_count,
        report.metrics.erc_unconnected_count,
        report.metrics.drc_report_present,
        report.metrics.drc_error_count,
        report.metrics.drc_warning_count,
        report.metrics.drc_unconnected_count,
        report.metrics.pcb_footprint_count,
        report.metrics.pcb_pad_count,
        report.metrics.pcb_track_count,
        report.metrics.cpl_unplaced_count,
        report.metrics.manufacturing_files_present,
        report.metrics.visual_review_files_present
    ));

    body.push_str("## Rubric\r\n\r\n");
    for section in &report.sections {
        body.push_str(&format!(
            "- {}: {}/{}\r\n",
            section.name, section.score, section.max_score
        ));
    }

    body.push_str("\r\n## Blockers\r\n\r\n");
    if report.blockers.is_empty() {
        body.push_str("- none\r\n");
    } else {
        for blocker in &report.blockers {
            body.push_str(&format!("- {}\r\n", blocker));
        }
    }

    body.push_str("\r\n## Warnings\r\n\r\n");
    for warning in &report.warnings {
        body.push_str(&format!("- {}\r\n", warning));
    }

    body.push_str("\r\n## Improvement Actions\r\n\r\n");
    for (idx, action) in report.improvement_actions.iter().enumerate() {
        body.push_str(&format!("{}. {}\r\n", idx + 1, action));
    }

    body
}

fn improvement_actions(metrics: &QualityMetrics, blockers: &[String]) -> Vec<String> {
    let mut actions = Vec::new();

    if !metrics.erc_report_present {
        actions.push(
            "Run KiCad ERC and save erc-report.json before claiming the 90-point gate.".to_string(),
        );
    } else if metrics.erc_error_count > 0
        || metrics.erc_warning_count > 0
        || metrics.erc_unconnected_count > 0
    {
        actions.push(
            "Resolve KiCad ERC findings and open/unconnected pins, regenerate erc-report.json, and rerun the quality report."
                .to_string(),
        );
    }

    if !metrics.drc_report_present {
        actions.push(
            "Run KiCad DRC and save drc-report.json before claiming the 90-point gate.".to_string(),
        );
    } else if metrics.drc_error_count > 0
        || metrics.drc_warning_count > 0
        || metrics.drc_unconnected_count > 0
    {
        actions.push("Resolve KiCad DRC findings and unconnected items, regenerate drc-report.json, and rerun the quality report.".to_string());
    }

    if !metrics.chat_trace_present || metrics.chat_trace_covered_count < 5 {
        actions.push("Expand chat-to-circuit-trace.md so each user-requested board feature maps to schematic, PCB, BOM, and review evidence.".to_string());
    }

    if !metrics.circuit_review_present || metrics.circuit_review_pass_count < 6 {
        actions.push("Complete circuit-review-findings.md for power, USB-C, boot straps, sensor interface, decoupling, and manufacturing boundary.".to_string());
    }

    if metrics.circuit_review_present && metrics.circuit_review_risk_rationale_count < 6 {
        actions.push("Add row-level circuit review risk rationale for power, USB-C, boot straps, sensor interface, decoupling, and manufacturing boundary.".to_string());
    }

    if metrics.prompt_specific_circuit_review_blocker_count > 0 {
        actions.push("Add prompt-specific electrical calculations to circuit-review-findings.md, including H2 ADC divider range and touch-display power/logic checks.".to_string());
    }

    if metrics.prompt_specific_schematic_review_blocker_count > 0 {
        actions.push("Embed prompt-specific electrical calculations in chatpcb3-esp32s3.kicad_sch, including H2 ADC divider range and touch-display power/logic notes.".to_string());
    }

    if !metrics.part_selection_review_present || metrics.part_selection_reviewed_count < 8 {
        actions.push("Complete part-selection-review.md with concrete MPN, LCSC/JLCPCB field, package, footprint, selection basis, and review risk for every major component group.".to_string());
    }

    if metrics.part_selection_review_present && metrics.part_selection_risk_rationale_count < 8 {
        actions.push("Add selection basis and risk rationale for every reviewed part-selection row so the score reflects real component judgment.".to_string());
    }

    if metrics.external_module_assembly_blocker_count > 0 {
        actions.push("Do not list external H2/display modules as JLCPCB-assembled BOM parts; either select verified assembled components/connectors or mark the modules as manual-install external items outside the 90-point assembly claim.".to_string());
    }

    if blockers
        .iter()
        .any(|blocker| blocker.contains("required design items"))
    {
        actions.push("Add missing prompt-required schematic evidence and visual review labels, then rerun quality scoring.".to_string());
    }

    if metrics.visual_schematic_clarity_blocker_count > 0 {
        actions.push("Redraw visual-review/schematic-review.svg so prompt-specific H2 ADC and touch-display paths are readable in separate labeled lanes before claiming the 90-point gate.".to_string());
    }

    if metrics.schematic_layout_spacing_blocker_count > 0 {
        actions.push("Re-space tightly stacked KiCad schematic symbols and net labels so the embedded 회로도 tab is readable before claiming the 90-point gate.".to_string());
    }

    if metrics.schematic_gnd_label_count < 5 {
        actions.push("Add or reposition GND labels/symbols around USB, regulator, ESP32, sensor, and optional modules so common-ground connectivity is clear at the schematic-tab zoom level.".to_string());
    }

    if blockers
        .iter()
        .any(|blocker| blocker.contains("selection is still"))
    {
        actions.push("Replace placeholder prompt-specific component selections with concrete reviewed MPN/LCSC candidates or mark them as explicit external-module blockers.".to_string());
    }

    actions.push("Keep the order gate blocked until human manufacturing signoff reviews KiCad, BOM/CPL orientation, live stock, substitutions, and JLCPCB upload preview.".to_string());
    actions
}

type RequiredDesignItem = (&'static str, &'static [&'static str]);

const REQUIRED_DESIGN_ITEMS: &[RequiredDesignItem] = &[
    ("J1 USB-C", &["J1 USB-C", "USB-C J1"]),
    ("CC1 5.1k", &["CC1 5.1k", "5.1k CC1"]),
    ("CC2 5.1k", &["CC2 5.1k", "5.1k CC2"]),
    ("VBUS fuse", &["VBUS fuse", "F1 VBUS"]),
    ("USB ESD", &["USB ESD", "ESD U4"]),
    (
        "U2 3V3 regulator",
        &["U2 3V3 regulator", "REG U2", "3V3 LDO"],
    ),
    (
        "LDO input capacitor",
        &["LDO input capacitor", "C1 LDO input"],
    ),
    (
        "LDO output capacitor",
        &["LDO output capacitor", "C2 LDO output"],
    ),
    ("ESP32-S3-WROOM-1", &["ESP32-S3-WROOM-1"]),
    ("ESP_EN pull-up", &["ESP_EN pull-up", "EN pull-up"]),
    ("BOOT strap", &["BOOT strap", "GPIO0 BOOT"]),
    ("I2C_SCL pull-up", &["I2C_SCL pull-up", "SCL pull-up"]),
    ("I2C_SDA pull-up", &["I2C_SDA pull-up", "SDA pull-up"]),
    ("BME280 I2C sensor", &["BME280 I2C sensor"]),
    ("sensor decoupling", &["sensor decoupling", "C4 sensor"]),
];

const H2_REQUIRED_DESIGN_ITEMS: &[RequiredDesignItem] = &[
    (
        "H2 sensor symbol U5",
        &["U5 H2 gas sensor", "MQ-8 analog H2 module", "U5,H2"],
    ),
    ("H2 sensor 5V heater/VCC", &["5V heater", "VBUS_5V"]),
    ("H2 analog ADC net", &["H2_ADC"]),
    (
        "H2 ADC divider/filter",
        &[
            "H2 ADC divider top",
            "H2 ADC divider bottom",
            "H2 ADC filter",
        ],
    ),
];

const TOUCH_DISPLAY_REQUIRED_DESIGN_ITEMS: &[RequiredDesignItem] = &[
    (
        "Touch display connector DS1",
        &[
            "DS1 Touch display",
            "Waveshare 2.8inch TFT Touch Shield",
            "DS1,Touch",
        ],
    ),
    ("Touch display SPI clock net", &["DISPLAY_SPI_SCK"]),
    ("Touch display SPI MOSI net", &["DISPLAY_SPI_MOSI"]),
    ("Touch controller chip select net", &["TOUCH_CS"]),
    ("Touch controller interrupt net", &["TOUCH_IRQ"]),
];

fn required_design_items_for_prompt(prompt: &str) -> Vec<RequiredDesignItem> {
    let mut items = REQUIRED_DESIGN_ITEMS.to_vec();
    if prompt_requests_h2_sensor(prompt) {
        items.extend(H2_REQUIRED_DESIGN_ITEMS);
    }
    if prompt_requests_touch_display(prompt) {
        items.extend(TOUCH_DISPLAY_REQUIRED_DESIGN_ITEMS);
    }

    items
}

fn prompt_requests_h2_sensor(prompt: &str) -> bool {
    let prompt_lower = prompt.to_ascii_lowercase();
    prompt_lower.contains("h2") || prompt.contains("수소")
}

fn prompt_requests_touch_display(prompt: &str) -> bool {
    let prompt_lower = prompt.to_ascii_lowercase();
    prompt_lower.contains("touch")
        || prompt_lower.contains("display")
        || prompt_lower.contains("oled")
        || prompt.contains("디스플레이")
}

fn prompt_specific_selection_blockers(prompt: &str, selection_corpus: &str) -> Vec<String> {
    let mut blockers = Vec::new();

    if prompt_requests_h2_sensor(prompt) && selection_corpus.contains("H2-SENSOR-MODULE-HEADER") {
        blockers
            .push("H2 sensor selection is still a generic module/header placeholder".to_string());
    }
    if prompt_requests_touch_display(prompt) && selection_corpus.contains("TOUCH-DISPLAY-HEADER") {
        blockers.push(
            "touch display selection is still a generic connector/header placeholder".to_string(),
        );
    }

    blockers
}

fn external_module_assembly_blockers(selection_corpus: &str) -> Vec<String> {
    let mut blockers = Vec::new();

    if selection_corpus.contains("MQ-8 analog H2 module")
        && selection_corpus.contains("1x04 external module header")
    {
        blockers.push("H2 sensor external module/header BOM row".to_string());
    }

    if selection_corpus.contains("Waveshare 2.8inch TFT Touch Shield")
        && selection_corpus.contains("1x12 external module header")
    {
        blockers.push("touch display external module/header BOM row".to_string());
    }

    blockers
}

fn prompt_specific_circuit_review_blockers(prompt: &str, circuit_review: &str) -> Vec<String> {
    let mut blockers = Vec::new();

    if prompt_requests_h2_sensor(prompt)
        && !all_keywords_present(
            circuit_review,
            &[
                "H2 ADC range",
                "5.0V AOUT / 2 = 2.5V",
                "2.5V < ESP32 3.3V ADC limit",
                "R7/R8 10k",
                "C6 100nF",
                "MQ-8 heater current",
            ],
        )
    {
        blockers.push("H2 ADC range calculation".to_string());
    }

    if prompt_requests_touch_display(prompt)
        && !all_keywords_present(
            circuit_review,
            &[
                "Touch display power/logic",
                "3V3 SPI logic",
                "DISPLAY_SPI_SCK",
                "backlight current",
            ],
        )
    {
        blockers.push("touch display power/logic calculation".to_string());
    }

    blockers
}

fn prompt_specific_schematic_review_blockers(prompt: &str, schematic: &str) -> Vec<String> {
    let mut blockers = Vec::new();

    if prompt_requests_h2_sensor(prompt)
        && !all_keywords_present(
            schematic,
            &[
                "H2 ADC range",
                "5.0V AOUT / 2 = 2.5V",
                "2.5V < ESP32 3.3V ADC limit",
                "R7/R8 10k",
                "C6 100nF",
            ],
        )
    {
        blockers.push("H2 ADC embedded schematic note".to_string());
    }

    if prompt_requests_touch_display(prompt)
        && !all_keywords_present(
            schematic,
            &[
                "Touch display power/logic",
                "3V3 SPI logic",
                "DISPLAY_SPI_SCK",
                "backlight current",
            ],
        )
    {
        blockers.push("touch display embedded schematic note".to_string());
    }

    blockers
}

fn visual_schematic_clarity_blockers(prompt: &str, visual_schematic: &str) -> Vec<String> {
    let mut blockers = Vec::new();

    if prompt_requests_h2_sensor(prompt)
        && !all_keywords_present(
            visual_schematic,
            &[
                r#"data-chatpcb-visual-clarity="schematic-review-v2""#,
                "visual-schematic-clarity-pass",
                "H2 ADC front-end",
                "U5 AOUT -> R7/R8 -> C6 -> GPIO1",
            ],
        )
    {
        blockers.push("H2 ADC front-end is not shown as a readable separated lane".to_string());
    }

    if prompt_requests_touch_display(prompt)
        && !all_keywords_present(
            visual_schematic,
            &[
                r#"data-chatpcb-visual-clarity="schematic-review-v2""#,
                "Touch SPI/touch connector separated from H2 ADC lane",
                "DS1 touch display connector",
                "DISPLAY_SPI_SCK/MOSI/MISO",
                "TOUCH_CS / TOUCH_IRQ",
            ],
        )
    {
        blockers.push(
            "touch display SPI/touch connector is not shown as a readable separated lane"
                .to_string(),
        );
    }

    blockers
}

struct PlacedSchematicSymbol {
    reference: String,
    lib_id: String,
    x: f32,
    y: f32,
}

fn schematic_layout_spacing_blockers(schematic: &str) -> Vec<String> {
    let mut symbols = placed_schematic_symbols(schematic)
        .into_iter()
        .filter(|symbol| {
            symbol.lib_id.ends_with("PASSIVE_2PIN") || symbol.lib_id.ends_with("CAPACITOR_2PIN")
        })
        .collect::<Vec<_>>();
    symbols.sort_by(|left, right| {
        left.x
            .partial_cmp(&right.x)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(
                left.y
                    .partial_cmp(&right.y)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
    });

    let mut blockers = Vec::new();
    for pair in symbols.windows(2) {
        let same_column = (pair[0].x - pair[1].x).abs() < 1.0;
        let vertical_gap = (pair[0].y - pair[1].y).abs();
        if same_column && vertical_gap < 8.0 {
            blockers.push(format!(
                "{} and {} stacked only {:.2}mm apart",
                pair[0].reference, pair[1].reference, vertical_gap
            ));
        }
    }
    blockers
}

fn placed_schematic_symbols(schematic: &str) -> Vec<PlacedSchematicSymbol> {
    let mut symbols = Vec::new();
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
        symbols.push(PlacedSchematicSymbol {
            reference: reference_tail[..reference_end].to_string(),
            lib_id,
            x,
            y,
        });
    }
    symbols
}

fn all_keywords_present(corpus: &str, keywords: &[&str]) -> bool {
    keywords.iter().all(|keyword| corpus.contains(keyword))
}

fn missing_required_design_items(
    corpus: &str,
    required_items: &[RequiredDesignItem],
) -> Vec<String> {
    required_items
        .iter()
        .filter(|(_, aliases)| !aliases.iter().any(|alias| corpus.contains(alias)))
        .map(|(item, _)| (*item).to_string())
        .collect()
}

fn part_selection_reviewed_count(report: &str) -> usize {
    report
        .lines()
        .filter(|line| line.starts_with("| "))
        .filter(|line| {
            !line.contains("Designator")
                && !line.contains(" --- ")
                && !line.contains("| --- |")
                && line.contains("C")
        })
        .count()
}

fn part_selection_risk_rationale_count(report: &str) -> usize {
    report
        .lines()
        .filter(|line| line.starts_with("| "))
        .filter(|line| {
            !line.contains("Designator")
                && !line.contains(" --- ")
                && !line.contains("| --- |")
                && line.contains(" | ")
                && risk_rationale_present(line)
                && selection_basis_present(line)
        })
        .count()
}

fn chat_trace_covered_count(report: &str) -> usize {
    report
        .lines()
        .filter(|line| line.starts_with("| "))
        .filter(|line| !line.contains("Trace result") && line.contains("| COVERED |"))
        .count()
}

fn circuit_review_pass_count(report: &str) -> usize {
    report
        .lines()
        .filter(|line| line.starts_with("| "))
        .filter(|line| !line.contains("Result") && line.contains("| PASS |"))
        .count()
}

fn circuit_review_risk_rationale_count(report: &str) -> usize {
    report
        .lines()
        .filter(|line| line.starts_with("| "))
        .filter(|line| {
            !line.contains("Result") && line.contains("| PASS |") && risk_rationale_present(line)
        })
        .count()
}

fn risk_rationale_present(line: &str) -> bool {
    let lowercase = line.to_ascii_lowercase();
    lowercase.contains("risk")
        || lowercase.contains("confirm")
        || lowercase.contains("verify")
        || lowercase.contains("human")
        || line.contains("검토")
        || line.contains("위험")
}

fn selection_basis_present(line: &str) -> bool {
    let lowercase = line.to_ascii_lowercase();
    lowercase.contains("candidate")
        || lowercase.contains("required")
        || lowercase.contains("target")
        || lowercase.contains("protection")
        || lowercase.contains("decoupling")
        || lowercase.contains("rail")
        || lowercase.contains("pull-up")
        || lowercase.contains("strap")
        || lowercase.contains("prompt-requested")
        || line.contains("근거")
}

#[derive(Debug, Clone, Copy, Default)]
struct KicadReportCounts {
    present: bool,
    error_count: usize,
    warning_count: usize,
    unconnected_count: usize,
}

fn read_kicad_report_counts(path: PathBuf) -> io::Result<KicadReportCounts> {
    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(KicadReportCounts::default());
        }
        Err(error) => return Err(error),
    };

    let report = parse_kicad_report(&contents)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    Ok(KicadReportCounts {
        present: true,
        error_count: report.error_count,
        warning_count: report.warning_count,
        unconnected_count: report.unconnected_count,
    })
}

fn score_section(name: &str, max_score: u8, passed: bool, evidence: Vec<String>) -> ScoreSection {
    ScoreSection {
        name: name.to_string(),
        score: if passed { max_score } else { 0 },
        max_score,
        evidence,
    }
}

fn score_threshold_section(
    name: &str,
    max_score: u8,
    first_value: usize,
    first_threshold: usize,
    second_value: usize,
    second_threshold: usize,
    evidence_label: &str,
) -> ScoreSection {
    let first = (max_score / 2) as usize;
    let second = (max_score - max_score / 2) as usize;
    let score = if first_value >= first_threshold {
        first
    } else {
        first * first_value / first_threshold
    } + if second_value >= second_threshold {
        second
    } else {
        second * second_value / second_threshold
    };

    ScoreSection {
        name: name.to_string(),
        score: score as u8,
        max_score,
        evidence: vec![format!(
            "{}: primary {} / {}, secondary {} / {}",
            evidence_label, first_value, first_threshold, second_value, second_threshold
        )],
    }
}

fn manufacturing_files_present(project_dir: &Path) -> bool {
    let production = project_dir.join("production").join("chatpcb3-esp32s3");
    production
        .join("gerbers")
        .join("chatpcb3-esp32s3-F_Cu.gbr")
        .exists()
        && production
            .join("drill")
            .join("chatpcb3-esp32s3.drl")
            .exists()
        && production.join("bom.csv").exists()
        && production.join("positions.csv").exists()
}

fn read_optional(path: PathBuf) -> io::Result<String> {
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(contents),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(error),
    }
}
