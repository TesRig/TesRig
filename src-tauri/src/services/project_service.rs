use super::archive_service::ArchiveService;
use super::workspace_service::{OpenWorkspace, WorkspaceService};
use crate::domain::case::{CaseStatus, CfdSetup, SimulationCase, SimulationType, Solver};
use crate::domain::geometry::{GeometryAsset, GeometryFormat};
use crate::domain::project::{
    CaseReference, ProjectManifest, ProjectSettings, ProjectSummary, PROJECT_FORMAT_VERSION,
};
use crate::error::{AppError, AppResult};
use crate::solver::openfoam::{CaseValidation, OpenFoamAdapter};
use crate::solver::processing::{
    self, ProcessingResult, ProcessingResultSummary, ProcessingScript, ProcessingScriptRun,
};
use chrono::Utc;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Default)]
pub struct ProjectService {
    workspaces: WorkspaceService,
}

impl ProjectService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn create_project(
        &mut self,
        name: &str,
        description: &str,
        destination: &Path,
    ) -> AppResult<ProjectSummary> {
        let name = validate_name(name, true)?;
        let archive_path = ArchiveService::normalize_destination(destination);
        if archive_path.exists() {
            return Err(AppError::ProjectAlreadyExists(
                archive_path.display().to_string(),
            ));
        }

        let mut workspace = self.workspaces.create_empty(archive_path)?;
        workspace.manifest = ProjectManifest::new(name, description.trim().to_owned());
        ArchiveService::initialize_layout(workspace.root())?;
        persist_workspace(&workspace)?;
        let summary = summarize(&workspace);
        self.workspaces.activate(workspace);
        Ok(summary)
    }

    pub fn open_project(&mut self, archive_path: &Path) -> AppResult<ProjectSummary> {
        if !archive_path.is_file() {
            return Err(AppError::missing(archive_path));
        }

        let mut workspace = self.workspaces.create_empty(archive_path.to_path_buf())?;
        ArchiveService::extract(archive_path, workspace.root())?;
        let (manifest, cases) = load_workspace(workspace.root())?;
        workspace.manifest = manifest;
        workspace.cases = cases;
        generate_solver_files(workspace.root(), &workspace.manifest, &workspace.cases)?;
        let summary = summarize(&workspace);
        self.workspaces.activate(workspace);
        Ok(summary)
    }

    pub fn save_project(&mut self, project_id: Uuid) -> AppResult<ProjectSummary> {
        let workspace = self.workspaces.current()?;
        ensure_project(workspace, project_id)?;
        write_models(workspace.root(), &workspace.manifest, &workspace.cases)?;
        ArchiveService::write(workspace.root(), &workspace.archive_path)?;
        Ok(summarize(workspace))
    }

    pub fn update_project_settings(
        &mut self,
        project_id: Uuid,
        settings: ProjectSettings,
    ) -> AppResult<ProjectSummary> {
        let workspace = self.workspaces.current_mut()?;
        ensure_project(workspace, project_id)?;
        workspace.manifest.settings = settings;
        workspace.manifest.updated_at = Utc::now();
        persist_workspace(workspace)?;
        Ok(summarize(workspace))
    }

    pub fn close_project(&mut self) {
        self.workspaces.close();
    }

    pub fn current_project(&self) -> Option<ProjectSummary> {
        self.workspaces.current().ok().map(summarize)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_case(
        &mut self,
        project_id: Uuid,
        name: &str,
        description: &str,
        simulation_type: SimulationType,
        solver: Solver,
        geometry_id: Option<Uuid>,
        variant_of_case_id: Option<Uuid>,
    ) -> AppResult<SimulationCase> {
        let name = validate_name(name, false)?;
        let workspace = self.workspaces.current_mut()?;
        ensure_project(workspace, project_id)?;

        if let Some(geometry_id) = geometry_id {
            ensure_geometry(workspace, geometry_id)?;
        }
        let inherited_case = if let Some(source_id) = variant_of_case_id {
            Some(
                workspace
                    .cases
                    .iter()
                    .find(|item| item.id == source_id)
                    .ok_or_else(|| AppError::CaseNotFound(source_id.to_string()))?,
            )
        } else {
            None
        };
        let mut simulation_case = SimulationCase::new(
            name,
            description.trim().to_owned(),
            simulation_type,
            solver,
            geometry_id.or_else(|| inherited_case.and_then(|item| item.geometry_id)),
            variant_of_case_id,
        );
        if let Some(source) = inherited_case {
            simulation_case.cfd_setup = source.cfd_setup.clone();
        }
        let mut next_manifest = workspace.manifest.clone();
        let mut next_cases = workspace.cases.clone();
        next_manifest
            .cases
            .push(CaseReference::from(&simulation_case));
        next_manifest.updated_at = Utc::now();
        next_cases.push(simulation_case.clone());

        write_models(workspace.root(), &next_manifest, &next_cases)?;
        generate_solver_files(workspace.root(), &next_manifest, &next_cases)?;
        ArchiveService::write(workspace.root(), &workspace.archive_path)?;
        workspace.manifest = next_manifest;
        workspace.cases = next_cases;
        Ok(simulation_case)
    }

    pub fn list_cases(&self, project_id: Uuid) -> AppResult<Vec<SimulationCase>> {
        let workspace = self.workspaces.current()?;
        ensure_project(workspace, project_id)?;
        Ok(workspace.cases.clone())
    }

    pub fn get_case(&self, project_id: Uuid, case_id: Uuid) -> AppResult<SimulationCase> {
        let workspace = self.workspaces.current()?;
        ensure_project(workspace, project_id)?;
        workspace
            .cases
            .iter()
            .find(|simulation_case| simulation_case.id == case_id)
            .cloned()
            .ok_or_else(|| AppError::CaseNotFound(case_id.to_string()))
    }

    pub fn update_case_setup(
        &mut self,
        project_id: Uuid,
        case_id: Uuid,
        setup: CfdSetup,
    ) -> AppResult<ProjectSummary> {
        OpenFoamAdapter::validate(&setup)?;
        let workspace = self.workspaces.current_mut()?;
        ensure_project(workspace, project_id)?;
        let target_case = workspace
            .cases
            .iter_mut()
            .find(|item| item.id == case_id)
            .ok_or_else(|| AppError::CaseNotFound(case_id.to_string()))?;
        target_case.cfd_setup = setup;
        target_case.status = if target_case.geometry_id.is_some() {
            CaseStatus::Ready
        } else {
            CaseStatus::Draft
        };
        target_case.updated_at = Utc::now();
        workspace.manifest.updated_at = Utc::now();
        persist_workspace(workspace)?;
        Ok(summarize(workspace))
    }

    pub fn validate_case(&self, project_id: Uuid, case_id: Uuid) -> AppResult<CaseValidation> {
        let workspace = self.workspaces.current()?;
        ensure_project(workspace, project_id)?;
        let simulation_case = workspace
            .cases
            .iter()
            .find(|item| item.id == case_id)
            .ok_or_else(|| AppError::CaseNotFound(case_id.to_string()))?;
        let geometry = simulation_case
            .geometry_id
            .map(|id| ensure_geometry(workspace, id))
            .transpose()?;
        OpenFoamAdapter::generate(workspace.root(), simulation_case, geometry)
    }

    pub fn export_openfoam_case(
        &mut self,
        project_id: Uuid,
        case_id: Uuid,
        destination: &Path,
    ) -> AppResult<String> {
        let workspace = self.workspaces.current_mut()?;
        ensure_project(workspace, project_id)?;
        write_models(workspace.root(), &workspace.manifest, &workspace.cases)?;
        ArchiveService::write(workspace.root(), &workspace.archive_path)?;
        let case_root = workspace
            .root()
            .join("cases")
            .join(case_id.to_string())
            .join("openfoam");
        if !workspace.cases.iter().any(|item| item.id == case_id) {
            return Err(AppError::CaseNotFound(case_id.to_string()));
        }
        Ok(OpenFoamAdapter::export(&case_root, destination)?
            .to_string_lossy()
            .into_owned())
    }

    pub fn prepare_simulation(&mut self, project_id: Uuid, case_id: Uuid) -> AppResult<PathBuf> {
        let workspace = self.workspaces.current_mut()?;
        ensure_project(workspace, project_id)?;
        let simulation_case = workspace
            .cases
            .iter()
            .find(|item| item.id == case_id)
            .ok_or_else(|| AppError::CaseNotFound(case_id.to_string()))?;
        let geometry_id = simulation_case.geometry_id.ok_or_else(|| {
            AppError::InvalidCaseSetup(
                "Assign a geometry before starting the simulation.".to_owned(),
            )
        })?;
        let geometry = ensure_geometry(workspace, geometry_id)?;
        if geometry.format == GeometryFormat::Step
            && !workspace
                .root()
                .join("geometries")
                .join(geometry.triangulated_file_name())
                .is_file()
        {
            return Err(AppError::InvalidCaseSetup(
                "TesRig could not find the triangulated mesh for this STEP geometry. Generate the case again to rebuild it."
                    .to_owned(),
            ));
        }
        OpenFoamAdapter::generate(workspace.root(), simulation_case, Some(geometry))?;
        let case_root = workspace
            .root()
            .join("cases")
            .join(case_id.to_string())
            .join("openfoam");
        OpenFoamAdapter::clear_results(&case_root)?;
        persist_workspace(workspace)?;
        Ok(case_root)
    }

    pub fn list_processing_scripts(
        &self,
        project_id: Uuid,
        case_id: Uuid,
    ) -> AppResult<Vec<ProcessingScript>> {
        let workspace = self.workspaces.current()?;
        ensure_project(workspace, project_id)?;
        ensure_case(workspace, case_id)?;
        processing::list_scripts(&openfoam_case_root(workspace.root(), case_id))
    }

    pub fn list_processing_results(
        &self,
        project_id: Uuid,
        case_id: Uuid,
    ) -> AppResult<Vec<ProcessingResultSummary>> {
        let workspace = self.workspaces.current()?;
        ensure_project(workspace, project_id)?;
        ensure_case(workspace, case_id)?;
        processing::list_results(&openfoam_case_root(workspace.root(), case_id))
    }

    pub fn read_processing_result(
        &self,
        project_id: Uuid,
        case_id: Uuid,
        file_name: &str,
    ) -> AppResult<ProcessingResult> {
        let workspace = self.workspaces.current()?;
        ensure_project(workspace, project_id)?;
        ensure_case(workspace, case_id)?;
        processing::read_result(&openfoam_case_root(workspace.root(), case_id), file_name)
    }

    pub fn save_processing_script(
        &mut self,
        project_id: Uuid,
        case_id: Uuid,
        name: &str,
        source: &str,
    ) -> AppResult<ProcessingScript> {
        let workspace = self.workspaces.current_mut()?;
        ensure_project(workspace, project_id)?;
        ensure_case(workspace, case_id)?;
        let script =
            processing::save_script(&openfoam_case_root(workspace.root(), case_id), name, source)?;
        ArchiveService::write(workspace.root(), &workspace.archive_path)?;
        Ok(script)
    }

    pub fn delete_processing_script(
        &mut self,
        project_id: Uuid,
        case_id: Uuid,
        name: &str,
    ) -> AppResult<()> {
        let workspace = self.workspaces.current_mut()?;
        ensure_project(workspace, project_id)?;
        ensure_case(workspace, case_id)?;
        processing::delete_script(&openfoam_case_root(workspace.root(), case_id), name)?;
        ArchiveService::write(workspace.root(), &workspace.archive_path)
    }

    pub fn run_processing_script(
        &mut self,
        project_id: Uuid,
        case_id: Uuid,
        name: &str,
        interpreter: &Path,
    ) -> AppResult<ProcessingScriptRun> {
        let workspace = self.workspaces.current_mut()?;
        ensure_project(workspace, project_id)?;
        ensure_case(workspace, case_id)?;
        let result = processing::run_script_with_interpreter(
            &openfoam_case_root(workspace.root(), case_id),
            name,
            Some(interpreter),
        )?;
        ArchiveService::write(workspace.root(), &workspace.archive_path)?;
        Ok(result)
    }

    pub fn import_geometry(
        &mut self,
        project_id: Uuid,
        case_id: Option<Uuid>,
        source_path: &Path,
    ) -> AppResult<ProjectSummary> {
        let workspace = self.workspaces.current_mut()?;
        ensure_project(workspace, project_id)?;
        if !source_path.is_file() {
            return Err(AppError::missing(source_path));
        }
        let extension = source_path
            .extension()
            .and_then(|value| value.to_str())
            .ok_or(AppError::UnsupportedGeometryFormat)?;
        let format =
            GeometryFormat::from_extension(extension).ok_or(AppError::UnsupportedGeometryFormat)?;
        let file_name = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or(AppError::UnsupportedGeometryFormat)?
            .to_owned();
        let name = source_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("Geometry")
            .to_owned();
        let size_bytes = fs::metadata(source_path).map_err(AppError::io)?.len();
        let asset = GeometryAsset::new(name, file_name, format, size_bytes);

        if let Some(case_id) = case_id {
            let target_case = workspace
                .cases
                .iter_mut()
                .find(|item| item.id == case_id)
                .ok_or_else(|| AppError::CaseNotFound(case_id.to_string()))?;
            target_case.geometry_id = Some(asset.id);
            target_case.status = CaseStatus::Ready;
            target_case.updated_at = Utc::now();
        }

        let geometry_directory = workspace.root().join("geometries");
        fs::create_dir_all(&geometry_directory).map_err(AppError::io)?;
        fs::copy(
            source_path,
            geometry_directory.join(asset.stored_file_name()),
        )
        .map_err(AppError::io)?;
        workspace.manifest.geometries.push(asset);
        workspace.manifest.updated_at = Utc::now();
        persist_workspace(workspace)?;
        Ok(summarize(workspace))
    }

    pub fn assign_geometry(
        &mut self,
        project_id: Uuid,
        case_id: Uuid,
        geometry_id: Uuid,
    ) -> AppResult<ProjectSummary> {
        let workspace = self.workspaces.current_mut()?;
        ensure_project(workspace, project_id)?;
        ensure_geometry(workspace, geometry_id)?;
        let target_case = workspace
            .cases
            .iter_mut()
            .find(|item| item.id == case_id)
            .ok_or_else(|| AppError::CaseNotFound(case_id.to_string()))?;
        target_case.geometry_id = Some(geometry_id);
        target_case.status = CaseStatus::Ready;
        target_case.updated_at = Utc::now();
        workspace.manifest.updated_at = Utc::now();
        persist_workspace(workspace)?;
        Ok(summarize(workspace))
    }

    pub fn remove_geometry(
        &mut self,
        project_id: Uuid,
        geometry_id: Uuid,
    ) -> AppResult<ProjectSummary> {
        let workspace = self.workspaces.current_mut()?;
        ensure_project(workspace, project_id)?;
        let geometry = ensure_geometry(workspace, geometry_id)?.clone();

        for simulation_case in &mut workspace.cases {
            if simulation_case.geometry_id == Some(geometry_id) {
                simulation_case.geometry_id = None;
                simulation_case.status = CaseStatus::Draft;
                simulation_case.updated_at = Utc::now();
            }
        }
        workspace
            .manifest
            .geometries
            .retain(|item| item.id != geometry_id);
        workspace.manifest.updated_at = Utc::now();

        let geometry_path = workspace
            .root()
            .join("geometries")
            .join(geometry.stored_file_name());
        if geometry_path.exists() {
            fs::remove_file(geometry_path).map_err(AppError::io)?;
        }
        let triangulated_path = workspace
            .root()
            .join("geometries")
            .join(geometry.triangulated_file_name());
        if triangulated_path.exists() {
            fs::remove_file(triangulated_path).map_err(AppError::io)?;
        }
        persist_workspace(workspace)?;
        Ok(summarize(workspace))
    }

    pub fn get_geometry_data(&self, project_id: Uuid, geometry_id: Uuid) -> AppResult<Vec<u8>> {
        let workspace = self.workspaces.current()?;
        ensure_project(workspace, project_id)?;
        let geometry = ensure_geometry(workspace, geometry_id)?;
        fs::read(
            workspace
                .root()
                .join("geometries")
                .join(geometry.stored_file_name()),
        )
        .map_err(AppError::io)
    }

    pub fn has_geometry_triangulation(
        &self,
        project_id: Uuid,
        geometry_id: Uuid,
    ) -> AppResult<bool> {
        let workspace = self.workspaces.current()?;
        ensure_project(workspace, project_id)?;
        let geometry = ensure_geometry(workspace, geometry_id)?;
        Ok(geometry.format != GeometryFormat::Step
            || workspace
                .root()
                .join("geometries")
                .join(geometry.triangulated_file_name())
                .is_file())
    }

    pub fn save_geometry_triangulation(
        &mut self,
        project_id: Uuid,
        geometry_id: Uuid,
        bytes: &[u8],
    ) -> AppResult<()> {
        let workspace = self.workspaces.current_mut()?;
        ensure_project(workspace, project_id)?;
        let geometry = ensure_geometry(workspace, geometry_id)?;
        if geometry.format != GeometryFormat::Step || bytes.len() < 84 {
            return Err(AppError::InvalidCaseSetup(
                "The generated STEP triangulation is invalid.".to_owned(),
            ));
        }
        let target = workspace
            .root()
            .join("geometries")
            .join(geometry.triangulated_file_name());
        fs::write(target, bytes).map_err(AppError::io)?;
        ArchiveService::write(workspace.root(), &workspace.archive_path)?;
        Ok(())
    }
}

fn validate_name(value: &str, is_project: bool) -> AppResult<String> {
    let name = value.trim();
    let invalid = name.is_empty()
        || name.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
        })
        || name.ends_with(['.', ' ']);
    if invalid {
        return Err(if is_project {
            AppError::InvalidProjectName
        } else {
            AppError::InvalidCaseName
        });
    }
    Ok(name.to_owned())
}

fn ensure_project(workspace: &OpenWorkspace, project_id: Uuid) -> AppResult<()> {
    if workspace.manifest.id == project_id {
        Ok(())
    } else {
        Err(AppError::ProjectMismatch)
    }
}

fn ensure_case(workspace: &OpenWorkspace, case_id: Uuid) -> AppResult<()> {
    if workspace.cases.iter().any(|item| item.id == case_id) {
        Ok(())
    } else {
        Err(AppError::CaseNotFound(case_id.to_string()))
    }
}

fn openfoam_case_root(root: &Path, case_id: Uuid) -> PathBuf {
    root.join("cases")
        .join(case_id.to_string())
        .join("openfoam")
}

fn ensure_geometry(workspace: &OpenWorkspace, geometry_id: Uuid) -> AppResult<&GeometryAsset> {
    workspace
        .manifest
        .geometries
        .iter()
        .find(|geometry| geometry.id == geometry_id)
        .ok_or_else(|| AppError::GeometryNotFound(geometry_id.to_string()))
}

fn persist_workspace(workspace: &OpenWorkspace) -> AppResult<()> {
    write_models(workspace.root(), &workspace.manifest, &workspace.cases)?;
    generate_solver_files(workspace.root(), &workspace.manifest, &workspace.cases)?;
    ArchiveService::write(workspace.root(), &workspace.archive_path)
}

fn generate_solver_files(
    root: &Path,
    manifest: &ProjectManifest,
    cases: &[SimulationCase],
) -> AppResult<()> {
    for simulation_case in cases {
        let geometry = simulation_case.geometry_id.and_then(|geometry_id| {
            manifest
                .geometries
                .iter()
                .find(|geometry| geometry.id == geometry_id)
        });
        OpenFoamAdapter::generate(root, simulation_case, geometry)?;
    }
    Ok(())
}

fn write_models(
    root: &Path,
    manifest: &ProjectManifest,
    cases: &[SimulationCase],
) -> AppResult<()> {
    ArchiveService::initialize_layout(root)?;
    let manifest_json = serde_json::to_vec_pretty(manifest)
        .map_err(|error| AppError::InternalError(error.to_string()))?;
    fs::write(root.join("project.json"), manifest_json).map_err(AppError::io)?;

    for simulation_case in cases {
        let case_directory = root.join("cases").join(simulation_case.id.to_string());
        fs::create_dir_all(&case_directory).map_err(AppError::io)?;
        let case_json = serde_json::to_vec_pretty(simulation_case)
            .map_err(|error| AppError::InternalError(error.to_string()))?;
        fs::write(case_directory.join("case.json"), case_json).map_err(AppError::io)?;
    }
    Ok(())
}

fn load_workspace(root: &Path) -> AppResult<(ProjectManifest, Vec<SimulationCase>)> {
    let manifest_path = root.join("project.json");
    let bytes = fs::read(&manifest_path).map_err(|_| AppError::InvalidProjectFormat)?;
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| AppError::InvalidProjectFormat)?;
    let version = value
        .get("formatVersion")
        .and_then(Value::as_u64)
        .ok_or(AppError::InvalidProjectFormat)? as u32;
    if version != PROJECT_FORMAT_VERSION {
        return Err(AppError::UnsupportedProjectVersion(version));
    }
    let manifest: ProjectManifest =
        serde_json::from_value(value).map_err(|_| AppError::InvalidProjectFormat)?;

    let mut cases = Vec::with_capacity(manifest.cases.len());
    for reference in &manifest.cases {
        let case_path = root
            .join("cases")
            .join(reference.id.to_string())
            .join("case.json");
        let case_bytes = fs::read(case_path).map_err(|_| AppError::InvalidProjectFormat)?;
        let simulation_case: SimulationCase =
            serde_json::from_slice(&case_bytes).map_err(|_| AppError::InvalidProjectFormat)?;
        if simulation_case.id != reference.id {
            return Err(AppError::InvalidProjectFormat);
        }
        cases.push(simulation_case);
    }
    Ok((manifest, cases))
}

fn summarize(workspace: &OpenWorkspace) -> ProjectSummary {
    ProjectSummary {
        format_version: workspace.manifest.format_version,
        id: workspace.manifest.id,
        name: workspace.manifest.name.clone(),
        description: workspace.manifest.description.clone(),
        created_at: workspace.manifest.created_at,
        updated_at: workspace.manifest.updated_at,
        archive_path: workspace.archive_path.to_string_lossy().into_owned(),
        cases: workspace.cases.clone(),
        geometries: workspace.manifest.geometries.clone(),
        settings: workspace.manifest.settings.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::project::UpAxis;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::{ZipArchive, ZipWriter};

    #[test]
    fn creates_project_archive_with_valid_manifest() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let destination = directory.path().join("AircraftTest");
        let mut service = ProjectService::new();

        let project = service
            .create_project(" Aircraft Test ", "Cruise studies", &destination)
            .expect("project creation");

        assert_ne!(project.id, Uuid::nil());
        assert_eq!(project.format_version, PROJECT_FORMAT_VERSION);
        assert_eq!(project.name, "Aircraft Test");
        let archive_path = directory.path().join("AircraftTest.tsrig");
        assert!(archive_path.is_file());

        let file = fs::File::open(archive_path).expect("archive file");
        let mut archive = ZipArchive::new(file).expect("valid zip");
        let manifest = archive.by_name("project.json").expect("manifest entry");
        let decoded: ProjectManifest = serde_json::from_reader(manifest).expect("valid manifest");
        assert_eq!(decoded.id, project.id);
    }

    #[test]
    fn project_and_case_survive_save_and_open_cycle() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let archive_path = directory.path().join("round-trip.tsrig");
        let mut service = ProjectService::new();
        let project = service
            .create_project("Round Trip", "Persistent metadata", &archive_path)
            .expect("project creation");
        let simulation_case = service
            .create_case(
                project.id,
                "Cruise Condition",
                "Mach 0.2",
                SimulationType::Cfd,
                Solver::OpenFOAM,
                None,
                None,
            )
            .expect("case creation");

        assert_ne!(simulation_case.id, Uuid::nil());
        service
            .update_project_settings(project.id, ProjectSettings { up_axis: UpAxis::Z })
            .expect("project settings update");
        service.close_project();
        let reopened = service
            .open_project(&archive_path)
            .expect("project reopening");

        assert_eq!(reopened.description, "Persistent metadata");
        assert_eq!(reopened.settings.up_axis, UpAxis::Z);
        assert_eq!(reopened.cases, vec![simulation_case.clone()]);
        let file = fs::File::open(&archive_path).expect("archive file");
        let mut archive = ZipArchive::new(file).expect("valid zip");
        let case_entry = format!("cases/{}/case.json", simulation_case.id);
        assert!(archive.by_name(&case_entry).is_ok());
        let control_dict = format!("cases/{}/openfoam/system/controlDict", simulation_case.id);
        assert!(archive.by_name(&control_dict).is_ok());
        let paraview_marker = format!("cases/{}/openfoam/TesRig.foam", simulation_case.id);
        assert!(archive.by_name(&paraview_marker).is_ok());
        let manifest = archive.by_name("project.json").expect("manifest");
        let decoded: ProjectManifest = serde_json::from_reader(manifest).expect("valid manifest");
        assert_eq!(decoded.cases[0].id, simulation_case.id);
    }

    #[test]
    fn rejects_empty_names() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let mut service = ProjectService::new();
        let project_error = service
            .create_project("  ", "", &directory.path().join("empty.tsrig"))
            .expect_err("empty project name must fail");
        assert!(matches!(project_error, AppError::InvalidProjectName));

        let project = service
            .create_project("Valid", "", &directory.path().join("valid.tsrig"))
            .expect("valid project");
        let case_error = service
            .create_case(
                project.id,
                "\t",
                "",
                SimulationType::Cfd,
                Solver::OpenFOAM,
                None,
                None,
            )
            .expect_err("empty case name must fail");
        assert!(matches!(case_error, AppError::InvalidCaseName));
    }

    #[test]
    fn imports_geometry_and_inherits_it_in_a_variant() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let archive_path = directory.path().join("geometry.tsrig");
        let source_path = directory.path().join("wing.obj");
        fs::write(&source_path, b"v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n").expect("geometry fixture");

        let mut service = ProjectService::new();
        let project = service
            .create_project("Geometry", "", &archive_path)
            .expect("project creation");
        let imported = service
            .import_geometry(project.id, None, &source_path)
            .expect("geometry import");
        let geometry = imported.geometries.first().expect("imported geometry");
        assert_eq!(geometry.name, "wing");
        assert_eq!(
            service
                .get_geometry_data(project.id, geometry.id)
                .unwrap()
                .len(),
            32
        );

        let base_case = service
            .create_case(
                project.id,
                "Baseline",
                "",
                SimulationType::Cfd,
                Solver::OpenFOAM,
                Some(geometry.id),
                None,
            )
            .expect("base case");
        let mut inherited_setup = base_case.cfd_setup.clone();
        inherited_setup.fluid.density = 1.18;
        service
            .update_case_setup(project.id, base_case.id, inherited_setup.clone())
            .expect("base setup update");
        let variant = service
            .create_case(
                project.id,
                "Baseline Variant",
                "",
                SimulationType::Cfd,
                Solver::OpenFOAM,
                None,
                Some(base_case.id),
            )
            .expect("variant");
        assert_eq!(variant.geometry_id, Some(geometry.id));
        assert_eq!(variant.variant_of_case_id, Some(base_case.id));
        assert_eq!(variant.cfd_setup, inherited_setup);

        service.close_project();
        let reopened = service
            .open_project(&archive_path)
            .expect("project reopening");
        assert_eq!(reopened.geometries.len(), 1);
        assert_eq!(reopened.cases[1], variant);
        assert_eq!(
            service
                .get_geometry_data(reopened.id, geometry.id)
                .expect("geometry bytes after reopening"),
            b"v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"
        );
    }

    #[test]
    fn removes_geometry_and_unassigns_referencing_cases() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let archive_path = directory.path().join("geometry-removal.tsrig");
        let source_path = directory.path().join("wing.obj");
        fs::write(&source_path, b"v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n").expect("geometry fixture");

        let mut service = ProjectService::new();
        let project = service
            .create_project("Geometry removal", "", &archive_path)
            .expect("project creation");
        let imported = service
            .import_geometry(project.id, None, &source_path)
            .expect("geometry import");
        let geometry = imported.geometries[0].clone();
        service
            .create_case(
                project.id,
                "Baseline",
                "",
                SimulationType::Cfd,
                Solver::OpenFOAM,
                Some(geometry.id),
                None,
            )
            .expect("case creation");

        let updated = service
            .remove_geometry(project.id, geometry.id)
            .expect("geometry removal");
        assert!(updated.geometries.is_empty());
        assert_eq!(updated.cases[0].geometry_id, None);
        assert!(matches!(
            service.get_geometry_data(project.id, geometry.id),
            Err(AppError::GeometryNotFound(_))
        ));
    }

    #[test]
    fn caches_step_triangulation_for_openfoam() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let archive_path = directory.path().join("step-mesh.tsrig");
        let source_path = directory.path().join("wing.step");
        fs::write(&source_path, b"ISO-10303-21;\nEND-ISO-10303-21;").expect("STEP fixture");

        let mut service = ProjectService::new();
        let project = service
            .create_project("STEP mesh", "", &archive_path)
            .expect("project creation");
        let imported = service
            .import_geometry(project.id, None, &source_path)
            .expect("geometry import");
        let geometry = &imported.geometries[0];
        assert!(!service
            .has_geometry_triangulation(project.id, geometry.id)
            .unwrap());

        service
            .save_geometry_triangulation(project.id, geometry.id, &[0; 84])
            .expect("triangulation cache");
        assert!(service
            .has_geometry_triangulation(project.id, geometry.id)
            .unwrap());

        let simulation_case = service
            .create_case(
                project.id,
                "STEP CFD",
                "",
                SimulationType::Cfd,
                Solver::OpenFOAM,
                Some(geometry.id),
                None,
            )
            .expect("case creation");
        let case_root = service
            .prepare_simulation(project.id, simulation_case.id)
            .expect("STEP simulation preparation");
        assert!(case_root.join("constant/triSurface/geometry.stl").is_file());
    }

    #[test]
    fn rejects_corrupt_archive() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let archive_path = directory.path().join("corrupt.tsrig");
        fs::write(&archive_path, b"not a zip archive").expect("write fixture");
        let error = ProjectService::new()
            .open_project(&archive_path)
            .expect_err("corrupt archive must fail");
        assert!(matches!(error, AppError::ArchiveReadFailed(_)));
    }

    #[test]
    fn rejects_unsupported_project_version() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let archive_path = directory.path().join("future.tsrig");
        let file = fs::File::create(&archive_path).expect("fixture archive");
        let mut writer = ZipWriter::new(file);
        writer
            .start_file("project.json", SimpleFileOptions::default())
            .expect("manifest entry");
        writer
            .write_all(br#"{"formatVersion":999}"#)
            .expect("manifest data");
        writer.finish().expect("finish archive");

        let error = ProjectService::new()
            .open_project(&archive_path)
            .expect_err("future version must fail");
        assert!(matches!(error, AppError::UnsupportedProjectVersion(999)));
    }
}
