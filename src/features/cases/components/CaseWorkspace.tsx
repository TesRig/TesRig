import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { toUserMessage } from "../../../lib/errors/app-error";
import { useWorkspace } from "../../../stores/workspace.store";
import { GeometryViewer } from "../../geometry/components/GeometryViewer";
import { assignGeometry, chooseGeometryFile, importGeometry } from "../../geometry/geometry.api";
import type { SimulationCase } from "../case.types";

interface CaseWorkspaceProps {
  simulationCase: SimulationCase;
  onCreateVariant: (caseId: string) => void;
  onStatus: (message: string, isError?: boolean) => void;
}

const futureStages = ["Setup", "Analyze", "Results"];

export function CaseWorkspace({ simulationCase, onCreateVariant, onStatus }: CaseWorkspaceProps) {
  const { project, syncProject } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState(simulationCase.geometryId ?? "");
  const geometry = project?.geometries.find(({ id }) => id === simulationCase.geometryId);
  const sourceCase = project?.cases.find(({ id }) => id === simulationCase.variantOfCaseId);

  useEffect(() => setSelection(simulationCase.geometryId ?? ""), [simulationCase.geometryId]);

  async function handleImport() {
    if (!project) return;
    const sourcePath = await chooseGeometryFile();
    if (typeof sourcePath !== "string") return;
    setBusy(true);
    onStatus("Importing geometry into case…");
    try {
      const updated = await importGeometry({
        projectId: project.id,
        caseId: simulationCase.id,
        sourcePath,
      });
      syncProject(updated);
      setSelection(updated.cases.find(({ id }) => id === simulationCase.id)?.geometryId ?? "");
      onStatus("Case geometry imported.");
    } catch (error) {
      onStatus(toUserMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function handleAssign() {
    if (!project || !selection) return;
    setBusy(true);
    onStatus("Assigning geometry…");
    try {
      syncProject(await assignGeometry(project.id, simulationCase.id, selection));
      onStatus("Case geometry updated.");
    } catch (error) {
      onStatus(toUserMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspace-content workspace-content--wide">
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">{sourceCase ? `Variant of ${sourceCase.name}` : "Case"}</p>
          <h1>{simulationCase.name}</h1>
          <p>{simulationCase.description || "No description provided."}</p>
        </div>
        <div className="workspace-heading__actions">
          <span className="status-chip">{simulationCase.status}</span>
          <Button onClick={() => onCreateVariant(simulationCase.id)}>Create variant</Button>
        </div>
      </header>

      <dl className="metadata-grid">
        <div>
          <dt>Simulation type</dt>
          <dd>Flow / {simulationCase.simulationType}</dd>
        </div>
        <div>
          <dt>Solver</dt>
          <dd>{simulationCase.solver}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{new Date(simulationCase.createdAt).toLocaleString()}</dd>
        </div>
      </dl>

      <div className="case-section-heading">
        <div>
          <p className="eyebrow">01 · Geometry</p>
          <h2>{geometry ? geometry.name : "No geometry assigned"}</h2>
        </div>
        <div className="case-geometry-actions">
          {project && project.geometries.length > 0 && (
            <>
              <select
                className="field__control geometry-select"
                aria-label="Project geometry"
                value={selection}
                onChange={(event) => setSelection(event.target.value)}
                disabled={busy}
              >
                <option value="">Choose project geometry</option>
                {project.geometries.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.format})
                  </option>
                ))}
              </select>
              <Button
                onClick={handleAssign}
                disabled={busy || !selection || selection === geometry?.id}
              >
                Use geometry
              </Button>
            </>
          )}
          <Button
            variant={geometry ? "secondary" : "primary"}
            onClick={handleImport}
            disabled={busy}
          >
            {geometry ? "Replace with import" : "Import geometry"}
          </Button>
        </div>
      </div>

      {geometry ? (
        <GeometryViewer projectId={project!.id} geometry={geometry} />
      ) : (
        <div className="case-geometry-empty">
          <span>◇</span>
          <h3>Add geometry to continue</h3>
          <p>
            Import an STL, OBJ, or STEP file, or choose an asset already stored in this project.
          </p>
          <Button variant="primary" onClick={handleImport} disabled={busy}>
            Choose geometry file
          </Button>
        </div>
      )}

      <div className="stage-list" aria-label="Future workflow stages">
        {futureStages.map((stage, index) => (
          <div className="stage-list__item" key={stage} aria-disabled="true">
            <span className="stage-list__number">0{index + 2}</span>
            <span>{stage}</span>
            <span className="stage-list__state">Coming next</span>
          </div>
        ))}
      </div>
    </section>
  );
}
