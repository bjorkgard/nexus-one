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
  key: {
    color: "#ffd9a8",
    intensity: 3.4,
    direction: [-0.5, 2, 1.5] as const,
    shadow: { radius: 3, bias: -0.0005, normalBias: 0.02 },
  },
  // Tower shell sizes in metres (task 2.3). The slab covers the tower footprint and sticks out past the glass by `glassInset`.
  tower: {
    slabThickness: 0.5,
    glassInset: 0.3,
    columnSize: 0.35,
    mullionSpacing: 6,
    parapetHeight: 0.6,
    parapetThickness: 0.3,
    parapetEdgeWidth: 0.1,
    parapetEdgeHeight: 0.04,
    glowWidth: 0.18,
    glowInset: 0.15,
    // Smallest gap between two faces that could z-fight; every offset below must be at least this.
    minGap: 0.01,
    // Every slab top sits this far above its floor level, so the lobby slab clears the ground top (y = 0) and the grid (`gridLift`).
    slabTopLift: 0.02,
    glowLift: 0.02,
  },
  // Dev overlay type: labels (zone overlay, palette board swatches) and headings (board title, rows, failure line).
  zonesOverlayLabelPx: 11,
  overlayHeadingPx: 13,
  zonesOverlayPillPx: 18,
  zonesOverlayHideFloorsBelowPx: 22,
  // Palette board swatch labels hide below this projected slot pitch; widest label is 119.3 px at 11 px type.
  paletteHideSwatchLabelsBelowPx: 120,
} as const;
