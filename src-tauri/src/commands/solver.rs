use crate::error::{AppError, AppResult};
use crate::solver::runtime::RuntimeStatus;
use crate::solver::simulation::{SimulationJob, SimulationLog};
use crate::AppState;
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationRequest {
    project_id: Uuid,
    case_id: Uuid,
}

#[tauri::command]
pub fn get_openfoam_runtime(state: State<'_, AppState>) -> AppResult<RuntimeStatus> {
    Ok(state.runtime_manager.status())
}

#[tauri::command]
pub async fn start_simulation(
    request: SimulationRequest,
    state: State<'_, AppState>,
) -> AppResult<SimulationJob> {
    let project_service = Arc::clone(&state.project_service);
    let simulation_manager = state.simulation_manager.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let case_directory = {
            let mut service = project_service.lock().map_err(|_| {
                AppError::InternalError("project service lock was poisoned".to_owned())
            })?;
            service.prepare_simulation(request.project_id, request.case_id)?
        };
        simulation_manager.start(
            request.project_id,
            request.case_id,
            case_directory,
            project_service,
        )
    })
    .await
    .map_err(|error| {
        AppError::InternalError(format!("simulation startup worker failed: {error}"))
    })?
}

#[tauri::command]
pub fn get_simulation_status(state: State<'_, AppState>) -> AppResult<Option<SimulationJob>> {
    state.simulation_manager.current()
}

#[tauri::command]
pub fn get_simulation_log(state: State<'_, AppState>) -> AppResult<SimulationLog> {
    state.simulation_manager.logs()
}

#[tauri::command]
pub fn cancel_simulation(state: State<'_, AppState>) -> AppResult<SimulationJob> {
    state.simulation_manager.cancel()
}
