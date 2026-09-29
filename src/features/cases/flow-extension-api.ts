/**
 * Serializable contract for flow visualizations. A future Python host only needs
 * to publish descriptors and snapshot data in this shape; the React/Three viewer
 * does not need to know whether a probe is built in or Python-backed.
 */
export interface FlowVisualizationExtension {
  id: string;
  label: string;
  source: "builtin" | "python";
  metric: "area" | "volume";
  capabilities: Array<"streamlines" | "surface-selection" | "section-plane">;
}

const extensions = new Map<string, FlowVisualizationExtension>();

export function registerFlowVisualizationExtension(extension: FlowVisualizationExtension) {
  extensions.set(extension.id, extension);
  return () => extensions.delete(extension.id);
}

export function listFlowVisualizationExtensions() {
  return [...extensions.values()];
}

[
  ["domain", "Domain streamlines", "area", ["streamlines"]],
  ["line", "Line probe", "area", ["streamlines"]],
  ["point", "Point + radius", "volume", ["streamlines"]],
  ["connections", "Inlet to outlets", "area", ["streamlines"]],
  ["surface", "Surface contact flow", "area", ["streamlines", "surface-selection"]],
  ["slice", "2D section", "area", ["streamlines", "section-plane"]],
].forEach(([id, label, metric, capabilities]) => {
  registerFlowVisualizationExtension({
    id: id as string,
    label: label as string,
    metric: metric as "area" | "volume",
    capabilities: capabilities as FlowVisualizationExtension["capabilities"],
    source: "builtin",
  });
});
