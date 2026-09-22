use crate::domain::project::ProjectSummary;
use crate::error::{AppError, AppResult};
use crate::AppState;
use serde::Deserialize;
use std::path::Path;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    name: String,
    description: String,
    destination: String,
}

#[derive(Debug, Deserialize)]
pub struct OpenProjectRequest {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIdRequest {
    project_id: Uuid,
}

#[tauri::command]
pub fn create_project(
    request: CreateProjectRequest,
    state: State<'_, AppState>,
) -> AppResult<ProjectSummary> {
    let mut service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.create_project(
        &request.name,
        &request.description,
        Path::new(&request.destination),
    )
}

#[tauri::command]
pub fn open_project(
    request: OpenProjectRequest,
    state: State<'_, AppState>,
) -> AppResult<ProjectSummary> {
    let mut service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.open_project(Path::new(&request.path))
}

#[tauri::command]
pub fn save_project(
    request: ProjectIdRequest,
    state: State<'_, AppState>,
) -> AppResult<ProjectSummary> {
    let mut service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.save_project(request.project_id)
}

#[tauri::command]
pub fn close_project(state: State<'_, AppState>) -> AppResult<()> {
    let mut service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.close_project();
    Ok(())
}
