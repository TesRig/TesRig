mod commands;
mod domain;
mod error;
mod services;
mod solver;
mod storage;

use services::project_service::ProjectService;
use std::sync::Mutex;

pub struct AppState {
    project_service: Mutex<ProjectService>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            project_service: Mutex::new(ProjectService::new()),
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::project::create_project,
            commands::project::open_project,
            commands::project::save_project,
            commands::project::close_project,
            commands::case::create_case,
            commands::case::list_cases,
            commands::case::get_case,
            commands::geometry::import_geometry,
            commands::geometry::get_geometry_data,
            commands::geometry::assign_geometry,
            commands::geometry::remove_geometry,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start TesRig");
}
