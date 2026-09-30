import { Button } from "../../../components/common/Button";
import { GeometryViewer } from "../../geometry/components/GeometryViewer";
import type { ProjectSummary, UpAxis } from "../project.types";

interface ProjectOverviewProps {
  project: ProjectSummary;
  selectedGeometryId: string | null;
  onGeometryChange: (geometryId: string) => void;
  onAddGeometry: () => void;
  onUpAxisChange: (upAxis: UpAxis) => void;
  busy: boolean;
}

export function ProjectOverview({
  project,
  selectedGeometryId,
  onGeometryChange,
  onAddGeometry,
  onUpAxisChange,
  busy,
}: ProjectOverviewProps) {
  const selected =
    project.geometries.find(({ id }) => id === selectedGeometryId) ?? project.geometries[0];
  const assignedMaterial = project.materials.find(({ id }) => id === selected?.materialId);

  if (selected) {
    return (
      <section className="geometry-editor">
        <GeometryViewer
          projectId={project.id}
          geometry={selected}
          geometries={project.geometries}
          onGeometryChange={onGeometryChange}
          upAxis={project.settings.upAxis}
          onUpAxisChange={onUpAxisChange}
          defaultMaterialAppearance={assignedMaterial?.appearance}
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
