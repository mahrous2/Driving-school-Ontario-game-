/* Scenario definitions: map, start, examiner route, traffic and scripted events.
 * Add a scenario by pushing another object onto DS.SCENARIOS (see README for the schema).
 */
(function () {
  'use strict';
  const DS = window.DS, U = DS.U;
  const K = DS.ScenarioKit;
  const S = (DS.SCENARIOS = []);

  // ======================================================================
  // 1. Downtown Toronto — streetcars, bike lanes, one-way streets
  // ======================================================================
  S.push({
    id: 'downtown', name: 'Downtown & Streetcars', level: 'G2',
    desc: 'Queen St streetcars with open doors, bike lanes on Bay St, a one-way street, a "No Right Turn on Red" sign and busy crosswalks. Limit 40 km/h.',
    skills: ['Streetcar stops (HTA 166)', 'Right-turn shoulder checks for cyclists', 'One-way streets', 'No right turn on red', 'Pedestrians at crosswalks'],
    style: 'downtown', seed: 11,
    map: () => ({
      bounds: { x0: -420, x1: 420, y0: -400, y1: 400 },
      roads: [
        { name: 'Dundas St W', axis: 'h', c: 130, a0: -400, a1: 400, lanes: [1, 1], limit: 40 },
        { name: 'Queen St W', axis: 'h', c: 0, a0: -400, a1: 400, lanes: [2, 2], streetcar: true, limit: 40 },
        { name: 'Richmond St W', axis: 'h', c: -130, a0: -400, a1: 400, lanes: [0, 3], bike: true, limit: 40 },
        { name: 'Spadina Ave', axis: 'v', c: -160, a0: -380, a1: 380, lanes: [2, 2], limit: 40 },
        { name: 'Peter St', axis: 'v', c: 0, a0: -380, a1: 380, lanes: [1, 1], limit: 40 },
        { name: 'Bay St', axis: 'v', c: 160, a0: -380, a1: 380, lanes: [2, 2], bike: true, limit: 40 },
      ],
      nodes: {
        'Dundas St W|Spadina Ave': { control: 'signal' }, 'Dundas St W|Peter St': { control: 'stop4' }, 'Dundas St W|Bay St': { control: 'signal' },
        'Queen St W|Spadina Ave': { control: 'signal' }, 'Queen St W|Peter St': { control: 'signal' }, 'Queen St W|Bay St': { control: 'signal', offset: 0 },
        'Richmond St W|Spadina Ave': { control: 'signal' }, 'Richmond St W|Peter St': { control: 'signal', rtorBan: [1], offset: 20 }, 'Richmond St W|Bay St': { control: 'signal' },
      },
      features: [
        { type: 'streetcarStop', road: 'Queen St W', dir: 1, s: -40 }, { type: 'streetcarStop', road: 'Queen St W', dir: 1, s: 125 },
        { type: 'streetcarStop', road: 'Queen St W', dir: -1, s: 40 }, { type: 'streetcarStop', road: 'Queen St W', dir: -1, s: -125 },
      ],
    }),
    start: { road: 'Queen St W', dir: 1, s: -285, parked: true },
    traffic: { cars: 24, peds: 36, bikes: 8 },
    vehicleMix: { car: 5, suv: 2, van: 1, taxi: 1.6, truck: 0.3 },
    checkpoints: [
      { road: 'Queen St W', dir: 1, s: 30, label: 'Stay behind the streetcar when its doors open' },
      { road: 'Bay St', dir: -1, s: -50, label: 'Right turn: check your RIGHT blind spot for cyclists (C)' },
      { road: 'Richmond St W', dir: -1, s: 90, label: 'Richmond St is one-way westbound' },
      { road: 'Peter St', dir: 1, s: -60, label: 'Watch for the "No Right Turn on Red" sign' },
      { road: 'Peter St', dir: 1, s: 80 },
      { road: 'Dundas St W', dir: -1, s: -75, type: 'park', label: 'All-way stop at Dundas, then pull over' },
    ],
    setup(G) {
      const stops = G.net.features.filter((f) => f.type === 'streetcarStop');
      const add = (dir, roadS) => { const v = K.spawnOn(G, 'Queen St W', dir, 0, roadS, 'streetcar', { v: 6, script: DS.Special.streetcarScript(stops), personal: 1 }); if (v) v.keep = true; return v; };
      add(1, -215); add(1, 150); add(-1, 220); add(-1, -60);
      this._streetcarStops = stops;
    },
    tick(G) {
      // keep streetcars running in both directions
      const sc = G.traffic.vehicles.filter((v) => v.type === 'streetcar');
      for (const dir of [1, -1]) {
        if (sc.filter((v) => v.seg.dir === dir || (v.seg.conn && v.seg.fromSeg.dir === dir)).length < 2) {
          const roadS = dir > 0 ? -390 : 390;
          if (G.traffic.freeAt(G.net.segAt(G.net.road('Queen St W'), dir, 0, roadS), 2, 25)) {
            const v = K.spawnOn(G, 'Queen St W', dir, 0, roadS, 'streetcar', { v: 8, script: DS.Special.streetcarScript(this._streetcarStops) });
            if (v) v.keep = true;
          }
        }
      }
    },
    events: [],
  });

  // ======================================================================
  // 2. Suburban — 4-way stops, school zone, school buses, PXO, crossing guard
  // ======================================================================
  S.push({
    id: 'suburban', name: 'Suburban 4-Way Stops & School Zones', level: 'G2',
    desc: 'All-way stop priority puzzles, a flashing 40 km/h school zone with a crossing guard, school buses stopping in both directions, a pedestrian crossover and an ambulance.',
    skills: ['All-way stop right-of-way', 'School bus — both directions (HTA 175)', 'Crossing guards & PXOs', 'Right turn on red', 'Pull over for emergency vehicles'],
    style: 'suburban', seed: 23,
    map: () => ({
      bounds: { x0: -410, x1: 410, y0: -410, y1: 410 },
      roads: [
        { name: 'Oak Cres', axis: 'h', c: 180, a0: -390, a1: 390, lanes: [1, 1], limit: 40 },
        { name: 'Maple Ave', axis: 'h', c: 0, a0: -390, a1: 390, lanes: [1, 1], limit: 50 },
        { name: 'Main St', axis: 'h', c: -180, a0: -390, a1: 390, lanes: [2, 2], limit: 60 },
        { name: 'Birch Rd', axis: 'v', c: -200, a0: -390, a1: 390, lanes: [1, 1], limit: 50 },
        { name: 'Cedar Dr', axis: 'v', c: 0, a0: -390, a1: 390, lanes: [1, 1], limit: 50 },
        { name: 'Pine St', axis: 'v', c: 200, a0: -390, a1: 390, lanes: [2, 2], limit: 60 },
      ],
      nodes: {
        'Oak Cres|Birch Rd': { control: 'stop4' }, 'Oak Cres|Cedar Dr': { control: 'stop4' }, 'Oak Cres|Pine St': { control: 'stop2', stopArms: [1, 3] },
        'Maple Ave|Birch Rd': { control: 'stop4' }, 'Maple Ave|Cedar Dr': { control: 'stop4' }, 'Maple Ave|Pine St': { control: 'signal' },
        'Main St|Birch Rd': { control: 'stop2', stopArms: [0, 2] }, 'Main St|Cedar Dr': { control: 'stop2', stopArms: [0, 2] }, 'Main St|Pine St': { control: 'signal', offset: 4 },
      },
      features: [
        { type: 'schoolZone', road: 'Maple Ave', s0: -185, s1: -20, limit: 40 },
        { type: 'schoolCrossing', road: 'Maple Ave', s: -150 },
        { type: 'pxo', road: 'Cedar Dr', s: 95 },
      ],
    }),
    landmarks: [{ type: 'school', x: -120, y: 42, w: 64, d: 34 }],
    start: { road: 'Birch Rd', dir: 1, s: -120, parked: true },
    traffic: { cars: 16, peds: 10, bikes: 0 },
    vehicleMix: { car: 5, suv: 3, van: 1, truck: 0.2 },
    checkpoints: [
      { road: 'Maple Ave', dir: 1, s: -160, label: 'All-way stop: first to stop goes first; tie → yield to the right' },
      { road: 'Maple Ave', dir: 1, s: -30, label: 'School zone 40 km/h when flashing — crossing guard ahead' },
      { road: 'Cedar Dr', dir: 1, s: 50, label: 'Pedestrian crossover ahead' },
      { road: 'Oak Cres', dir: 1, s: 90 },
      { road: 'Pine St', dir: -1, s: 90, label: 'Two-way stop: yield to Pine St traffic' },
      { road: 'Main St', dir: -1, s: 140, label: 'Right turn on red is allowed here after a full stop' },
      { road: 'Main St', dir: -1, s: 35, type: 'park', label: 'Pull over and park at the right curb' },
    ],
    events: [
      { // 4-way stop puzzle: two cars arrive at Maple & Birch with the student
        when: (G) => K.on(G, 'Birch Rd', 1, -95),
        run: (G) => { K.spawnOn(G, 'Maple Ave', 1, 0, -262, 'car', { v: 11 }); K.spawnOn(G, 'Maple Ave', -1, 0, -140, 'suv', { v: 10 }); DS.Bus.emit('hint', 'All-way stop ahead: remember who stopped first. Same time? The vehicle on the RIGHT goes first.'); },
      },
      { // crossing guard + children
        when: (G) => K.on(G, 'Maple Ave', 1, -194),
        run: (G) => { const f = G.net.features.find((x) => x.type === 'schoolCrossing'); G.peds.spawnGuardRoutine(f, 4); },
      },
      { // oncoming school bus stops and unloads children
        when: (G) => K.on(G, 'Maple Ave', 1, -128),
        run: (G) => {
          const v = K.spawnOn(G, 'Maple Ave', -1, 0, -36, 'schoolbus', { v: 6, script: DS.Special.schoolBusScript(-62, { kids: 3, minTime: 10 }) });
          if (v) { v.keep = true; DS.Bus.emit('hint', 'School bus approaching from the opposite direction. Without a median, BOTH directions must stop for its red lights.'); }
        },
      },
      { // PXO pedestrian
        when: (G) => K.on(G, 'Cedar Dr', 1, 25),
        run: (G) => { const f = G.net.features.find((x) => x.type === 'pxo'); G.peds.spawnFeatureCrossing(f, { count: 1, fromLow: false }); },
      },
      { // school bus ahead in the same direction on Oak Cres
        when: (G) => K.on(G, 'Oak Cres', 1, 12),
        run: (G) => { const v = K.spawnOn(G, 'Oak Cres', 1, 0, 55, 'schoolbus', { v: 8, script: DS.Special.schoolBusScript(122, { kids: 2, minTime: 9 }) }); if (v) v.keep = true; },
      },
      { // ambulance from behind on Main St
        when: (G) => K.on(G, 'Main St', -1, 150),
        run: (G) => { if (DS.Special.spawnEmergencyBehind(G, 'ambulance', 120)) DS.Bus.emit('siren'); },
      },
    ],
  });

  // ======================================================================
  // 3. Highway 401 — merging, Move Over, following distance, exiting
  // ======================================================================
  const RAMP_ON = U.bezier3({ x: 40, y: -185 }, { x: 40, y: -70 }, { x: 160, y: -16.125 }, { x: 335, y: -16.125 }, 30);
  const RAMP_OFF = U.bezier3({ x: 2885, y: -16.125 }, { x: 3020, y: -16.125 }, { x: 3110, y: -60 }, { x: 3125, y: -230 }, 30);
  S.push({
    id: 'highway', name: 'Highway 401 Merging & Lane Changes', level: 'G',
    desc: '400-series freeway at 100 km/h: use the acceleration lane, shoulder-check and merge, keep a 3-second gap, Move Over for police on the shoulder, yield to an ambulance and take the exit using the deceleration lane.',
    skills: ['Acceleration lane & merging', 'Shoulder checks at speed', '3-second following distance', 'Move Over law (HTA 159)', 'Exiting via deceleration lane'],
    style: 'highway', seed: 401,
    map: () => ({
      bounds: { x0: -320, x1: 3650, y0: -420, y1: 420 },
      roads: [
        { name: 'Hwy 401', axis: 'h', c: 0, a0: -300, a1: 3600, lanes: [3, 3], laneW: 3.75, median: 6, shoulder: 3, limit: 100, sidewalk: false, kind: 'highway',
          aux: [{ dir: 1, s0: 335, s1: 640, kind: 'accel', solidEnd: 400 }, { dir: 1, s0: 2600, s1: 2885, kind: 'decel', solidStart: 2825 }] },
      ],
      ramps: [
        { id: 'on', name: 'On-ramp to 401 East', pts: RAMP_ON, width: 4.5, limit: 100 },
        { id: 'off', name: 'Exit 365 — Westbrook Rd', pts: RAMP_OFF, width: 4.5, limit: 80 },
      ],
      features: [
        { type: 'shield', road: 'Hwy 401', dir: 1, s: 450 },
        { type: 'gantry', road: 'Hwy 401', dir: 1, s: 1900, text: 'EXIT 365|Westbrook Rd|1 km', w: 6.5 },
        { type: 'gantry', road: 'Hwy 401', dir: 1, s: 2560, text: 'EXIT 365|Westbrook Rd|EXIT ONLY ⟶', w: 5, q: 3 + 3 * 3.75 + 1.9 },
      ],
    }),
    start: { ramp: 'on', s: 6 },
    startParked: false,
    traffic: { cars: 34, peds: 0, bikes: 0 },
    vehicleMix: { car: 5, suv: 3, van: 1, truck: 1.4 },
    despawnDist: 520,
    wantsExit: true,
    checkpoints: [
      { road: 'Hwy 401', dir: 1, s: 700, instr: 'Accelerate on the ramp to ~100 km/h. Signal LEFT, check mirror (X) and LEFT blind spot (Z), then merge into a safe gap.', label: 'Do not stop in the acceleration lane' },
      { road: 'Hwy 401', dir: 1, s: 1350, instr: 'Police vehicle stopped on the right shoulder ahead — MOVE OVER one lane (or slow down if you can not).', label: 'Move Over law — HTA s.159' },
      { road: 'Hwy 401', dir: 1, s: 2150, instr: 'Keep right except to pass. Maintain at least a 3-second following distance.', label: 'Watch your mirrors' },
      { road: 'Hwy 401', dir: 1, s: 2700, instr: 'Take EXIT 365: signal RIGHT, mirror + RIGHT blind spot, enter the deceleration lane, THEN slow down.', label: 'Do not cross the painted gore' },
      { ramp: 'off', s: 230, type: 'end', instr: 'Slow to the ramp speed and follow Exit 365.', label: 'Ramp advisory 60 km/h' },
    ],
    setup(G) {
      DS.Special.placeStaticPolice(G, 'Hwy 401', 1, 2, 1500, 3.4);
    },
    spawn(G, traffic) {
      // spawn ahead or behind the student on random lanes
      const P = G.player, r = G.net.road('Hwy 401');
      const dir = Math.random() < 0.72 ? 1 : -1;
      const lane = U.randInt(0, 2);
      const base = Math.max(P.x, 340);
      const sRoad = dir > 0 ? base + (Math.random() < 0.55 ? U.rand(160, 420) : -U.rand(140, 330)) : base + U.rand(-300, 450);
      if (sRoad < r.a0 + 20 || sRoad > r.a1 - 20) return;
      const seg = G.net.segAt(r, dir, lane, sRoad);
      if (!seg) return;
      const s = (sRoad - seg.sStart) * dir;
      if (!traffic.freeAt(seg, s, 30)) return;
      const type = traffic.randomType();
      const pers = type === 'truck' ? U.rand(0.9, 1.0) : U.rand(0.95, 1.16);
      traffic.add(type, seg, s, { v: (100 / 3.6) * pers, personal: pers });
    },
    events: [
      { // a platoon in the right lane to make the merge interesting
        when: (G) => G.playerLoc.ramp && G.playerLoc.rampS > 60,
        run: (G) => {
          const r = G.net.road('Hwy 401');
          for (const sRoad of [190, 225, 300]) {
            const seg = G.net.segAt(r, 1, 2, sRoad);
            if (seg && G.traffic.freeAt(seg, sRoad - seg.sStart, 20)) G.traffic.add(U.pick(['car', 'suv', 'truck']), seg, sRoad - seg.sStart, { v: 27, personal: 0.98 });
          }
        },
      },
      { // ambulance from behind in the left lane
        when: (G) => K.on(G, 'Hwy 401', 1, 1850),
        run: (G) => { const ev = DS.Special.spawnEmergencyBehind(G, 'ambulance', 160); if (ev) { DS.Bus.emit('siren'); } },
      },
    ],
  });

  // ======================================================================
  // 4. Rural roads & roundabouts
  // ======================================================================
  S.push({
    id: 'roundabout', name: 'Roundabouts & Rural Roads', level: 'G2',
    desc: 'Two single-lane roundabouts on an 80 km/h regional road, a two-way stop on a side road and an emergency vehicle. Try it with Winter Mode for black ice!',
    skills: ['Yield to traffic in the roundabout', 'Counter-clockwise circulation', 'Signal right to exit', 'Two-way stops', 'Speed changes (80 → 60)'],
    style: 'rural', seed: 77,
    map: () => ({
      bounds: { x0: -700, x1: 800, y0: -560, y1: 560 },
      roads: [
        { name: 'Regional Rd 7', axis: 'h', c: 0, a0: -680, a1: 780, lanes: [1, 1], limit: 80, sidewalk: false, rural: true },
        { name: 'Concession 6', axis: 'v', c: 0, a0: -520, a1: 520, lanes: [1, 1], limit: 80, sidewalk: false, rural: true },
        { name: 'Sideroad 15', axis: 'v', c: -420, a0: -360, a1: 360, lanes: [1, 1], limit: 60, sidewalk: false, rural: true },
        { name: 'Townline Rd', axis: 'v', c: 420, a0: -360, a1: 420, lanes: [1, 1], limit: 60, sidewalk: false, rural: true },
      ],
      nodes: {
        'Regional Rd 7|Concession 6': { control: 'roundabout', ring: { r0: 10, r1: 20 } },
        'Regional Rd 7|Townline Rd': { control: 'roundabout', ring: { r0: 9, r1: 19 } },
        'Regional Rd 7|Sideroad 15': { control: 'stop2', stopArms: [0, 2] },
      },
      features: [
        { type: 'limit', road: 'Regional Rd 7', s0: -160, s1: 160, limit: 60 },
        { type: 'limit', road: 'Regional Rd 7', s0: 280, s1: 560, limit: 60 },
        { type: 'limit', road: 'Concession 6', s0: -160, s1: 160, limit: 60 },
      ],
    }),
    start: { road: 'Sideroad 15', dir: 1, s: -260, parked: true },
    traffic: { cars: 20, peds: 0, bikes: 0 },
    vehicleMix: { car: 5, suv: 3, van: 1, truck: 0.8 },
    despawnDist: 450,
    checkpoints: [
      { road: 'Regional Rd 7', dir: 1, s: -330, label: 'Stop sign: yield to Regional Rd 7 traffic in both directions' },
      { road: 'Regional Rd 7', dir: 1, s: 150, label: 'Yield to vehicles already in the roundabout (from your LEFT)' },
      { road: 'Townline Rd', dir: 1, s: 90, label: 'Signal RIGHT as you pass the exit before yours' },
      { road: 'Townline Rd', dir: 1, s: 230, type: 'park', label: 'Pull over onto the right shoulder and stop' },
    ],
    setup(G) {
      // steady traffic through the roundabouts
      for (const [rd, dir, s] of [['Concession 6', 1, -150], ['Concession 6', -1, 140], ['Regional Rd 7', -1, 120], ['Regional Rd 7', -1, 330]]) K.spawnOn(G, rd, dir, 0, s, 'car', { v: 14 });
    },
    events: [
      { when: (G) => K.on(G, 'Regional Rd 7', 1, -60), run: (G) => { K.spawnOn(G, 'Concession 6', 1, 0, -70, 'suv', { v: 12 }); K.spawnOn(G, 'Regional Rd 7', -1, 0, 80, 'car', { v: 13, fixedRoute: ['R'] }); } },
      { when: (G) => K.on(G, 'Regional Rd 7', 1, 190), run: (G) => { if (DS.Special.spawnEmergencyBehind(G, 'fire', 150)) DS.Bus.emit('siren'); } },
    ],
  });

  // ======================================================================
  // 5. Full mock road test (G2)
  // ======================================================================
  S.push({
    id: 'mock', name: 'Mock G2 Road Test', level: 'G2 TEST', defaultMode: 'test',
    desc: 'A complete examiner-led route through town: signals, all-way stops, a roundabout, a pedestrian crossover, a school zone, a one-way street, lane changes and a final curb park. One dangerous action = automatic fail.',
    skills: ['Everything!', 'Examiner directions', 'Pass mark: 80 with no dangerous actions'],
    style: 'suburban', seed: 5,
    map: () => ({
      bounds: { x0: -410, x1: 410, y0: -410, y1: 410 },
      roads: [
        { name: 'King St', axis: 'h', c: 150, a0: -400, a1: 400, lanes: [1, 1], limit: 50 },
        { name: 'Main St', axis: 'h', c: 0, a0: -400, a1: 400, lanes: [1, 1], limit: 50 },
        { name: 'Lakeshore Rd', axis: 'h', c: -160, a0: -400, a1: 400, lanes: [2, 2], limit: 60 },
        { name: 'Elm St', axis: 'v', c: -220, a0: -390, a1: 390, lanes: [1, 1], limit: 50 },
        { name: 'Centre St', axis: 'v', c: 0, a0: -390, a1: 390, lanes: [1, 1], limit: 50 },
        { name: 'Victoria St', axis: 'v', c: 220, a0: -390, a1: 390, lanes: [2, 0], limit: 40 },
      ],
      nodes: {
        'King St|Elm St': { control: 'stop4' }, 'King St|Centre St': { control: 'stop4' }, 'King St|Victoria St': { control: 'signal' },
        'Main St|Elm St': { control: 'signal', offset: 6 }, 'Main St|Centre St': { control: 'roundabout', ring: { r0: 9, r1: 19 } }, 'Main St|Victoria St': { control: 'signal' },
        'Lakeshore Rd|Elm St': { control: 'signal' }, 'Lakeshore Rd|Centre St': { control: 'signal', rtorBan: [2] }, 'Lakeshore Rd|Victoria St': { control: 'signal' },
      },
      features: [
        { type: 'schoolZone', road: 'King St', s0: -200, s1: -25, limit: 40 },
        { type: 'pxo', road: 'Centre St', s: 80 },
      ],
    }),
    landmarks: [{ type: 'school', x: -110, y: 190, w: 60, d: 30 }],
    start: { road: 'Elm St', dir: 1, s: -90, parked: true },
    traffic: { cars: 18, peds: 14, bikes: 0 },
    vehicleMix: { car: 5, suv: 3, van: 1, truck: 0.2 },
    checkpoints: [
      { road: 'Main St', dir: 1, s: -150 },
      { road: 'Centre St', dir: 1, s: 40 },
      { road: 'King St', dir: -1, s: -40 },
      { road: 'Elm St', dir: -1, s: 80 },
      { road: 'Lakeshore Rd', dir: 1, s: -120 },
      { road: 'Victoria St', dir: 1, s: -60 },
      { road: 'Victoria St', dir: 1, s: 70, type: 'park', label: 'Pull over to the right curb and park' },
    ],
    events: [
      { when: (G) => K.on(G, 'Centre St', 1, 30), run: (G) => { const f = G.net.features.find((x) => x.type === 'pxo'); G.peds.spawnFeatureCrossing(f, { count: 2, fromLow: true }); } },
      { when: (G) => K.on(G, 'King St', -1, -10), run: (G) => { const v = K.spawnOn(G, 'King St', 1, 0, -205, 'schoolbus', { v: 7, script: DS.Special.schoolBusScript(-120, { kids: 3, minTime: 9 }) }); if (v) v.keep = true; } },
      { when: (G) => K.on(G, 'Lakeshore Rd', 1, -150), run: (G) => { if (DS.Special.spawnEmergencyBehind(G, 'ambulance', 130)) DS.Bus.emit('siren'); } },
    ],
  });
})();
