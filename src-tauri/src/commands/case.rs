use crate::domain::case::{CfdSetup, SimulationCase, SimulationType, Solver};
use crate::domain::geometry::GeometryFormat;
use crate::domain::project::ProjectSummary;
use crate::error::{AppError, AppResult};
use crate::solver::openfoam::CaseValidation;
use crate::AppState;
use serde::{Deserialize, Serialize};
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
    geometry_id: Option<Uuid>,
    variant_of_case_id: Option<Uuid>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCaseSetupRequest {
    project_id: Uuid,
    case_id: Uuid,
    setup: CfdSetup,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCaseRequest {
    project_id: Uuid,
    case_id: Uuid,
    destination: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFoamGeometryData {
    file_name: String,
    format: GeometryFormat,
    bytes: Vec<u8>,
}

#[tauri::command]
pub fn create_case(
    request: CreateCaseRequest,
    state: State<'_, AppState>,
) -> AppResult<SimulationCase> {
    state.ensure_simulation_idle()?;
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
        request.geometry_id,
        request.variant_of_case_id,
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

#[tauri::command]
pub fn update_case_setup(
    request: UpdateCaseSetupRequest,
    state: State<'_, AppState>,
) -> AppResult<ProjectSummary> {
    state.ensure_simulation_idle()?;
    let mut service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.update_case_setup(request.project_id, request.case_id, request.setup)
}

#[tauri::command]
pub fn validate_case(
    request: GetCaseRequest,
    state: State<'_, AppState>,
) -> AppResult<CaseValidation> {
    state.ensure_simulation_idle()?;
    let service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.validate_case(request.project_id, request.case_id)
}

#[tauri::command]
pub fn get_openfoam_geometry_data(
    request: GetCaseRequest,
    state: State<'_, AppState>,
) -> AppResult<OpenFoamGeometryData> {
    if !cfg!(debug_assertions) {
        return Err(AppError::InternalError(
            "OpenFOAM geometry inspection is only available in debug builds.".to_owned(),
        ));
    }
    let service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    let (file_name, format, bytes) =
        service.get_openfoam_geometry_data(request.project_id, request.case_id)?;
    Ok(OpenFoamGeometryData {
        file_name,
        format,
        bytes,
    })
}

#[tauri::command]
pub fn export_openfoam_case(
    request: ExportCaseRequest,
    state: State<'_, AppState>,
) -> AppResult<String> {
    state.ensure_simulation_idle()?;
    let mut service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.export_openfoam_case(
        request.project_id,
        request.case_id,
        std::path::Path::new(&request.destination),
    )
}
