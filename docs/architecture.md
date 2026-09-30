# TesRig application architecture

```text
React presentation and UI state
              ↓ typed domain requests
          Tauri IPC commands
              ↓
       TesRig native core (Rust)
              ↓
      Solver adapter boundary
              ↓
 Bundled OpenFOAM v2606 runtime
```

## Responsibility boundary

React owns navigation, forms, dialog visibility, loading/error presentation, selection in the 3D
view, and the selected case ID. It holds a normalized snapshot returned by the native core so the
current workspace can be rendered, but it does not serialize or edit archive contents or OpenFOAM
dictionaries. Raw `invoke` calls are confined to `src/lib/tauri`; feature API modules expose typed
domain operations.

Rust owns validation, identifiers, timestamps, filesystem access, temporary workspaces, ZIP
extraction/compression, manifests, case persistence, solver configuration generation, runtime
discovery, and exports. Tauri commands contain no archive logic: they deserialize a domain request
and delegate it to `ProjectService` or a solver-neutral manager.

The frontend uses the narrowly scoped native dialog plugin to obtain open/save/export paths. A
chosen path is passed to a domain command; React has no general filesystem permission and the
application exposes no generic read, write, shell, or execute command.

## Project archive strategy

`.tsrig` is a portable ZIP archive. Format version 1 contains:

```text
project.json (including materials and geometry-to-material assignments)
cases/<case-uuid>/case.json
cases/<case-uuid>/openfoam/{0,constant,system}/
cases/<case-uuid>/openfoam/{Allmesh,Allrun,Allrun-windows.cmd,TesRig.foam}
geometries/
inputs/
generated/
results/
workflows/
scripts/
```

`project.json` contains portable project metadata and small case references. Full case metadata
lives under its UUID directory. Absolute machine paths are never written into either model.

Project material definitions are solver-neutral and use SI units. They include physical simulation
properties, viewport appearance, provenance, and derivation lineage. Geometry-level assignments are
stored on the geometry asset so a future CalculiX adapter can resolve the material independently of
the React UI. See `docs/materials.md` for the interchange contract.

Opening a project extracts it to a uniquely named OS temporary directory managed by
`WorkspaceService`. Changes are written to this workspace and then recompressed into the original
archive. Replacing or closing the active workspace drops the temporary-directory owner, allowing
automatic cleanup.

The native service validates archive entry paths before extraction, requires `project.json`, checks
the format version before model deserialization, and checks that each referenced case has a matching
case document. Archives are staged through a temporary file when saved.

## Versioning

`formatVersion` begins at `1`. A version other than the current supported value produces a
structured `UNSUPPORTED_PROJECT_VERSION` error. Newly added case setup fields have serde defaults,
so archives created by the earlier format-1 implementation open with documented CFD defaults.
Explicit migrations can be inserted ahead of model loading for future incompatible changes.

## Error contract

The Rust `AppError` is serialized as `{ code, message }`. Codes are stable enough for the frontend
to map to user-oriented copy, while messages preserve useful context. Expected I/O, validation, and
archive failures return errors instead of panicking.

## Solver boundary

`src-tauri/src/solver` contains solver adapters behind solver-neutral native operations. React edits
TesRig's typed CFD model and requests case validation, setup persistence, or export; it never writes
a solver dictionary or starts a process.

The OpenFOAM adapter targets bundled OpenCFD v2606 on Windows and Foundation v14 as a fallback. It owns:

- validation of fluid, initial-condition, mesh, run, and boundary-condition values;
- deterministic generation of `0`, `constant`, and `system` dictionaries;
- `blockMesh` and `snappyHexMesh` setup for STL/OBJ geometry;
- preservation of STEP geometry with an explicit triangulation warning;
- native and shell run/mesh scripts, decomposition configuration, VTK post-processing, and a
  `TesRig.foam` ParaView marker;
- case-folder export without exposing generic filesystem access to React.

Generated solver files live under the owning case and are regenerated from the authoritative case
model whenever it changes. Case variants copy the source geometry reference and complete CFD setup,
then diverge independently.

The Tauri bundle includes the supplied OpenFOAM v2606 MinGW archive, a version-pinned runtime
manifest, and fallback launchers under `src-tauri/resources/openfoam`. On first use the Windows
runtime is safely extracted to local application data and validated for `simpleFoam`, `pimpleFoam`,
`blockMesh`, `snappyHexMesh`, `checkMesh`, and `foamToVTK`. An already-extracted development runtime
can be selected with `TESRIG_OPENFOAM_NATIVE_ROOT`. If the native package is unavailable, the probe
can fall back to Foundation v14 in WSL and validates `foamRun` plus the meshing utilities before a
run. The native runtime does not require WSL lifecycle management.

`SimulationManager` owns process execution, stage/time-derived progress, task state, cancellation,
log capture, final project archiving, and runtime cleanup. While a job is active, native commands reject project replacement,
case edits, geometry changes, exports, and manual saves so generated files cannot be mutated under
OpenFOAM. React can request solver-neutral start/cancel/status operations but has no shell access.
The status bar can display live stdout/stderr. Native runs produce legacy VTK velocity and pressure
files for processed viewing in ParaView; an in-app volume/streamline renderer remains outside this
milestone.
