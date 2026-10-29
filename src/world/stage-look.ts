// Every look constant for the stage except surface colours, which come from src/shared/tokens.ts.
// Light colours stay here with the light intensities until 6.1 takes over lights and exposure;
// 2.2 takes over material colours.
export const LOOK = {
  dpr: [1, 2] as [number, number],
  exposure: 1,
  slabSize: 120,
  slabThickness: 1.4,
  // No palette or variant emissiveIntensity above this: AgX pushes brighter emissive toward white.
  emissiveCeiling: 1.5,
  gridLift: 0.01,
  gridCellSize: 1,
  gridSectionSize: 10,
  gridCellThickness: 0.45,
  gridSectionThickness: 1,
  // Cell lines fade out as the projected cell size drops from `gridFadeFromPx` to `gridFadeToPx`.
  gridFadeFromPx: 10,
  gridFadeToPx: 6,
  hemisphere: { sky: "#9ab8ff", ground: "#0a0e14", intensity: 3.5 },
  key: { color: "#ffd9a8", intensity: 3.4, direction: [-0.5, 2, 1.5] as const },
  zonesOverlayLabelPx: 11,
  zonesOverlayPillPx: 18,
  zonesOverlayHideFloorsBelowPx: 22,
} as const;
