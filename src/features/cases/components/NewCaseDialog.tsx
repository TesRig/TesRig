import { useState, type FormEvent } from "react";
import { Button } from "../../../components/common/Button";
import { Field, TextAreaField } from "../../../components/common/Field";
import { Modal } from "../../../components/dialogs/Modal";
import { toUserMessage } from "../../../lib/errors/app-error";
import { useWorkspace } from "../../../stores/workspace.store";
import { chooseGeometryFile, importGeometry } from "../../geometry/geometry.api";
import { createCase } from "../case.api";

interface NewCaseDialogProps {
  onClose: () => void;
  onStatus: (message: string, isError?: boolean) => void;
  variantOfCaseId?: string | null;
}

export function NewCaseDialog({ onClose, onStatus, variantOfCaseId = null }: NewCaseDialogProps) {
  const { project, addCase, syncProject, selectCase } = useWorkspace();
  const sourceCase = project?.cases.find(({ id }) => id === variantOfCaseId);
  const isVariant = Boolean(sourceCase);
  const initialGeometry = isVariant
    ? "inherit"
    : project?.geometries[0]
      ? `asset:${project.geometries[0].id}`
      : "import";
  const [name, setName] = useState(sourceCase ? `${sourceCase.name} Variant` : "");
  const [description, setDescription] = useState(sourceCase?.description ?? "");
  const [geometryChoice, setGeometryChoice] = useState(initialGeometry);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function browseGeometry() {
    const selection = await chooseGeometryFile();
    if (typeof selection === "string") {
      setImportPath(selection);
      setGeometryChoice("import");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!project) return;
    if (!name.trim()) return setError("Case name is required.");
    if (geometryChoice === "import" && !importPath) {
      return setError("Choose an STL, OBJ, or STEP file to import.");
    }

    setBusy(true);
    setError(null);
    onStatus(isVariant ? "Creating variant…" : "Creating case…");
    try {
      let geometryId = geometryChoice.startsWith("asset:")
        ? geometryChoice.slice("asset:".length)
        : null;
      if (geometryChoice === "import" && importPath) {
        onStatus("Importing geometry…");
        const updatedProject = await importGeometry({
          projectId: project.id,
          sourcePath: importPath,
        });
        syncProject(updatedProject);
        geometryId = updatedProject.geometries.at(-1)?.id ?? null;
      }

      const simulationCase = await createCase({
        projectId: project.id,
        name,
        description,
        simulationType: "CFD",
        solver: "OpenFOAM",
        geometryId,
        variantOfCaseId: sourceCase?.id ?? null,
      });
      addCase(simulationCase);
      selectCase(simulationCase.id);

      onStatus(
        isVariant
          ? `Created variant “${simulationCase.name}”.`
          : `Created case “${simulationCase.name}”.`,
      );
      onClose();
    } catch (nativeError) {
      const message = toUserMessage(nativeError);
      setError(message);
      onStatus(message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isVariant ? "Create variant" : "New case"}
      onClose={busy ? () => undefined : onClose}
    >
      <form onSubmit={submit}>
        <div className="modal__body form-stack">
          {sourceCase && (
            <div className="variant-source">
              <span>Variant of</span>
              <strong>{sourceCase.name}</strong>
              <small>Solver settings and geometry are inherited initially.</small>
            </div>
          )}
          <Field
            id="case-name"
            label="Case name *"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
          />
          <TextAreaField
            id="case-description"
            label="Description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy}
          />
          <label className="field" htmlFor="case-geometry">
            <span className="field__label">Geometry</span>
            <select
              id="case-geometry"
              className="field__control"
              value={geometryChoice}
              onChange={(event) => setGeometryChoice(event.target.value)}
              disabled={busy}
            >
              {sourceCase && <option value="inherit">Inherit from {sourceCase.name}</option>}
              {project?.geometries.map((geometry) => (
                <option key={geometry.id} value={`asset:${geometry.id}`}>
                  {geometry.name} ({geometry.format})
                </option>
              ))}
              <option value="import">Import a new geometry…</option>
              {!sourceCase && <option value="none">No geometry yet</option>}
            </select>
          </label>
          {geometryChoice === "import" && (
            <div className="geometry-picker">
              <Button type="button" onClick={browseGeometry} disabled={busy}>
                Choose STL / OBJ / STEP
              </Button>
              <span title={importPath ?? undefined}>
                {importPath?.split(/[\\/]/).pop() ?? "No file selected"}
              </span>
            </div>
          )}
          <div className="form-columns">
            <label className="field" htmlFor="simulation-type">
              <span className="field__label">Simulation type</span>
              <select id="simulation-type" className="field__control" value="CFD" disabled>
                <option value="CFD">Flow / CFD</option>
              </select>
            </label>
            <label className="field" htmlFor="solver">
              <span className="field__label">Solver</span>
              <select id="solver" className="field__control" value="OpenFOAM" disabled>
                <option value="OpenFOAM">OpenFOAM</option>
              </select>
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
        </div>
        <footer className="modal__actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Working…" : isVariant ? "Create variant" : "Create case"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
