use crate::error::{AppError, AppResult};
use crate::services::project_service::ProjectService;
use crate::solver::runtime::RuntimeManager;
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::thread;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum SimulationJobStatus {
    Starting,
    Running,
    Cancelling,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationJob {
    pub id: Uuid,
    pub project_id: Uuid,
    pub case_id: Uuid,
    pub status: SimulationJobStatus,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub exit_code: Option<i32>,
    pub log_path: String,
    pub error: Option<String>,
    pub stage: String,
    pub progress: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationLog {
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldStatistics {
    pub minimum: f64,
    pub maximum: f64,
    pub mean: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowSnapshot {
    pub time: f64,
    pub velocity_mean: [f64; 3],
    pub velocity_magnitude: FieldStatistics,
    pub pressure: Option<FieldStatistics>,
    pub sample_count: usize,
    pub source: String,
}

#[derive(Debug, Default)]
struct SimulationState {
    current: Option<SimulationJob>,
    stdout_path: Option<PathBuf>,
    stderr_path: Option<PathBuf>,
    stdout_clear_offset: u64,
    stderr_clear_offset: u64,
    stage_path: Option<PathBuf>,
    progress_target: f64,
    process_id: Option<u32>,
    case_directory: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct SimulationManager {
    state: Arc<Mutex<SimulationState>>,
    runtime: RuntimeManager,
}

impl SimulationManager {
    pub fn new(runtime: RuntimeManager) -> Self {
        Self {
            state: Arc::new(Mutex::new(SimulationState::default())),
            runtime,
        }
    }

    pub fn start(
        &self,
        project_id: Uuid,
        case_id: Uuid,
        case_directory: std::path::PathBuf,
        project_service: Arc<Mutex<ProjectService>>,
    ) -> AppResult<SimulationJob> {
        let mut state = self.state.lock().map_err(lock_error)?;
        if state
            .current
            .as_ref()
            .is_some_and(|job| is_active(job.status))
        {
            return Err(AppError::SimulationAlreadyRunning);
        }

        let mut command = self.runtime.simulation_command(&case_directory)?;
        let stdout_path = case_directory.join("log.tesrig.stdout");
        let stderr_path = case_directory.join("log.tesrig.stderr");
        let stage_path = case_directory.join("tesrig.stage");
        if stage_path.exists() {
            fs::remove_file(&stage_path).map_err(AppError::io)?;
        }
        let progress_target = read_end_time(&case_directory.join("system/controlDict"));
        let stdout = fs::File::create(&stdout_path).map_err(AppError::io)?;
        let stderr = fs::File::create(&stderr_path).map_err(AppError::io)?;
        command
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr));

        let job = SimulationJob {
            id: Uuid::new_v4(),
            project_id,
            case_id,
            status: SimulationJobStatus::Starting,
            started_at: Utc::now(),
            finished_at: None,
            exit_code: None,
            log_path: format!("cases/{case_id}/openfoam/log.tesrig.stdout"),
            error: None,
            stage: "Starting".to_owned(),
            progress: 0.0,
        };
        state.current = Some(job.clone());
        state.stdout_path = Some(stdout_path.clone());
        state.stderr_path = Some(stderr_path.clone());
        state.stdout_clear_offset = 0;
        state.stderr_clear_offset = 0;
        state.stage_path = Some(stage_path);
        state.progress_target = progress_target;
        state.case_directory = Some(case_directory.clone());
        drop(state);

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                self.finish_failed(job.id, error.to_string());
                return Err(AppError::SolverRuntimeUnavailable(error.to_string()));
            }
        };
        if let Ok(mut state) = self.state.lock() {
            state.process_id = Some(child.id());
        }
        self.update_status(job.id, SimulationJobStatus::Running);

        let state = Arc::clone(&self.state);
        let runtime = self.runtime.clone();
        thread::spawn(move || {
            let wait_result = child.wait();
            let shutdown_result = runtime.shutdown_after_task();

            let cancelling = state
                .lock()
                .ok()
                .and_then(|state| state.current.as_ref().map(|job| job.status))
                == Some(SimulationJobStatus::Cancelling);

            let archive_result = project_service
                .lock()
                .map_err(|_| {
                    AppError::InternalError("project service lock was poisoned".to_owned())
                })
                .and_then(|mut service| service.save_project(project_id).map(|_| ()));

            if let Ok(mut state) = state.lock() {
                state.process_id = None;
                if let Some(current) = state.current.as_mut().filter(|item| item.id == job.id) {
                    current.finished_at = Some(Utc::now());
                    match wait_result {
                        Ok(status) if cancelling => {
                            current.status = SimulationJobStatus::Cancelled;
                            current.exit_code = status.code();
                            current.stage = "Cancelled".to_owned();
                        }
                        Ok(status) => {
                            current.exit_code = status.code();
                            if status.success() && shutdown_result.is_ok() && archive_result.is_ok()
                            {
                                current.status = SimulationJobStatus::Completed;
                                current.stage = "Complete".to_owned();
                                current.progress = 100.0;
                            } else {
                                current.status = SimulationJobStatus::Failed;
                                current.stage = "Failed".to_owned();
                                current.error = Some(if !status.success() {
                                    let mut message = openfoam_failure_message(
                                        status.code(),
                                        &stdout_path,
                                        &stderr_path,
                                    );
                                    if let Some(error) = shutdown_result.as_ref().err() {
                                        message.push_str(&format!(
                                            "\n\nAdditionally, TesRig could not finalize the runtime: {error}"
                                        ));
                                    }
                                    if let Some(error) = archive_result.as_ref().err() {
                                        message.push_str(&format!(
                                            "\n\nAdditionally, TesRig could not archive the run logs: {error}"
                                        ));
                                    }
                                    message
                                } else {
                                    shutdown_result
                                        .as_ref()
                                        .err()
                                        .or_else(|| archive_result.as_ref().err())
                                        .map(|error| error.to_string())
                                        .unwrap_or_else(|| "The simulation task failed.".to_owned())
                                });
                            }
                        }
                        Err(error) => {
                            current.status = if cancelling {
                                SimulationJobStatus::Cancelled
                            } else {
                                SimulationJobStatus::Failed
                            };
                            current.stage = if cancelling {
                                "Cancelled".to_owned()
                            } else {
                                "Failed".to_owned()
                            };
                            current.error = Some(error.to_string());
                        }
                    }
                }
            }
        });

        self.current()?.ok_or(AppError::SimulationNotFound)
    }

    pub fn current(&self) -> AppResult<Option<SimulationJob>> {
        let mut state = self.state.lock().map_err(lock_error)?;
        refresh_progress(&mut state);
        Ok(state.current.clone())
    }

    pub fn logs(&self) -> AppResult<SimulationLog> {
        let state = self.state.lock().map_err(lock_error)?;
        if state.current.is_none() {
            return Err(AppError::SimulationNotFound);
        }
        Ok(SimulationLog {
            stdout: state
                .stdout_path
                .as_deref()
                .map(|path| read_log_tail_from(path, state.stdout_clear_offset, 96 * 1024))
                .unwrap_or_default(),
            stderr: state
                .stderr_path
                .as_deref()
                .map(|path| read_log_tail_from(path, state.stderr_clear_offset, 48 * 1024))
                .unwrap_or_default(),
        })
    }

    /// Reads only a bounded sample from the newest completed OpenFOAM field files.
    /// Keeping this provider behind the simulation manager leaves room for Python
    /// post-processing providers to expose the same snapshot contract later.
    pub fn flow_snapshot(&self) -> AppResult<Option<FlowSnapshot>> {
        let case_directory = self
            .state
            .lock()
            .map_err(lock_error)?
            .case_directory
            .clone();
        Ok(case_directory
            .as_deref()
            .and_then(read_latest_flow_snapshot))
    }

    pub fn clear_logs(&self) -> AppResult<SimulationLog> {
        let mut state = self.state.lock().map_err(lock_error)?;
        if state.current.is_none() {
            return Err(AppError::SimulationNotFound);
        }
        state.stdout_clear_offset = state
            .stdout_path
            .as_deref()
            .and_then(|path| fs::metadata(path).ok())
            .map(|metadata| metadata.len())
            .unwrap_or_default();
        state.stderr_clear_offset = state
            .stderr_path
            .as_deref()
            .and_then(|path| fs::metadata(path).ok())
            .map(|metadata| metadata.len())
            .unwrap_or_default();
        Ok(SimulationLog {
            stdout: String::new(),
            stderr: String::new(),
        })
    }

    pub fn cancel(&self) -> AppResult<SimulationJob> {
        let process_id = {
            let mut state = self.state.lock().map_err(lock_error)?;
            let job = state.current.as_mut().ok_or(AppError::SimulationNotFound)?;
            if !is_active(job.status) {
                return Ok(job.clone());
            }
            job.status = SimulationJobStatus::Cancelling;
            job.stage = "Stopping".to_owned();
            state.process_id
        };
        if let Some(process_id) = process_id {
            self.runtime.cancel_process(process_id)?;
        } else {
            self.runtime.shutdown_after_task()?;
        }
        self.current()?.ok_or(AppError::SimulationNotFound)
    }

    pub fn is_active(&self) -> bool {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.current.as_ref().map(|job| is_active(job.status)))
            .unwrap_or(false)
    }

    fn update_status(&self, job_id: Uuid, status: SimulationJobStatus) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(job) = state.current.as_mut().filter(|job| job.id == job_id) {
                job.status = status;
                if status == SimulationJobStatus::Running {
                    job.stage = "Runtime setup".to_owned();
                    job.progress = 1.0;
                }
            }
        }
    }

    fn finish_failed(&self, job_id: Uuid, error: String) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(job) = state.current.as_mut().filter(|job| job.id == job_id) {
                job.status = SimulationJobStatus::Failed;
                job.finished_at = Some(Utc::now());
                job.error = Some(error);
            }
        }
    }
}

fn refresh_progress(state: &mut SimulationState) {
    let Some(job) = state.current.as_mut() else {
        return;
    };
    if !is_active(job.status) {
        return;
    }
    if job.status == SimulationJobStatus::Cancelling {
        job.stage = "Stopping".to_owned();
        return;
    }
    let stdout = state
        .stdout_path
        .as_deref()
        .map(|path| read_log_tail(path, 64 * 1024))
        .unwrap_or_default();
    let recorded_stage = state
        .stage_path
        .as_deref()
        .and_then(|path| fs::read_to_string(path).ok());
    let stage = recorded_stage
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            stdout
                .lines()
                .rev()
                .find_map(|line| line.trim().strip_prefix("TESRIG_STAGE:"))
                .map(str::trim)
        })
        .unwrap_or("runtime setup");
    let base = match stage.to_ascii_lowercase().as_str() {
        "runtime setup" => 1.0,
        "blockmesh" => 5.0,
        "snappyhexmesh" => 15.0,
        "checkmesh" => 45.0,
        "decomposepar" => 50.0,
        "foamrun" | "simplefoam" | "pimplefoam" => 52.0,
        "reconstructpar" => 96.0,
        "post-processing" => 98.0,
        _ => job.progress,
    };
    let solver_progress = if matches!(
        stage.to_ascii_lowercase().as_str(),
        "foamrun" | "simplefoam" | "pimplefoam"
    ) {
        latest_simulation_time(&stdout)
            .filter(|_| state.progress_target > 0.0)
            .map(|time| 52.0 + (time / state.progress_target).clamp(0.0, 1.0) * 43.0)
            .unwrap_or(base)
    } else {
        base
    };
    job.progress = job.progress.max(solver_progress).min(99.0);
    job.stage = display_stage(stage).to_owned();
}

fn display_stage(stage: &str) -> &str {
    match stage.to_ascii_lowercase().as_str() {
        "runtime setup" => "Preparing runtime",
        "blockmesh" => "Creating background mesh",
        "snappyhexmesh" => "Fitting mesh to geometry",
        "checkmesh" => "Checking mesh",
        "decomposepar" => "Preparing parallel solve",
        "foamrun" | "simplefoam" | "pimplefoam" => "Solving airflow",
        "reconstructpar" => "Reconstructing results",
        "post-processing" => "Processing preview data",
        _ => "Simulation running",
    }
}

fn latest_simulation_time(log: &str) -> Option<f64> {
    log.lines().rev().find_map(|line| {
        line.trim()
            .strip_prefix("Time =")
            .and_then(|value| value.trim().trim_end_matches('s').parse::<f64>().ok())
    })
}

const MAX_FIELD_SAMPLES: usize = 4096;

fn read_latest_flow_snapshot(case_directory: &Path) -> Option<FlowSnapshot> {
    let mut candidates = vec![(1_u8, case_directory.to_path_buf())];
    let processor_zero = case_directory.join("processor0");
    if processor_zero.is_dir() {
        candidates.push((0, processor_zero));
    }

    let (time, _, directory) = candidates
        .into_iter()
        .filter_map(|(priority, root)| {
            latest_time_directory(&root).map(|(time, path)| (time, priority, path))
        })
        .max_by(|left, right| {
            left.0
                .total_cmp(&right.0)
                .then_with(|| left.1.cmp(&right.1))
        })?;
    let pressure_path = directory.join("p");
    if !field_is_stable(&directory.join("U"))
        || (pressure_path.is_file() && !field_is_stable(&pressure_path))
    {
        return None;
    }
    let velocities = read_vector_field(&directory.join("U"), MAX_FIELD_SAMPLES)?;
    if velocities.is_empty() {
        return None;
    }
    let pressures = read_scalar_field(&pressure_path, MAX_FIELD_SAMPLES);
    let sample_count = velocities.len();
    let velocity_mean = velocities.iter().fold([0.0; 3], |mut sum, value| {
        for axis in 0..3 {
            sum[axis] += value[axis];
        }
        sum
    });
    let velocity_mean = velocity_mean.map(|value| value / sample_count as f64);
    let magnitudes = velocities
        .iter()
        .map(|value| (value[0].powi(2) + value[1].powi(2) + value[2].powi(2)).sqrt())
        .collect::<Vec<_>>();

    Some(FlowSnapshot {
        time,
        velocity_mean,
        velocity_magnitude: statistics(&magnitudes)?,
        pressure: pressures.as_deref().and_then(statistics),
        sample_count,
        source: if directory.starts_with(case_directory.join("processor0")) {
            "processor0".to_owned()
        } else {
            "reconstructed".to_owned()
        },
    })
}

fn field_is_stable(path: &Path) -> bool {
    if cfg!(test) {
        return true;
    }
    fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.elapsed().ok())
        .is_some_and(|age| age.as_millis() >= 250)
}

fn latest_time_directory(root: &Path) -> Option<(f64, PathBuf)> {
    fs::read_dir(root)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let time = entry.file_name().to_string_lossy().parse::<f64>().ok()?;
            (path.is_dir() && path.join("U").is_file()).then_some((time, path))
        })
        .max_by(|left, right| left.0.total_cmp(&right.0))
}

fn read_vector_field(path: &Path, limit: usize) -> Option<Vec<[f64; 3]>> {
    read_field_lines(path, limit, |line| parse_vector(line))
}

fn read_scalar_field(path: &Path, limit: usize) -> Option<Vec<f64>> {
    read_field_lines(path, limit, |line| {
        line.trim().trim_end_matches(';').parse().ok()
    })
}

fn read_field_lines<T>(
    path: &Path,
    limit: usize,
    parse: impl Fn(&str) -> Option<T>,
) -> Option<Vec<T>> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
    let mut values = Vec::new();
    let mut internal_field = false;
    let mut list_started = false;

    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if !internal_field {
            if !trimmed.starts_with("internalField") {
                continue;
            }
            internal_field = true;
            if let Some(uniform) = trimmed.strip_prefix("internalField uniform") {
                if let Some(value) = parse(uniform) {
                    values.push(value);
                }
                break;
            }
            continue;
        }
        if !list_started {
            if trimmed == "(" {
                list_started = true;
            }
            continue;
        }
        if trimmed == ")" || trimmed == ");" {
            break;
        }
        if let Some(value) = parse(trimmed) {
            values.push(value);
            if values.len() >= limit {
                break;
            }
        }
    }
    (!values.is_empty()).then_some(values)
}

fn parse_vector(value: &str) -> Option<[f64; 3]> {
    let values = value
        .trim()
        .trim_end_matches(';')
        .trim_start_matches('(')
        .trim_end_matches(')')
        .split_whitespace()
        .map(str::parse::<f64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    (values.len() == 3).then_some([values[0], values[1], values[2]])
}

fn statistics(values: &[f64]) -> Option<FieldStatistics> {
    let mut count = 0usize;
    let mut sum = 0.0;
    let mut minimum = f64::INFINITY;
    let mut maximum = f64::NEG_INFINITY;
    for value in values.iter().copied().filter(|value| value.is_finite()) {
        count += 1;
        sum += value;
        minimum = minimum.min(value);
        maximum = maximum.max(value);
    }
    (count > 0).then_some(FieldStatistics {
        minimum,
        maximum,
        mean: sum / count as f64,
    })
}

fn read_end_time(path: &Path) -> f64 {
    let Ok(content) = fs::read_to_string(path) else {
        return 1.0;
    };
    content
        .split(';')
        .find_map(|statement| {
            let mut fields = statement.split_whitespace();
            (fields.next()? == "endTime")
                .then(|| fields.next()?.parse::<f64>().ok())
                .flatten()
        })
        .unwrap_or(1.0)
}

fn openfoam_failure_message(
    exit_code: Option<i32>,
    stdout_path: &Path,
    stderr_path: &Path,
) -> String {
    let stdout = read_log_tail(stdout_path, 24 * 1024);
    let stderr = read_log_tail(stderr_path, 12 * 1024);
    let stage = stdout
        .lines()
        .rev()
        .find_map(|line| line.trim().strip_prefix("TESRIG_STAGE:"))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("OpenFOAM");
    let combined = format!("{}\n{}", stdout, stderr);
    let diagnostic = extract_diagnostic(&combined);
    let context = combined.to_ascii_lowercase();
    let suggestion = diagnostic_suggestion(stage, &context);
    let code = exit_code
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown".to_owned());
    let mut message = format!("OpenFOAM failed during {stage} (exit code {code}).");
    if !diagnostic.is_empty() {
        message.push_str("\n\nOpenFOAM reported:\n");
        message.push_str(&diagnostic);
    }
    message.push_str("\n\nWhat to try:\n");
    message.push_str(suggestion);
    message.push_str("\n\nFull logs:\n");
    message.push_str(&stdout_path.to_string_lossy());
    message.push('\n');
    message.push_str(&stderr_path.to_string_lossy());
    message
}

fn read_log_tail(path: &Path, max_bytes: u64) -> String {
    read_log_tail_from(path, 0, max_bytes)
}

fn read_log_tail_from(path: &Path, clear_offset: u64, max_bytes: u64) -> String {
    let Ok(mut file) = fs::File::open(path) else {
        return String::new();
    };
    let length = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
    let visible_start = clear_offset.min(length);
    let start = visible_start.max(length.saturating_sub(max_bytes));
    if file.seek(SeekFrom::Start(start)).is_err() {
        return String::new();
    }
    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() {
        return String::new();
    }
    let text = String::from_utf8_lossy(&bytes);
    if start == visible_start {
        text.into_owned()
    } else {
        text.split_once('\n')
            .map(|(_, tail)| tail.to_owned())
            .unwrap_or_default()
    }
}

fn extract_diagnostic(log: &str) -> String {
    let cleaned = strip_ansi(log);
    if let Some(start) = cleaned
        .rfind("FOAM FATAL")
        .or_else(|| cleaned.rfind("Error:"))
    {
        return cleaned[start..]
            .lines()
            .filter(|line| !line.trim().is_empty())
            .take(24)
            .collect::<Vec<_>>()
            .join("\n");
    }
    let lines = cleaned
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>();
    lines[lines.len().saturating_sub(24)..].join("\n")
}

fn strip_ansi(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut characters = value.chars().peekable();
    while let Some(character) = characters.next() {
        if character == '\u{1b}' && characters.peek() == Some(&'[') {
            characters.next();
            for next in characters.by_ref() {
                if ('@'..='~').contains(&next) {
                    break;
                }
            }
        } else {
            output.push(character);
        }
    }
    output
}

fn diagnostic_suggestion<'a>(stage: &str, context: &'a str) -> &'a str {
    if context.contains("openfoam 14 environment was not found") {
        "Install the OpenFOAM Foundation openfoam14 package in the configured WSL distribution, or set TESRIG_OPENFOAM_BASHRC to a compatible environment script."
    } else if context.contains("no space left on device")
        || context.contains("error in iostream")
        || (context.contains("fatal io error") && context.contains("writelist"))
    {
        "OpenFOAM could not finish writing a result field. Free space on the Windows system drive and its temporary directory, then run the case again. TesRig will regenerate the case and retain only the 10 newest result times to prevent unbounded output growth."
    } else if context.contains("locationinmesh") {
        "Resize the boundary box so it fully surrounds the geometry and leaves open fluid space near a far corner."
    } else if context.contains("cannot find patchfield entry")
        || context.contains("cannot find patch")
    {
        "Review the boundary conditions, remove stale patch assignments, then use Save & generate before running again."
    } else if context.contains("mesh has no cells") || context.contains("no cells in mesh") {
        "Enlarge the boundary box or move any origin-snapped face so the box retains a non-empty fluid region."
    } else if context.contains("command not found") || context.contains("not found: foam") {
        "Verify the OpenFOAM Foundation v14 installation and its required commands, or set TESRIG_OPENFOAM_BASHRC to the correct environment script."
    } else if stage.eq_ignore_ascii_case("blockMesh") {
        "Check that every boundary-box minimum is below its maximum and increase the base cell size if the mesh is excessively large."
    } else if stage.eq_ignore_ascii_case("snappyHexMesh") {
        "Check that the geometry is watertight, the boundary box surrounds it, and the base cell size is appropriate for the model scale."
    } else if stage.eq_ignore_ascii_case("checkMesh") {
        "Adjust the boundary box, base cell size, or surface refinement, then generate and run the case again."
    } else {
        "Review the reported log lines and CFD setup, then use Save & generate before running the case again."
    }
}

fn is_active(status: SimulationJobStatus) -> bool {
    matches!(
        status,
        SimulationJobStatus::Starting
            | SimulationJobStatus::Running
            | SimulationJobStatus::Cancelling
    )
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> AppError {
    AppError::InternalError("simulation manager lock was poisoned".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_run_reports_stage_log_excerpt_and_suggestion() {
        let directory = tempfile::tempdir().unwrap();
        let stdout = directory.path().join("stdout.log");
        let stderr = directory.path().join("stderr.log");
        fs::write(
            &stdout,
            "TESRIG_STAGE: snappyHexMesh\nFOAM FATAL ERROR:\nPoint (1 1 1) is not inside the mesh. Check locationInMesh.\nFOAM exiting\n",
        )
        .unwrap();
        fs::write(&stderr, "").unwrap();

        let message = openfoam_failure_message(Some(1), &stdout, &stderr);

        assert!(message.contains("failed during snappyHexMesh (exit code 1)"));
        assert!(message.contains("FOAM FATAL ERROR"));
        assert!(message.contains("Resize the boundary box"));
        assert!(message.contains(&stdout.to_string_lossy().to_string()));
    }

    #[test]
    fn parses_solver_time_for_native_and_foundation_logs() {
        assert_eq!(latest_simulation_time("Time = 8\nTime = 9\n"), Some(9.0));
        assert_eq!(
            latest_simulation_time("Time = 9s\nTime = 10s\n"),
            Some(10.0)
        );
    }

    #[test]
    fn reads_progress_target_from_control_dict() {
        let directory = tempfile::tempdir().unwrap();
        let control = directory.path().join("controlDict");
        fs::write(&control, "startTime 0;\nendTime 250;\ndeltaT 1;\n").unwrap();
        assert_eq!(read_end_time(&control), 250.0);
    }

    #[test]
    fn write_failure_reports_storage_guidance() {
        let context = "foam fatal io error: error in iostream 193/phi for operation writelist";

        let suggestion = diagnostic_suggestion("simpleFoam", context);

        assert!(suggestion.contains("Free space"));
        assert!(suggestion.contains("10 newest result times"));
    }

    #[test]
    fn log_clear_offset_hides_old_output_without_truncating_the_file() {
        let directory = tempfile::tempdir().unwrap();
        let log = directory.path().join("stdout.log");
        fs::write(&log, "old output\nnew output\n").unwrap();

        assert_eq!(read_log_tail_from(&log, 11, 1024), "new output\n");
        assert_eq!(
            fs::read_to_string(&log).unwrap(),
            "old output\nnew output\n"
        );
    }

    #[test]
    fn reads_latest_ascii_flow_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        for time in ["1", "2.5"] {
            fs::create_dir(directory.path().join(time)).unwrap();
        }
        fs::write(
            directory.path().join("2.5/U"),
            "FoamFile {}\ninternalField nonuniform List<vector>\n2\n(\n(1 2 2)\n(3 0 4)\n)\n;\n",
        )
        .unwrap();
        fs::write(
            directory.path().join("2.5/p"),
            "FoamFile {}\ninternalField nonuniform List<scalar>\n2\n(\n10\n20\n)\n;\n",
        )
        .unwrap();
        fs::write(
            directory.path().join("1/U"),
            "FoamFile {}\ninternalField uniform (9 9 9);\n",
        )
        .unwrap();

        let snapshot = read_latest_flow_snapshot(directory.path()).unwrap();

        assert_eq!(snapshot.time, 2.5);
        assert_eq!(snapshot.velocity_mean, [2.0, 1.0, 3.0]);
        assert_eq!(snapshot.velocity_magnitude.minimum, 3.0);
        assert_eq!(snapshot.velocity_magnitude.maximum, 5.0);
        assert_eq!(snapshot.pressure.unwrap().mean, 15.0);
    }
}
