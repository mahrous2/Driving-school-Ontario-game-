# Ontario Road Test Simulator (G2 & G)

A browser-based 3D driving simulator (Three.js) for practising **Ontario road rules** and **MTO road-test
manoeuvres**. An on-board "examiner" watches every move, deducts points for violations and explains the rule
that was broken, what the MTO Driver's Handbook teaches, and the Highway Traffic Act (HTA) section.

> Training aid only. Rule text is paraphrased from the Official MTO Driver's Handbook and the HTA. Always refer
> to the current official publications.

## Running it

No build step and no install. Three.js r128 is vendored in `vendor/`, so it also works offline.

* **Easiest:** open `index.html` in Chrome, Edge, Firefox or Safari. Classic scripts are used, so `file://` works.
* **Or serve it:** `python3 -m http.server 8000`, then open <http://localhost:8000>.

Handy URL parameters: `?scenario=highway&weather=snow&view=top&autostart=1`.

## Controls

| Key | Action | Key | Action |
|---|---|---|---|
| W / ↑ | Accelerate (progressive) | S / ↓ / Space | Brake (progressive) |
| A D / ← → | Steer | R | Drive ⇄ Reverse (when stopped) |
| P | Park | B | Seatbelt |
| Q / E | Left / right signal (cancels itself after a real turn) | H | Hazard lights |
| L | Headlights | V | Camera: cockpit → chase → top-down |
| **Z** | **Left shoulder check** (the head turns in cockpit view) | **C** | **Right shoulder check** |
| **X** | **Mirror check** | + / − | Zoom the top-down view |
| Esc | Pause | M | Mute |

The Z / X / C checks are also clickable buttons on the dashboard. Their green bars show how recently each check
was done, and the examiner looks at those times before lane changes, merges, pulling out and turns.

## Scenarios

1. **Downtown & Streetcars (G2).** Streetcars on Queen St stop with their doors open, so you must stop 2 m behind
   the rear doors (HTA 166). Also: bike lanes on Bay St (right shoulder check for cyclists), the one-way Richmond
   St, a "No Right Turn on Red" sign and busy crosswalks.
2. **Suburban 4-Way Stops & School Zones (G2).** All-way stop priority puzzles, a flashing 40 km/h school zone with
   a crossing guard, school buses stopping in *both* directions (HTA 175), a pedestrian crossover (PXO), a two-way
   stop, a legal right turn on red, and an ambulance from behind.
3. **Highway 401 (G).** Acceleration lane and merge, shoulder checks at speed, the 3-second following distance, the
   Move Over law for police stopped on the shoulder (HTA 159), an ambulance from behind, and the exit through the
   deceleration lane.
4. **Roundabouts & Rural Roads (G2).** Two single-lane roundabouts (yield to traffic already circulating, travel
   counter-clockwise, signal right to exit), a two-way stop, 80 → 60 km/h zones and a fire truck.
5. **Mock G2 Road Test.** A full examiner-led route through town. One dangerous action is an automatic fail.

**Conditions** (any scenario):

* Clear, rain (μ ≈ 0.72), or **Canadian Winter**: snow (μ ≈ 0.38) plus **black-ice patches** (μ ≈ 0.12), falling
  snow and snowbanks. Following-distance and speed expectations scale with the weather.
* Day or night. Headlights are required at night and in rain or snow (HTA 62).
* **Practice mode** gives hints and praise, and you keep driving after errors. **Mock Road Test mode** shows no
  hints and ends the test on a dangerous action.

## What the examiner checks

| Area | Rules |
|---|---|
| Speed | Posted limits, school zones when flashing, too fast for winter conditions, too slow on the highway |
| Stop signs | No stop, rolling stop, stopping past the line, all-way stop order (first to stop; on a tie, the vehicle on the right goes first), yielding after a two-way stop, hesitating |
| Signals | Red light, stale amber, right on red (full stop; 3-second training standard; **No Right Turn on Red** signs; yield), unprotected left turns across oncoming traffic |
| Vulnerable road users | Pedestrians in crosswalks, PXOs (wait until the pedestrian has *fully* crossed), school crossing guards, cyclists in bike lanes |
| Special vehicles | School buses with red lights (20 m behind; both directions unless there is a median), streetcar doors, emergency vehicles (pull right and stop), Move Over / slow down |
| Lanes | Signal, mirror and shoulder check for lane changes, unsafe gaps, forcing another driver to brake hard, keep right, wrong way on a one-way street, left of centre, bike lanes |
| Highway | Merge signal, shoulder check and speed, running out of the acceleration lane, crossing the painted gore, slowing in a through lane, reversing, hazard lights on the shoulder |
| Roundabouts | Yield on entry, wrong-way travel, exit signal, speed |
| Vehicle handling | Seatbelt, headlights, curb mounting, leaving the road, skids, collisions |
| Manoeuvres | Pulling out from the curb (signal and shoulder check), pulling over and parking (signal, check, distance from the curb) |

Severity follows road-test conventions:

* **Minor:** 2–5 points.
* **Major:** 10–15 points.
* **Dangerous action:** 25+ points, and an automatic fail in a mock test.

The pass mark is **80 or more with no dangerous actions**. The end-of-drive report groups every violation with its
rule, its MTO explanation, the HTA reference and a tip, and also lists what you did well.

## Views and teaching aids

* **Driver cockpit.** Live rear-view and side mirrors (mirrored render targets). The camera turns your head during
  shoulder checks, so you actually see into the blind spot.
* **Chase camera.**
* **Top-down tactical view.** Blind-spot zones beside the car turn red when a vehicle is in them, and a bar on the
  road shows your current stopping distance (1.5 s reaction plus braking at the current grip).
* **HUD.**
  * Examiner instructions with distances; a heading-up minimap showing the route.
  * The current speed-limit sign (a school-zone badge appears when one applies).
  * Speedometer with the over-limit arc, turn-signal tell-tales and the gear.
  * Seatbelt, lights, hazard and grip/skid indicators.
  * Live following gap in seconds, and stopping distance.

## Architecture

```
index.html            page shell, HUD markup, menus
css/style.css         HUD / menu styling
vendor/three.min.js   Three.js r128 (MIT)
js/core/      util.js (math, polylines, OBB), input.js, audio.js (synthesised sounds)
js/world/     roadnet.js   roads, lanes, intersections, roundabouts, ramps, localisation, routing
js/sim/       physics.js   player car (bicycle model + friction circle, ABS, weather friction)
              traffic.js   AI: IDM car-following, signals, all-way/two-way stops, roundabouts, yielding,
                           highway lane changes, pulling over for emergency vehicles
              peds.js      crosswalk users, PXO/crossing-guard routines, streetcar passengers, school children
              special.js   streetcar / school-bus / emergency-vehicle scripts, stopped police
js/rules/     catalog.js   violation definitions (title, severity, points, rule, MTO text, HTA, tip)
              examiner.js  scoring, cooldowns, praise, pass/fail
              rules.js     the rule engine (approach / intersection / lane tracking + all checks)
js/render/    textures.js (procedural signs), models.js (low-poly vehicles, batching), world3d.js (static world),
              renderer.js (cameras, mirrors, dynamic objects, weather, night)
js/scenarios/ nav.js (examiner directions, checkpoints, scripted events), scenarios.js (the five scenarios)
js/ui/        hud.js, menu.js
js/main.js    game loop (fixed 60 Hz simulation step)
```

### Extending

* **New scenario:** push an object onto `DS.SCENARIOS` in `js/scenarios/scenarios.js`. It needs:
  * `map()`: roads, node controls and features. Roads are axis-aligned, and intersections are created where
    roads cross. Node controls can be `signal`, `stop4`, `stop2` with `stopArms`, or `roundabout`. Features
    include `schoolZone`, `pxo`, `schoolCrossing`, `streetcarStop`, `limit`, `gantry` and `shield`.
  * `start`, `traffic` and `checkpoints` (use `type: 'park'` for a final curb park).
  * Optionally `events` (`when` / `run`), `setup(G)` and `tick(G)`.
* **New violation:** add an entry to `DS.VIOLATIONS` in `js/rules/catalog.js`, then call
  `G.examiner.flag('CODE', { cooldown, detail })` from a check in `js/rules/rules.js`.
* **New rule check:** `DS.Rules` has hooks for approaching an intersection (`trackApproach`), entering, being
  inside and leaving it (`onNodeEnter`, `whileInNode`, `onNodeExit`), lane changes (`trackLane`), and per-frame
  checks (`checkGeneral`, `checkSpecial`). `G.playerLoc` holds the road, direction, lane, approach, limit,
  following gap and blind-spot state.

### Ideas for follow-ups

Three-point turns, parallel parking, reverse parking, multi-lane roundabouts, advanced left-turn arrows,
railway crossings, construction zones, a gamepad or steering wheel, and a hands-free phone (distracted driving)
module.
