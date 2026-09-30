use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GeometryFormat {
    #[serde(rename = "STL")]
    Stl,
    #[serde(rename = "OBJ")]
    Obj,
    #[serde(rename = "STEP")]
    Step,
}

impl GeometryFormat {
    pub fn from_extension(extension: &str) -> Option<Self> {
        match extension.to_ascii_lowercase().as_str() {
            "stl" => Some(Self::Stl),
            "obj" => Some(Self::Obj),
            "step" | "stp" => Some(Self::Step),
            _ => None,
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Stl => "stl",
            Self::Obj => "obj",
            Self::Step => "step",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryAsset {
    pub id: Uuid,
    pub name: String,
    pub file_name: String,
    pub format: GeometryFormat,
    pub size_bytes: u64,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub material_id: Option<Uuid>,
}

impl GeometryAsset {
    pub fn new(name: String, file_name: String, format: GeometryFormat, size_bytes: u64) -> Self {
        Self {
            id: Uuid::new_v4(),
            name,
            file_name,
            format,
            size_bytes,
            created_at: Utc::now(),
            material_id: None,
        }
    }

    pub fn stored_file_name(&self) -> String {
        format!("{}.{}", self.id, self.format.extension())
    }

    pub fn triangulated_file_name(&self) -> String {
        format!("{}.triangulated.stl", self.id)
    }
}

#[cfg(test)]
mod tests {
    use super::GeometryFormat;

    #[test]
    fn recognizes_both_step_extensions() {
        assert_eq!(
            GeometryFormat::from_extension("step"),
            Some(GeometryFormat::Step)
        );
        assert_eq!(
            GeometryFormat::from_extension("STP"),
            Some(GeometryFormat::Step)
        );
        assert_eq!(GeometryFormat::Step.extension(), "step");
    }
}
