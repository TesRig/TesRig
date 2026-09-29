use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs;
use std::fs::File;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const MAX_SCRIPT_BYTES: usize = 512 * 1024;
const MAX_RESULT_BYTES: u64 = 32 * 1024 * 1024;
const BUNDLED_PYTHON_VERSION: &str = "3.12.10";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone)]
pub struct PythonRuntime {
    resource_root: PathBuf,
    documentation_root: PathBuf,
    data_root: PathBuf,
    extraction_lock: Arc<Mutex<()>>,
}

impl PythonRuntime {
    pub fn new(resource_directory: PathBuf, data_directory: PathBuf) -> Self {
        Self {
            resource_root: nested_resource(&resource_directory, "python"),
            documentation_root: nested_resource(&resource_directory, "python-api-docs"),
            data_root: data_directory,
            extraction_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn interpreter(&self) -> AppResult<PathBuf> {
        if let Some(configured) = std::env::var_os("TESRIG_PYTHON") {
            let path = PathBuf::from(configured);
            if path.is_file() {
                return Ok(path);
            }
            return Err(AppError::InvalidProcessingScript(format!(
                "TESRIG_PYTHON points to a missing interpreter: {}",
                path.display()
            )));
        }

        #[cfg(target_os = "windows")]
        {
            self.ensure_windows_runtime()
        }

        #[cfg(not(target_os = "windows"))]
        {
            let platform = if cfg!(target_os = "macos") {
                "macos"
            } else {
                "linux"
            };
            let interpreter = self
                .resource_root
                .join(platform)
                .join("bin")
                .join("python3");
            if interpreter.is_file() {
                Ok(interpreter)
            } else {
                Err(AppError::InvalidProcessingScript(format!(
                    "The bundled Python {BUNDLED_PYTHON_VERSION} runtime is missing at {}.",
                    interpreter.display()
                )))
            }
        }
    }

    pub fn open_documentation(&self) -> AppResult<()> {
        let index = self.documentation_root.join("index.html");
        if !index.is_file() {
            return Err(AppError::InvalidProcessingScript(format!(
                "The bundled Python API documentation is missing at {}.",
                index.display()
            )));
        }
        open_in_default_browser(&index)
    }

    #[cfg(target_os = "windows")]
    fn ensure_windows_runtime(&self) -> AppResult<PathBuf> {
        let install_root = self.data_root.join("python").join(BUNDLED_PYTHON_VERSION);
        let interpreter = install_root.join("python.exe");
        if interpreter.is_file() {
            return Ok(interpreter);
        }

        let _guard = self.extraction_lock.lock().map_err(|_| {
            AppError::InternalError("Python runtime extraction lock was poisoned".to_owned())
        })?;
        if interpreter.is_file() {
            return Ok(interpreter);
        }
        let archive = self
            .resource_root
            .join("windows")
            .join("python-3.12.10-embed-amd64.zip");
        if !archive.is_file() {
            return Err(AppError::InvalidProcessingScript(format!(
                "The bundled Python {BUNDLED_PYTHON_VERSION} archive is missing at {}.",
                archive.display()
            )));
        }
        if install_root.exists() {
            fs::remove_dir_all(&install_root).map_err(AppError::io)?;
        }
        fs::create_dir_all(&install_root).map_err(AppError::io)?;
        extract_zip(&archive, &install_root)?;
        if interpreter.is_file() {
            Ok(interpreter)
        } else {
            Err(AppError::InvalidProcessingScript(
                "The bundled Python archive did not contain python.exe.".to_owned(),
            ))
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingScript {
    pub name: String,
    pub source: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingScriptRun {
    pub name: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingScriptDiagnostic {
    pub line: usize,
    pub column: usize,
    pub end_line: Option<usize>,
    pub end_column: Option<usize>,
    pub message: String,
    pub severity: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingScriptValidation {
    pub valid: bool,
    pub diagnostics: Vec<ProcessingScriptDiagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingResultSummary {
    pub file_name: String,
    pub name: String,
    pub kind: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingResult {
    pub file_name: String,
    pub schema_version: u32,
    pub name: String,
    pub kind: String,
    pub updated_at: DateTime<Utc>,
    pub metadata: serde_json::Value,
    pub data: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProcessingResultEnvelope {
    schema_version: u32,
    name: String,
    kind: String,
    #[serde(default)]
    metadata: serde_json::Value,
    data: serde_json::Value,
}

pub fn list_scripts(case_root: &Path) -> AppResult<Vec<ProcessingScript>> {
    let directory = scripts_directory(case_root);
    if !directory.is_dir() {
        return Ok(Vec::new());
    }
    let mut scripts = fs::read_dir(directory)
        .map_err(AppError::io)?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            (path.extension().and_then(|value| value.to_str()) == Some("py")).then_some(path)
        })
        .map(read_script)
        .collect::<AppResult<Vec<_>>>()?;
    scripts.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(scripts)
}

pub fn save_script(case_root: &Path, name: &str, source: &str) -> AppResult<ProcessingScript> {
    if source.len() > MAX_SCRIPT_BYTES {
        return Err(AppError::InvalidProcessingScript(
            "Python scripts must be smaller than 512 KiB.".to_owned(),
        ));
    }
    let name = normalize_script_name(name)?;
    ensure_layout(case_root)?;
    let path = scripts_directory(case_root).join(&name);
    fs::write(&path, source).map_err(AppError::io)?;
    read_script(path)
}

pub fn delete_script(case_root: &Path, name: &str) -> AppResult<()> {
    let name = normalize_script_name(name)?;
    let path = scripts_directory(case_root).join(name);
    if path.is_file() {
        fs::remove_file(path).map_err(AppError::io)?;
    }
    Ok(())
}

pub fn list_results(case_root: &Path) -> AppResult<Vec<ProcessingResultSummary>> {
    let directory = results_directory(case_root);
    if !directory.is_dir() {
        return Ok(Vec::new());
    }
    let mut results = fs::read_dir(directory)
        .map_err(AppError::io)?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            (path.extension().and_then(|value| value.to_str()) == Some("json")).then_some(path)
        })
        .filter_map(|path| read_result_path(path).ok())
        .map(|result| ProcessingResultSummary {
            file_name: result.file_name,
            name: result.name,
            kind: result.kind,
            updated_at: result.updated_at,
        })
        .collect::<Vec<_>>();
    results.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(results)
}

pub fn read_result(case_root: &Path, file_name: &str) -> AppResult<ProcessingResult> {
    let file_name = normalize_result_file_name(file_name)?;
    read_result_path(results_directory(case_root).join(file_name))
}

#[cfg(test)]
pub fn run_script(case_root: &Path, name: &str) -> AppResult<ProcessingScriptRun> {
    run_script_with_interpreter(case_root, name, None)
}

pub fn run_script_with_interpreter(
    case_root: &Path,
    name: &str,
    interpreter: Option<&Path>,
) -> AppResult<ProcessingScriptRun> {
    let name = normalize_script_name(name)?;
    ensure_layout(case_root)?;
    let processing_root = processing_directory(case_root);
    let path = scripts_directory(case_root).join(&name);
    if !path.is_file() {
        return Err(AppError::InvalidProcessingScript(format!(
            "Processing script was not found: {name}"
        )));
    }

    let mut launch_errors = Vec::new();
    for (program, prefix_arguments) in python_candidates(interpreter) {
        match python_command(&program)
            .args(&prefix_arguments)
            .arg("-c")
            .arg(PYTHON_RUNNER)
            .arg(&path)
            .arg(&processing_root)
            .current_dir(&processing_root)
            .env("TESRIG_CASE_DIR", case_root)
            .output()
        {
            Ok(output) => {
                return Ok(ProcessingScriptRun {
                    name,
                    success: output.status.success(),
                    exit_code: output.status.code(),
                    stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                    stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
                });
            }
            Err(error) => launch_errors.push(format!("{}: {error}", program.to_string_lossy())),
        }
    }
    Err(AppError::InvalidProcessingScript(format!(
        "Python 3 could not be started. Install Python 3 and ensure it is on PATH. {}",
        launch_errors.join("; ")
    )))
}

#[cfg(test)]
pub fn validate_script(source: &str) -> AppResult<ProcessingScriptValidation> {
    validate_script_with_interpreter(source, None)
}

pub fn validate_script_with_interpreter(
    source: &str,
    interpreter: Option<&Path>,
) -> AppResult<ProcessingScriptValidation> {
    if source.len() > MAX_SCRIPT_BYTES {
        return Err(AppError::InvalidProcessingScript(
            "Python scripts must be smaller than 512 KiB.".to_owned(),
        ));
    }

    let mut launch_errors = Vec::new();
    for (program, prefix_arguments) in python_candidates(interpreter) {
        let mut child = match python_command(&program)
            .args(&prefix_arguments)
            .arg("-I")
            .arg("-c")
            .arg(PYTHON_VALIDATOR)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(error) => {
                launch_errors.push(format!("{}: {error}", program.to_string_lossy()));
                continue;
            }
        };

        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(source.as_bytes()).map_err(AppError::io)?;
        }
        let output = child.wait_with_output().map_err(AppError::io)?;
        if !output.status.success() {
            launch_errors.push(format!(
                "{}: {}",
                program.to_string_lossy(),
                String::from_utf8_lossy(&output.stderr).trim()
            ));
            continue;
        }
        return serde_json::from_slice(&output.stdout).map_err(|error| {
            AppError::InternalError(format!(
                "Python syntax validator returned invalid data: {error}"
            ))
        });
    }

    Err(AppError::InvalidProcessingScript(format!(
        "Python 3 could not be started. Install Python 3 and ensure it is on PATH. {}",
        launch_errors.join("; ")
    )))
}

fn python_candidates(interpreter: Option<&Path>) -> Vec<(OsString, Vec<OsString>)> {
    if let Some(interpreter) = interpreter {
        return vec![(interpreter.as_os_str().to_owned(), Vec::new())];
    }

    #[cfg(target_os = "windows")]
    return vec![
        (OsString::from("py"), vec![OsString::from("-3")]),
        (OsString::from("python"), Vec::new()),
    ];

    #[cfg(not(target_os = "windows"))]
    return vec![
        (OsString::from("python3"), Vec::new()),
        (OsString::from("python"), Vec::new()),
    ];
}

fn python_command(program: &std::ffi::OsStr) -> Command {
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

fn nested_resource(resource_directory: &Path, name: &str) -> PathBuf {
    let nested = resource_directory.join("resources").join(name);
    if nested.exists() {
        nested
    } else {
        resource_directory.join(name)
    }
}

fn extract_zip(archive_path: &Path, destination: &Path) -> AppResult<()> {
    let archive_file = File::open(archive_path).map_err(AppError::io)?;
    let mut archive = zip::ZipArchive::new(archive_file).map_err(|error| {
        AppError::InvalidProcessingScript(format!(
            "Could not open bundled Python archive {}: {error}",
            archive_path.display()
        ))
    })?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| {
            AppError::InvalidProcessingScript(format!(
                "Could not read bundled Python archive entry: {error}"
            ))
        })?;
        let Some(relative) = entry.enclosed_name() else {
            return Err(AppError::InvalidProcessingScript(
                "The bundled Python archive contains an unsafe path.".to_owned(),
            ));
        };
        let target = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(AppError::io)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(AppError::io)?;
        }
        let mut output = File::create(&target).map_err(AppError::io)?;
        io::copy(&mut entry, &mut output).map_err(AppError::io)?;
    }
    Ok(())
}

fn open_in_default_browser(path: &Path) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer.exe");
        command.creation_flags(CREATE_NO_WINDOW).arg(path);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };

    command.spawn().map_err(|error| {
        AppError::InternalError(format!(
            "Could not open Python API documentation in the default browser: {error}"
        ))
    })?;
    Ok(())
}

pub fn ensure_layout(case_root: &Path) -> AppResult<()> {
    let processing = processing_directory(case_root);
    fs::create_dir_all(scripts_directory(case_root)).map_err(AppError::io)?;
    fs::create_dir_all(processing.join("results")).map_err(AppError::io)?;
    fs::write(processing.join("tesrig_api.py"), PYTHON_API).map_err(AppError::io)
}

fn read_script(path: PathBuf) -> AppResult<ProcessingScript> {
    let metadata = fs::metadata(&path).map_err(AppError::io)?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            AppError::InvalidProcessingScript("Script name is not valid UTF-8.".to_owned())
        })?
        .to_owned();
    Ok(ProcessingScript {
        name,
        source: fs::read_to_string(path).map_err(AppError::io)?,
        updated_at: metadata
            .modified()
            .map(DateTime::<Utc>::from)
            .unwrap_or_else(|_| Utc::now()),
    })
}

fn normalize_script_name(name: &str) -> AppResult<String> {
    let mut name = name.trim().to_owned();
    if !name.ends_with(".py") {
        name.push_str(".py");
    }
    let stem = name.trim_end_matches(".py");
    let valid = !stem.is_empty()
        && stem.len() <= 80
        && stem
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'));
    if !valid {
        return Err(AppError::InvalidProcessingScript(
            "Use a script name containing only letters, numbers, underscores, or hyphens."
                .to_owned(),
        ));
    }
    Ok(name)
}

fn processing_directory(case_root: &Path) -> PathBuf {
    case_root.join("tesrig-processing")
}

fn scripts_directory(case_root: &Path) -> PathBuf {
    processing_directory(case_root).join("scripts")
}

fn results_directory(case_root: &Path) -> PathBuf {
    processing_directory(case_root).join("results")
}

fn read_result_path(path: PathBuf) -> AppResult<ProcessingResult> {
    let metadata = fs::metadata(&path).map_err(AppError::io)?;
    if metadata.len() > MAX_RESULT_BYTES {
        return Err(AppError::InvalidProcessingScript(format!(
            "Processing result {} is larger than 32 MiB.",
            path.display()
        )));
    }
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            AppError::InvalidProcessingScript("Result file name is not valid UTF-8.".to_owned())
        })?
        .to_owned();
    let envelope: ProcessingResultEnvelope = serde_json::from_str(
        &fs::read_to_string(&path).map_err(AppError::io)?,
    )
    .map_err(|error| {
        AppError::InvalidProcessingScript(format!(
            "Could not read processing result {file_name}: {error}"
        ))
    })?;
    Ok(ProcessingResult {
        file_name,
        schema_version: envelope.schema_version,
        name: envelope.name,
        kind: envelope.kind,
        updated_at: metadata
            .modified()
            .map(DateTime::<Utc>::from)
            .unwrap_or_else(|_| Utc::now()),
        metadata: envelope.metadata,
        data: envelope.data,
    })
}

fn normalize_result_file_name(file_name: &str) -> AppResult<String> {
    let file_name = file_name.trim();
    let stem = file_name.strip_suffix(".json").unwrap_or(file_name);
    let valid = !stem.is_empty()
        && stem.len() <= 100
        && stem
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'));
    if !valid {
        return Err(AppError::InvalidProcessingScript(
            "Result file names may contain only letters, numbers, underscores, or hyphens."
                .to_owned(),
        ));
    }
    Ok(format!("{stem}.json"))
}

const PYTHON_VALIDATOR: &str = r#"import ast
import json
import sys

source = sys.stdin.read()
try:
    ast.parse(source, filename="<tesrig-processing>", mode="exec")
except SyntaxError as error:
    print(json.dumps({
        "valid": False,
        "diagnostics": [{
            "line": error.lineno or 1,
            "column": error.offset or 1,
            "endLine": getattr(error, "end_lineno", None),
            "endColumn": getattr(error, "end_offset", None),
            "message": error.msg,
            "severity": "error",
        }],
    }))
else:
    print(json.dumps({"valid": True, "diagnostics": []}))
"#;

const PYTHON_RUNNER: &str = r#"import runpy
import sys

script, api_root = sys.argv[1:3]
sys.path.insert(0, api_root)
runpy.run_path(script, run_name="__main__")
"#;

const PYTHON_API: &str = r#"# TesRig's stable, dependency-free OpenFOAM processing API.
from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path
from typing import Any, Iterable

API_VERSION = "1.0"
__all__ = [
    "API_VERSION", "available_fields", "case_directory", "dynamic_pressure",
    "field_statistics", "latest_snapshot", "latest_time", "pressure_coefficient",
    "read_field", "read_internal_field", "sample_every", "time_directories",
    "vector_magnitude", "write_probe", "write_result", "write_table",
]


def case_directory() -> Path:
    """Return the OpenFOAM case directory for the current script run."""
    return Path(os.environ["TESRIG_CASE_DIR"]).resolve()


def time_directories() -> list[tuple[float, Path]]:
    """Return available reconstructed result directories in ascending time order."""
    result = []
    for path in case_directory().iterdir():
        if not path.is_dir():
            continue
        try:
            result.append((float(path.name), path))
        except ValueError:
            pass
    return sorted(result, key=lambda item: item[0])


def latest_time() -> tuple[float, Path]:
    """Return the newest reconstructed OpenFOAM time and its directory."""
    times = time_directories()
    if not times:
        raise RuntimeError("No OpenFOAM result times are available yet.")
    return times[-1]


def available_fields(time: float | None = None) -> list[str]:
    """Return field-file names available at a result time."""
    if time is None:
        _, directory = latest_time()
    else:
        directory = dict(time_directories()).get(float(time))
        if directory is None:
            raise KeyError(f"Result time {time} was not found")
    return sorted(path.name for path in directory.iterdir() if path.is_file() and not path.name.startswith("."))


def read_internal_field(field: str, time: float | None = None, limit: int | None = None) -> list[Any]:
    """Read an ASCII scalar or vector internalField from a result time."""
    if time is None:
        _, directory = latest_time()
    else:
        directory = dict(time_directories()).get(float(time))
        if directory is None:
            raise KeyError(f"Result time {time} was not found")
    text = (directory / field).read_text(encoding="utf-8", errors="strict")
    uniform = re.search(r"internalField\s+uniform\s+([^;]+);", text)
    if uniform:
        return [_parse_value(uniform.group(1))]
    values = []
    in_internal_field = False
    in_values = False
    for line in text.splitlines():
        stripped = line.strip()
        if not in_internal_field:
            in_internal_field = stripped.startswith("internalField nonuniform")
            continue
        if not in_values:
            in_values = stripped == "("
            continue
        if stripped in (")", ");"):
            return values
        if stripped:
            values.append(_parse_value(stripped))
            if limit is not None and len(values) >= limit:
                return values
    raise ValueError(f"Could not read a complete ASCII internalField for {field}")


def read_field(field: str, time: float | None = None, limit: int | None = None) -> list[Any]:
    """Alias for read_internal_field, suitable for most TesRig scripts."""
    return read_internal_field(field, time, limit)


def vector_magnitude(value: Iterable[float]) -> float:
    """Return the Euclidean magnitude of a scalar/vector iterable."""
    return math.sqrt(sum(float(component) ** 2 for component in value))


def field_statistics(values: Iterable[float]) -> dict[str, float]:
    """Return minimum, maximum, and arithmetic mean for scalar values."""
    return _statistics(values)


def sample_every(values: Iterable[Any], step: int, limit: int | None = None) -> list[Any]:
    """Take every Nth value, optionally stopping at a maximum result count."""
    if step < 1:
        raise ValueError("step must be at least 1")
    sampled = []
    for index, value in enumerate(values):
        if index % step == 0:
            sampled.append(value)
            if limit is not None and len(sampled) >= limit:
                break
    return sampled


def dynamic_pressure(speed: float, density: float = 1.225) -> float:
    """Return dynamic pressure in Pa for speed in m/s and density in kg/m^3."""
    return 0.5 * float(density) * float(speed) ** 2


def pressure_coefficient(pressure: float, reference_pressure: float, speed: float, density: float = 1.225) -> float:
    """Return Cp from pressure, reference pressure, speed, and density."""
    q = dynamic_pressure(speed, density)
    if q == 0:
        raise ValueError("speed must be non-zero when calculating pressure coefficient")
    return (float(pressure) - float(reference_pressure)) / q


def latest_snapshot(limit: int = 10000) -> dict[str, Any]:
    """Return sampled U/p data and summary statistics for the newest time."""
    time, _ = latest_time()
    velocity = read_internal_field("U", time, limit)
    pressure = read_internal_field("p", time, limit)
    magnitudes = [vector_magnitude(value) for value in velocity]
    return {
        "time": time,
        "velocity": velocity,
        "pressure": pressure,
        "velocity_magnitude": _statistics(magnitudes),
        "pressure_statistics": _statistics(pressure),
    }


def write_result(name: str, data: Any, *, kind: str = "data", metadata: dict[str, Any] | None = None) -> Path:
    """Write a JSON result that TesRig can load as a future visualization extension."""
    safe_name = _safe_name(name)
    target = Path(__file__).parent / "results" / f"{safe_name}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    envelope = {"schemaVersion": 1, "name": name, "kind": kind, "metadata": metadata or {}, "data": data}
    temporary = target.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(envelope, indent=2), encoding="utf-8")
    temporary.replace(target)
    return target


def write_probe(name: str, points: Iterable[Iterable[float]], values: Iterable[Any], *, units: str = "", metadata: dict[str, Any] | None = None) -> Path:
    """Write point/vector probe data using TesRig's versioned result envelope."""
    payload = {"points": list(points), "values": list(values), "units": units}
    return write_result(name, payload, kind="probe", metadata=metadata)


def write_table(name: str, columns: dict[str, Iterable[Any]], *, units: dict[str, str] | None = None, metadata: dict[str, Any] | None = None) -> Path:
    """Write equal-length named columns as a versioned TesRig table result."""
    materialized = {column: list(values) for column, values in columns.items()}
    lengths = {len(values) for values in materialized.values()}
    if len(lengths) > 1:
        raise ValueError("All table columns must contain the same number of values")
    payload = {"columns": materialized, "units": units or {}, "rowCount": next(iter(lengths), 0)}
    return write_result(name, payload, kind="table", metadata=metadata)


def _parse_value(value: str) -> Any:
    value = value.strip().strip("()")
    numbers = [float(item) for item in value.split()]
    return numbers if len(numbers) > 1 else numbers[0]


def _statistics(values: Iterable[float]) -> dict[str, float]:
    values = [float(value) for value in values]
    if not values:
        return {"minimum": 0.0, "maximum": 0.0, "mean": 0.0}
    return {"minimum": min(values), "maximum": max(values), "mean": sum(values) / len(values)}


def _safe_name(name: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_")
    if not safe:
        raise ValueError("Result name must contain a letter or number")
    return safe
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_lists_and_rejects_unsafe_script_names() {
        let directory = tempfile::tempdir().unwrap();
        let saved = save_script(directory.path(), "surface_pressure", "print('ok')\n").unwrap();
        assert_eq!(saved.name, "surface_pressure.py");
        assert_eq!(list_scripts(directory.path()).unwrap().len(), 1);
        assert!(save_script(directory.path(), "../escape", "").is_err());
        assert!(directory
            .path()
            .join("tesrig-processing/tesrig_api.py")
            .is_file());
    }

    #[test]
    fn python_api_reads_fields_and_writes_versioned_results_when_python_is_available() {
        let directory = tempfile::tempdir().unwrap();
        let time = directory.path().join("1");
        fs::create_dir(&time).unwrap();
        fs::write(
            time.join("U"),
            "internalField nonuniform List<vector>\n2\n(\n(3 4 0)\n(0 0 2)\n)\n;\n",
        )
        .unwrap();
        fs::write(
            time.join("p"),
            "internalField nonuniform List<scalar>\n2\n(\n10\n20\n)\n;\n",
        )
        .unwrap();
        save_script(
            directory.path(),
            "api_smoke",
            "from tesrig_api import latest_snapshot, write_result\ns = latest_snapshot()\nwrite_result('smoke', s)\nprint(s['time'])\n",
        )
        .unwrap();

        let result = match run_script(directory.path(), "api_smoke.py") {
            Ok(result) => result,
            Err(AppError::InvalidProcessingScript(message))
                if message.contains("Python 3 could not be started") =>
            {
                return;
            }
            Err(error) => panic!("processing script failed to launch: {error}"),
        };

        assert!(result.success, "{}", result.stderr);
        assert!(result.stdout.contains('1'));
        let output = directory
            .path()
            .join("tesrig-processing/results/smoke.json");
        let json: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
        assert_eq!(json["schemaVersion"], 1);
        assert_eq!(json["kind"], "data");
    }

    #[test]
    fn validates_python_syntax_when_python_is_available() {
        let valid = match validate_script("value = 1\n") {
            Ok(result) => result,
            Err(AppError::InvalidProcessingScript(message))
                if message.contains("Python 3 could not be started") =>
            {
                return;
            }
            Err(error) => panic!("syntax validator failed to launch: {error}"),
        };
        assert!(valid.valid);
        assert!(valid.diagnostics.is_empty());

        let invalid = validate_script("if True print('broken')\n").unwrap();
        assert!(!invalid.valid);
        assert_eq!(invalid.diagnostics[0].line, 1);
        assert!(!invalid.diagnostics[0].message.is_empty());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn bundled_python_extracts_and_validates_without_system_python() {
        let data_directory = tempfile::tempdir().unwrap();
        let runtime = PythonRuntime::new(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")),
            data_directory.path().to_path_buf(),
        );
        let interpreter = runtime.ensure_windows_runtime().unwrap();
        assert!(interpreter.is_file());
        assert!(interpreter.starts_with(data_directory.path()));

        let validation = validate_script_with_interpreter(
            "from tesrig_api import write_table\n",
            Some(&interpreter),
        )
        .unwrap();
        assert!(validation.valid);

        let case_root = data_directory.path().join("case");
        fs::create_dir_all(&case_root).unwrap();
        save_script(
            &case_root,
            "bundled_runtime",
            "from tesrig_api import dynamic_pressure, write_table\nwrite_table('runtime', {'q': [dynamic_pressure(10.0)]}, units={'q': 'Pa'})\n",
        )
        .unwrap();
        let run = run_script_with_interpreter(&case_root, "bundled_runtime.py", Some(&interpreter))
            .unwrap();
        assert!(run.success, "{}", run.stderr);
        assert!(case_root
            .join("tesrig-processing/results/runtime.json")
            .is_file());
        let summaries = list_results(&case_root).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].kind, "table");
        let result = read_result(&case_root, "runtime.json").unwrap();
        assert_eq!(result.data["rowCount"], 1);
        assert!(read_result(&case_root, "../runtime.json").is_err());
    }
}
