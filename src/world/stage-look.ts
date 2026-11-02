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
    shadow: { radius: 3, bias: -0.0005, normalBias: 0.02, mapSize: 2048 },
  },
  // Tower shell sizes in metres (task 2.3). The slab covers the tower footprint and sticks out past the glass by `glassInset`.
  tower: {
    slabThickness: 0.5,
    glassInset: 0.3,
    columnSize: 0.35,
    mullionSpacing: 6,
    parapetHeight: 0.6,
    parapetThickness: 0.3,
    parapetEdgeWidth: 0.25,
    parapetEdgeHeight: 0.06,
    glowWidth: 0.4,
    glowInset: 0.15,
    // Smallest gap between two faces that could z-fight; every offset below must be at least this.
    minGap: 0.01,
    // Every slab top sits this far above its floor level, so the lobby slab clears the ground top (y = 0) and the grid (`gridLift`).
    slabTopLift: 0.02,
    glowLift: 0.02,
  },
  // Floor layout sizes in metres (task 2.4). Changing any of these, or LAYOUT_SEED, moves every desk.
  interior: {
    wallThickness: 0.1,
    doorWidth: 1.2,
    // Floor-0 entrance gap in the glass; must stay narrower than a mullion bay minus `tower.columnSize`.
    entranceWidth: 3,
    // Floor-0 entrance portal frame: jambs this deep (across the glass plane) and wide, in the frame colour.
    portalDepth: 0.3,
    // Desk cluster footprint (4 desks) and the smallest office run: cluster plus 1 m door clearance.
    clusterSize: 3.2,
    minOfficeWidth: 4.2,
    clearance: 1,
    // Centre core half-size and ring corridor width; their sum is the ring's outer half-size.
    coreHalf: 7,
    corridorWidth: 2.4,
    // Rooms at the ends of the +z and -z strips reach this far past the ring's outer edge into the ring's span, so they touch a corridor.
    cornerContact: 2,
    // Floor-0 escalator base: width across, length along the run; the floor-1 landing is `width` square. Length plus
    // width must equal 2 * (ring outer half - cornerContact) so the run and landing tile the -z strip against the glass.
    escalator: { width: 1.6, length: 13.2 },
    // Rooftop server room: footprint and height; a `panel` roof slab tops the glass walls, and a lit floor plate (the cool-white glow) sits `glowInset` inside the walls.
    penthouse: {
      x: 10,
      z: 8,
      height: 3.5,
      roofThickness: 0.2,
      glowInset: 0.6,
      glowThickness: 0.04,
    },
    // Visual sizes for the rendered interior (DECISIONS #15): low partitions, open core frame (posts and beams), lobby furniture.
    partitionHeight: 1.2,
    coreFrameSize: 0.3,
    receptionDesk: { length: 3, depth: 0.8, height: 1.1 },
    chair: { size: 0.6, height: 0.8 },
    // Desk kit (task 2.5, design D23): per seat a desk top, a chair on its outer side, a monitor on its inner edge and a lamp. lampGain scales the lamp colour so it stays at or below the tower glow (intensity x linear luminance). plantRate is the chance a 2 x 2 pod has a plant; tintRange the most a desk top's lightness varies either way (E1).
    desk: {
      top: { length: 1.4, depth: 0.7, height: 0.75 },
      monitor: { width: 0.55, height: 0.35, stand: 0.1, depth: 0.04, inset: 0.02 },
      lamp: { height: 0.45, head: 0.14 },
      plant: { width: 0.3, height: 0.5 },
      lampGain: 0.35,
      plantRate: 1 / 3,
      tintRange: 0.04,
    },
  },
  // Dev overlay type: labels (zone overlay, palette board swatches) and headings (board title, rows, failure line).
  zonesOverlayLabelPx: 11,
  overlayHeadingPx: 13,
  zonesOverlayPillPx: 18,
  zonesOverlayHideFloorsBelowPx: 22,
  // Palette board swatch labels hide below this projected slot pitch; widest label is 119.3 px at 11 px type.
  paletteHideSwatchLabelsBelowPx: 120,
} as const;
