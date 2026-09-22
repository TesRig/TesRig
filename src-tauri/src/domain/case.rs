use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SimulationType {
    #[serde(rename = "CFD")]
    Cfd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Solver {
    OpenFOAM,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CaseStatus {
    Draft,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationCase {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub simulation_type: SimulationType,
    pub solver: Solver,
    pub status: CaseStatus,
    #[serde(default)]
    pub geometry_id: Option<Uuid>,
    #[serde(default)]
    pub variant_of_case_id: Option<Uuid>,
}

impl SimulationCase {
    pub fn new(
        name: String,
        description: String,
        simulation_type: SimulationType,
        solver: Solver,
        geometry_id: Option<Uuid>,
        variant_of_case_id: Option<Uuid>,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            name,
            description,
            created_at: now,
            updated_at: now,
            simulation_type,
            solver,
            status: CaseStatus::Draft,
            geometry_id,
            variant_of_case_id,
        }
    }
}
