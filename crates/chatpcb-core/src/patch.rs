use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PatchRisk {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PatchProposal {
    pub proposal_id: String,
    pub target_files: Vec<String>,
    pub semantic_diff: String,
    pub affected_nets: Vec<String>,
    pub risk: PatchRisk,
    pub approved: bool,
    pub rollback_hint: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppliedPatch {
    pub proposal_id: String,
    pub applied_files: Vec<String>,
    pub validation_required: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PatchError {
    #[error("approval required before applying patch proposal {0}")]
    ApprovalRequired(String),
}

pub fn apply_patch_proposal(proposal: &PatchProposal) -> Result<AppliedPatch, PatchError> {
    if !proposal.approved {
        return Err(PatchError::ApprovalRequired(proposal.proposal_id.clone()));
    }

    Ok(AppliedPatch {
        proposal_id: proposal.proposal_id.clone(),
        applied_files: proposal.target_files.clone(),
        validation_required: true,
    })
}
