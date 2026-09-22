import { Button } from "../../../components/common/Button";
import { GeometryViewer } from "../../geometry/components/GeometryViewer";
import type { ProjectSummary } from "../project.types";

interface ProjectOverviewProps {
  project: ProjectSummary;
  selectedGeometryId: string | null;
  onGeometryChange: (geometryId: string) => void;
  onAddGeometry: () => void;
  busy: boolean;
}

export function ProjectOverview({
  project,
  selectedGeometryId,
  onGeometryChange,
  onAddGeometry,
  busy,
}: ProjectOverviewProps) {
  const selected =
    project.geometries.find(({ id }) => id === selectedGeometryId) ?? project.geometries[0];

  if (selected) {
    return (
      <section className="geometry-editor">
        <GeometryViewer
          projectId={project.id}
          geometry={selected}
          geometries={project.geometries}
          onGeometryChange={onGeometryChange}
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
          <Button variant="primary" onClick={onAddGeometry} disabled={busy}>
            {busy ? "Importing…" : "Choose geometry file"}
          </Button>
        </div>
      </div>
    </section>
  );
}
