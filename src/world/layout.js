// Shared world plan. ALL systems must place content according to this layout so districts fit together.
// Units: meters. +Y up. Main avenue runs along -Z ("north"). Street level y = 0.
export const LAYOUT = {
  // Main avenue (reference panel 1): road centered on x=0
  avenue: { x: 0, roadHalfWidth: 6, sidewalkWidth: 4, curbHeight: 0.15, zStart: 60, zEnd: -420 },
  // Cross streets (perpendicular, along X) at these z values
  crossStreets: { zs: [-60, -180, -300], roadHalfWidth: 5, sidewalkWidth: 3, xStart: -200, xEnd: 140 },
  // City blocks lining the avenue: buildings occupy x in [7+4, 11+blockDepth] on both sides
  blocks: { frontageOffset: 10, depth: 28, minHeight: 12, maxHeight: 60 },
  // Elevated rail + expressway crossing the avenue (panel 2 background, panel 1 overpass)
  elevatedRail: { z: -140, height: 14, width: 9, xStart: -400, xEnd: 400 },
  expressway: { z: -240, height: 22, width: 16, xStart: -400, xEnd: 400 },
  // River to the east running along Z (panel 3)
  river: { xCenter: 175, halfWidth: 35, waterLevel: -3.0, zStart: 200, zEnd: -700 },
  // Riverside promenade with cherry trees, on west bank (panel 3)
  promenade: { xMin: 128, xMax: 140, y: 0, zStart: 40, zEnd: -500 },
  bridges: [{ z: -260, deckY: 8 }],
  // Backstreet alley with stairs and lanterns (panel 4): runs west from the avenue
  alley: { z: -100, width: 4.5, xStart: -11, xEnd: -90, stairs: { xStart: -40, xEnd: -62, rise: 7 } },
  // Rooftop overlook balcony (panel 2 vantage): on east building looking north-east
  overlook: { position: [42, 26, -60], lookAt: [90, 20, -200] },
  // Skyline: mega towers placed in ring beyond these distances
  skyline: { innerRadius: 450, outerRadius: 1500, count: 140, megaTowerHeight: [150, 520] },
  // Player spawn
  spawn: { position: [3, 1.7, 20], yaw: 0 },
};

// Fixed camera views used by the screenshot harness (tools/shot.mjs) and the visual critics.
// Each corresponds to a panel of ref/target_reference.jpg, plus gameplay views.
export const SHOT_VIEWS = {
  street:   { pos: [1.5, 1.6, 30], look: [0.5, 3.5, -60], fov: 55, desc: 'Ref panel 1: wet neon avenue, ramen shop on left, car ahead, overpass in distance' },
  overlook: { pos: [42, 26, -60], look: [90, 22, -200], fov: 55, desc: 'Ref panel 2: rooftop balcony railing overlooking elevated rail, giant holo billboard, skyline' },
  river:    { pos: [133, 1.7, -10], look: [150, 8, -140], fov: 55, desc: 'Ref panel 3: cherry blossom riverside promenade, lanterns, river reflecting skyline' },
  alley:    { pos: [-30, 2.2, -100], look: [-70, 6.5, -100], fov: 55, desc: 'Ref panel 4: narrow alley with stairs going up, red lanterns, hanging wires, signs' },
  aerial:   { pos: [-60, 90, 120], look: [40, 10, -200], fov: 50, desc: 'Gameplay: aerial overview of the district and skyline' },
  ground:   { pos: [-4, 0.5, 5], look: [2, 1.2, -25], fov: 60, desc: 'Gameplay: low angle on wet road surface, reflections and rain splashes' },
};
