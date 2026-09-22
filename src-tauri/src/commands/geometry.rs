use crate::domain::project::ProjectSummary;
use crate::error::{AppError, AppResult};
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportGeometryRequest {
    project_id: Uuid,
    case_id: Option<Uuid>,
    source_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryDataRequest {
    project_id: Uuid,
    geometry_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignGeometryRequest {
    project_id: Uuid,
    case_id: Uuid,
    geometry_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveGeometryRequest {
    project_id: Uuid,
    geometry_id: Uuid,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryData {
    pub bytes: Vec<u8>,
}

#[tauri::command]
pub fn import_geometry(
    request: ImportGeometryRequest,
    state: State<'_, AppState>,
) -> AppResult<ProjectSummary> {
    let mut service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.import_geometry(
        request.project_id,
        request.case_id,
        Path::new(&request.source_path),
    )
}

#[tauri::command]
pub fn get_geometry_data(
    request: GeometryDataRequest,
    state: State<'_, AppState>,
) -> AppResult<GeometryData> {
    let service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    Ok(GeometryData {
        bytes: service.get_geometry_data(request.project_id, request.geometry_id)?,
    })
}

#[tauri::command]
pub fn assign_geometry(
    request: AssignGeometryRequest,
    state: State<'_, AppState>,
) -> AppResult<ProjectSummary> {
    let mut service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.assign_geometry(request.project_id, request.case_id, request.geometry_id)
}

#[tauri::command]
pub fn remove_geometry(
    request: RemoveGeometryRequest,
    state: State<'_, AppState>,
) -> AppResult<ProjectSummary> {
    let mut service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.remove_geometry(request.project_id, request.geometry_id)
}
