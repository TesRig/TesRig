import type { SimulationCase } from "../case.types";

interface CaseWorkspaceProps {
  simulationCase: SimulationCase;
}

const futureStages = ["Geometry", "Setup", "Analyze", "Results"];

export function CaseWorkspace({ simulationCase }: CaseWorkspaceProps) {
  return (
    <section className="workspace-content">
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">Case</p>
          <h1>{simulationCase.name}</h1>
          <p>{simulationCase.description || "No description provided."}</p>
        </div>
        <span className="status-chip">{simulationCase.status}</span>
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

      <div className="stage-list" aria-label="Future workflow stages">
        {futureStages.map((stage, index) => (
          <div className="stage-list__item" key={stage} aria-disabled="true">
            <span className="stage-list__number">0{index + 1}</span>
            <span>{stage}</span>
            <span className="stage-list__state">Not available in Phase 1</span>
          </div>
        ))}
      </div>
    </section>
  );
}
