use crate::domain::material::Material;
use crate::domain::project::ProjectSummary;
use crate::error::{AppError, AppResult};
use crate::AppState;
use serde::Deserialize;
use std::path::Path;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertMaterialRequest {
    project_id: Uuid,
    material: Material,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialRequest {
    project_id: Uuid,
    material_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignMaterialRequest {
    project_id: Uuid,
    geometry_id: Uuid,
    material_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportMaterialsRequest {
    project_id: Uuid,
    source_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportMaterialsRequest {
    project_id: Uuid,
    material_ids: Vec<Uuid>,
    destination: String,
}

fn service_lock<'a>(
    state: &'a State<'a, AppState>,
) -> AppResult<std::sync::MutexGuard<'a, crate::services::project_service::ProjectService>> {
    state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))
}

#[tauri::command]
pub fn upsert_material(
    request: UpsertMaterialRequest,
    state: State<'_, AppState>,
) -> AppResult<ProjectSummary> {
    state.ensure_simulation_idle()?;
    service_lock(&state)?.upsert_material(request.project_id, request.material)
}

#[tauri::command]
pub fn delete_material(
    request: MaterialRequest,
    state: State<'_, AppState>,
) -> AppResult<ProjectSummary> {
    state.ensure_simulation_idle()?;
    service_lock(&state)?.delete_material(request.project_id, request.material_id)
}

#[tauri::command]
pub fn assign_material(
    request: AssignMaterialRequest,
    state: State<'_, AppState>,
) -> AppResult<ProjectSummary> {
    state.ensure_simulation_idle()?;
    service_lock(&state)?.assign_material(
        request.project_id,
        request.geometry_id,
        request.material_id,
    )
}

#[tauri::command]
pub fn import_materials(
    request: ImportMaterialsRequest,
    state: State<'_, AppState>,
) -> AppResult<ProjectSummary> {
    state.ensure_simulation_idle()?;
    service_lock(&state)?.import_materials(request.project_id, Path::new(&request.source_path))
}

#[tauri::command]
pub fn export_materials(
    request: ExportMaterialsRequest,
    state: State<'_, AppState>,
) -> AppResult<String> {
    service_lock(&state)?.export_materials(
        request.project_id,
        &request.material_ids,
        Path::new(&request.destination),
    )
}
