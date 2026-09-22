use super::case::SimulationCase;
use super::geometry::GeometryAsset;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const PROJECT_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseReference {
    pub id: Uuid,
    pub name: String,
}

impl From<&SimulationCase> for CaseReference {
    fn from(value: &SimulationCase) -> Self {
        Self {
            id: value.id,
            name: value.name.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifest {
    pub format_version: u32,
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub cases: Vec<CaseReference>,
    #[serde(default)]
    pub geometries: Vec<GeometryAsset>,
}

impl ProjectManifest {
    pub fn new(name: String, description: String) -> Self {
        let now = Utc::now();
        Self {
            format_version: PROJECT_FORMAT_VERSION,
            id: Uuid::new_v4(),
            name,
            description,
            created_at: now,
            updated_at: now,
            cases: Vec::new(),
            geometries: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub format_version: u32,
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub archive_path: String,
    pub cases: Vec<SimulationCase>,
    pub geometries: Vec<GeometryAsset>,
}
