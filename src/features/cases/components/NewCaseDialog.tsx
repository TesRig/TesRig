import { useState, type FormEvent } from "react";
import { Button } from "../../../components/common/Button";
import { Field, TextAreaField } from "../../../components/common/Field";
import { Modal } from "../../../components/dialogs/Modal";
import { toUserMessage } from "../../../lib/errors/app-error";
import { useWorkspace } from "../../../stores/workspace.store";
import { createCase } from "../case.api";

interface NewCaseDialogProps {
  onClose: () => void;
  onStatus: (message: string, isError?: boolean) => void;
}

export function NewCaseDialog({ onClose, onStatus }: NewCaseDialogProps) {
  const { project, addCase } = useWorkspace();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!project) return;
    if (!name.trim()) return setError("Case name is required.");

    setBusy(true);
    setError(null);
    onStatus("Creating case…");
    try {
      const simulationCase = await createCase({
        projectId: project.id,
        name,
        description,
        simulationType: "CFD",
        solver: "OpenFOAM",
      });
      addCase(simulationCase);
      onStatus(`Created case “${simulationCase.name}”.`);
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
    <Modal title="New case" onClose={busy ? () => undefined : onClose}>
      <form onSubmit={submit}>
        <div className="modal__body form-stack">
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
          {error && <p className="form-error">{error}</p>}
        </div>
        <footer className="modal__actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Creating case…" : "Create case"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
