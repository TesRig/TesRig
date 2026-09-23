# TesRig

TesRig is a desktop engineering workspace for portable simulation projects. It provides a desktop-only Tauri 2 application with a React/TypeScript interface and a Rust-native project core. It creates and opens versioned `.tsrig` ZIP archives, configures CFD cases in the 3D view, and generates OpenFOAM cases for the bundled Windows-native v2606 runtime with Foundation v14 fallback compatibility. Android and iOS are not application targets.

## Prerequisites

- Node.js 20 or newer
- pnpm 9 (`corepack enable` is the recommended installation method)
- The stable Rust toolchain with `rustfmt` and `clippy`
- [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system
- No separate OpenFOAM installation is required on Windows. The packaged v2606 MinGW runtime is
  extracted to local application data on first use. Developers can set
  `TESRIG_OPENFOAM_NATIVE_ROOT` to an existing extracted installation to skip that extraction.
- WSL 2 with OpenFOAM Foundation v14 is retained as a fallback. Use
  `TESRIG_WSL_DISTRIBUTION` and `TESRIG_OPENFOAM_BASHRC` to configure it.

## Development

```sh
pnpm install
pnpm tauri dev
```

The desktop development command starts Vite automatically. To work on the browser presentation layer alone, run `pnpm dev`; native project operations require the Tauri host.

For the local wing smoke-test workspace, place `Wing.step` in `sandbox/assets` and run:

```sh
pnpm dev:test
```

This creates `sandbox/projects/wing.tsrig` when needed, opens it automatically, selects its CFD
case, triangulates the STEP asset, and starts a coarse ten-iteration smoke run. The sandbox remains
outside version control.

## Verification

```sh
pnpm build
pnpm lint
pnpm format:check
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo check --manifest-path src-tauri/Cargo.toml
```

Create an installer with `pnpm tauri build`.

## Repository overview

- `src/app` — application composition and screen routing
- `src/components` — reusable desktop shell, dialogs, and common controls
- `src/features` — typed project/case IPC APIs and feature UI
- `src/stores` — UI session state; native project data remains authoritative
- `src-tauri/src/domain` — versioned project and case models
- `src-tauri/src/services` — archive, workspace, and project operations
- `src-tauri/src/commands` — thin Tauri IPC boundary
- `src-tauri/src/solver` — OpenFOAM adapter, case generator, and runtime discovery
- `src-tauri/resources/openfoam` — bundled Windows-native OpenFOAM v2606 runtime and fallback launchers
- `docs/architecture.md` — ownership and persistence design

The current milestone generates, runs, and exports OpenFOAM cases. Windows simulations run natively,
report stage/time-derived progress, and expose live logs from the status bar. Completed native runs
also generate legacy VTK velocity and pressure output for ParaView. The supplied v2606 MinGW build
is CPU-only; OpenFOAM's GPU architecture is a separate compile-time build and cannot be enabled by a
runtime switch.
