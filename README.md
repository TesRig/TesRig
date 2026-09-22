# TesRig

TesRig is a desktop engineering workspace for portable simulation projects. Phase 1 provides a desktop-only Tauri 2 application with a React/TypeScript interface and a Rust-native project core. It creates and opens versioned `.tsrig` ZIP archives and persists CFD/OpenFOAM case metadata without executing a solver. Android and iOS are not application targets.

## Prerequisites

- Node.js 20 or newer
- pnpm 9 (`corepack enable` is the recommended installation method)
- The stable Rust toolchain with `rustfmt` and `clippy`
- [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system

## Development

```sh
pnpm install
pnpm tauri dev
```

The desktop development command starts Vite automatically. To work on the browser presentation layer alone, run `pnpm dev`; native project operations require the Tauri host.

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
- `src-tauri/src/solver` — intentionally empty future solver-adapter boundary
- `docs/architecture.md` — ownership and persistence design

Phase 1 intentionally excludes geometry, meshing, solver execution, analysis, and results visualization.
