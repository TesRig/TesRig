use super::case::SimulationCase;
use super::geometry::GeometryAsset;
use super::material::{default_material_library, Material};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const PROJECT_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum UpAxis {
    #[default]
    Y,
    Z,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings {
    pub up_axis: UpAxis,
}

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    #[serde(default = "default_material_library")]
    pub materials: Vec<Material>,
    #[serde(default)]
    pub settings: ProjectSettings,
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
            materials: default_material_library(),
            settings: ProjectSettings::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
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
    pub materials: Vec<Material>,
    pub settings: ProjectSettings,
}
