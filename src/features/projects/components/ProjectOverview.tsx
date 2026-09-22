import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { toUserMessage } from "../../../lib/errors/app-error";
import { useWorkspace } from "../../../stores/workspace.store";
import { GeometryViewer } from "../../geometry/components/GeometryViewer";
import { chooseGeometryFile, importGeometry } from "../../geometry/geometry.api";
import type { ProjectSummary } from "../project.types";

interface ProjectOverviewProps {
  project: ProjectSummary;
  onStatus: (message: string, isError?: boolean) => void;
}

export function ProjectOverview({ project, onStatus }: ProjectOverviewProps) {
  const { syncProject } = useWorkspace();
  const [selectedId, setSelectedId] = useState(project.geometries[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const selected = project.geometries.find(({ id }) => id === selectedId) ?? project.geometries[0];

  useEffect(() => {
    if (!selected && project.geometries[0]) setSelectedId(project.geometries[0].id);
  }, [project.geometries, selected]);

  async function handleImport() {
    const sourcePath = await chooseGeometryFile();
    if (typeof sourcePath !== "string") return;
    setBusy(true);
    onStatus("Importing geometry…");
    try {
      const updated = await importGeometry({ projectId: project.id, sourcePath });
      syncProject(updated);
      const imported = updated.geometries.at(-1);
      if (imported) setSelectedId(imported.id);
      onStatus(`Imported “${imported?.name ?? "geometry"}”.`);
    } catch (error) {
      onStatus(toUserMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  if (selected) {
    return (
      <section className="geometry-editor">
        <GeometryViewer
          projectId={project.id}
          geometry={selected}
          geometries={project.geometries}
          onGeometryChange={setSelectedId}
        />
      </section>
    );
  }

  return (
    <section className="geometry-editor geometry-editor--empty">
      <div className="geometry-empty">
        <div className="geometry-empty__preview" aria-hidden="true">
          <span className="geometry-empty__cube">◇</span>
          <span className="geometry-empty__grid" />
        </div>
        <div>
          <p className="eyebrow">Project geometry</p>
          <h2>Import your first geometry</h2>
          <p>
            Add an STL, OBJ, or STEP model. It will be packaged with the project and can be reused
            by any case.
          </p>
          <Button variant="primary" onClick={handleImport} disabled={busy}>
            {busy ? "Importing…" : "Choose geometry file"}
          </Button>
        </div>
      </div>
    </section>
  );
}
