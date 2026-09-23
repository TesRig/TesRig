//! Solver-neutral boundary for case generation and managed execution.
//!
//! OpenFOAM-specific dictionaries stay in the adapter, while runtime and simulation
//! managers own platform launch, task state, logging, cancellation, and cleanup.
pub mod openfoam;
pub mod runtime;
pub mod simulation;
