use serde::ser::{Serialize, SerializeStruct, Serializer};
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Project name is required and must be valid for a file name.")]
    InvalidProjectName,
    #[error("Case name is required.")]
    InvalidCaseName,
    #[error("Select an STL, OBJ, STEP, or STP geometry file.")]
    UnsupportedGeometryFormat,
    #[error("Geometry was not found: {0}")]
    GeometryNotFound(String),
    #[error("The selected file is not a valid TesRig project.")]
    InvalidProjectFormat,
    #[error("Project file was not found: {0}")]
    ProjectNotFound(String),
    #[error("A project already exists at: {0}")]
    ProjectAlreadyExists(String),
    #[error("Project format version {0} is not supported by this version of TesRig.")]
    UnsupportedProjectVersion(u32),
    #[error("The project archive could not be read: {0}")]
    ArchiveReadFailed(String),
    #[error("The project archive could not be written: {0}")]
    ArchiveWriteFailed(String),
    #[error("Case was not found: {0}")]
    CaseNotFound(String),
    #[error("The CFD case setup is invalid: {0}")]
    InvalidCaseSetup(String),
    #[error("The Python processing script is invalid: {0}")]
    InvalidProcessingScript(String),
    #[error("Generate the OpenFOAM case files before exporting them.")]
    CaseFilesNotGenerated,
    #[error("An OpenFOAM case already exists at: {0}")]
    ExportAlreadyExists(String),
    #[error("The managed OpenFOAM runtime is unavailable: {0}")]
    SolverRuntimeUnavailable(String),
    #[error("A simulation is already running.")]
    SimulationAlreadyRunning,
    #[error("No simulation task is available.")]
    SimulationNotFound,
    #[error("The project cannot be closed while a simulation is running.")]
    SimulationRunning,
    #[error("No project is currently open.")]
    NoProjectOpen,
    #[error("The requested project is not the open project.")]
    ProjectMismatch,
    #[error("A filesystem operation failed: {0}")]
    IoError(String),
    #[error("An internal application error occurred: {0}")]
    InternalError(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidProjectName => "INVALID_PROJECT_NAME",
            Self::InvalidCaseName => "INVALID_CASE_NAME",
            Self::UnsupportedGeometryFormat => "UNSUPPORTED_GEOMETRY_FORMAT",
            Self::GeometryNotFound(_) => "GEOMETRY_NOT_FOUND",
            Self::InvalidProjectFormat => "INVALID_PROJECT_FORMAT",
            Self::ProjectNotFound(_) => "PROJECT_NOT_FOUND",
            Self::ProjectAlreadyExists(_) => "PROJECT_ALREADY_EXISTS",
            Self::UnsupportedProjectVersion(_) => "UNSUPPORTED_PROJECT_VERSION",
            Self::ArchiveReadFailed(_) => "ARCHIVE_READ_FAILED",
            Self::ArchiveWriteFailed(_) => "ARCHIVE_WRITE_FAILED",
            Self::CaseNotFound(_) => "CASE_NOT_FOUND",
            Self::InvalidCaseSetup(_) => "INVALID_CASE_SETUP",
            Self::InvalidProcessingScript(_) => "INVALID_PROCESSING_SCRIPT",
            Self::CaseFilesNotGenerated => "CASE_FILES_NOT_GENERATED",
            Self::ExportAlreadyExists(_) => "EXPORT_ALREADY_EXISTS",
            Self::SolverRuntimeUnavailable(_) => "SOLVER_RUNTIME_UNAVAILABLE",
            Self::SimulationAlreadyRunning => "SIMULATION_ALREADY_RUNNING",
            Self::SimulationNotFound => "SIMULATION_NOT_FOUND",
            Self::SimulationRunning => "SIMULATION_RUNNING",
            Self::NoProjectOpen => "NO_PROJECT_OPEN",
            Self::ProjectMismatch => "PROJECT_MISMATCH",
            Self::IoError(_) => "IO_ERROR",
            Self::InternalError(_) => "INTERNAL_ERROR",
        }
    }

    pub fn io(error: std::io::Error) -> Self {
        Self::IoError(error.to_string())
    }

    pub fn missing(path: &Path) -> Self {
        Self::ProjectNotFound(path.display().to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
