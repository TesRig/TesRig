mod commands;
mod domain;
mod error;
mod services;
mod solver;
mod storage;

use services::project_service::ProjectService;
use solver::runtime::RuntimeManager;
use solver::simulation::SimulationManager;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub struct AppState {
    project_service: Arc<Mutex<ProjectService>>,
    runtime_manager: RuntimeManager,
    simulation_manager: SimulationManager,
}

impl AppState {
    fn new(resource_directory: PathBuf, data_directory: PathBuf) -> Self {
        let runtime_manager = RuntimeManager::new(resource_directory, data_directory);
        #[allow(unused_mut)]
        let mut project_service = ProjectService::new();
        #[cfg(debug_assertions)]
        if let Err(error) = open_or_create_dev_project(&mut project_service) {
            eprintln!("TesRig test project setup failed: {error}");
        }
        Self {
            project_service: Arc::new(Mutex::new(project_service)),
            simulation_manager: SimulationManager::new(runtime_manager.clone()),
            runtime_manager,
        }
    }

    fn ensure_simulation_idle(&self) -> crate::error::AppResult<()> {
        if self.simulation_manager.is_active() {
            Err(crate::error::AppError::SimulationRunning)
        } else {
            Ok(())
        }
    }
}

#[cfg(debug_assertions)]
fn open_or_create_dev_project(service: &mut ProjectService) -> crate::error::AppResult<()> {
    use crate::domain::case::{
        BoundaryBox, BoundaryCondition, BoundaryType, SimulationType, Solver,
    };
    use std::fs;

    let Some(project_value) = std::env::var_os("TESRIG_DEV_PROJECT") else {
        return Ok(());
    };
    let project_path = PathBuf::from(project_value);
    if project_path.is_file() {
        service.open_project(&project_path)?;
        return Ok(());
    }

    let geometry_path = std::env::var_os("TESRIG_DEV_GEOMETRY")
        .map(PathBuf::from)
        .ok_or_else(|| {
            crate::error::AppError::InternalError(
                "TESRIG_DEV_GEOMETRY is required when creating a test project".to_owned(),
            )
        })?;
    if let Some(parent) = project_path.parent() {
        fs::create_dir_all(parent).map_err(crate::error::AppError::io)?;
    }

    let project = service.create_project(
        "Wing OpenFOAM Test",
        "Local development fixture generated from sandbox/assets/Wing.step.",
        &project_path,
    )?;
    let project = service.import_geometry(project.id, None, &geometry_path)?;
    let geometry = project.geometries.first().ok_or_else(|| {
        crate::error::AppError::InternalError("test geometry was not imported".to_owned())
    })?;
    let simulation_case = service.create_case(
        project.id,
        "Fast external flow",
        "Coarse mesh and ten iterations for application smoke tests.",
        SimulationType::Cfd,
        Solver::OpenFOAM,
        Some(geometry.id),
        None,
    )?;
    let mut setup = simulation_case.cfd_setup;
    setup.boundary_box = Some(BoundaryBox {
        min: [-100.0, -50.0, -50.0],
        max: [150.0, 100.0, 50.0],
    });
    setup.mesh.base_cell_size = 25.0;
    setup.mesh.surface_refinement = 1;
    setup.mesh.boundary_layers = 0;
    setup.run.max_iterations = 10;
    setup.run.write_interval = 10.0;
    setup.boundaries = vec![
        BoundaryCondition {
            surface: "domain:xMin".to_owned(),
            patch_name: "inlet".to_owned(),
            boundary_type: BoundaryType::Inlet,
            velocity: [10.0, 0.0, 0.0],
            gauge_pressure: 0.0,
        },
        BoundaryCondition {
            surface: "domain:xMax".to_owned(),
            patch_name: "outlet".to_owned(),
            boundary_type: BoundaryType::Outlet,
            velocity: [0.0, 0.0, 0.0],
            gauge_pressure: 0.0,
        },
    ];
    service.update_case_setup(project.id, simulation_case.id, setup)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let resource_directory = app.path().resource_dir()?;
            let data_directory = app.path().app_local_data_dir()?;
            app.manage(AppState::new(resource_directory, data_directory));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::project::create_project,
            commands::project::get_current_project,
            commands::project::open_project,
            commands::project::save_project,
            commands::project::update_project_settings,
            commands::project::close_project,
            commands::case::create_case,
            commands::case::list_cases,
            commands::case::get_case,
            commands::case::update_case_setup,
            commands::case::validate_case,
            commands::case::export_openfoam_case,
            commands::geometry::import_geometry,
            commands::geometry::get_geometry_data,
            commands::geometry::has_geometry_triangulation,
            commands::geometry::save_geometry_triangulation,
            commands::geometry::assign_geometry,
            commands::geometry::remove_geometry,
            commands::solver::get_openfoam_runtime,
            commands::solver::start_simulation,
            commands::solver::get_simulation_status,
            commands::solver::get_simulation_log,
            commands::solver::cancel_simulation,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start TesRig");
}
