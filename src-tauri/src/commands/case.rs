use crate::domain::case::{SimulationCase, SimulationType, Solver};
use crate::error::{AppError, AppResult};
use crate::AppState;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCaseRequest {
    project_id: Uuid,
    name: String,
    description: String,
    simulation_type: SimulationType,
    solver: Solver,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIdRequest {
    project_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetCaseRequest {
    project_id: Uuid,
    case_id: Uuid,
}

#[tauri::command]
pub fn create_case(
    request: CreateCaseRequest,
    state: State<'_, AppState>,
) -> AppResult<SimulationCase> {
    let mut service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.create_case(
        request.project_id,
        &request.name,
        &request.description,
        request.simulation_type,
        request.solver,
    )
}

#[tauri::command]
pub fn list_cases(
    request: ProjectIdRequest,
    state: State<'_, AppState>,
) -> AppResult<Vec<SimulationCase>> {
    let service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.list_cases(request.project_id)
}

#[tauri::command]
pub fn get_case(request: GetCaseRequest, state: State<'_, AppState>) -> AppResult<SimulationCase> {
    let service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.get_case(request.project_id, request.case_id)
}
