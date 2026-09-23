use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

use super::openfoam::SUPPORTED_OPENFOAM_VERSION;

#[cfg(target_os = "windows")]
use std::ffi::OsString;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(target_os = "windows")]
const NATIVE_VERSION: &str = "v2606";

#[derive(Debug, Clone)]
pub struct RuntimeManager {
    resource_root: PathBuf,
    data_root: PathBuf,
    wsl_distribution: String,
    configured_environment: Option<String>,
    extraction_lock: Arc<Mutex<()>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RuntimeInstallation {
    #[cfg(target_os = "windows")]
    NativeWindows { root: PathBuf, bin: PathBuf },
    Shell {
        environment_script: String,
        version: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub target_version: String,
    pub detected_version: Option<String>,
    pub environment_script: Option<String>,
    pub adapter_packaged: bool,
    pub runtime_ready: bool,
    pub backend: String,
    pub distribution: String,
    pub message: String,
    pub gpu_acceleration: bool,
}

impl RuntimeManager {
    pub fn new(resource_directory: PathBuf, data_directory: PathBuf) -> Self {
        let nested = resource_directory.join("resources").join("openfoam");
        let resource_root = if nested.exists() {
            nested
        } else {
            resource_directory.join("openfoam")
        };
        let wsl_distribution =
            std::env::var("TESRIG_WSL_DISTRIBUTION").unwrap_or_else(|_| "Ubuntu".to_owned());
        let configured_environment = std::env::var("TESRIG_OPENFOAM_BASHRC")
            .ok()
            .filter(|value| !value.trim().is_empty());
        Self {
            resource_root,
            data_root: data_directory,
            wsl_distribution,
            configured_environment,
            extraction_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn status(&self) -> RuntimeStatus {
        let adapter_packaged = self.resource_root.join("runtime-manifest.json").is_file();
        if !adapter_packaged {
            return RuntimeStatus {
                target_version: preferred_version().to_owned(),
                detected_version: None,
                environment_script: None,
                adapter_packaged,
                runtime_ready: false,
                backend: preferred_backend_name().to_owned(),
                distribution: self.wsl_distribution.clone(),
                message: "The packaged OpenFOAM adapter could not be found.".to_owned(),
                gpu_acceleration: false,
            };
        }

        #[cfg(target_os = "windows")]
        {
            match self.native_installation_if_present() {
                Ok(Some(RuntimeInstallation::NativeWindows { root, .. })) => RuntimeStatus {
                    target_version: NATIVE_VERSION.to_owned(),
                    detected_version: Some(NATIVE_VERSION.to_owned()),
                    environment_script: Some(root.to_string_lossy().into_owned()),
                    adapter_packaged,
                    runtime_ready: true,
                    backend: "Bundled Windows runtime".to_owned(),
                    distribution: "Windows native".to_owned(),
                    message: format!(
                        "OpenFOAM {NATIVE_VERSION} is ready from the bundled runtime."
                    ),
                    gpu_acceleration: false,
                },
                Ok(None) if self.native_archive_path().is_file() => RuntimeStatus {
                    target_version: NATIVE_VERSION.to_owned(),
                    detected_version: Some(NATIVE_VERSION.to_owned()),
                    environment_script: None,
                    adapter_packaged,
                    runtime_ready: true,
                    backend: "Bundled Windows runtime".to_owned(),
                    distribution: "Windows native".to_owned(),
                    message: format!(
                        "OpenFOAM {NATIVE_VERSION} is packaged and will be prepared when the first simulation starts."
                    ),
                    gpu_acceleration: false,
                },
                Ok(None) => RuntimeStatus {
                    target_version: NATIVE_VERSION.to_owned(),
                    detected_version: None,
                    environment_script: None,
                    adapter_packaged,
                    runtime_ready: false,
                    backend: "Bundled Windows runtime".to_owned(),
                    distribution: "Windows native".to_owned(),
                    message: format!(
                        "The packaged {NATIVE_VERSION} archive could not be found. WSL fallback will be checked when a simulation starts."
                    ),
                    gpu_acceleration: false,
                },
                Err(message) => RuntimeStatus {
                    target_version: NATIVE_VERSION.to_owned(),
                    detected_version: None,
                    environment_script: None,
                    adapter_packaged,
                    runtime_ready: false,
                    backend: "Bundled Windows runtime".to_owned(),
                    distribution: "Windows native".to_owned(),
                    message,
                    gpu_acceleration: false,
                },
                Ok(Some(RuntimeInstallation::Shell { .. })) => unreachable!(),
            }
        }

        #[cfg(not(target_os = "windows"))]
        match self.probe() {
            Ok(RuntimeInstallation::Shell {
                environment_script,
                version,
            }) => RuntimeStatus {
                target_version: SUPPORTED_OPENFOAM_VERSION.to_owned(),
                detected_version: Some(version.clone()),
                environment_script: Some(environment_script.clone()),
                adapter_packaged,
                runtime_ready: true,
                backend: shell_backend_name(),
                distribution: self.wsl_distribution.clone(),
                message: format!(
                    "OpenFOAM Foundation v{version} is ready from {environment_script}."
                ),
                gpu_acceleration: false,
            },
            Err(message) => RuntimeStatus {
                target_version: preferred_version().to_owned(),
                detected_version: detected_version(&message),
                environment_script: detected_environment(&message),
                adapter_packaged,
                runtime_ready: false,
                backend: preferred_backend_name().to_owned(),
                distribution: self.wsl_distribution.clone(),
                message,
                gpu_acceleration: false,
            },
        }
    }

    pub fn simulation_command(&self, case_directory: &Path) -> AppResult<Command> {
        if !self.resource_root.join("runtime-manifest.json").is_file() {
            return Err(AppError::SolverRuntimeUnavailable(
                "The packaged OpenFOAM adapter could not be found.".to_owned(),
            ));
        }
        let installation = self.probe().map_err(AppError::SolverRuntimeUnavailable)?;

        match installation {
            #[cfg(target_os = "windows")]
            RuntimeInstallation::NativeWindows { root, bin } => {
                let mut command = Command::new("cmd.exe");
                command
                    .args(["/d", "/s", "/c", "Allrun-windows.cmd"])
                    .current_dir(case_directory)
                    .env("WM_PROJECT", "OpenFOAM")
                    .env("WM_PROJECT_VERSION", NATIVE_VERSION)
                    .env("WM_PROJECT_DIR", native_project_dir(&root))
                    .env("FOAM_SIGFPE", "1")
                    .env("PATH", prepend_path(&bin))
                    .creation_flags(CREATE_NO_WINDOW);
                Ok(command)
            }
            RuntimeInstallation::Shell {
                environment_script, ..
            } => {
                #[cfg(target_os = "windows")]
                {
                    let executable = windows_wsl_executable().ok_or_else(|| {
                        AppError::SolverRuntimeUnavailable("WSL 2 is not installed.".to_owned())
                    })?;
                    let case_path = windows_path_to_wsl(case_directory)?;
                    let script = simulation_script(&environment_script, &case_path);
                    let mut command = Command::new(executable);
                    command
                        .args([
                            "--distribution",
                            &self.wsl_distribution,
                            "--exec",
                            "bash",
                            "-lc",
                            &script,
                        ])
                        .creation_flags(CREATE_NO_WINDOW);
                    Ok(command)
                }

                #[cfg(not(target_os = "windows"))]
                {
                    let script =
                        simulation_script(&environment_script, &case_directory.to_string_lossy());
                    let mut command = Command::new("bash");
                    command.args(["-lc", &script]);
                    Ok(command)
                }
            }
        }
    }

    fn probe(&self) -> Result<RuntimeInstallation, String> {
        #[cfg(target_os = "windows")]
        {
            match self.probe_native() {
                Ok(installation) => Ok(installation),
                Err(native_error) => match self.probe_shell() {
                    Ok(installation) => Ok(installation),
                    Err(wsl_error) => Err(format!(
                        "The bundled Windows OpenFOAM runtime is unavailable: {native_error}\n\nWSL fallback is also unavailable: {wsl_error}"
                    )),
                },
            }
        }

        #[cfg(not(target_os = "windows"))]
        self.probe_shell()
    }

    #[cfg(target_os = "windows")]
    fn probe_native(&self) -> Result<RuntimeInstallation, String> {
        let root = self.ensure_native_runtime()?;
        validate_native_root(root)
    }

    #[cfg(target_os = "windows")]
    fn native_installation_if_present(&self) -> Result<Option<RuntimeInstallation>, String> {
        if let Some(configured) = std::env::var_os("TESRIG_OPENFOAM_NATIVE_ROOT") {
            return validate_native_root(PathBuf::from(configured)).map(Some);
        }
        let root = self.data_root.join("openfoam").join(NATIVE_VERSION);
        if native_bin(&root).join("simpleFoam.exe").is_file() {
            validate_native_root(root).map(Some)
        } else {
            Ok(None)
        }
    }

    #[cfg(target_os = "windows")]
    fn native_archive_path(&self) -> PathBuf {
        self.resource_root
            .join("windows-native")
            .join("OpenFOAMv2606.zip")
    }

    #[cfg(target_os = "windows")]
    fn native_runtime_is_ready(&self) -> bool {
        matches!(
            self.native_installation_if_present(),
            Ok(Some(RuntimeInstallation::NativeWindows { .. }))
        )
    }

    fn probe_shell(&self) -> Result<RuntimeInstallation, String> {
        let script = probe_script(self.configured_environment.as_deref());

        #[cfg(target_os = "windows")]
        let output = {
            let executable = windows_wsl_executable().ok_or_else(|| {
                "WSL 2 is not installed or wsl.exe could not be found.".to_owned()
            })?;
            let mut command = Command::new(executable);
            command
                .args([
                    "--distribution",
                    &self.wsl_distribution,
                    "--exec",
                    "bash",
                    "-lc",
                    &script,
                ])
                .creation_flags(CREATE_NO_WINDOW);
            command.output().map_err(|error| {
                format!(
                    "Could not inspect WSL distribution {}: {error}",
                    self.wsl_distribution
                )
            })?
        };

        #[cfg(not(target_os = "windows"))]
        let output = Command::new("bash")
            .args(["-lc", &script])
            .output()
            .map_err(|error| format!("Could not inspect the OpenFOAM runtime: {error}"))?;

        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            return Err(if detail.is_empty() {
                "The OpenFOAM runtime probe failed.".to_owned()
            } else {
                format!("The OpenFOAM runtime probe failed: {detail}")
            });
        }
        parse_probe_output(&String::from_utf8_lossy(&output.stdout))
    }

    #[cfg(target_os = "windows")]
    fn ensure_native_runtime(&self) -> Result<PathBuf, String> {
        if let Some(RuntimeInstallation::NativeWindows { root, .. }) =
            self.native_installation_if_present()?
        {
            return Ok(root);
        }

        let install_parent = self.data_root.join("openfoam");
        let root = install_parent.join(NATIVE_VERSION);
        let _guard = self
            .extraction_lock
            .lock()
            .map_err(|_| "OpenFOAM extraction lock was poisoned.".to_owned())?;
        if let Some(RuntimeInstallation::NativeWindows { root, .. }) =
            self.native_installation_if_present()?
        {
            return Ok(root);
        }

        let archive_path = self.native_archive_path();
        if !archive_path.is_file() {
            return Err(format!(
                "The packaged {NATIVE_VERSION} archive was not found at {}.",
                archive_path.to_string_lossy()
            ));
        }
        if root.exists() {
            fs::remove_dir_all(&root).map_err(|error| {
                format!(
                    "Could not replace an incomplete OpenFOAM runtime at {}: {error}",
                    root.to_string_lossy()
                )
            })?;
        }
        fs::create_dir_all(&install_parent).map_err(|error| {
            format!(
                "Could not create the OpenFOAM runtime directory {}: {error}",
                install_parent.to_string_lossy()
            )
        })?;
        extract_zip(&archive_path, &install_parent)?;
        if native_bin(&root).join("simpleFoam.exe").is_file() {
            Ok(root)
        } else {
            Err(format!(
                "The packaged archive did not contain the expected {NATIVE_VERSION} runtime."
            ))
        }
    }

    pub fn shutdown_after_task(&self) -> AppResult<()> {
        #[cfg(target_os = "windows")]
        {
            if self.native_runtime_is_ready() {
                return Ok(());
            }
            let executable = windows_wsl_executable().ok_or_else(|| {
                AppError::SolverRuntimeUnavailable("WSL 2 is not installed.".to_owned())
            })?;
            let status = Command::new(executable)
                .args(["--terminate", &self.wsl_distribution])
                .creation_flags(CREATE_NO_WINDOW)
                .status()
                .map_err(AppError::io)?;
            if !status.success() {
                return Err(AppError::SolverRuntimeUnavailable(format!(
                    "WSL distribution {} could not be terminated.",
                    self.wsl_distribution
                )));
            }
        }
        Ok(())
    }

    pub fn cancel_process(&self, process_id: u32) -> AppResult<()> {
        #[cfg(target_os = "windows")]
        {
            if self.native_runtime_is_ready() {
                let status = Command::new("taskkill.exe")
                    .args(["/PID", &process_id.to_string(), "/T", "/F"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .status()
                    .map_err(AppError::io)?;
                if !status.success() {
                    return Err(AppError::SolverRuntimeUnavailable(
                        "The native OpenFOAM process could not be stopped.".to_owned(),
                    ));
                }
                return Ok(());
            }
        }
        self.shutdown_after_task()
    }
}

#[cfg(target_os = "windows")]
fn validate_native_root(root: PathBuf) -> Result<RuntimeInstallation, String> {
    let bin = native_bin(&root);
    for executable in [
        "blockMesh.exe",
        "snappyHexMesh.exe",
        "checkMesh.exe",
        "simpleFoam.exe",
        "pimpleFoam.exe",
        "foamToVTK.exe",
    ] {
        if !bin.join(executable).is_file() {
            return Err(format!(
                "{executable} was not found in {}.",
                bin.to_string_lossy()
            ));
        }
    }
    Ok(RuntimeInstallation::NativeWindows { root, bin })
}

fn preferred_version() -> &'static str {
    if cfg!(target_os = "windows") {
        "v2606"
    } else {
        SUPPORTED_OPENFOAM_VERSION
    }
}

fn preferred_backend_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "Bundled Windows runtime"
    } else {
        "Managed native Linux runtime"
    }
}

#[cfg(not(target_os = "windows"))]
fn shell_backend_name() -> String {
    if cfg!(target_os = "windows") {
        "WSL 2 fallback runtime".to_owned()
    } else {
        "Managed native Linux runtime".to_owned()
    }
}

fn probe_script(configured_environment: Option<&str>) -> String {
    let configured = configured_environment
        .map(shell_quote)
        .unwrap_or_else(|| "''".to_owned());
    format!(
        r#"tesrig_configured={configured}
tesrig_selected=''
tesrig_selected_version=''
tesrig_incompatible=''
tesrig_incompatible_version=''
for tesrig_candidate in "$tesrig_configured" /opt/openfoam14/etc/bashrc /opt/OpenFOAM/OpenFOAM-14/etc/bashrc /usr/lib/openfoam/openfoam14/etc/bashrc /opt/OpenFOAM/OpenFOAM-*/etc/bashrc /usr/lib/openfoam/*/etc/bashrc; do
    [ -n "$tesrig_candidate" ] || continue
    [ -r "$tesrig_candidate" ] || continue
    if tesrig_metadata="$(bash -c '. "$1" >/dev/null 2>&1 || exit 20; printf "%s\t%s" "${{WM_PROJECT:-}}" "${{WM_PROJECT_VERSION:-}}"; command -v foamRun >/dev/null && command -v blockMesh >/dev/null && command -v snappyHexMesh >/dev/null && command -v checkMesh >/dev/null' _ "$tesrig_candidate")"; then
        tesrig_project="${{tesrig_metadata%%	*}}"
        tesrig_version="${{tesrig_metadata#*	}}"
        if [ "$tesrig_project" = OpenFOAM ] && [ "$tesrig_version" = {version} ]; then
            tesrig_selected="$tesrig_candidate"
            tesrig_selected_version="$tesrig_version"
            break
        fi
    else
        tesrig_project="${{tesrig_metadata%%	*}}"
        tesrig_version="${{tesrig_metadata#*	}}"
    fi
    if [ -z "$tesrig_incompatible" ] && [ -n "$tesrig_version" ]; then
        tesrig_incompatible="$tesrig_candidate"
        tesrig_incompatible_version="$tesrig_version"
    fi
done
if [ -n "$tesrig_selected" ]; then
    printf 'TESRIG_RUNTIME_READY\t%s\t%s\n' "$tesrig_selected" "$tesrig_selected_version"
elif [ -n "$tesrig_incompatible" ]; then
    printf 'TESRIG_RUNTIME_INCOMPATIBLE\t%s\t%s\n' "$tesrig_incompatible" "$tesrig_incompatible_version"
else
    printf 'TESRIG_RUNTIME_MISSING\n'
fi"#,
        version = SUPPORTED_OPENFOAM_VERSION
    )
}

fn parse_probe_output(output: &str) -> Result<RuntimeInstallation, String> {
    for line in output.lines().rev() {
        let fields = line.split('\t').collect::<Vec<_>>();
        match fields.as_slice() {
            ["TESRIG_RUNTIME_READY", path, version] => {
                return Ok(RuntimeInstallation::Shell {
                    environment_script: (*path).to_owned(),
                    version: (*version).to_owned(),
                });
            }
            ["TESRIG_RUNTIME_INCOMPATIBLE", path, version] => {
                return Err(format!(
                    "OpenFOAM {version} was found at {path}, but the fallback requires OpenFOAM Foundation v{SUPPORTED_OPENFOAM_VERSION}. Install openfoam{SUPPORTED_OPENFOAM_VERSION} or set TESRIG_OPENFOAM_BASHRC to a compatible environment script. [detected={version}; environment={path}]"
                ));
            }
            ["TESRIG_RUNTIME_MISSING"] => {
                return Err(format!(
                    "OpenFOAM Foundation v{SUPPORTED_OPENFOAM_VERSION} was not found. Install openfoam{SUPPORTED_OPENFOAM_VERSION} or set TESRIG_OPENFOAM_BASHRC to its etc/bashrc file."
                ));
            }
            _ => {}
        }
    }
    Err("The OpenFOAM runtime probe returned an unrecognized response.".to_owned())
}

#[cfg(any(not(target_os = "windows"), test))]
fn detected_version(message: &str) -> Option<String> {
    tagged_value(message, "detected=")
}

#[cfg(not(target_os = "windows"))]
fn detected_environment(message: &str) -> Option<String> {
    tagged_value(message, "environment=")
}

#[cfg(any(not(target_os = "windows"), test))]
fn tagged_value(message: &str, tag: &str) -> Option<String> {
    let value = message.split(tag).nth(1)?.split([';', ']']).next()?.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

fn simulation_script(environment_script: &str, case_directory: &str) -> String {
    format!(
        "set -e; echo 'TESRIG_STAGE: runtime setup'; . {}; cd {}; sh Allmesh; sh Allrun",
        shell_quote(environment_script),
        shell_quote(case_directory)
    )
}

#[cfg(target_os = "windows")]
fn native_project_dir(root: &Path) -> PathBuf {
    root.join("msys64")
        .join("home")
        .join("ofuser")
        .join("OpenFOAM")
        .join("OpenFOAM-v2606")
}

#[cfg(target_os = "windows")]
fn native_bin(root: &Path) -> PathBuf {
    native_project_dir(root)
        .join("platforms")
        .join("win64MingwDPInt32Opt")
        .join("bin")
}

#[cfg(target_os = "windows")]
fn prepend_path(bin: &Path) -> OsString {
    let mut paths = vec![bin.to_path_buf()];
    if let Some(current) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&current));
    }
    std::env::join_paths(paths).unwrap_or_else(|_| bin.as_os_str().to_owned())
}

#[cfg(target_os = "windows")]
fn extract_zip(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let archive_file = fs::File::open(archive_path)
        .map_err(|error| format!("Could not open the bundled OpenFOAM archive: {error}"))?;
    let mut archive = zip::ZipArchive::new(archive_file)
        .map_err(|error| format!("The bundled OpenFOAM archive is invalid: {error}"))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Could not read the OpenFOAM archive: {error}"))?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| "The OpenFOAM archive contains an unsafe path.".to_owned())?;
        let target = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&target)
                .map_err(|error| format!("Could not create {}: {error}", target.display()))?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
        }
        let mut output = fs::File::create(&target)
            .map_err(|error| format!("Could not create {}: {error}", target.display()))?;
        io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Could not extract {}: {error}", target.display()))?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_wsl_executable() -> Option<PathBuf> {
    let system_root = std::env::var_os("SystemRoot")?;
    let executable = PathBuf::from(system_root).join("System32").join("wsl.exe");
    executable.is_file().then_some(executable)
}

#[cfg(target_os = "windows")]
fn windows_path_to_wsl(path: &Path) -> AppResult<String> {
    let value = path.to_string_lossy().replace('\\', "/");
    let bytes = value.as_bytes();
    if bytes.len() < 3 || bytes[1] != b':' || bytes[2] != b'/' {
        return Err(AppError::SolverRuntimeUnavailable(
            "The case workspace must be on a local Windows drive for WSL execution.".to_owned(),
        ));
    }
    let drive = (bytes[0] as char).to_ascii_lowercase();
    Ok(format!("/mnt/{drive}/{}", &value[3..]))
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_shell_paths() {
        assert_eq!(shell_quote("/mnt/c/a b"), "'/mnt/c/a b'");
        assert_eq!(
            shell_quote("/mnt/c/user's case"),
            "'/mnt/c/user'\\''s case'"
        );
    }

    #[test]
    fn parses_a_compatible_runtime() {
        assert_eq!(
            parse_probe_output("noise\nTESRIG_RUNTIME_READY\t/opt/openfoam14/etc/bashrc\t14\n"),
            Ok(RuntimeInstallation::Shell {
                environment_script: "/opt/openfoam14/etc/bashrc".to_owned(),
                version: "14".to_owned(),
            })
        );
    }

    #[test]
    fn reports_an_incompatible_runtime() {
        let error = parse_probe_output(
            "TESRIG_RUNTIME_INCOMPATIBLE\t/opt/OpenFOAM/OpenFOAM-v2012/etc/bashrc\tv2012\n",
        )
        .unwrap_err();
        assert!(error.contains("OpenFOAM v2012 was found"));
        assert!(error.contains("openfoam14"));
        assert_eq!(detected_version(&error).as_deref(), Some("v2012"));
    }

    #[test]
    fn runtime_setup_does_not_enable_nounset_before_sourcing_openfoam() {
        let script = simulation_script("/opt/openfoam14/etc/bashrc", "/mnt/e/case");
        assert!(script.starts_with("set -e;"));
        assert!(!script.contains("set -eu"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn status_does_not_extract_the_packaged_runtime() {
        let resources = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let openfoam = resources.path().join("resources").join("openfoam");
        fs::create_dir_all(openfoam.join("windows-native")).unwrap();
        fs::write(openfoam.join("runtime-manifest.json"), b"{}").unwrap();
        fs::write(
            openfoam.join("windows-native").join("OpenFOAMv2606.zip"),
            b"packaged",
        )
        .unwrap();

        let manager =
            RuntimeManager::new(resources.path().to_path_buf(), data.path().to_path_buf());
        let status = manager.status();

        assert!(status.runtime_ready);
        assert!(status.message.contains("will be prepared"));
        assert!(!data.path().join("openfoam").exists());
    }
}
