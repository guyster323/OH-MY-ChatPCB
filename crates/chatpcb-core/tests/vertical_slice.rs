use chatpcb_core::{
    design::{esp32s3_usb_sensor_board_spec, BoardSpec},
    manufacturing::{build_jlcpcb_package, validate_jlcpcb_package, ManufacturingPackage},
    patch::{apply_patch_proposal, PatchProposal, PatchRisk},
    provider::{catalog_with_probe, LoginMode, ProviderKind},
    release_gate::{evaluate_release_gate, ReleaseGateStatus},
    validation::{parse_kicad_report, summarize_kicad_cli_check, KicadCliCheckStatus, Severity},
};

fn order_ready_state(package: ManufacturingPackage) -> chatpcb_core::release_gate::PipelineState {
    chatpcb_core::release_gate::PipelineState {
        erc_errors: 0,
        drc_errors: 0,
        unrouted_nets: 0,
        manufacturing_package: Some(package),
        visual_review_passed: true,
        user_signoff_required: true,
        blockers: Vec::new(),
        warnings: Vec::new(),
    }
}

#[test]
fn provider_catalog_reports_local_cli_statuses_without_secrets() {
    let providers = catalog_with_probe(|command| match command {
        "codex" => Some("codex 0.41.0".to_string()),
        "claude" => Some("Claude Code 1.2.3".to_string()),
        "gemini" => None,
        _ => None,
    });

    assert_eq!(providers.len(), 3);
    assert_eq!(providers[0].kind, ProviderKind::Codex);
    assert_eq!(providers[0].login_mode, LoginMode::LocalCli);
    assert!(providers[0].available);
    assert_eq!(providers[1].kind, ProviderKind::Claude);
    assert!(providers[1].available);
    assert_eq!(providers[2].kind, ProviderKind::Gemini);
    assert!(!providers[2].available);
    assert!(providers[0].login_hint.contains("Install Codex CLI"));
    assert!(providers[1].login_hint.contains("Install Claude Code"));
    assert!(providers[2].login_hint.contains("Install Gemini CLI"));
    assert!(providers[2].login_hint.contains("complete local login"));

    let serialized = serde_json::to_string(&providers).unwrap();
    assert!(!serialized.to_ascii_lowercase().contains("api_key"));
    assert!(!serialized.to_ascii_lowercase().contains("token"));
    assert!(!serialized.to_ascii_lowercase().contains("secret"));
}

#[test]
fn esp32s3_board_spec_is_fixed_order_ready_target() {
    let spec: BoardSpec = esp32s3_usb_sensor_board_spec(
        "USB-C ESP32-S3 sensor board with I2C sensor, UART debug, GPIO header, and automatic routing",
    );

    assert_eq!(spec.product_name, "ChatPCB3 ESP32-S3 USB-C Sensor Board");
    assert_eq!(spec.mcu, "ESP32-S3");
    assert_eq!(spec.power_input, "USB-C 5V");
    assert_eq!(spec.layers, 2);
    assert_eq!(spec.max_board_size_mm, (50, 50));
    assert!(spec
        .rails
        .iter()
        .any(|rail| rail.name == "3V3" && rail.current_ma == 500));
    assert!(spec
        .interfaces
        .iter()
        .any(|interface| interface == "I2C sensor"));
    assert!(spec
        .interfaces
        .iter()
        .any(|interface| interface == "UART debug"));
    assert!(spec
        .interfaces
        .iter()
        .any(|interface| interface == "USB device"));
    assert!(spec
        .manufacturing_constraints
        .iter()
        .any(|rule| rule.contains("JLCPCB")));
}

#[test]
fn jlcpcb_package_validates_required_bom_cpl_fields() {
    let spec = esp32s3_usb_sensor_board_spec("ESP32-S3 USB-C sensor board");
    let package = build_jlcpcb_package(&spec);

    assert_eq!(
        package.bom_columns,
        vec![
            "Designator",
            "Footprint",
            "Quantity",
            "Value",
            "LCSC Part #"
        ]
    );
    assert_eq!(
        package.cpl_columns,
        vec!["Designator", "Mid X", "Mid Y", "Rotation", "Layer"]
    );
    assert!(package
        .files
        .iter()
        .any(|file| file.ends_with("gerbers/chatpcb3-esp32s3.zip")));
    assert!(package.files.iter().any(|file| file.ends_with("bom.csv")));
    assert!(package
        .files
        .iter()
        .any(|file| file.ends_with("positions.csv")));
    assert!(package
        .parts
        .iter()
        .all(|part| part.lcsc_part_number.starts_with('C')));

    validate_jlcpcb_package(&package).unwrap();
}

#[test]
fn release_gate_requires_complete_order_ready_evidence() {
    let spec = esp32s3_usb_sensor_board_spec("ESP32-S3 USB-C sensor board");
    let package = build_jlcpcb_package(&spec);
    let gate = evaluate_release_gate(&order_ready_state(package));

    assert_eq!(gate.status, ReleaseGateStatus::OrderReadyEvidence);
    assert!(gate.required_user_signoff);
    assert!(gate.reasons.iter().any(|reason| reason.contains("ERC")));
    assert!(gate.reasons.iter().any(|reason| reason.contains("DRC")));
    assert!(gate.reasons.iter().any(|reason| reason.contains("Gerber")));

    let blocked = evaluate_release_gate(&chatpcb_core::release_gate::PipelineState {
        manufacturing_package: None,
        ..order_ready_state(build_jlcpcb_package(&spec))
    });

    assert_eq!(blocked.status, ReleaseGateStatus::Blocked);
    assert!(blocked
        .reasons
        .iter()
        .any(|reason| reason.contains("manufacturing package")));
}

#[test]
fn patch_proposals_cannot_apply_without_approval() {
    let proposal = PatchProposal {
        proposal_id: "patch-001".to_string(),
        target_files: vec!["board.kicad_pcb".to_string()],
        semantic_diff: "Move USB-C connector to board edge and reroute VBUS.".to_string(),
        affected_nets: vec!["VBUS_5V".to_string(), "GND".to_string()],
        risk: PatchRisk::Medium,
        approved: false,
        rollback_hint: "Restore previous board.kicad_pcb from patch snapshot.".to_string(),
    };

    let error = apply_patch_proposal(&proposal).unwrap_err();
    assert!(error.to_string().contains("approval required"));

    let approved = PatchProposal {
        approved: true,
        ..proposal
    };
    let applied = apply_patch_proposal(&approved).unwrap();
    assert_eq!(applied.applied_files, vec!["board.kicad_pcb"]);
    assert!(applied.validation_required);
}

#[test]
fn validation_parses_kicad_json_reports() {
    let report = parse_kicad_report(
        r#"{
            "violations": [
                {"severity": "error", "message": "Track too close", "items": ["Net-(U1-Pad1)"]},
                {"severity": "warning", "message": "Silkscreen overlap", "items": ["R1"]}
            ]
        }"#,
    )
    .unwrap();

    assert_eq!(report.error_count, 1);
    assert_eq!(report.warning_count, 1);
    assert_eq!(report.violations[0].severity, Severity::Error);
    assert!(report.violations[0].message.contains("Track too close"));
}

#[test]
fn validation_flattens_kicad_10_erc_sheet_reports() {
    let report = parse_kicad_report(
        r#"{
            "$schema": "https://schemas.kicad.org/erc.v1.json",
            "sheets": [
                {
                    "path": "/",
                    "violations": [
                        {
                            "severity": "error",
                            "description": "Pin is not connected",
                            "items": [
                                {"description": "U1 pin EN"},
                                {"description": "Net ESP_EN"}
                            ]
                        }
                    ]
                }
            ]
        }"#,
    )
    .unwrap();

    assert_eq!(report.error_count, 1);
    assert_eq!(report.warning_count, 0);
    assert_eq!(report.violations[0].severity, Severity::Error);
    assert_eq!(report.violations[0].message, "Pin is not connected");
    assert_eq!(report.violations[0].items, vec!["U1 pin EN", "Net ESP_EN"]);
}

#[test]
fn validation_parses_kicad_10_drc_description_and_unconnected_items() {
    let report = parse_kicad_report(
        r#"{
            "$schema": "https://schemas.kicad.org/drc.v1.json",
            "unconnected_items": [
                {"description": "Net 3V3 between U1 and C1"}
            ],
            "violations": [
                {
                    "severity": "warning",
                    "description": "Silkscreen clipped by board edge",
                    "items": [
                        {"description": "PCB text"},
                        "Edge.Cuts segment"
                    ]
                }
            ]
        }"#,
    )
    .unwrap();

    assert_eq!(report.error_count, 0);
    assert_eq!(report.warning_count, 1);
    assert_eq!(report.unconnected_count, 1);
    assert_eq!(
        report.violations[0].message,
        "Silkscreen clipped by board edge"
    );
    assert_eq!(
        report.violations[0].items,
        vec!["PCB text", "Edge.Cuts segment"]
    );
}

#[test]
fn validation_summarizes_erc_drc_counts_without_order_ready_claims() {
    let erc = parse_kicad_report(
        r#"{
            "sheets": [{"path": "/", "violations": []}]
        }"#,
    )
    .unwrap();
    let drc = parse_kicad_report(
        r#"{
            "unconnected_items": [],
            "violations": [
                {"severity": "warning", "description": "Silkscreen clipped by board edge"}
            ]
        }"#,
    )
    .unwrap();

    let summary = chatpcb_core::validation::summarize_erc_drc_reports(&erc, &drc);

    assert!(summary.contains("ERC: 오류 0개, 경고 0개"));
    assert!(summary.contains("DRC: 오류 0개, 경고 1개"));
    assert!(summary.contains("미연결 0개"));
    assert!(summary.contains("prototype-review"));
    assert!(summary.contains("검토 목록"));
    assert!(summary.contains("주문 준비 상태가 아닙니다"));
    assert!(!summary.contains("schematic/layout"));
    assert!(!summary.contains("Gerber/BOM/CPL"));
    assert!(!summary.contains("gate"));
    assert!(!summary.contains("Gate remains"));
    assert!(!summary.contains("0 errors"));
    assert!(!summary.contains("1 warning"));
    assert!(!summary.contains("unconnected"));
    assert!(!summary.to_ascii_lowercase().contains("order-ready"));
}

#[test]
fn validation_summarizes_kicad_cli_acceptance_without_order_ready_claims() {
    let report = summarize_kicad_cli_check(
        Some(0),
        "최신 형식으로 기판 파일을 성공적으로 저장했습니다",
        "",
    );

    assert_eq!(report.status, KicadCliCheckStatus::Accepted);
    assert!(report
        .summary
        .contains("KiCad 확인: preview PCB를 열 수 있습니다"));
    assert!(report.summary.contains("prototype-review"));
    assert!(report.summary.contains("검토 목록"));
    assert!(report.summary.contains("주문 전 검토"));
    assert!(!report.summary.contains("schematic/DRC"));
    assert!(!report.summary.contains("Gerber/BOM/CPL"));
    assert!(!report.summary.contains("gate"));
    assert!(!report.summary.contains("KiCad accepted the preview PCB"));
    assert!(!report.summary.contains("Gate remains"));
    assert!(report.stdout.contains("성공적으로 저장"));
    assert!(!report.summary.to_ascii_lowercase().contains("order-ready"));
}

#[test]
fn validation_summarizes_missing_kicad_cli_as_a_local_tool_gap() {
    let report = summarize_kicad_cli_check(None, "", "kicad-cli.exe was not found");

    assert_eq!(report.status, KicadCliCheckStatus::ToolMissing);
    assert!(report.summary.contains("KiCad 10 실행 파일"));
    assert!(report.summary.contains("설치"));
    assert!(report.summary.contains("prototype-review"));
    assert!(!report.summary.contains("gate"));
    assert!(!report.summary.contains("KiCad CLI was not found"));
    assert!(!report.summary.contains("Gate remains"));
    assert!(!report.summary.to_ascii_lowercase().contains("order-ready"));
}
