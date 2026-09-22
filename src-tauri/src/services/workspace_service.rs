use crate::domain::{case::SimulationCase, project::ProjectManifest};
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
use tempfile::TempDir;

#[derive(Debug)]
pub struct OpenWorkspace {
    pub archive_path: PathBuf,
    pub directory: TempDir,
    pub manifest: ProjectManifest,
    pub cases: Vec<SimulationCase>,
}

impl OpenWorkspace {
    pub fn root(&self) -> &Path {
        self.directory.path()
    }
}

#[derive(Debug, Default)]
pub struct WorkspaceService {
    current: Option<OpenWorkspace>,
}

impl WorkspaceService {
    pub fn create_empty(&self, archive_path: PathBuf) -> AppResult<OpenWorkspace> {
        let directory = tempfile::Builder::new()
            .prefix("tesrig-")
            .tempdir()
            .map_err(AppError::io)?;
        Ok(OpenWorkspace {
            archive_path,
            directory,
            manifest: ProjectManifest::new(String::new(), String::new()),
            cases: Vec::new(),
        })
    }

    pub fn activate(&mut self, workspace: OpenWorkspace) {
        self.current = Some(workspace);
    }

    pub fn current(&self) -> AppResult<&OpenWorkspace> {
        self.current.as_ref().ok_or(AppError::NoProjectOpen)
    }

    pub fn current_mut(&mut self) -> AppResult<&mut OpenWorkspace> {
        self.current.as_mut().ok_or(AppError::NoProjectOpen)
    }

    pub fn close(&mut self) {
        self.current = None;
    }
}
