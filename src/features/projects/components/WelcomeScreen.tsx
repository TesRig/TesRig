import { useState } from "react";
import { Button } from "../../../components/common/Button";
import { toUserMessage } from "../../../lib/errors/app-error";
import { useWorkspace } from "../../../stores/workspace.store";
import { chooseProjectToOpen, openProject } from "../project.api";
import { NewProjectDialog } from "./NewProjectDialog";

export function WelcomeScreen() {
  const { setProject } = useWorkspace();
  const [showNewProject, setShowNewProject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen() {
    setError(null);
    try {
      const path = await chooseProjectToOpen();
      if (!path) return;
      setBusy(true);
      setProject(await openProject({ path }));
    } catch (nativeError) {
      setError(toUserMessage(nativeError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="welcome">
      <section className="welcome__panel">
        <div className="brand-mark" aria-hidden="true">
          T
        </div>
        <p className="eyebrow">Engineering simulation workspace</p>
        <h1>TesRig</h1>
        <p className="welcome__intro">
          Create a portable project, organize simulation cases, and build toward a repeatable
          engineering workflow.
        </p>
        <div className="welcome__actions">
          <Button variant="primary" onClick={() => setShowNewProject(true)} disabled={busy}>
            New Project
          </Button>
          <Button onClick={handleOpen} disabled={busy}>
            {busy ? "Opening project…" : "Open Project"}
          </Button>
        </div>
        {error && <p className="form-error welcome__error">{error}</p>}
        <div className="recent-projects">
          <span className="recent-projects__label">Recent projects</span>
          <p>Projects you open will be available from their saved location.</p>
        </div>
      </section>
      <p className="welcome__version">TesRig · Project format 1</p>
      {showNewProject && <NewProjectDialog onClose={() => setShowNewProject(false)} />}
    </main>
  );
}
