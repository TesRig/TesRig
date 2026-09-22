# TesRig Phase 1 architecture

```text
React presentation and UI state
              ↓ typed domain requests
          Tauri IPC commands
              ↓
       TesRig native core (Rust)
              ↓
    Solver adapter boundary (future)
```

## Responsibility boundary

React owns navigation, forms, dialog visibility, loading/error presentation, and the selected case ID. It holds a normalized snapshot returned by the native core so the current workspace can be rendered, but it does not serialize or edit archive contents. Raw `invoke` calls are confined to `src/lib/tauri`; feature API modules expose typed domain operations.

Rust owns validation, identifiers, timestamps, filesystem access, temporary workspaces, ZIP extraction/compression, manifests, and case persistence. Tauri commands contain no archive logic: they deserialize a domain request and delegate it to `ProjectService`.

The frontend uses the narrowly scoped native dialog plugin to obtain open/save paths. A chosen path is passed to a domain command; React has no general filesystem permission and the application exposes no generic read, write, shell, or execute command.

## Project archive strategy

`.tsrig` is a portable ZIP archive. Format version 1 contains:

```text
project.json
cases/<case-uuid>/case.json
inputs/
generated/
results/
workflows/
scripts/
```

`project.json` contains portable project metadata and small case references. Full case metadata lives under its UUID directory. Absolute machine paths are never written into either model.

Opening a project extracts it to a uniquely named OS temporary directory managed by `WorkspaceService`. Changes are written to this workspace and then recompressed into the original archive. Replacing or closing the active workspace drops the temporary-directory owner, allowing automatic cleanup.

The native service validates archive entry paths before extraction, requires `project.json`, checks the format version before model deserialization, and checks that each referenced case has a matching case document. Archives are staged through a temporary file when saved.

## Versioning

`formatVersion` begins at `1`. A version other than the current supported value produces a structured `UNSUPPORTED_PROJECT_VERSION` error; TesRig does not guess at or silently mutate future formats. Explicit migrations can be inserted ahead of model loading in a future release.

## Error contract

The Rust `AppError` is serialized as `{ code, message }`. Codes are stable enough for the frontend to map to user-oriented copy, while messages preserve useful context. Expected I/O, validation, and archive failures return errors instead of panicking.

## Solver boundary

`src-tauri/src/solver` is intentionally implementation-free. Future solver-neutral operations such as case validation, starting/canceling simulations, progress reporting, and result discovery will enter the native core and dispatch to an adapter selected from case metadata. OpenFOAM concepts are currently limited to the extensible `Solver` metadata value; no OpenFOAM execution or configuration exists in Phase 1.
