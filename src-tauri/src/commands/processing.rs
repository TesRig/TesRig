use crate::error::{AppError, AppResult};
use crate::solver::processing::{
    self, ProcessingResult, ProcessingResultSummary, ProcessingScript, ProcessingScriptRun,
    ProcessingScriptValidation,
};
use crate::AppState;
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingCaseRequest {
    project_id: Uuid,
    case_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingScriptRequest {
    project_id: Uuid,
    case_id: Uuid,
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProcessingScriptRequest {
    project_id: Uuid,
    case_id: Uuid,
    name: String,
    source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateProcessingScriptRequest {
    source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingResultRequest {
    project_id: Uuid,
    case_id: Uuid,
    file_name: String,
}

#[tauri::command]
pub fn list_processing_scripts(
    request: ProcessingCaseRequest,
    state: State<'_, AppState>,
) -> AppResult<Vec<ProcessingScript>> {
    let service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.list_processing_scripts(request.project_id, request.case_id)
}

#[tauri::command]
pub fn list_processing_results(
    request: ProcessingCaseRequest,
    state: State<'_, AppState>,
) -> AppResult<Vec<ProcessingResultSummary>> {
    let service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.list_processing_results(request.project_id, request.case_id)
}

#[tauri::command]
pub fn read_processing_result(
    request: ProcessingResultRequest,
    state: State<'_, AppState>,
) -> AppResult<ProcessingResult> {
    let service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.read_processing_result(request.project_id, request.case_id, &request.file_name)
}

#[tauri::command]
pub fn save_processing_script(
    request: SaveProcessingScriptRequest,
    state: State<'_, AppState>,
) -> AppResult<ProcessingScript> {
    let mut service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.save_processing_script(
        request.project_id,
        request.case_id,
        &request.name,
        &request.source,
    )
}

#[tauri::command]
pub fn delete_processing_script(
    request: ProcessingScriptRequest,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut service = state
        .project_service
        .lock()
        .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
    service.delete_processing_script(request.project_id, request.case_id, &request.name)
}

#[tauri::command]
pub async fn run_processing_script(
    request: ProcessingScriptRequest,
    state: State<'_, AppState>,
) -> AppResult<ProcessingScriptRun> {
    let project_service = Arc::clone(&state.project_service);
    let python_runtime = state.python_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let interpreter = python_runtime.interpreter()?;
        let mut service = project_service
            .lock()
            .map_err(|_| AppError::InternalError("project service lock was poisoned".to_owned()))?;
        service.run_processing_script(
            request.project_id,
            request.case_id,
            &request.name,
            &interpreter,
        )
    })
    .await
    .map_err(|error| AppError::InternalError(format!("processing script worker failed: {error}")))?
}

#[tauri::command]
pub async fn validate_processing_script(
    request: ValidateProcessingScriptRequest,
    state: State<'_, AppState>,
) -> AppResult<ProcessingScriptValidation> {
    let python_runtime = state.python_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let interpreter = python_runtime.interpreter()?;
        processing::validate_script_with_interpreter(&request.source, Some(&interpreter))
    })
    .await
    .map_err(|error| {
        AppError::InternalError(format!("Python syntax validator worker failed: {error}"))
    })?
}

#[tauri::command]
pub fn open_python_api_docs(state: State<'_, AppState>) -> AppResult<()> {
    state.python_runtime.open_documentation()
}
