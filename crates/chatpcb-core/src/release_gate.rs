use crate::manufacturing::{validate_jlcpcb_package, ManufacturingPackage};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReleaseGateStatus {
    Blocked,
    PrototypeReview,
    OrderReadyEvidence,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PipelineState {
    pub erc_errors: u32,
    pub drc_errors: u32,
    pub unrouted_nets: u32,
    pub manufacturing_package: Option<ManufacturingPackage>,
    pub visual_review_passed: bool,
    pub user_signoff_required: bool,
    pub blockers: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseGate {
    pub status: ReleaseGateStatus,
    pub reasons: Vec<String>,
    pub required_user_signoff: bool,
}

pub fn evaluate_release_gate(state: &PipelineState) -> ReleaseGate {
    let mut blocked_reasons = state.blockers.clone();

    if state.erc_errors > 0 {
        blocked_reasons.push(format!("ERC has {} error(s).", state.erc_errors));
    }

    if state.drc_errors > 0 {
        blocked_reasons.push(format!("DRC has {} error(s).", state.drc_errors));
    }

    if state.unrouted_nets > 0 {
        blocked_reasons.push(format!("{} unrouted net(s) remain.", state.unrouted_nets));
    }

    if !state.visual_review_passed {
        blocked_reasons.push("visual review evidence is missing or failed.".to_string());
    }

    match &state.manufacturing_package {
        Some(package) => {
            if let Err(error) = validate_jlcpcb_package(package) {
                blocked_reasons.push(error.to_string());
            }
        }
        None => blocked_reasons.push("manufacturing package is missing.".to_string()),
    }

    if !blocked_reasons.is_empty() {
        return ReleaseGate {
            status: ReleaseGateStatus::Blocked,
            reasons: blocked_reasons,
            required_user_signoff: true,
        };
    }

    if !state.warnings.is_empty() {
        return ReleaseGate {
            status: ReleaseGateStatus::PrototypeReview,
            reasons: state.warnings.clone(),
            required_user_signoff: true,
        };
    }

    ReleaseGate {
        status: ReleaseGateStatus::OrderReadyEvidence,
        reasons: vec![
            "ERC clear with zero errors.".to_string(),
            "DRC clear with zero errors and no unrouted nets.".to_string(),
            "Gerber, drill, BOM, and CPL manufacturing package is present.".to_string(),
            "Visual review evidence is present; final JLCPCB upload preview signoff is still required.".to_string(),
        ],
        required_user_signoff: state.user_signoff_required,
    }
}
