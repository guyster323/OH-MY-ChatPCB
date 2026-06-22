use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PowerRail {
    pub name: String,
    pub voltage_mv: u32,
    pub current_ma: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BoardSpec {
    pub product_name: String,
    pub source_prompt: String,
    pub mcu: String,
    pub power_input: String,
    pub rails: Vec<PowerRail>,
    pub interfaces: Vec<String>,
    pub layers: u8,
    pub max_board_size_mm: (u16, u16),
    pub manufacturing_constraints: Vec<String>,
}

pub fn esp32s3_usb_sensor_board_spec(prompt: &str) -> BoardSpec {
    BoardSpec {
        product_name: "ChatPCB3 ESP32-S3 USB-C Sensor Board".to_string(),
        source_prompt: prompt.trim().to_string(),
        mcu: "ESP32-S3".to_string(),
        power_input: "USB-C 5V".to_string(),
        rails: vec![
            PowerRail {
                name: "VBUS_5V".to_string(),
                voltage_mv: 5000,
                current_ma: 1000,
            },
            PowerRail {
                name: "3V3".to_string(),
                voltage_mv: 3300,
                current_ma: 500,
            },
        ],
        interfaces: vec![
            "USB device".to_string(),
            "I2C sensor".to_string(),
            "UART debug".to_string(),
            "GPIO header".to_string(),
            "JTAG debug".to_string(),
        ],
        layers: 2,
        max_board_size_mm: (50, 50),
        manufacturing_constraints: vec![
            "JLCPCB economic assembly compatible BOM and CPL are required.".to_string(),
            "Use LCSC/JLCPCB part numbers for all populated SMT parts.".to_string(),
            "Generate Gerber, drill, BOM, CPL, ERC, DRC, and visual-review evidence before order-ready status.".to_string(),
        ],
    }
}
