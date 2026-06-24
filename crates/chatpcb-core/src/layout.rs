use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AutorouteContract {
    pub engine: String,
    pub bundled_version: String,
    pub input_dsn: String,
    pub output_ses: String,
    pub drc_required_after_import: bool,
    pub notes: Vec<String>,
}

pub fn freerouting_contract() -> AutorouteContract {
    AutorouteContract {
        engine: "freerouting".to_string(),
        bundled_version: "v2.2.4".to_string(),
        input_dsn: "chatpcb3-esp32s3.dsn".to_string(),
        output_ses: "chatpcb3-esp32s3.ses".to_string(),
        drc_required_after_import: true,
        notes: vec![
            "Export KiCad PCB placement to Specctra DSN before routing.".to_string(),
            "Import SES back into KiCad, run DRC, and review the result in 검토 목록.".to_string(),
        ],
    }
}
