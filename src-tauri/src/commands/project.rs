use crate::domain::project::{ProjectSettings, ProjectSummary};
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectSettingsRequest {
    project_id: Uuid,
    settings: ProjectSettings,
}

#[tauri::command]
pub fn get_current_project(state: State<'_, AppState>) -> AppResult<Option<ProjectSummary>> {
    let service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    Ok(service.current_project())
}

#[tauri::command]
pub fn create_project(
    request: CreateProjectRequest,
    state: State<'_, AppState>,
) -> AppResult<ProjectSummary> {
    state.ensure_simulation_idle()?;
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
    state.ensure_simulation_idle()?;
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
    state.ensure_simulation_idle()?;
    let mut service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.save_project(request.project_id)
}

#[tauri::command]
pub fn update_project_settings(
    request: UpdateProjectSettingsRequest,
    state: State<'_, AppState>,
) -> AppResult<ProjectSummary> {
    state.ensure_simulation_idle()?;
    let mut service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.update_project_settings(request.project_id, request.settings)
}

#[tauri::command]
pub fn close_project(state: State<'_, AppState>) -> AppResult<()> {
    state.ensure_simulation_idle()?;
    let mut service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.close_project()
}
