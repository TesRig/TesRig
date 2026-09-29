use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SimulationType {
    #[serde(rename = "CFD")]
    Cfd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Solver {
    OpenFOAM,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CaseStatus {
    Draft,
    Ready,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum FlowRegime {
    #[default]
    Steady,
    Transient,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum FlowDomain {
    #[default]
    External,
    Internal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum TurbulenceModel {
    Laminar,
    #[default]
    #[serde(rename = "kOmegaSST")]
    KOmegaSst,
    SpalartAllmaras,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum BoundaryType {
    #[default]
    Wall,
    Inlet,
    Outlet,
    Symmetry,
    Slip,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum ConvergenceTarget {
    #[default]
    Default,
    General,
    Accurate,
    VeryAccurate,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FluidProperties {
    pub density: f64,
    pub kinematic_viscosity: f64,
}

impl Default for FluidProperties {
    fn default() -> Self {
        Self {
            density: 1.225,
            kinematic_viscosity: 1.5e-5,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialConditions {
    pub velocity: [f64; 3],
    pub gauge_pressure: f64,
    pub turbulence_intensity: f64,
    pub turbulent_length_scale: f64,
}

impl Default for InitialConditions {
    fn default() -> Self {
        Self {
            velocity: [10.0, 0.0, 0.0],
            gauge_pressure: 0.0,
            turbulence_intensity: 0.05,
            turbulent_length_scale: 0.1,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshSettings {
    pub base_cell_size: f64,
    pub surface_refinement: u8,
    pub boundary_layers: u8,
    pub feature_angle: f64,
    pub domain_padding: f64,
}

impl Default for MeshSettings {
    fn default() -> Self {
        Self {
            base_cell_size: 0.1,
            surface_refinement: 2,
            boundary_layers: 3,
            feature_angle: 30.0,
            domain_padding: 5.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunControl {
    pub end_time: f64,
    pub time_step: f64,
    pub write_interval: f64,
    pub max_iterations: u32,
    pub processors: u16,
    #[serde(default)]
    pub convergence_target: ConvergenceTarget,
}

impl Default for RunControl {
    fn default() -> Self {
        Self {
            end_time: 1.0,
            time_step: 0.001,
            write_interval: 0.1,
            max_iterations: 1000,
            processors: std::thread::available_parallelism()
                .map(|count| count.get().min(u16::MAX as usize) as u16)
                .unwrap_or(1),
            convergence_target: ConvergenceTarget::Default,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryCondition {
    pub surface: String,
    pub patch_name: String,
    pub boundary_type: BoundaryType,
    pub velocity: [f64; 3],
    pub gauge_pressure: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryBox {
    pub min: [f64; 3],
    pub max: [f64; 3],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CfdSetup {
    #[serde(default)]
    pub flow_domain: FlowDomain,
    pub flow_regime: FlowRegime,
    pub turbulence_model: TurbulenceModel,
    pub fluid: FluidProperties,
    pub initial_conditions: InitialConditions,
    pub mesh: MeshSettings,
    pub run: RunControl,
    #[serde(default)]
    pub boundary_box: Option<BoundaryBox>,
    pub boundaries: Vec<BoundaryCondition>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationCase {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub simulation_type: SimulationType,
    pub solver: Solver,
    pub status: CaseStatus,
    #[serde(default)]
    pub geometry_id: Option<Uuid>,
    #[serde(default)]
    pub variant_of_case_id: Option<Uuid>,
    #[serde(default)]
    pub cfd_setup: CfdSetup,
}

impl SimulationCase {
    pub fn new(
        name: String,
        description: String,
        simulation_type: SimulationType,
        solver: Solver,
        geometry_id: Option<Uuid>,
        variant_of_case_id: Option<Uuid>,
    ) -> Self {
        let now = Utc::now();
        let status = if geometry_id.is_some() {
            CaseStatus::Ready
        } else {
            CaseStatus::Draft
        };
        Self {
            id: Uuid::new_v4(),
            name,
            description,
            created_at: now,
            updated_at: now,
            simulation_type,
            solver,
            status,
            geometry_id,
            variant_of_case_id,
            cfd_setup: CfdSetup::default(),
        }
    }
}
