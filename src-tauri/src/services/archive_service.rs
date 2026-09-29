use crate::error::{AppError, AppResult};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const PROJECT_DIRECTORIES: [&str; 7] = [
    "cases",
    "geometries",
    "inputs",
    "generated",
    "results",
    "workflows",
    "scripts",
];

pub struct ArchiveService;

impl ArchiveService {
    pub fn initialize_layout(workspace: &Path) -> AppResult<()> {
        for directory in PROJECT_DIRECTORIES {
            fs::create_dir_all(workspace.join(directory)).map_err(AppError::io)?;
        }
        Ok(())
    }

    pub fn extract(archive_path: &Path, workspace: &Path) -> AppResult<()> {
        let file = File::open(archive_path)
            .map_err(|error| AppError::ArchiveReadFailed(error.to_string()))?;
        let mut archive = ZipArchive::new(file)
            .map_err(|error| AppError::ArchiveReadFailed(error.to_string()))?;

        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|error| AppError::ArchiveReadFailed(error.to_string()))?;
            let relative_path = entry
                .enclosed_name()
                .ok_or(AppError::InvalidProjectFormat)?
                .to_path_buf();
            let output_path = workspace.join(relative_path);

            if entry.is_dir() {
                fs::create_dir_all(&output_path).map_err(AppError::io)?;
                continue;
            }

            if let Some(parent) = output_path.parent() {
                fs::create_dir_all(parent).map_err(AppError::io)?;
            }
            let mut output = File::create(&output_path).map_err(AppError::io)?;
            io::copy(&mut entry, &mut output).map_err(AppError::io)?;
        }
        Ok(())
    }

    pub fn write(workspace: &Path, archive_path: &Path) -> AppResult<()> {
        let parent = archive_path.parent().unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent).map_err(AppError::io)?;
        let temporary = tempfile::NamedTempFile::new_in(parent)
            .map_err(|error| AppError::ArchiveWriteFailed(error.to_string()))?;

        {
            let mut writer = ZipWriter::new(temporary.as_file());
            let options = SimpleFileOptions::default()
                .compression_method(CompressionMethod::Deflated)
                .unix_permissions(0o644);
            Self::add_directory(&mut writer, workspace, workspace, options)?;
            writer
                .finish()
                .map_err(|error| AppError::ArchiveWriteFailed(error.to_string()))?;
        }

        temporary
            .persist(archive_path)
            .map_err(|error| AppError::ArchiveWriteFailed(error.error.to_string()))?;
        Ok(())
    }

    fn add_directory<W: Write + io::Seek>(
        writer: &mut ZipWriter<W>,
        root: &Path,
        directory: &Path,
        options: SimpleFileOptions,
    ) -> AppResult<()> {
        let mut entries = fs::read_dir(directory)
            .map_err(AppError::io)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::io)?;
        entries.sort_by_key(|entry| entry.path());

        for entry in entries {
            let path = entry.path();
            let relative = path
                .strip_prefix(root)
                .map_err(|error| AppError::InternalError(error.to_string()))?;
            let archive_name = relative.to_string_lossy().replace('\\', "/");

            // The per-case surface is a generated duplicate of the project's source geometry and
            // is recreated when a project is opened. Runtime stage markers are transient. Keeping
            // either in every archive needlessly inflates large CFD projects.
            if is_rebuildable_case_artifact(&archive_name) {
                continue;
            }

            if path.is_dir() {
                writer
                    .add_directory(format!("{archive_name}/"), options)
                    .map_err(|error| AppError::ArchiveWriteFailed(error.to_string()))?;
                Self::add_directory(writer, root, &path, options)?;
            } else {
                writer
                    .start_file(archive_name, options)
                    .map_err(|error| AppError::ArchiveWriteFailed(error.to_string()))?;
                let mut source = File::open(&path).map_err(AppError::io)?;
                let mut buffer = Vec::new();
                source.read_to_end(&mut buffer).map_err(AppError::io)?;
                writer
                    .write_all(&buffer)
                    .map_err(|error| AppError::ArchiveWriteFailed(error.to_string()))?;
            }
        }
        Ok(())
    }

    pub fn normalize_destination(destination: &Path) -> PathBuf {
        if destination
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("tsrig"))
        {
            destination.to_path_buf()
        } else {
            destination.with_extension("tsrig")
        }
    }
}

fn is_rebuildable_case_artifact(path: &str) -> bool {
    let parts = path.split('/').collect::<Vec<_>>();
    parts.len() >= 4
        && parts[0] == "cases"
        && parts[2] == "openfoam"
        && ((parts.len() >= 5 && parts[3] == "constant" && parts[4] == "triSurface")
            || (parts.len() == 4 && parts[3] == "tesrig.stage"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_only_regenerable_case_artifacts() {
        assert!(is_rebuildable_case_artifact(
            "cases/case-id/openfoam/constant/triSurface"
        ));
        assert!(is_rebuildable_case_artifact(
            "cases/case-id/openfoam/constant/triSurface/geometry.stl"
        ));
        assert!(is_rebuildable_case_artifact(
            "cases/case-id/openfoam/tesrig.stage"
        ));
        assert!(!is_rebuildable_case_artifact(
            "cases/case-id/openfoam/constant/polyMesh/points"
        ));
        assert!(!is_rebuildable_case_artifact(
            "geometries/source/triSurface/geometry.stl"
        ));
    }
}
