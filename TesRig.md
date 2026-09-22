# TesRig

TesRig is a desktop application that allows users to run simulations using OpenFOAM, CalculiX, and other solvers. For the initial implementation, only OpenFOAM will be supported.

TesRig must manage projects containing geometry, simulation cases, boundary conditions, flow or analysis conditions, moving components, solver configuration, analysis tools, results, and visualization.

The application must support:

* Project creation
* Project opening
* Case creation
* Case selection
* Case editing
* Geometry import using OBJ, glTF/GLB, STL, and STEP
* Geometry positioning, mating, and assembly
* Geometry movement and animation, such as rotating propellers
* Boundary-condition generation
* Flow and simulation information panels
* Analyze tab showing solver progress, output, estimates, residuals, and available runtime information
* Results tab with probes, measurements, calculations, and processing tools
* Exporting results to supported formats
* Python interpreter/API or scripting system for custom result processing

## Workflow

The typical workflow is:

1. Create a project with a name and description.
2. Create one or more cases under the project and select the simulation type and solver.
3. Import geometry and other required files.
4. Position and mate geometry to assemble the simulation environment.
5. Configure boundary conditions and solver-specific simulation parameters.
6. Run the selected solver.
7. Monitor simulation progress and available intermediate results.
8. View completed results and add probes, measurements, calculations, or custom processing functions.
9. Export results in the required format.

## Frontend Design

TesRig must use Tauri 2.0 with React, TypeScript, and appropriate supporting libraries.

The React frontend should handle:

* UI and navigation
* Project and case interaction
* Geometry visualization and interaction
* Simulation configuration
* Results visualization
* User-facing application state

The frontend must communicate with the native Tauri application core through Tauri commands, channels, and events as appropriate.

The UI must be modern, minimal, and designed primarily around a dark monochrome theme. Additional colors may be used for errors, warnings, status indicators, simulation results, plots, and similar purposes.

TesRig must include a 3D workspace where users can orbit, pan, zoom, select, position, rotate, mate, and configure imported geometry. TesRig is not intended to be a CAD geometry editor.

Material configuration is not required at the current stage.

Where supported by the solver, TesRig should show simulation progress and intermediate results while a simulation is running. Any incomplete results must be clearly identified as intermediate or unfinished.

## Application Architecture

TesRig should function as a complete desktop application rather than relying on separate backend services.

The architecture should be:

```text
React Frontend
      ↓
Tauri IPC
      ↓
TesRig Native Application Core
      ↓
Simulation Solver
```

The native TesRig application core should preferably use Rust and be responsible for:

* Project file operations
* File and workspace management
* Simulation job management
* Solver execution
* Solver configuration generation
* Process monitoring
* Progress and output parsing
* Error handling
* Result discovery and indexing
* Platform-specific integration

The frontend must remain solver-independent. It should request operations such as:

```text
startSimulation
cancelSimulation
validateCase
getSimulationStatus
getResults
```

rather than directly executing OpenFOAM or other solver commands.

Solver-specific implementation should remain internally modular, for example:

```text
TesRig Core
├── OpenFOAM
├── CalculiX
└── Future Solvers
```

These are internal application modules, not separate backend services.

The architecture must allow additional solvers to be added later without requiring major changes to the frontend.

For now, only OpenFOAM needs to be implemented.

## OpenFOAM Integration

TesRig should interact directly with the latest stable supported OpenFOAM release through the native application core.

The OpenFOAM integration should eventually handle:

* Runtime discovery
* Version detection
* Case generation
* OpenFOAM dictionaries
* Geometry preparation
* Meshing
* Solver execution
* Parallel execution
* Progress and residual parsing
* Errors and warnings
* Restarting simulations
* Result discovery
* ParaView-compatible output

GPU or other hardware acceleration should be used where supported, but TesRig must not assume that GPU acceleration is always available.

OpenFOAM execution must remain isolated from the React frontend.

## Project Files

TesRig projects must use the extension:

```text
*.tsrig
```

A `.tsrig` file should be a ZIP-based project archive containing everything needed to move or share the project.

It should include:

1. Project configuration
2. Cases and case-specific configurations
3. Input geometry and other required files
4. Solver configuration and generated data
5. Simulation results
6. Workflows, pipelines, and processing definitions
7. User scripts and reusable processing tools

A project may use an extracted temporary working directory while it is open, but the `.tsrig` file should remain the portable representation of the project.

The application owns the TesRig project model, while native file operations such as reading, writing, extraction, compression, and large-file handling should be performed by the Tauri application core.

The project format must be versioned so future format migrations can be handled safely.

## Implementation Priority

1. Set up the Tauri repository and application architecture.
2. Build the frontend and support project and case creation.
3. Add geometry import, visualization, positioning, and mating.
4. Add boundary-condition and simulation configuration.
5. Integrate OpenFOAM and export results in ParaView-compatible formats.
6. Add native result visualization and basic probes.
7. Add Python scripting and result-processing APIs.
8. Add advanced features such as live solver previews, improved error handling, additional solvers, remote execution, and MCP integration.
