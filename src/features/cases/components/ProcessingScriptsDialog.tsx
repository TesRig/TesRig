import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toUserMessage } from "../../../lib/errors/app-error";
import {
  listProcessingResults,
  listProcessingScripts,
  openPythonApiDocs,
  readProcessingResult,
  runProcessingScript,
  saveProcessingScript,
  validateProcessingScript,
} from "../case.api";
import type {
  ProcessingResult,
  ProcessingResultSummary,
  ProcessingScript,
  ProcessingScriptValidation,
} from "../case.types";
import { PythonCodeEditor } from "./PythonCodeEditor";
import { ProcessingResultViewer } from "./ProcessingResultViewer";

const SCRIPT_TEMPLATE = `from tesrig_api import latest_snapshot, write_result

snapshot = latest_snapshot()

# Add custom calculations here. Results are saved inside the case archive.
write_result("airflow_summary", {
    "time": snapshot["time"],
    "mean_pressure": snapshot["pressure_statistics"]["mean"],
    "mean_speed": snapshot["velocity_magnitude"]["mean"],
})

print(f"Processed OpenFOAM time {snapshot['time']}")
`;

interface ProcessingScriptsPanelProps {
  projectId: string;
  caseId: string;
  simulationActive: boolean;
  onStatus: (message: string, isError?: boolean) => void;
}

export function ProcessingScriptsPanel({
  projectId,
  caseId,
  simulationActive,
  onStatus,
}: ProcessingScriptsPanelProps) {
  const [scripts, setScripts] = useState<ProcessingScript[]>([]);
  const [selectedName, setSelectedName] = useState("");
  const [name, setName] = useState("airflow_summary.py");
  const [source, setSource] = useState(SCRIPT_TEMPLATE);
  const [view, setView] = useState<"results" | "code">("results");
  const [results, setResults] = useState<ProcessingResultSummary[]>([]);
  const [selectedResultFile, setSelectedResultFile] = useState("");
  const [selectedResult, setSelectedResult] = useState<ProcessingResult | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [validation, setValidation] = useState<ProcessingScriptValidation | null>(null);
  const [validationError, setValidationError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const validationRequest = useRef(0);
  const autosaveRequest = useRef(0);
  const lastSavedSource = useRef("");

  useEffect(() => {
    let disposed = false;
    void Promise.all([
      listProcessingScripts(projectId, caseId),
      listProcessingResults(projectId, caseId),
    ])
      .then(([items, resultItems]) => {
        if (disposed) return;
        setScripts(items);
        setResults(resultItems);
        setSelectedResultFile(resultItems[0]?.fileName ?? "");
        if (items[0]) {
          setSelectedName(items[0].name);
          setName(items[0].name);
          setSource(items[0].source);
          lastSavedSource.current = items[0].source;
        }
      })
      .catch((error) => {
        if (!disposed) onStatus(toUserMessage(error), true);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [caseId, onStatus, projectId]);

  useEffect(() => {
    if (!selectedResultFile) {
      setSelectedResult(null);
      return;
    }
    let disposed = false;
    setResultLoading(true);
    void readProcessingResult(projectId, caseId, selectedResultFile)
      .then((result) => {
        if (!disposed) setSelectedResult(result);
      })
      .catch((error) => {
        if (!disposed) onStatus(toUserMessage(error), true);
      })
      .finally(() => {
        if (!disposed) setResultLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [caseId, onStatus, projectId, selectedResultFile]);

  const checkSyntax = useCallback(async () => {
    const request = ++validationRequest.current;
    setChecking(true);
    setValidation(null);
    setValidationError("");
    try {
      const result = await validateProcessingScript(source);
      if (request === validationRequest.current) setValidation(result);
      return result;
    } catch (error) {
      if (request === validationRequest.current) setValidationError(toUserMessage(error));
      return null;
    } finally {
      if (request === validationRequest.current) setChecking(false);
    }
  }, [source]);

  useEffect(() => {
    setChecking(true);
    setValidation(null);
    setValidationError("");
    const timer = window.setTimeout(() => void checkSyntax(), 120);
    return () => {
      window.clearTimeout(timer);
      validationRequest.current += 1;
    };
  }, [checkSyntax]);

  function selectScript(script: ProcessingScript) {
    setSelectedName(script.name);
    setName(script.name);
    setSource(script.source);
    lastSavedSource.current = script.source;
  }

  useEffect(() => {
    if (loading || checking || validation?.valid !== true || source === lastSavedSource.current) {
      return;
    }
    const request = ++autosaveRequest.current;
    const timer = window.setTimeout(() => {
      if (request !== autosaveRequest.current) return;
      setSaving(true);
      void saveProcessingScript(projectId, caseId, name, source)
        .then((saved) => {
          if (request !== autosaveRequest.current) return;
          lastSavedSource.current = saved.source;
          setSelectedName(saved.name);
          setName(saved.name);
          setScripts((current) => {
            const remaining = current.filter(({ name: currentName }) => currentName !== saved.name);
            return [...remaining, saved].sort((left, right) => left.name.localeCompare(right.name));
          });
        })
        .catch((error) => {
          if (request === autosaveRequest.current) onStatus(toUserMessage(error), true);
        })
        .finally(() => {
          if (request === autosaveRequest.current) setSaving(false);
        });
    }, 650);
    return () => {
      window.clearTimeout(timer);
      autosaveRequest.current += 1;
    };
  }, [caseId, checking, loading, name, onStatus, projectId, source, validation?.valid]);

  async function run() {
    if (checking || validation?.valid !== true) return;
    autosaveRequest.current += 1;
    setSaving(true);
    try {
      const saved = await saveProcessingScript(projectId, caseId, name, source);
      lastSavedSource.current = saved.source;
      setSelectedName(saved.name);
      const result = await runProcessingScript(projectId, caseId, saved.name);
      onStatus(
        result.success
          ? `Python processing script ${saved.name} completed.`
          : `Python processing script ${saved.name} exited with code ${result.exitCode ?? "unknown"}.`,
        !result.success,
      );
      if (result.success) {
        const resultItems = await listProcessingResults(projectId, caseId);
        setResults(resultItems);
        const latestFile = resultItems[0]?.fileName ?? "";
        setSelectedResultFile(latestFile);
        setSelectedResult(
          latestFile ? await readProcessingResult(projectId, caseId, latestFile) : null,
        );
        setView("results");
      }
    } catch (error) {
      onStatus(toUserMessage(error), true);
    } finally {
      setSaving(false);
    }
  }

  const syntaxInvalid = validation?.valid === false;
  const hasUnsavedChanges = source !== lastSavedSource.current;
  const editorPopup = view === "code" && !collapsed;

  const panel = (
    <section
      className={`processing-scripts-popup ${collapsed ? "is-collapsed" : ""} ${editorPopup ? "is-code-view" : ""}`}
      aria-label="Python processing scripts"
      role={editorPopup ? "dialog" : undefined}
    >
      <header className="processing-scripts-popup__header">
        <div className="processing-scripts-popup__controls processing-scripts-popup__controls--leading">
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand Python scripts" : "Minimize Python scripts"}
            title={collapsed ? "Expand Python scripts" : "Minimize Python scripts"}
          >
            {collapsed ? "›" : "‹"}
          </button>
        </div>
        {!collapsed ? (
          <>
            <div className="processing-scripts-popup__title">
              <span>
                {view === "results" ? "Python results · File based" : "Python API · Live checking"}
              </span>
            </div>
            <div className="processing-scripts-popup__controls">
              {view === "code" ? (
                <button
                  type="button"
                  onClick={() => void run()}
                  disabled={
                    loading ||
                    saving ||
                    checking ||
                    validation?.valid !== true ||
                    simulationActive ||
                    !name.trim()
                  }
                  title={
                    simulationActive
                      ? "Run processing scripts after the solver finishes"
                      : undefined
                  }
                >
                  {saving ? "Saving…" : "Run"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setView((current) => (current === "results" ? "code" : "results"))}
              >
                {view === "results" ? "Show code" : "Show results"}
              </button>
              <button
                type="button"
                onClick={() =>
                  void openPythonApiDocs().catch((error) => onStatus(toUserMessage(error), true))
                }
                aria-label="Open Python API documentation in the default browser"
                title="Open API documentation"
              >
                Docs ↗
              </button>
            </div>
          </>
        ) : null}
      </header>
      {!collapsed ? (
        view === "results" ? (
          <div className="processing-results">
            {results.length > 1 ? (
              <div
                className="processing-results__tabs"
                role="tablist"
                aria-label="Processing result files"
              >
                {results.map((result) => (
                  <button
                    key={result.fileName}
                    type="button"
                    role="tab"
                    aria-selected={selectedResultFile === result.fileName}
                    className={selectedResultFile === result.fileName ? "is-active" : ""}
                    onClick={() => setSelectedResultFile(result.fileName)}
                    title={`${result.name} · ${result.kind} · ${new Date(result.updatedAt).toLocaleString()}`}
                  >
                    <span>{result.name}</span>
                    <small>{result.kind}</small>
                  </button>
                ))}
              </div>
            ) : null}
            <section className="processing-results__content" aria-live="polite">
              {resultLoading ? <p className="processing-result__empty">Loading result…</p> : null}
              {!resultLoading && selectedResult ? (
                <ProcessingResultViewer result={selectedResult} />
              ) : null}
              {!resultLoading && !selectedResult ? (
                <div className="processing-results__empty">
                  <strong>No Python results</strong>
                  <p>
                    Select Show code, write a result with <code>write_result</code>,{" "}
                    <code>write_probe</code>, or <code>write_table</code>, then run the script.
                  </p>
                </div>
              ) : null}
            </section>
          </div>
        ) : (
          <div className="processing-scripts">
            <aside className="processing-scripts__list">
              {scripts.map((script) => (
                <button
                  key={script.name}
                  type="button"
                  className={selectedName === script.name ? "is-active" : ""}
                  onClick={() => selectScript(script)}
                >
                  <strong>{script.name}</strong>
                  <small>{new Date(script.updatedAt).toLocaleString()}</small>
                </button>
              ))}
            </aside>
            <section className="processing-scripts__editor">
              <div className="processing-scripts__code">
                <PythonCodeEditor
                  value={source}
                  onChange={setSource}
                  diagnostics={validation?.diagnostics ?? []}
                />
                <div
                  className={`processing-scripts__validation ${syntaxInvalid || validationError ? "is-error" : ""}`}
                  role="status"
                  aria-live="polite"
                >
                  {checking ? <span>Checking Python syntax…</span> : null}
                  {!checking && validation?.valid ? (
                    <span>
                      {saving
                        ? "Syntax valid · Saving…"
                        : hasUnsavedChanges
                          ? "Syntax valid · Autosave pending"
                          : "Syntax valid · Autosaved"}
                    </span>
                  ) : null}
                  {!checking && validationError ? <span>{validationError}</span> : null}
                  {!checking && syntaxInvalid
                    ? validation.diagnostics.map((diagnostic, index) => (
                        <span key={`${diagnostic.line}-${diagnostic.column}-${index}`}>
                          Line {diagnostic.line}, column {diagnostic.column}: {diagnostic.message}
                        </span>
                      ))
                    : null}
                </div>
              </div>
            </section>
          </div>
        )
      ) : null}
    </section>
  );

  return editorPopup ? createPortal(panel, document.body) : panel;
}
