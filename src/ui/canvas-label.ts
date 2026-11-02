import type { FloorsReport } from "../world/Stage";

const GENERIC_LABEL = "Nexus One campus, isometric view";

// The name follows what is drawn: the tower's floor count once Stage has validated it, generic otherwise.
export const canvasLabel = (report: FloorsReport | null) =>
  report?.towerVisible
    ? `Nexus One campus: glass office tower, ${report.floors} floors, isometric view`
    : GENERIC_LABEL;
