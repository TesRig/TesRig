use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GeometryFormat {
    STL,
    OBJ,
    STEP,
}

impl GeometryFormat {
    pub fn from_extension(extension: &str) -> Option<Self> {
        match extension.to_ascii_lowercase().as_str() {
            "stl" => Some(Self::STL),
            "obj" => Some(Self::OBJ),
            "step" | "stp" => Some(Self::STEP),
            _ => None,
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::STL => "stl",
            Self::OBJ => "obj",
            Self::STEP => "step",
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
        }
    }

    pub fn stored_file_name(&self) -> String {
        format!("{}.{}", self.id, self.format.extension())
    }
}

#[cfg(test)]
mod tests {
    use super::GeometryFormat;

    #[test]
    fn recognizes_both_step_extensions() {
        assert_eq!(
            GeometryFormat::from_extension("step"),
            Some(GeometryFormat::STEP)
        );
        assert_eq!(
            GeometryFormat::from_extension("STP"),
            Some(GeometryFormat::STEP)
        );
        assert_eq!(GeometryFormat::STEP.extension(), "step");
    }
}
