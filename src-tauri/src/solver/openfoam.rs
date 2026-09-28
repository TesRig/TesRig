use crate::domain::case::{BoundaryType, CfdSetup, FlowRegime, SimulationCase, TurbulenceModel};
use crate::domain::geometry::GeometryAsset;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

pub const SUPPORTED_OPENFOAM_VERSION: &str = "14";
const MAX_BACKGROUND_CELLS: u64 = 500_000;
const MAX_BACKGROUND_AXIS_CELLS: u32 = 500;
const MAX_STORED_WRITE_TIMES: u32 = 10;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseValidation {
    pub valid: bool,
    pub warnings: Vec<String>,
    pub generated_path: String,
}

pub struct OpenFoamAdapter;

impl OpenFoamAdapter {
    pub fn validate(setup: &CfdSetup) -> AppResult<()> {
        let finite_positive = |value: f64| value.is_finite() && value > 0.0;
        if !finite_positive(setup.fluid.density)
            || !finite_positive(setup.fluid.kinematic_viscosity)
            || !finite_positive(setup.mesh.base_cell_size)
            || !finite_positive(setup.mesh.domain_padding)
            || !finite_positive(setup.initial_conditions.turbulent_length_scale)
            || !finite_positive(setup.run.end_time)
            || !finite_positive(setup.run.time_step)
            || !finite_positive(setup.run.write_interval)
            || setup.run.max_iterations == 0
            || setup.run.processors == 0
        {
            return Err(AppError::InvalidCaseSetup(
                "Physical, mesh, and run values must be finite and greater than zero.".to_owned(),
            ));
        }
        if !setup
            .initial_conditions
            .velocity
            .iter()
            .all(|value| value.is_finite())
            || !setup.initial_conditions.gauge_pressure.is_finite()
        {
            return Err(AppError::InvalidCaseSetup(
                "Initial velocity and pressure must be finite numbers.".to_owned(),
            ));
        }
        if !(0.0..=1.0).contains(&setup.initial_conditions.turbulence_intensity) {
            return Err(AppError::InvalidCaseSetup(
                "Turbulence intensity must be between 0 and 1.".to_owned(),
            ));
        }
        if let Some(domain) = &setup.boundary_box {
            if !domain
                .min
                .iter()
                .chain(domain.max.iter())
                .all(|value| value.is_finite())
                || !(0..3).all(|axis| domain.min[axis] < domain.max[axis])
            {
                return Err(AppError::InvalidCaseSetup(
                    "Boundary box limits must be finite and each minimum must be below its maximum."
                        .to_owned(),
                ));
            }
        }
        let mut patch_names = HashSet::new();
        for boundary in &setup.boundaries {
            if is_domain_surface(&boundary.surface)
                && (setup.boundary_box.is_none()
                    || !domain_face_defaults()
                        .into_iter()
                        .any(|(surface, _, _)| surface == boundary.surface))
            {
                return Err(AppError::InvalidCaseSetup(
                    "Boundary-box conditions require a valid boundary box face.".to_owned(),
                ));
            }
            if boundary.surface.trim().is_empty() || sanitize_word(&boundary.patch_name).is_empty()
            {
                return Err(AppError::InvalidCaseSetup(
                    "Every boundary condition needs a surface and patch name.".to_owned(),
                ));
            }
            if !patch_names.insert(sanitize_word(&boundary.patch_name)) {
                return Err(AppError::InvalidCaseSetup(
                    "Boundary patch names must be unique.".to_owned(),
                ));
            }
            if !boundary.velocity.iter().all(|value| value.is_finite())
                || !boundary.gauge_pressure.is_finite()
            {
                return Err(AppError::InvalidCaseSetup(
                    "Boundary values must be finite numbers.".to_owned(),
                ));
            }
        }
        for (surface, default_name, _) in domain_face_defaults() {
            if setup
                .boundaries
                .iter()
                .any(|boundary| boundary.surface == surface)
            {
                continue;
            }
            if !patch_names.insert(default_name.to_owned()) {
                return Err(AppError::InvalidCaseSetup(
                    "Boundary patch names must be unique.".to_owned(),
                ));
            }
        }
        Ok(())
    }

    pub fn generate(
        workspace: &Path,
        simulation_case: &SimulationCase,
        geometry: Option<&GeometryAsset>,
    ) -> AppResult<CaseValidation> {
        Self::validate(&simulation_case.cfd_setup)?;
        let root = workspace
            .join("cases")
            .join(simulation_case.id.to_string())
            .join("openfoam");
        if root.exists() {
            for relative in ["0", "constant", "system"] {
                let path = root.join(relative);
                if path.exists() {
                    fs::remove_dir_all(path).map_err(AppError::io)?;
                }
            }
            for relative in [
                "Allmesh",
                "Allrun",
                "Allrun-windows.cmd",
                "TesRig.foam",
                "README.txt",
            ] {
                let path = root.join(relative);
                if path.exists() {
                    fs::remove_file(path).map_err(AppError::io)?;
                }
            }
        }
        for directory in ["0", "constant", "constant/triSurface", "system"] {
            fs::create_dir_all(root.join(directory)).map_err(AppError::io)?;
        }

        let geometry_name = if let Some(asset) = geometry {
            let triangulated_source = workspace
                .join("geometries")
                .join(asset.triangulated_file_name());
            let (source, target_name) = if asset.format
                == crate::domain::geometry::GeometryFormat::Step
                && triangulated_source.is_file()
            {
                (triangulated_source, "geometry.stl".to_owned())
            } else {
                (
                    workspace.join("geometries").join(asset.stored_file_name()),
                    format!("geometry.{}", asset.format.extension()),
                )
            };
            fs::copy(source, root.join("constant/triSurface").join(&target_name))
                .map_err(AppError::io)?;
            Some(target_name)
        } else {
            None
        };

        write(
            &root.join("system/controlDict"),
            control_dict(simulation_case),
        )?;
        write(&root.join("system/fvSchemes"), fv_schemes(simulation_case))?;
        write(&root.join("system/fvSolution"), fv_solution())?;
        write(
            &root.join("system/blockMeshDict"),
            block_mesh_dict(&simulation_case.cfd_setup),
        )?;
        write(
            &root.join("system/decomposeParDict"),
            decompose_dict(simulation_case.cfd_setup.run.processors),
        )?;
        if let Some(name) = geometry_name.as_deref() {
            if name.ends_with(".stl") || name.ends_with(".obj") {
                write(
                    &root.join("system/snappyHexMeshDict"),
                    snappy_dict(name, &simulation_case.cfd_setup),
                )?;
                write(
                    &root.join("system/snappyHexMeshDict.v2606"),
                    snappy_dict_v2606(name, &simulation_case.cfd_setup),
                )?;
                write(&root.join("system/meshQualityDict"), mesh_quality_dict())?;
            }
        }
        write(
            &root.join("constant/physicalProperties"),
            physical_properties(&simulation_case.cfd_setup),
        )?;
        write(
            &root.join("constant/momentumTransport"),
            momentum_transport(&simulation_case.cfd_setup),
        )?;
        write(
            &root.join("constant/transportProperties"),
            transport_properties(&simulation_case.cfd_setup),
        )?;
        write(
            &root.join("constant/turbulenceProperties"),
            turbulence_properties(&simulation_case.cfd_setup),
        )?;
        write(
            &root.join("constant/TesRigProperties"),
            tesrig_properties(&simulation_case.cfd_setup),
        )?;
        write(
            &root.join("0/U"),
            velocity_field(&simulation_case.cfd_setup),
        )?;
        write(
            &root.join("0/p"),
            pressure_field(&simulation_case.cfd_setup),
        )?;
        write(&root.join("0/k"), turbulence_k(&simulation_case.cfd_setup))?;
        write(
            &root.join("0/omega"),
            turbulence_omega(&simulation_case.cfd_setup),
        )?;
        write(
            &root.join("0/nut"),
            turbulence_nut(&simulation_case.cfd_setup),
        )?;
        write(
            &root.join("0/nuTilda"),
            turbulence_nu_tilda(&simulation_case.cfd_setup),
        )?;
        write(&root.join("TesRig.foam"), String::new())?;
        write(
            &root.join("Allmesh"),
            "#!/usr/bin/env sh\nset -eu\nprintf 'blockMesh' > tesrig.stage\necho 'TESRIG_STAGE: blockMesh'\nblockMesh\nif [ -f system/snappyHexMeshDict ]; then printf 'snappyHexMesh' > tesrig.stage; echo 'TESRIG_STAGE: snappyHexMesh'; snappyHexMesh -overwrite; fi\nprintf 'checkMesh' > tesrig.stage\necho 'TESRIG_STAGE: checkMesh'\ncheckMesh\n"
                .to_owned(),
        )?;
        write(
            &root.join("Allrun"),
            run_script(simulation_case.cfd_setup.run.processors),
        )?;
        write(
            &root.join("Allrun-windows.cmd"),
            windows_run_script(simulation_case.cfd_setup.flow_regime),
        )?;
        write(
            &root.join("README.txt"),
            "Generated by TesRig for bundled OpenFOAM v2606 on Windows, with OpenFOAM Foundation v14 fallback support.\nRun Allrun-windows.cmd from the v2606 environment, or Allmesh and Allrun on Foundation v14.\nOpen TesRig.foam or the generated VTK directory in ParaView.\n".to_owned(),
        )?;

        let mut warnings = Vec::new();
        if geometry.is_none() {
            warnings.push(
                "No geometry is assigned; only the background domain was generated.".to_owned(),
            );
        } else if geometry_name
            .as_deref()
            .is_some_and(|name| name.ends_with(".step"))
        {
            warnings.push(
                "STEP is preserved in the case, but must be triangulated before snappyHexMesh can run."
                    .to_owned(),
            );
        }
        if simulation_case
            .cfd_setup
            .boundaries
            .iter()
            .all(|boundary| is_domain_surface(&boundary.surface))
        {
            warnings.push(
                "No geometry surfaces have explicit boundary conditions; the geometry defaults to a no-slip wall."
                    .to_owned(),
            );
        }
        if simulation_case.cfd_setup.boundary_box.is_none() {
            warnings.push(
                "Create a boundary box to control the external flow domain and its faces."
                    .to_owned(),
            );
        }
        let mesh_plan = background_mesh_plan(&simulation_case.cfd_setup);
        if mesh_plan.limited {
            let cell_count = mesh_plan
                .cells
                .iter()
                .map(|count| u64::from(*count))
                .product::<u64>();
            warnings.push(format!(
                "The requested base cell size would exceed the safe background-mesh budget. TesRig used about {} m with {} x {} x {} cells ({} total) to prevent a blockMesh memory failure.",
                num(mesh_plan.effective_cell_size),
                mesh_plan.cells[0],
                mesh_plan.cells[1],
                mesh_plan.cells[2],
                cell_count,
            ));
        }
        Ok(CaseValidation {
            valid: true,
            warnings,
            generated_path: format!("cases/{}/openfoam", simulation_case.id),
        })
    }

    pub fn export(case_root: &Path, destination: &Path) -> AppResult<PathBuf> {
        if !case_root.is_dir() {
            return Err(AppError::CaseFilesNotGenerated);
        }
        let target = destination.join("openfoam-case");
        if target.exists() {
            return Err(AppError::ExportAlreadyExists(target.display().to_string()));
        }
        copy_directory(case_root, &target)?;
        Ok(target)
    }

    pub fn clear_results(case_root: &Path) -> AppResult<()> {
        if !case_root.is_dir() {
            return Ok(());
        }
        for entry in fs::read_dir(case_root).map_err(AppError::io)? {
            let entry = entry.map_err(AppError::io)?;
            if !entry.path().is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.parse::<f64>().is_ok() || name.starts_with("processor") {
                fs::remove_dir_all(entry.path()).map_err(AppError::io)?;
            }
        }
        for log in ["log.tesrig.stdout", "log.tesrig.stderr"] {
            let path = case_root.join(log);
            if path.exists() {
                fs::remove_file(path).map_err(AppError::io)?;
            }
        }
        Ok(())
    }
}

fn write(path: &Path, content: String) -> AppResult<()> {
    fs::write(path, content).map_err(AppError::io)
}

fn run_script(processors: u16) -> String {
    if processors > 1 {
        format!(
            "#!/usr/bin/env sh\nset -eu\nprintf 'decomposePar' > tesrig.stage\necho 'TESRIG_STAGE: decomposePar'\ndecomposePar -force\nprintf 'foamRun' > tesrig.stage\necho 'TESRIG_STAGE: foamRun'\nmpirun -np {processors} foamRun -parallel\nprintf 'reconstructPar' > tesrig.stage\necho 'TESRIG_STAGE: reconstructPar'\nreconstructPar\n"
        )
    } else {
        "#!/usr/bin/env sh\nset -eu\nprintf 'foamRun' > tesrig.stage\necho 'TESRIG_STAGE: foamRun'\nfoamRun\n".to_owned()
    }
}

fn windows_run_script(flow_regime: FlowRegime) -> String {
    let solver = if flow_regime == FlowRegime::Steady {
        "simpleFoam"
    } else {
        "pimpleFoam"
    };
    format!(
        "@echo off\r\nsetlocal\r\necho runtime setup>tesrig.stage\r\necho TESRIG_STAGE: runtime setup\r\necho blockMesh>tesrig.stage\r\necho TESRIG_STAGE: blockMesh\r\nblockMesh\r\nif errorlevel 1 exit /b 1\r\nif exist system\\snappyHexMeshDict.v2606 (\r\n  echo snappyHexMesh>tesrig.stage\r\n  echo TESRIG_STAGE: snappyHexMesh\r\n  snappyHexMesh -overwrite -dict system/snappyHexMeshDict.v2606\r\n  if errorlevel 1 exit /b 1\r\n)\r\necho checkMesh>tesrig.stage\r\necho TESRIG_STAGE: checkMesh\r\ncheckMesh\r\nif errorlevel 1 exit /b 1\r\necho {solver}>tesrig.stage\r\necho TESRIG_STAGE: {solver}\r\n{solver}\r\nif errorlevel 1 exit /b 1\r\necho post-processing>tesrig.stage\r\necho TESRIG_STAGE: post-processing\r\nfoamToVTK -latestTime -legacy -ascii -fields \"(U p)\" -overwrite\r\nif errorlevel 1 echo TesRig warning: VTK preview generation failed.\r\nexit /b 0\r\n"
    )
}

fn copy_directory(source: &Path, destination: &Path) -> AppResult<()> {
    fs::create_dir_all(destination).map_err(AppError::io)?;
    for entry in fs::read_dir(source).map_err(AppError::io)? {
        let entry = entry.map_err(AppError::io)?;
        let target = destination.join(entry.file_name());
        if entry.path().is_dir() {
            copy_directory(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target).map_err(AppError::io)?;
        }
    }
    Ok(())
}

fn header(class: &str, location: &str, object: &str) -> String {
    format!(
        "/*--------------------------------*- C++ -*----------------------------------*\\\n| TesRig OpenFOAM case                                                        |\n\\*---------------------------------------------------------------------------*/\nFoamFile\n{{\n    format ascii;\n    class {class};\n    location \"{location}\";\n    object {object};\n}}\n\n"
    )
}

fn control_dict(case: &SimulationCase) -> String {
    let setup = &case.cfd_setup;
    let (end_time, time_step, write_control, write_interval) = match setup.flow_regime {
        FlowRegime::Steady => {
            let requested_interval = setup.run.write_interval.round();
            let recommended_interval =
                (f64::from(setup.run.max_iterations) / f64::from(MAX_STORED_WRITE_TIMES)).ceil();
            (
                setup.run.max_iterations as f64,
                1.0,
                "timeStep",
                if setup.run.write_interval < 1.0 {
                    recommended_interval.max(1.0)
                } else {
                    requested_interval.max(1.0)
                },
            )
        }
        FlowRegime::Transient => (
            setup.run.end_time,
            setup.run.time_step,
            "runTime",
            setup.run.write_interval.max(setup.run.time_step),
        ),
    };
    format!(
        "{}application simpleFoam;\nsolver incompressibleFluid;\nstartFrom startTime;\nstartTime 0;\nstopAt endTime;\nendTime {};\ndeltaT {};\nwriteControl {};\nwriteInterval {};\npurgeWrite {};\nwriteFormat binary;\nwritePrecision 8;\nrunTimeModifiable true;\nfunctions\n{{\n    TesRigVelocityAverage\n    {{\n        type volFieldValue;\n        libs (fieldFunctionObjects);\n        log true;\n        writeControl timeStep;\n        writeInterval 1;\n        writeFields false;\n        regionType all;\n        cellZone all;\n        operation volAverage;\n        fields (U);\n    }}\n}}\n",
        header("dictionary", "system", "controlDict"),
        num(end_time),
        num(time_step),
        write_control,
        num(write_interval),
        MAX_STORED_WRITE_TIMES,
    )
}

fn fv_schemes(case: &SimulationCase) -> String {
    let ddt = if case.cfd_setup.flow_regime == FlowRegime::Steady {
        "steadyState"
    } else {
        "Euler"
    };
    format!(
        "{}ddtSchemes {{ default {ddt}; }}\ngradSchemes {{ default cellLimited Gauss linear 1; }}\ndivSchemes\n{{\n    default none;\n    div(phi,U) bounded Gauss linearUpwind grad(U);\n    div(phi,k) bounded Gauss upwind;\n    div(phi,omega) bounded Gauss upwind;\n    div(phi,nuTilda) bounded Gauss upwind;\n    div((nuEff*dev2(T(grad(U))))) Gauss linear;\n}}\nlaplacianSchemes {{ default Gauss linear limited 0.5; }}\ninterpolationSchemes {{ default linear; }}\nsnGradSchemes {{ default limited 0.5; }}\nwallDist {{ method meshWave; }}\n",
        header("dictionary", "system", "fvSchemes")
    )
}

fn fv_solution() -> String {
    format!(
        "{}solvers\n{{\n    p {{ solver GAMG; tolerance 1e-7; relTol 0.05; smoother GaussSeidel; }}\n    pFinal {{ $p; relTol 0; }}\n    \"(U|k|omega|nut|nuTilda)\" {{ solver smoothSolver; smoother symGaussSeidel; tolerance 1e-8; relTol 0.1; }}\n    \"(U|k|omega|nut|nuTilda)Final\" {{ $U; relTol 0; }}\n}}\nSIMPLE\n{{\n    momentumPredictor yes;\n    nNonOrthogonalCorrectors 1;\n}}\nPIMPLE\n{{\n    momentumPredictor yes;\n    nNonOrthogonalCorrectors 1;\n    nOuterCorrectors 2;\n    nCorrectors 2;\n}}\nrelaxationFactors\n{{\n    fields {{ p 0.3; }}\n    equations {{ U 0.7; \"(k|omega|nuTilda)\" 0.7; }}\n}}\n",
        header("dictionary", "system", "fvSolution")
    )
}

#[derive(Debug, Clone, Copy)]
struct BackgroundMeshPlan {
    cells: [u32; 3],
    effective_cell_size: f64,
    limited: bool,
}

fn background_mesh_plan(setup: &CfdSetup) -> BackgroundMeshPlan {
    let (min, max) = setup
        .boundary_box
        .as_ref()
        .map(|domain| (domain.min, domain.max))
        .unwrap_or_else(|| {
            let padding = setup.mesh.domain_padding;
            ([-padding; 3], [padding; 3])
        });
    let spans = [0, 1, 2].map(|axis| max[axis] - min[axis]);
    let requested_cell_size = setup.mesh.base_cell_size;
    let mut effective_cell_size = spans.iter().fold(requested_cell_size, |size, span| {
        size.max(*span / f64::from(MAX_BACKGROUND_AXIS_CELLS))
    });
    let calculate_cells =
        |cell_size: f64| spans.map(|span| ((span / cell_size).ceil() as u32).max(4));
    let mut cells = calculate_cells(effective_cell_size);

    for _ in 0..64 {
        let cell_count = cells.iter().map(|count| u64::from(*count)).product::<u64>();
        if cell_count <= MAX_BACKGROUND_CELLS {
            break;
        }
        let scale = ((cell_count as f64 / MAX_BACKGROUND_CELLS as f64).cbrt() * 1.001).max(1.01);
        effective_cell_size *= scale;
        cells = calculate_cells(effective_cell_size);
    }

    BackgroundMeshPlan {
        cells,
        effective_cell_size,
        limited: effective_cell_size > requested_cell_size * 1.000001,
    }
}

fn block_mesh_dict(setup: &CfdSetup) -> String {
    let (min, max) = setup
        .boundary_box
        .as_ref()
        .map(|domain| (domain.min, domain.max))
        .unwrap_or_else(|| {
            let padding = setup.mesh.domain_padding;
            ([-padding; 3], [padding; 3])
        });
    let cells = background_mesh_plan(setup).cells;
    let faces = [
        ("domain:xMin", "(0 4 7 3)"),
        ("domain:xMax", "(1 2 6 5)"),
        ("domain:yMin", "(0 1 5 4)"),
        ("domain:yMax", "(3 7 6 2)"),
        ("domain:zMin", "(0 3 2 1)"),
        ("domain:zMax", "(4 5 6 7)"),
    ]
    .iter()
    .map(|(surface, face)| {
        let boundary = setup
            .boundaries
            .iter()
            .find(|boundary| boundary.surface == *surface);
        let patch_name = boundary
            .map(|boundary| sanitize_word(&boundary.patch_name))
            .unwrap_or_else(|| domain_default_name(surface).to_owned());
        let patch_type = boundary
            .map(|boundary| mesh_patch_type(boundary.boundary_type))
            .unwrap_or("patch");
        format!("    {patch_name} {{ type {patch_type}; faces ({face}); }}\n")
    })
    .collect::<String>();
    format!(
        "{}scale 1;\nvertices\n(\n    ({} {} {}) ({} {} {}) ({} {} {}) ({} {} {})\n    ({} {} {}) ({} {} {}) ({} {} {}) ({} {} {})\n);\nblocks (hex (0 1 2 3 4 5 6 7) ({} {} {}) simpleGrading (1 1 1));\nedges ();\nboundary\n(\n{faces});\n",
        header("dictionary", "system", "blockMeshDict"),
        num(min[0]), num(min[1]), num(min[2]),
        num(max[0]), num(min[1]), num(min[2]),
        num(max[0]), num(max[1]), num(min[2]),
        num(min[0]), num(max[1]), num(min[2]),
        num(min[0]), num(min[1]), num(max[2]),
        num(max[0]), num(min[1]), num(max[2]),
        num(max[0]), num(max[1]), num(max[2]),
        num(min[0]), num(max[1]), num(max[2]),
        cells[0], cells[1], cells[2],
    )
}

fn snappy_dict(geometry_name: &str, setup: &CfdSetup) -> String {
    let level = setup.mesh.surface_refinement;
    let layers = setup.mesh.boundary_layers;
    let location = setup
        .boundary_box
        .as_ref()
        .map(|domain| {
            [0, 1, 2].map(|axis| domain.min[axis] + (domain.max[axis] - domain.min[axis]) * 0.9)
        })
        .unwrap_or([setup.mesh.domain_padding * 0.85; 3]);
    let surface_name = setup
        .boundaries
        .iter()
        .find(|boundary| !is_domain_surface(&boundary.surface))
        .map(|boundary| sanitize_word(&boundary.patch_name))
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "geometry".to_owned());
    let geometry_regions = setup
        .boundaries
        .iter()
        .filter(|boundary| !is_domain_surface(&boundary.surface))
        .map(|boundary| {
            format!(
                "        \"{}\" {{ name {}; }}\n",
                boundary.surface.replace('"', ""),
                sanitize_word(&boundary.patch_name)
            )
        })
        .collect::<String>();
    let refinement_regions = setup
        .boundaries
        .iter()
        .filter(|boundary| !is_domain_surface(&boundary.surface))
        .map(|boundary| {
            format!(
                "            \"{}\" {{ level ({level} {level}); patchInfo {{ type {}; }} }}\n",
                boundary.surface.replace('"', ""),
                mesh_patch_type(boundary.boundary_type)
            )
        })
        .collect::<String>();
    let default_patch_type = setup
        .boundaries
        .iter()
        .find(|boundary| !is_domain_surface(&boundary.surface))
        .map(|boundary| mesh_patch_type(boundary.boundary_type))
        .unwrap_or("wall");
    let layer_patches = if setup
        .boundaries
        .iter()
        .all(|boundary| is_domain_surface(&boundary.surface))
    {
        format!("{surface_name} {{ nSurfaceLayers {layers}; }}")
    } else {
        setup
            .boundaries
            .iter()
            .filter(|boundary| !is_domain_surface(&boundary.surface))
            .filter(|boundary| boundary.boundary_type == BoundaryType::Wall)
            .map(|boundary| {
                format!(
                    "{} {{ nSurfaceLayers {layers}; }}",
                    sanitize_word(&boundary.patch_name)
                )
            })
            .collect::<Vec<_>>()
            .join(" ")
    };
    format!(
        "{}castellatedMesh true;\nsnap true;\naddLayers {};\nsingleRegionName true;\ngeometry\n{{\n    {surface_name}\n    {{\n        type triSurface;\n        file \"{geometry_name}\";\n        regions\n        {{\n{geometry_regions}        }}\n    }}\n}}\ncastellatedMeshControls\n{{\n    maxLocalCells 1000000; maxGlobalCells 4000000; minRefinementCells 0; maxLoadUnbalance 0.10; nCellsBetweenLevels 3;\n    features ();\n    refinementSurfaces\n    {{\n        {surface_name}\n        {{\n            level ({level} {level});\n            regions\n            {{\n{refinement_regions}            }}\n            patchInfo {{ type {default_patch_type}; }}\n        }}\n    }}\n    resolveFeatureAngle {};\n    refinementRegions {{}}\n    locationInMesh ({} {} {});\n    allowFreeStandingZoneFaces true;\n}}\nsnapControls {{ nSmoothPatch 3; tolerance 2.0; nSolveIter 30; nRelaxIter 5; }}\naddLayersControls\n{{\n    relativeSizes true;\n    layers {{ {layer_patches} }}\n    expansionRatio 1.2; finalLayerThickness 0.3; minThickness 0.1; nGrow 0; featureAngle 60; nRelaxIter 5; nSmoothSurfaceNormals 1; nSmoothNormals 3; nSmoothThickness 10; maxFaceThicknessRatio 0.5; maxThicknessToMedialRatio 0.3; minMedialAxisAngle 90; nBufferCellsNoExtrude 0; nLayerIter 50;\n}}\nmeshQualityControls {{ #include \"meshQualityDict\" }}\nwriteFlags (scalarLevels layerSets layerFields);\nmergeTolerance 1e-6;\n",
        header("dictionary", "system", "snappyHexMeshDict"),
        if layers > 0 { "true" } else { "false" },
        num(setup.mesh.feature_angle),
        num(location[0]),
        num(location[1]),
        num(location[2]),
    )
}

fn snappy_dict_v2606(geometry_name: &str, setup: &CfdSetup) -> String {
    let surface_name = setup
        .boundaries
        .iter()
        .find(|boundary| !is_domain_surface(&boundary.surface))
        .map(|boundary| sanitize_word(&boundary.patch_name))
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "geometry".to_owned());
    snappy_dict(geometry_name, setup)
        .replace(
            &format!("geometry\n{{\n    {surface_name}\n"),
            &format!("geometry\n{{\n    \"{geometry_name}\"\n"),
        )
        .replace(
            &format!("type triSurface;\n        file \"{geometry_name}\";"),
            &format!("type triSurfaceMesh;\n        name {surface_name};"),
        )
}

fn domain_face_defaults() -> [(&'static str, &'static str, BoundaryType); 6] {
    [
        ("domain:xMin", "xMin", BoundaryType::Inlet),
        ("domain:xMax", "xMax", BoundaryType::Outlet),
        ("domain:yMin", "yMin", BoundaryType::Slip),
        ("domain:yMax", "yMax", BoundaryType::Slip),
        ("domain:zMin", "zMin", BoundaryType::Slip),
        ("domain:zMax", "zMax", BoundaryType::Slip),
    ]
}

fn is_domain_surface(surface: &str) -> bool {
    surface.starts_with("domain:")
}

fn domain_default_name(surface: &str) -> &'static str {
    domain_face_defaults()
        .into_iter()
        .find(|(candidate, _, _)| *candidate == surface)
        .map(|(_, name, _)| name)
        .unwrap_or("domain")
}

fn domain_default_type(setup: &CfdSetup, surface: &str) -> BoundaryType {
    let flow_axis = setup
        .initial_conditions
        .velocity
        .iter()
        .enumerate()
        .max_by(|(_, left), (_, right)| left.abs().total_cmp(&right.abs()))
        .map(|(axis, _)| axis)
        .unwrap_or(0);
    let axis_name = ["x", "y", "z"][flow_axis];
    let positive_flow = setup.initial_conditions.velocity[flow_axis] >= 0.0;
    let inlet = format!(
        "domain:{axis_name}{}",
        if positive_flow { "Min" } else { "Max" }
    );
    let outlet = format!(
        "domain:{axis_name}{}",
        if positive_flow { "Max" } else { "Min" }
    );
    if surface == inlet {
        BoundaryType::Inlet
    } else if surface == outlet {
        BoundaryType::Outlet
    } else {
        BoundaryType::Slip
    }
}

fn mesh_patch_type(boundary_type: BoundaryType) -> &'static str {
    match boundary_type {
        BoundaryType::Wall => "wall",
        BoundaryType::Symmetry => "symmetryPlane",
        BoundaryType::Inlet | BoundaryType::Outlet | BoundaryType::Slip => "patch",
    }
}

fn mesh_quality_dict() -> String {
    format!(
        "{}maxNonOrtho 65;\nmaxBoundarySkewness 20;\nmaxInternalSkewness 4;\nmaxConcave 80;\nminVol 1e-13;\nminTetQuality 1e-15;\nminArea -1;\nminTwist 0.02;\nminDeterminant 0.001;\nminFaceWeight 0.02;\nminVolRatio 0.01;\nminTriangleTwist -1;\nnSmoothScale 4;\nerrorReduction 0.75;\n",
        header("dictionary", "system", "meshQualityDict")
    )
}

fn decompose_dict(processors: u16) -> String {
    format!(
        "{}numberOfSubdomains {processors};\nmethod scotch;\n",
        header("dictionary", "system", "decomposeParDict")
    )
}

fn physical_properties(setup: &CfdSetup) -> String {
    format!(
        "{}viscosityModel constant;\nnu {};\n",
        header("dictionary", "constant", "physicalProperties"),
        num(setup.fluid.kinematic_viscosity)
    )
}

fn transport_properties(setup: &CfdSetup) -> String {
    format!(
        "{}transportModel Newtonian;\nnu [0 2 -1 0 0 0 0] {};\n",
        header("dictionary", "constant", "transportProperties"),
        num(setup.fluid.kinematic_viscosity)
    )
}

fn tesrig_properties(setup: &CfdSetup) -> String {
    format!(
        "{}rho [1 -3 0 0 0 0 0] {};\n",
        header("dictionary", "constant", "TesRigProperties"),
        num(setup.fluid.density)
    )
}

fn momentum_transport(setup: &CfdSetup) -> String {
    match setup.turbulence_model {
        TurbulenceModel::Laminar => format!(
            "{}simulationType laminar;\n",
            header("dictionary", "constant", "momentumTransport")
        ),
        model => format!(
            "{}simulationType RAS;\nRAS\n{{\n    model {};\n    turbulence on;\n    printCoeffs on;\n}}\n",
            header("dictionary", "constant", "momentumTransport"),
            match model {
                TurbulenceModel::KOmegaSst => "kOmegaSST",
                TurbulenceModel::SpalartAllmaras => "SpalartAllmaras",
                TurbulenceModel::Laminar => unreachable!(),
            }
        ),
    }
}

fn turbulence_properties(setup: &CfdSetup) -> String {
    match setup.turbulence_model {
        TurbulenceModel::Laminar => format!(
            "{}simulationType laminar;\n",
            header("dictionary", "constant", "turbulenceProperties")
        ),
        model => format!(
            "{}simulationType RAS;\nRAS\n{{\n    RASModel {};\n    turbulence on;\n    printCoeffs on;\n}}\n",
            header("dictionary", "constant", "turbulenceProperties"),
            match model {
                TurbulenceModel::KOmegaSst => "kOmegaSST",
                TurbulenceModel::SpalartAllmaras => "SpalartAllmaras",
                TurbulenceModel::Laminar => unreachable!(),
            }
        ),
    }
}

fn velocity_field(setup: &CfdSetup) -> String {
    let initial = vector(setup.initial_conditions.velocity);
    let domain_boundaries = domain_field_boundaries(setup, "U");
    let geometry_boundaries = geometry_field_boundaries(setup, "U");
    format!(
        "{}dimensions [0 1 -1 0 0 0 0];\ninternalField uniform {initial};\nboundaryField\n{{\n{domain_boundaries}{geometry_boundaries}}}\n",
        header("volVectorField", "0", "U")
    )
}

fn pressure_field(setup: &CfdSetup) -> String {
    let pressure = num(setup.initial_conditions.gauge_pressure / setup.fluid.density);
    let domain_boundaries = domain_field_boundaries(setup, "p");
    let geometry_boundaries = geometry_field_boundaries(setup, "p");
    format!(
        "{}dimensions [0 2 -2 0 0 0 0];\ninternalField uniform {pressure};\nboundaryField\n{{\n{domain_boundaries}{geometry_boundaries}}}\n",
        header("volScalarField", "0", "p")
    )
}

fn turbulence_k(setup: &CfdSetup) -> String {
    let speed = setup
        .initial_conditions
        .velocity
        .iter()
        .map(|v| v * v)
        .sum::<f64>()
        .sqrt();
    let value = (1.5 * (speed * setup.initial_conditions.turbulence_intensity).powi(2)).max(1e-10);
    scalar_turbulence_field(setup, "k", "[0 2 -2 0 0 0 0]", value)
}

fn turbulence_omega(setup: &CfdSetup) -> String {
    let speed = setup
        .initial_conditions
        .velocity
        .iter()
        .map(|v| v * v)
        .sum::<f64>()
        .sqrt();
    let k = (1.5 * (speed * setup.initial_conditions.turbulence_intensity).powi(2)).max(1e-10);
    let value = (k.sqrt()
        / (0.09_f64.powf(0.25) * setup.initial_conditions.turbulent_length_scale))
        .max(1e-10);
    scalar_turbulence_field(setup, "omega", "[0 0 -1 0 0 0 0]", value)
}

fn turbulence_nut(setup: &CfdSetup) -> String {
    scalar_turbulence_field(setup, "nut", "[0 2 -1 0 0 0 0]", 0.0)
}

fn turbulence_nu_tilda(setup: &CfdSetup) -> String {
    scalar_turbulence_field(
        setup,
        "nuTilda",
        "[0 2 -1 0 0 0 0]",
        setup.fluid.kinematic_viscosity * 3.0,
    )
}

fn scalar_turbulence_field(setup: &CfdSetup, name: &str, dimensions: &str, value: f64) -> String {
    let mut geometry_patches = String::new();
    if setup
        .boundaries
        .iter()
        .all(|boundary| is_domain_surface(&boundary.surface))
    {
        let condition = match name {
            "nut" => "type nutkWallFunction; value uniform 0;".to_owned(),
            "omega" => format!("type omegaWallFunction; value uniform {};", num(value)),
            "k" => format!("type kqRWallFunction; value uniform {};", num(value)),
            "nuTilda" => "type fixedValue; value uniform 0;".to_owned(),
            _ => "type zeroGradient;".to_owned(),
        };
        geometry_patches.push_str(&format!("    geometry {{ {condition} }}\n"));
    }
    for boundary in setup
        .boundaries
        .iter()
        .filter(|boundary| !is_domain_surface(&boundary.surface))
    {
        let patch = sanitize_word(&boundary.patch_name);
        let condition = if boundary.boundary_type == BoundaryType::Wall {
            match name {
                "nut" => "type nutkWallFunction; value uniform 0;".to_owned(),
                "omega" => format!("type omegaWallFunction; value uniform {};", num(value)),
                "k" => format!("type kqRWallFunction; value uniform {};", num(value)),
                _ => "type zeroGradient;".to_owned(),
            }
        } else {
            format!("type fixedValue; value uniform {};", num(value))
        };
        geometry_patches.push_str(&format!("    {patch} {{ {condition} }}\n"));
    }
    let domain_patches = domain_scalar_boundaries(setup, name, value);
    format!(
        "{}dimensions {dimensions};\ninternalField uniform {};\nboundaryField\n{{\n{domain_patches}{geometry_patches}}}\n",
        header("volScalarField", "0", name), num(value)
    )
}

fn geometry_field_boundaries(setup: &CfdSetup, field: &str) -> String {
    let mut output = String::new();
    if setup
        .boundaries
        .iter()
        .all(|boundary| is_domain_surface(&boundary.surface))
    {
        output.push_str(if field == "U" {
            "    geometry { type noSlip; }\n"
        } else {
            "    geometry { type zeroGradient; }\n"
        });
    }
    for boundary in setup
        .boundaries
        .iter()
        .filter(|boundary| !is_domain_surface(&boundary.surface))
    {
        let patch = sanitize_word(&boundary.patch_name);
        let condition = match (field, boundary.boundary_type) {
            ("U", BoundaryType::Wall) => "type noSlip;".to_owned(),
            ("U", BoundaryType::Inlet) => format!(
                "type fixedValue; value uniform {};",
                vector(boundary.velocity)
            ),
            ("U", BoundaryType::Outlet) => "type zeroGradient;".to_owned(),
            ("U", BoundaryType::Symmetry) => "type symmetry;".to_owned(),
            ("U", BoundaryType::Slip) => "type slip;".to_owned(),
            ("p", BoundaryType::Outlet) => format!(
                "type fixedValue; value uniform {};",
                num(boundary.gauge_pressure / setup.fluid.density)
            ),
            ("p", BoundaryType::Symmetry) => "type symmetry;".to_owned(),
            _ => "type zeroGradient;".to_owned(),
        };
        output.push_str(&format!("    {patch} {{ {condition} }}\n"));
    }
    output
}

fn domain_field_boundaries(setup: &CfdSetup, field: &str) -> String {
    domain_face_defaults()
        .into_iter()
        .map(|(surface, default_name, _)| {
            let configured = setup
                .boundaries
                .iter()
                .find(|boundary| boundary.surface == surface);
            let patch = configured
                .map(|boundary| sanitize_word(&boundary.patch_name))
                .unwrap_or_else(|| default_name.to_owned());
            let boundary_type = configured
                .map(|boundary| boundary.boundary_type)
                .unwrap_or_else(|| domain_default_type(setup, surface));
            let velocity = configured
                .map(|boundary| boundary.velocity)
                .unwrap_or(setup.initial_conditions.velocity);
            let gauge_pressure = configured
                .map(|boundary| boundary.gauge_pressure)
                .unwrap_or(setup.initial_conditions.gauge_pressure);
            let condition = match (field, boundary_type) {
                ("U", BoundaryType::Wall) => "type noSlip;".to_owned(),
                ("U", BoundaryType::Inlet) => {
                    format!("type fixedValue; value uniform {};", vector(velocity))
                }
                ("U", BoundaryType::Outlet) => "type zeroGradient;".to_owned(),
                ("U", BoundaryType::Symmetry) => "type symmetry;".to_owned(),
                ("U", BoundaryType::Slip) => "type slip;".to_owned(),
                ("p", BoundaryType::Outlet) => format!(
                    "type fixedValue; value uniform {};",
                    num(gauge_pressure / setup.fluid.density)
                ),
                ("p", BoundaryType::Symmetry) => "type symmetry;".to_owned(),
                _ => "type zeroGradient;".to_owned(),
            };
            format!("    {patch} {{ {condition} }}\n")
        })
        .collect()
}

fn domain_scalar_boundaries(setup: &CfdSetup, field: &str, value: f64) -> String {
    domain_face_defaults()
        .into_iter()
        .map(|(surface, default_name, _)| {
            let configured = setup
                .boundaries
                .iter()
                .find(|boundary| boundary.surface == surface);
            let patch = configured
                .map(|boundary| sanitize_word(&boundary.patch_name))
                .unwrap_or_else(|| default_name.to_owned());
            let boundary_type = configured
                .map(|boundary| boundary.boundary_type)
                .unwrap_or_else(|| domain_default_type(setup, surface));
            let condition = match boundary_type {
                BoundaryType::Wall => match field {
                    "nut" => "type nutkWallFunction; value uniform 0;".to_owned(),
                    "omega" => format!("type omegaWallFunction; value uniform {};", num(value)),
                    "k" => format!("type kqRWallFunction; value uniform {};", num(value)),
                    "nuTilda" => "type fixedValue; value uniform 0;".to_owned(),
                    _ => "type zeroGradient;".to_owned(),
                },
                BoundaryType::Symmetry => "type symmetry;".to_owned(),
                BoundaryType::Inlet => {
                    format!("type fixedValue; value uniform {};", num(value))
                }
                BoundaryType::Outlet | BoundaryType::Slip => "type zeroGradient;".to_owned(),
            };
            format!("    {patch} {{ {condition} }}\n")
        })
        .collect()
}

fn vector(value: [f64; 3]) -> String {
    format!("({} {} {})", num(value[0]), num(value[1]), num(value[2]))
}

fn num(value: f64) -> String {
    if value.abs() >= 1e5 || (value != 0.0 && value.abs() < 1e-4) {
        format!("{value:.8e}")
    } else {
        format!("{value:.8}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_owned()
    }
}

pub fn sanitize_word(value: &str) -> String {
    let mut word = value
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if word.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        word.insert(0, '_');
    }
    word
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_generate_native_and_fallback_dictionaries() {
        let case = SimulationCase::new(
            "Baseline".to_owned(),
            String::new(),
            crate::domain::case::SimulationType::Cfd,
            crate::domain::case::Solver::OpenFOAM,
            None,
            None,
        );
        let workspace = tempfile::tempdir().unwrap();
        let result = OpenFoamAdapter::generate(workspace.path(), &case, None).unwrap();
        assert!(result.valid);
        let root = workspace.path().join(result.generated_path);
        assert!(root.join("TesRig.foam").is_file());
        assert!(fs::read_to_string(root.join("system/controlDict"))
            .unwrap()
            .contains("solver incompressibleFluid"));
        assert!(fs::read_to_string(root.join("system/controlDict"))
            .unwrap()
            .contains("deltaT 1;"));
        let control = fs::read_to_string(root.join("system/controlDict")).unwrap();
        assert!(control.contains("writeControl timeStep;"));
        assert!(control.contains("writeInterval 100;"));
        assert!(control.contains("purgeWrite 10;"));
        assert!(control.contains("type volFieldValue;"));
        assert!(control.contains("operation volAverage;"));
        assert!(control.contains("fields (U);"));
        assert!(fs::read_to_string(root.join("constant/physicalProperties"))
            .unwrap()
            .contains("nu 1.50000000e-5"));
        assert!(
            fs::read_to_string(root.join("constant/transportProperties"))
                .unwrap()
                .contains("transportModel Newtonian")
        );
        assert!(
            fs::read_to_string(root.join("constant/turbulenceProperties"))
                .unwrap()
                .contains("RASModel kOmegaSST")
        );
        assert!(fs::read_to_string(root.join("Allrun-windows.cmd"))
            .unwrap()
            .contains("simpleFoam"));
    }

    #[test]
    fn transient_case_uses_runtime_output_interval() {
        let mut case = SimulationCase::new(
            "Transient".to_owned(),
            String::new(),
            crate::domain::case::SimulationType::Cfd,
            crate::domain::case::Solver::OpenFOAM,
            None,
            None,
        );
        case.cfd_setup.flow_regime = FlowRegime::Transient;

        let control = control_dict(&case);

        assert!(control.contains("writeControl runTime;"));
        assert!(control.contains("writeInterval 0.1;"));
        assert!(control.contains("purgeWrite 10;"));
    }

    #[test]
    fn patch_names_are_openfoam_words() {
        assert_eq!(sanitize_word("Wing Upper 1"), "Wing_Upper_1");
        assert_eq!(sanitize_word("12 inlet"), "_12_inlet");
    }

    #[test]
    fn regeneration_preserves_existing_results() {
        let case = SimulationCase::new(
            "Baseline".to_owned(),
            String::new(),
            crate::domain::case::SimulationType::Cfd,
            crate::domain::case::Solver::OpenFOAM,
            None,
            None,
        );
        let workspace = tempfile::tempdir().unwrap();
        let result = OpenFoamAdapter::generate(workspace.path(), &case, None).unwrap();
        let time_directory = workspace.path().join(&result.generated_path).join("100");
        fs::create_dir_all(&time_directory).unwrap();
        fs::write(time_directory.join("U"), b"result").unwrap();

        OpenFoamAdapter::generate(workspace.path(), &case, None).unwrap();

        assert!(time_directory.join("U").is_file());
    }

    #[test]
    fn parallel_run_script_reconstructs_results() {
        let script = run_script(4);
        assert!(script.contains("mpirun -np 4 foamRun -parallel"));
        assert!(script.contains("reconstructPar"));
    }

    #[test]
    fn boundary_box_drives_background_mesh_and_domain_patches() {
        let mut case = SimulationCase::new(
            "Domain".to_owned(),
            String::new(),
            crate::domain::case::SimulationType::Cfd,
            crate::domain::case::Solver::OpenFOAM,
            None,
            None,
        );
        case.cfd_setup.boundary_box = Some(crate::domain::case::BoundaryBox {
            min: [-2.0, -1.0, 0.0],
            max: [6.0, 3.0, 2.0],
        });
        case.cfd_setup
            .boundaries
            .push(crate::domain::case::BoundaryCondition {
                surface: "domain:yMin".to_owned(),
                patch_name: "symmetry".to_owned(),
                boundary_type: BoundaryType::Symmetry,
                velocity: [10.0, 0.0, 0.0],
                gauge_pressure: 0.0,
            });

        let block_mesh = block_mesh_dict(&case.cfd_setup);
        assert!(block_mesh.contains("(-2 -1 0)"));
        assert!(block_mesh.contains("(6 3 2)"));
        assert!(block_mesh.contains("(80 40 20)"));
        assert!(block_mesh.contains("symmetry { type symmetryPlane;"));

        let velocity = velocity_field(&case.cfd_setup);
        assert!(velocity.contains("xMin { type fixedValue;"));
        assert!(velocity.contains("xMax { type zeroGradient;"));
        assert!(velocity.contains("symmetry { type symmetry;"));

        let snappy = snappy_dict("geometry.stl", &case.cfd_setup);
        assert!(snappy.contains("type triSurface;"));
        assert!(snappy.contains("file \"geometry.stl\";"));
        assert!(!snappy.contains("triSurfaceMesh"));
        assert!(snappy.contains("locationInMesh (5.2 2.6 1.8)"));
        assert!(!snappy.contains("domain:yMin"));
    }

    #[test]
    fn background_mesh_uses_a_total_cell_budget() {
        let mut setup = CfdSetup::default();
        setup.mesh.base_cell_size = 0.1;
        setup.boundary_box = Some(crate::domain::case::BoundaryBox {
            min: [0.0, -32.26976148, -54.93187357],
            max: [80.15027406, 84.10378665, 45.19595878],
        });

        let plan = background_mesh_plan(&setup);
        let cell_count = plan
            .cells
            .iter()
            .map(|count| u64::from(*count))
            .product::<u64>();

        assert!(plan.limited);
        assert!(cell_count <= MAX_BACKGROUND_CELLS);
        assert_ne!(plan.cells, [500, 500, 500]);
        assert!(plan.effective_cell_size > setup.mesh.base_cell_size);
    }
}
