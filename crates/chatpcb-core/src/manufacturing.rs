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
    let mut parts = baseline_parts();
    if spec
        .interfaces
        .iter()
        .any(|interface| interface == "H2 gas sensor")
    {
        parts.push(PartSelection {
            designator: "U5".to_string(),
            value: "H2 module interface 1x4 2.54mm header".to_string(),
            footprint: "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical".to_string(),
            package: "Through Hole 1x4 2.54mm header".to_string(),
            manufacturer_part_number: "ZHOURI PZ2.54-1x4-11.2".to_string(),
            lcsc_part_number: "C29779969".to_string(),
            placement_layer: "Top".to_string(),
        });
        parts.push(PartSelection {
            designator: "R7,R8".to_string(),
            value: "10k H2 ADC divider".to_string(),
            footprint: "Resistor_SMD:R_0603_1608Metric".to_string(),
            package: "0603".to_string(),
            manufacturer_part_number: "0603WAF1002T5E".to_string(),
            lcsc_part_number: "C25804".to_string(),
            placement_layer: "Top".to_string(),
        });
        parts.push(PartSelection {
            designator: "C6".to_string(),
            value: "100nF 6.3V X7R 0603 +/-10% H2 ADC filter capacitor".to_string(),
            footprint: "Capacitor_SMD:C_0603_1608Metric".to_string(),
            package: "0603".to_string(),
            manufacturer_part_number: "CL10B104KB8NNNC".to_string(),
            lcsc_part_number: "C1591".to_string(),
            placement_layer: "Top".to_string(),
        });
    }
    if spec
        .interfaces
        .iter()
        .any(|interface| interface == "Touch display")
    {
        parts.push(PartSelection {
            designator: "DS1".to_string(),
            value: "Touch display interface 1x12 2.54mm header".to_string(),
            footprint: "Connector_PinHeader_2.54mm:PinHeader_1x12_P2.54mm_Vertical".to_string(),
            package: "Through Hole 1x12 2.54mm header".to_string(),
            manufacturer_part_number: "hanxia HX PZ2.54-1x12P ZZ".to_string(),
            lcsc_part_number: "C42372504".to_string(),
            placement_layer: "Top".to_string(),
        });
    }

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
        parts,
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
            designator: "U3".to_string(),
            value: "BME280 I2C sensor".to_string(),
            footprint: "Package_LGA:Bosch_LGA-8_2.5x2.5mm_P0.65mm".to_string(),
            package: "LGA-8".to_string(),
            manufacturer_part_number: "BME280".to_string(),
            lcsc_part_number: "C92489".to_string(),
            placement_layer: "Top".to_string(),
        },
        PartSelection {
            designator: "U4".to_string(),
            value: "USB ESD protection".to_string(),
            footprint: "Package_TO_SOT_SMD:SOT-23-6".to_string(),
            package: "SOT-23-6".to_string(),
            manufacturer_part_number: "USBLC6-2SC6".to_string(),
            lcsc_part_number: "C282765".to_string(),
            placement_layer: "Top".to_string(),
        },
        PartSelection {
            designator: "F1".to_string(),
            value: "VBUS fuse 500mA".to_string(),
            footprint: "Fuse:Fuse_1206_3216Metric".to_string(),
            package: "1206".to_string(),
            manufacturer_part_number: "1206L050YR".to_string(),
            lcsc_part_number: "C70076".to_string(),
            placement_layer: "Top".to_string(),
        },
        PartSelection {
            designator: "R1,R2".to_string(),
            value: "5.1k USB-C CC pulldown".to_string(),
            footprint: "Resistor_SMD:R_0603_1608Metric".to_string(),
            package: "0603".to_string(),
            manufacturer_part_number: "0603WAF5101T5E".to_string(),
            lcsc_part_number: "C23186".to_string(),
            placement_layer: "Top".to_string(),
        },
        PartSelection {
            designator: "R3,R4".to_string(),
            value: "4.7k I2C pull-up".to_string(),
            footprint: "Resistor_SMD:R_0603_1608Metric".to_string(),
            package: "0603".to_string(),
            manufacturer_part_number: "0603WAF4701T5E".to_string(),
            lcsc_part_number: "C23162".to_string(),
            placement_layer: "Top".to_string(),
        },
        PartSelection {
            designator: "R9,R10".to_string(),
            value: "USB data 22R series resistor".to_string(),
            footprint: "Resistor_SMD:R_0603_1608Metric".to_string(),
            package: "0603".to_string(),
            manufacturer_part_number: "0603WAF220JT5E".to_string(),
            lcsc_part_number: "C23345".to_string(),
            placement_layer: "Top".to_string(),
        },
        PartSelection {
            designator: "R5".to_string(),
            value: "10k ESP_EN pull-up".to_string(),
            footprint: "Resistor_SMD:R_0603_1608Metric".to_string(),
            package: "0603".to_string(),
            manufacturer_part_number: "0603WAF1002T5E".to_string(),
            lcsc_part_number: "C25804".to_string(),
            placement_layer: "Top".to_string(),
        },
        PartSelection {
            designator: "R6".to_string(),
            value: "10k BOOT strap".to_string(),
            footprint: "Resistor_SMD:R_0603_1608Metric".to_string(),
            package: "0603".to_string(),
            manufacturer_part_number: "0603WAF1002T5E".to_string(),
            lcsc_part_number: "C25804".to_string(),
            placement_layer: "Top".to_string(),
        },
        PartSelection {
            designator: "C1,C2".to_string(),
            value: "10uF 10V X5R 0603 +/-10% rail capacitor".to_string(),
            footprint: "Capacitor_SMD:C_0603_1608Metric".to_string(),
            package: "0603".to_string(),
            manufacturer_part_number: "CL10A106KP8NNNC".to_string(),
            lcsc_part_number: "C19702".to_string(),
            placement_layer: "Top".to_string(),
        },
        PartSelection {
            designator: "C3".to_string(),
            value: "1uF 6.3V X5R 0603 +/-10% ESP32 bulk capacitor".to_string(),
            footprint: "Capacitor_SMD:C_0603_1608Metric".to_string(),
            package: "0603".to_string(),
            manufacturer_part_number: "CL10A105KO8NNNC".to_string(),
            lcsc_part_number: "C15849".to_string(),
            placement_layer: "Top".to_string(),
        },
        PartSelection {
            designator: "C4,C5".to_string(),
            value: "100nF 6.3V X7R 0603 +/-10% local decoupling capacitor".to_string(),
            footprint: "Capacitor_SMD:C_0603_1608Metric".to_string(),
            package: "0603".to_string(),
            manufacturer_part_number: "CL10B104KB8NNNC".to_string(),
            lcsc_part_number: "C1591".to_string(),
            placement_layer: "Top".to_string(),
        },
    ]
}
