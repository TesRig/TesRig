import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Field, TextAreaField } from "../../../components/common/Field";
import { Modal } from "../../../components/dialogs/Modal";
import { toUserMessage } from "../../../lib/errors/app-error";
import type { Material, ProjectSummary } from "../../projects/project.types";
import {
  assignMaterial,
  chooseMaterialExportFile,
  chooseMaterialFile,
  deleteMaterial,
  exportMaterials,
  importMaterials,
  upsertMaterial,
} from "../material.api";

interface MaterialManagerProps {
  project: ProjectSummary;
  initialMaterialId?: string | null;
  initialGeometryId?: string | null;
  onProjectChange: (project: ProjectSummary) => void;
  onStatus: (message: string, isError?: boolean) => void;
  onClose: () => void;
}

type PropertyGroup = "mechanical" | "thermal";
type NumericProperty =
  | "density"
  | "youngsModulus"
  | "poissonsRatio"
  | "yieldStrength"
  | "ultimateTensileStrength"
  | "thermalConductivity"
  | "specificHeat"
  | "thermalExpansionCoefficient";

const numericFields: Array<{
  group: PropertyGroup;
  property: NumericProperty;
  label: string;
  unit: string;
}> = [
  { group: "mechanical", property: "density", label: "Density", unit: "kg/m³" },
  {
    group: "mechanical",
    property: "youngsModulus",
    label: "Young's modulus",
    unit: "Pa",
  },
  {
    group: "mechanical",
    property: "poissonsRatio",
    label: "Poisson's ratio",
    unit: "unitless",
  },
  {
    group: "mechanical",
    property: "yieldStrength",
    label: "Yield strength",
    unit: "Pa",
  },
  {
    group: "mechanical",
    property: "ultimateTensileStrength",
    label: "Ultimate tensile strength",
    unit: "Pa",
  },
  {
    group: "thermal",
    property: "thermalConductivity",
    label: "Thermal conductivity",
    unit: "W/(m·K)",
  },
  {
    group: "thermal",
    property: "specificHeat",
    label: "Specific heat",
    unit: "J/(kg·K)",
  },
  {
    group: "thermal",
    property: "thermalExpansionCoefficient",
    label: "Thermal expansion coefficient",
    unit: "1/K",
  },
];

function cloneMaterial(material: Material): Material {
  return structuredClone(material);
}

function createMaterial(base?: Material): Material {
  const now = new Date().toISOString();
  if (base) {
    return {
      ...cloneMaterial(base),
      id: crypto.randomUUID(),
      name: `${base.name} copy`,
      basedOn: base.id,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    };
  }
  return {
    id: crypto.randomUUID(),
    name: "New material",
    category: "Custom",
    description: "",
    mechanical: {
      density: null,
      youngsModulus: null,
      poissonsRatio: null,
      yieldStrength: null,
      ultimateTensileStrength: null,
    },
    thermal: {
      thermalConductivity: null,
      specificHeat: null,
      thermalExpansionCoefficient: null,
    },
    appearance: { baseColor: "#72CFFF", metalness: 0, roughness: 0.45, opacity: 1 },
    sources: [],
    basedOn: null,
    builtIn: false,
    createdAt: now,
    updatedAt: now,
  };
}

function toNumber(value: string) {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getNumericValue(material: Material, group: PropertyGroup, property: NumericProperty) {
  const values = material[group] as unknown as Record<string, number | null>;
  return values[property];
}

export function MaterialManager({
  project,
  initialMaterialId,
  initialGeometryId,
  onProjectChange,
  onStatus,
  onClose,
}: MaterialManagerProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
  const [selectedId, setSelectedId] = useState(
    initialMaterialId ?? project.materials[0]?.id ?? null,
  );
  const [geometryId, setGeometryId] = useState(
    initialGeometryId ?? project.geometries[0]?.id ?? "",
  );
  const selected = project.materials.find((material) => material.id === selectedId) ?? null;
  const [draft, setDraft] = useState<Material | null>(() =>
    selected ? cloneMaterial(selected) : null,
  );
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty && draft?.id === selectedId) return;
    setDraft(selected ? cloneMaterial(selected) : null);
    setDirty(false);
  }, [dirty, draft?.id, selected, selectedId]);

  const filteredMaterials = useMemo(() => {
    if (!deferredSearch) return project.materials;
    return project.materials.filter((material) =>
      `${material.name} ${material.category} ${material.description}`
        .toLocaleLowerCase()
        .includes(deferredSearch),
    );
  }, [deferredSearch, project.materials]);

  const assignedGeometry = project.geometries.find((geometry) => geometry.id === geometryId);

  function updateDraft(update: (current: Material) => Material) {
    setDraft((current) => (current ? update(current) : current));
    setDirty(true);
  }

  function updateNumber(group: PropertyGroup, property: NumericProperty, value: string) {
    updateDraft((current) => ({
      ...current,
      [group]: { ...current[group], [property]: toNumber(value) },
    }));
  }

  async function handleSave() {
    if (!draft) return;
    setBusy(true);
    try {
      const updated = await upsertMaterial(project.id, draft);
      onProjectChange(updated);
      setDirty(false);
      onStatus(`Saved material “${draft.name}”.`);
    } catch (error) {
      onStatus(toUserMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!draft || !window.confirm(`Delete “${draft.name}” from this project?`)) return;
    setBusy(true);
    try {
      const updated = await deleteMaterial(project.id, draft.id);
      onProjectChange(updated);
      setSelectedId(updated.materials[0]?.id ?? null);
      onStatus(`Deleted material “${draft.name}”.`);
    } catch (error) {
      onStatus(toUserMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  function startMaterial(base?: Material) {
    const material = createMaterial(base);
    setSelectedId(material.id);
    setDraft(material);
    setDirty(true);
  }

  async function handleAssign(materialId: string | null) {
    if (!geometryId) return;
    setBusy(true);
    try {
      const updated = await assignMaterial(project.id, geometryId, materialId);
      onProjectChange(updated);
      const materialName = updated.materials.find((item) => item.id === materialId)?.name;
      onStatus(
        materialName
          ? `Assigned ${materialName} to ${assignedGeometry?.name ?? "geometry"}.`
          : `Cleared the material from ${assignedGeometry?.name ?? "geometry"}.`,
      );
    } catch (error) {
      onStatus(toUserMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    const sourcePath = await chooseMaterialFile();
    if (typeof sourcePath !== "string") return;
    setBusy(true);
    try {
      const previousCount = project.materials.length;
      const updated = await importMaterials(project.id, sourcePath);
      onProjectChange(updated);
      const importedCount = updated.materials.length - previousCount;
      setSelectedId(updated.materials.at(-1)?.id ?? selectedId);
      onStatus(`Imported ${importedCount} material${importedCount === 1 ? "" : "s"}.`);
    } catch (error) {
      onStatus(toUserMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function handleExport(all: boolean) {
    if (!draft && !all) return;
    const destination = await chooseMaterialExportFile(
      all ? "tesrig-material-library.json" : `${draft?.name ?? "material"}.json`,
    );
    if (typeof destination !== "string") return;
    setBusy(true);
    try {
      const path = await exportMaterials(project.id, all || !draft ? [] : [draft.id], destination);
      onStatus(`Exported material data to ${path}.`);
    } catch (error) {
      onStatus(toUserMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Materials" onClose={onClose}>
      <div className="material-manager">
        <aside className="material-browser">
          <div className="material-browser__actions">
            <Button variant="primary" onClick={() => startMaterial()} disabled={busy}>
              New
            </Button>
            <Button
              onClick={() => selected && startMaterial(selected)}
              disabled={busy || !selected}
            >
              Duplicate
            </Button>
          </div>
          <label className="material-search">
            <span className="sr-only">Search materials</span>
            <input
              type="search"
              placeholder="Search name, category…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="material-list" role="listbox" aria-label="Material library">
            {filteredMaterials.map((material) => (
              <button
                key={material.id}
                type="button"
                role="option"
                aria-selected={material.id === selectedId}
                className={material.id === selectedId ? "is-selected" : ""}
                onClick={() => setSelectedId(material.id)}
              >
                <span
                  className="material-swatch"
                  style={{ backgroundColor: material.appearance.baseColor }}
                />
                <span>
                  <strong>{material.name}</strong>
                  <small>{material.category}</small>
                </span>
              </button>
            ))}
            {filteredMaterials.length === 0 ? <p>No materials match this search.</p> : null}
          </div>
          <div className="material-browser__io">
            <Button onClick={() => void handleImport()} disabled={busy}>
              Import
            </Button>
            <Button
              onClick={() => void handleExport(true)}
              disabled={busy || dirty || !project.materials.length}
              title={dirty ? "Save this material before exporting the library" : undefined}
            >
              Export all
            </Button>
          </div>
        </aside>

        <section className="material-editor">
          {draft ? (
            <>
              <div className="material-editor__assignment">
                <label>
                  <span>Geometry</span>
                  <select
                    value={geometryId}
                    onChange={(event) => setGeometryId(event.target.value)}
                  >
                    {project.geometries.length === 0 ? <option value="">No geometry</option> : null}
                    {project.geometries.map((geometry) => (
                      <option key={geometry.id} value={geometry.id}>
                        {geometry.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Assigned material</span>
                  <select
                    value={assignedGeometry?.materialId ?? ""}
                    onChange={(event) => void handleAssign(event.target.value || null)}
                    disabled={!geometryId || busy || dirty}
                    title={dirty ? "Save this material before changing assignments" : undefined}
                  >
                    <option value="">Unassigned</option>
                    {project.materials.map((material) => (
                      <option key={material.id} value={material.id}>
                        {material.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="material-editor__scroll">
                <div className="material-editor__identity">
                  <div
                    className="material-color-preview"
                    style={{ background: draft.appearance.baseColor }}
                  />
                  <Field
                    id="material-name"
                    label="Name"
                    value={draft.name}
                    onChange={(event) =>
                      updateDraft((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                  <Field
                    id="material-category"
                    label="Category"
                    value={draft.category}
                    onChange={(event) =>
                      updateDraft((current) => ({ ...current, category: event.target.value }))
                    }
                  />
                </div>
                <TextAreaField
                  id="material-description"
                  label="Description / assumptions"
                  rows={2}
                  value={draft.description}
                  onChange={(event) =>
                    updateDraft((current) => ({ ...current, description: event.target.value }))
                  }
                />

                <fieldset className="material-property-group">
                  <legend>Physical properties · SI units</legend>
                  <div className="material-property-grid">
                    {numericFields.map(({ group, property, label, unit }) => (
                      <Field
                        key={property}
                        id={`material-${property}`}
                        label={label}
                        hint={unit}
                        type="number"
                        step="any"
                        value={getNumericValue(draft, group, property) ?? ""}
                        onChange={(event) => updateNumber(group, property, event.target.value)}
                      />
                    ))}
                  </div>
                </fieldset>

                <fieldset className="material-property-group">
                  <legend>Rendering appearance</legend>
                  <div className="material-appearance-grid">
                    <label className="field">
                      <span className="field__label">Base color</span>
                      <span className="material-color-input">
                        <input
                          type="color"
                          value={draft.appearance.baseColor}
                          onChange={(event) =>
                            updateDraft((current) => ({
                              ...current,
                              appearance: {
                                ...current.appearance,
                                baseColor: event.target.value.toUpperCase(),
                              },
                            }))
                          }
                        />
                        <input
                          className="field__control"
                          value={draft.appearance.baseColor}
                          pattern="#[0-9A-Fa-f]{6}"
                          onChange={(event) =>
                            updateDraft((current) => ({
                              ...current,
                              appearance: {
                                ...current.appearance,
                                baseColor: event.target.value,
                              },
                            }))
                          }
                        />
                      </span>
                    </label>
                    {(["metalness", "roughness", "opacity"] as const).map((property) => (
                      <label className="field material-range" key={property}>
                        <span className="field__label">
                          {property[0].toUpperCase() + property.slice(1)} ·{" "}
                          {draft.appearance[property].toFixed(2)}
                        </span>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={draft.appearance[property]}
                          onChange={(event) =>
                            updateDraft((current) => ({
                              ...current,
                              appearance: {
                                ...current.appearance,
                                [property]: Number(event.target.value),
                              },
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>

                {draft.sources.length ? (
                  <section className="material-sources">
                    <h3>Reference data</h3>
                    {draft.sources.map((source) => (
                      <div key={`${source.title}-${source.url}`}>
                        <strong>{source.title}</strong>
                        <span>{source.note}</span>
                        <small title={source.url}>{source.url}</small>
                      </div>
                    ))}
                  </section>
                ) : null}
                <p className="material-editor__notice">
                  Values are starting points. Confirm the exact grade, process, orientation, and
                  test temperature before analysis.
                </p>
              </div>

              <footer className="material-editor__actions">
                <Button onClick={() => void handleDelete()} disabled={busy || !selected}>
                  Delete
                </Button>
                <span />
                <Button onClick={() => void handleExport(false)} disabled={busy || dirty}>
                  Export selected
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void handleSave()}
                  disabled={busy || !dirty}
                >
                  {busy ? "Working…" : "Save material"}
                </Button>
              </footer>
            </>
          ) : (
            <div className="material-editor__empty">
              <h3>Create a material</h3>
              <p>Add a blank material, duplicate a catalog entry, or import MatML, JSON, or INP.</p>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
