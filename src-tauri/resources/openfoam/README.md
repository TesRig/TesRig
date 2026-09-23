# TesRig OpenFOAM runtime

TesRig packages the supplied OpenCFD OpenFOAM v2606 MinGW runtime as
`windows-native/OpenFOAMv2606.zip`. On first use the app extracts it to its local application-data
directory, validates the required executables, and runs OpenFOAM directly on Windows. No WSL
installation is required for this primary path.

The native package and its included third-party components retain their original licenses inside
the archive. OpenFOAM is GPL-3.0-or-later. The archive was copied without modification from the
locally supplied `E:/OpenFOAM/OpenFOAMv2606.zip` package.

For development, `TESRIG_OPENFOAM_NATIVE_ROOT` can point at an already-extracted v2606 directory,
which avoids unpacking the bundled archive. `pnpm dev:test` uses the local installation and opens
the ignored `sandbox/projects/wing.tsrig` fixture automatically.

OpenFOAM Foundation v14 in WSL remains a compatibility fallback. Set `TESRIG_WSL_DISTRIBUTION` or
`TESRIG_OPENFOAM_BASHRC` only when using that fallback.
