use chatpcb_core::{
    design::{esp32s3_usb_sensor_board_spec, BoardSpec},
    manufacturing::{build_jlcpcb_package, validate_jlcpcb_package, ManufacturingPackage},
    patch::{apply_patch_proposal, PatchProposal, PatchRisk},
    provider::{catalog_with_probe, LoginMode, ProviderKind},
    release_gate::{evaluate_release_gate, ReleaseGateStatus},
    validation::{parse_kicad_report, Severity},
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
