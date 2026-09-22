import type { ProjectSummary } from "../project.types";

export function ProjectOverview({ project }: { project: ProjectSummary }) {
  return (
    <section className="workspace-content">
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">Project overview</p>
          <h1>{project.name}</h1>
          <p>{project.description || "No description provided."}</p>
        </div>
      </header>
      <div className="empty-workspace">
        <div className="empty-workspace__glyph">＋</div>
        <h2>{project.cases.length ? "Select a case" : "No cases yet"}</h2>
        <p>
          {project.cases.length
            ? "Choose a case in the project navigator to inspect its metadata."
            : "Create the first CFD case to begin organizing this simulation project."}
        </p>
      </div>
    </section>
  );
}
