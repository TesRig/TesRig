import { useState, type FormEvent } from "react";
import { Button } from "../../../components/common/Button";
import { Field, TextAreaField } from "../../../components/common/Field";
import { Modal } from "../../../components/dialogs/Modal";
import { toUserMessage } from "../../../lib/errors/app-error";
import { useWorkspace } from "../../../stores/workspace.store";
import { chooseProjectDestination, createProject } from "../project.api";

interface NewProjectDialogProps {
  onClose: () => void;
}

export function NewProjectDialog({ onClose }: NewProjectDialogProps) {
  const { setProject } = useWorkspace();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [destination, setDestination] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function browse() {
    setError(null);
    try {
      const selected = await chooseProjectDestination(name);
      if (selected) setDestination(selected);
    } catch (nativeError) {
      setError(toUserMessage(nativeError));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Project name is required.");
    if (!destination.trim()) return setError("Choose where to save the project.");

    setBusy(true);
    setError(null);
    try {
      const project = await createProject({ name, description, destination });
      setProject(project);
      onClose();
    } catch (nativeError) {
      setError(toUserMessage(nativeError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New project" onClose={busy ? () => undefined : onClose}>
      <form onSubmit={submit}>
        <div className="modal__body form-stack">
          <Field
            id="project-name"
            label="Project name *"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
          />
          <TextAreaField
            id="project-description"
            label="Description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy}
          />
          <div className="field">
            <span className="field__label">Location *</span>
            <div className="path-picker">
              <input
                className="field__control"
                value={destination}
                readOnly
                placeholder="Choose a .tsrig destination"
                aria-label="Project destination"
              />
              <Button type="button" onClick={browse} disabled={busy}>
                Browse…
              </Button>
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
        </div>
        <footer className="modal__actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Creating project…" : "Create project"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
