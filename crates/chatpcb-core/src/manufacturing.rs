use crate::design::BoardSpec;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PartSelection {
    pub designator: String,
    pub value: String,
    pub footprint: String,
    pub package: String,
    pub manufacturer_part_number: String,
    pub lcsc_part_number: String,
    pub placement_layer: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManufacturingPackage {
    pub board_name: String,
    pub files: Vec<String>,
    pub bom_columns: Vec<String>,
    pub cpl_columns: Vec<String>,
    pub parts: Vec<PartSelection>,
    pub release_report: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ManufacturingError {
    #[error("missing required BOM column: {0}")]
    MissingBomColumn(String),
    #[error("missing required CPL column: {0}")]
    MissingCplColumn(String),
    #[error("missing manufacturing file ending with: {0}")]
    MissingFile(String),
    #[error("part {0} is missing an LCSC/JLCPCB part number")]
    MissingLcscPart(String),
}

pub fn build_jlcpcb_package(spec: &BoardSpec) -> ManufacturingPackage {
    let slug = "chatpcb3-esp32s3";

    ManufacturingPackage {
        board_name: spec.product_name.clone(),
        files: vec![
            format!("production/{slug}/gerbers/{slug}.zip"),
            format!("production/{slug}/drill/{slug}.drl"),
            format!("production/{slug}/bom.csv"),
            format!("production/{slug}/positions.csv"),
            format!("production/{slug}/erc.json"),
            format!("production/{slug}/drc.json"),
            format!("production/{slug}/visual-review.pdf"),
            format!("production/{slug}/release-evidence.md"),
        ],
        bom_columns: vec![
            "Designator".to_string(),
            "Footprint".to_string(),
            "Quantity".to_string(),
            "Value".to_string(),
            "LCSC Part #".to_string(),
        ],
        cpl_columns: vec![
            "Designator".to_string(),
            "Mid X".to_string(),
            "Mid Y".to_string(),
            "Rotation".to_string(),
            "Layer".to_string(),
        ],
        parts: baseline_parts(),
        release_report: "Order-ready evidence requires human signoff after JLCPCB upload preview."
            .to_string(),
    }
}

pub fn validate_jlcpcb_package(package: &ManufacturingPackage) -> Result<(), ManufacturingError> {
    for column in [
        "Designator",
        "Footprint",
        "Quantity",
        "Value",
        "LCSC Part #",
    ] {
        if !package
            .bom_columns
            .iter()
            .any(|candidate| candidate == column)
        {
            return Err(ManufacturingError::MissingBomColumn(column.to_string()));
        }
    }

    for column in ["Designator", "Mid X", "Mid Y", "Rotation", "Layer"] {
        if !package
            .cpl_columns
            .iter()
            .any(|candidate| candidate == column)
        {
            return Err(ManufacturingError::MissingCplColumn(column.to_string()));
        }
    }

    for suffix in [
        "gerbers/chatpcb3-esp32s3.zip",
        "drill/chatpcb3-esp32s3.drl",
        "bom.csv",
        "positions.csv",
    ] {
        if !package.files.iter().any(|file| file.ends_with(suffix)) {
            return Err(ManufacturingError::MissingFile(suffix.to_string()));
        }
    }

    for part in &package.parts {
        if !part.lcsc_part_number.starts_with('C') {
            return Err(ManufacturingError::MissingLcscPart(part.designator.clone()));
        }
    }

    Ok(())
}

fn baseline_parts() -> Vec<PartSelection> {
    vec![
        PartSelection {
            designator: "U1".to_string(),
            value: "ESP32-S3-WROOM-1-N8R8".to_string(),
            footprint: "RF_Module:ESP32-S3-WROOM-1".to_string(),
            package: "Module".to_string(),
            manufacturer_part_number: "ESP32-S3-WROOM-1-N8R8".to_string(),
            lcsc_part_number: "C2913204".to_string(),
            placement_layer: "Top".to_string(),
        },
        PartSelection {
            designator: "J1".to_string(),
            value: "USB-C receptacle".to_string(),
            footprint: "Connector_USB:USB_C_Receptacle_USB2.0_16P".to_string(),
            package: "SMD".to_string(),
            manufacturer_part_number: "TYPE-C-31-M-12".to_string(),
            lcsc_part_number: "C165948".to_string(),
            placement_layer: "Top".to_string(),
        },
        PartSelection {
            designator: "U2".to_string(),
            value: "3.3V 500mA regulator".to_string(),
            footprint: "Package_TO_SOT_SMD:SOT-23-5".to_string(),
            package: "SOT-23-5".to_string(),
            manufacturer_part_number: "ME6211C33M5G-N".to_string(),
            lcsc_part_number: "C82942".to_string(),
            placement_layer: "Top".to_string(),
        },
        PartSelection {
            designator: "R1,R2".to_string(),
            value: "5.1k".to_string(),
            footprint: "Resistor_SMD:R_0603_1608Metric".to_string(),
            package: "0603".to_string(),
            manufacturer_part_number: "0603WAF5101T5E".to_string(),
            lcsc_part_number: "C23186".to_string(),
            placement_layer: "Top".to_string(),
        },
        PartSelection {
            designator: "C1,C2,C3,C4".to_string(),
            value: "100nF".to_string(),
            footprint: "Capacitor_SMD:C_0603_1608Metric".to_string(),
            package: "0603".to_string(),
            manufacturer_part_number: "CL10B104KB8NNNC".to_string(),
            lcsc_part_number: "C1591".to_string(),
            placement_layer: "Top".to_string(),
        },
    ]
}
