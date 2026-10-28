# Nexus One — Build Plan

A living, low-poly isometric 3D office campus that shows every Claude and Codex agent and subagent at work, and makes stuck agents impossible to miss.

## Decisions locked before this plan

| ID  | Decision             | Choice                                                                                                                                                                                                                                            |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Live data source     | A local **collector** tails JSONL transcripts: Claude Code under `~/.claude/projects/**` (including subagent transcripts) and Codex under `~/.codex/sessions/**/rollout-*.jsonl`. Hooks may be added later for explicit "needs attention" events. |
| D2  | Standalone packaging | **Electron** `.app` / `.dmg` built with electron-builder. The Electron main process runs the same collector code as the dev server.                                                                                                               |
| D3  | Double-click target  | **macOS** (Apple Silicon). Other platforms are out of scope.                                                                                                                                                                                      |
| D4  | 3D layer             | **React Three Fiber + drei** on Three.js. Hot paths (desks, racks, rain, crowds) use `InstancedMesh`.                                                                                                                                             |

Fixed stack: React, TailwindCSS, Three.js, Vite+ (`vp`), TypeScript. All geometry, people, vehicles and props are procedural. No external 3D models, textures or image assets.

## How to read this plan

- Phases run in order. **A phase is complete only when every step's "Done when" holds and its phase gate passes.** Do not start the next phase before that.
- Every step has **Action**, **Test**, **Done when**. Each step has a GitHub issue that links back to its anchor here (`#t<phase>-<step>`).
- "e2e" means a Playwright test against the dev server. Tests read scene state through a dev-only debug API `window.__nexus` (added in step 1.3), never through pixel guessing alone.
- "Mock source" is the deterministic event generator from step 1.5. Every visual feature is testable with it before live data is wired.

### Performance budget (applies from Phase 2 onward)

60 fps on an M-series Mac at 2560×1440, with 100 agents plus ambient NPCs, under 300 draw calls, JS heap growth under 10% over one hour.

---

## Phase 1 — Project setup and packaging path

Goal: a typed React + R3F + Tailwind app with tests, a data contract, a mock data source, and a proven path to an Electron `.app`.

<a id="t1-1"></a>

### 1.1 Install the stack and replace the starter page

- **Action:** Add `react`, `react-dom`, `three`, `@react-three/fiber`, `@react-three/drei`, `tailwindcss` (v4 with `@tailwindcss/vite`), `zustand`. Convert `src/main.ts` to `src/main.tsx`, render an `<App>` with a full-screen `<Canvas>` and one Tailwind-styled overlay label "Nexus One". Remove `counter.ts` and starter assets.
- **Test:** `vp check`, `vp run build`, `vp run dev` and open the page.
- **Done when:** check and build exit 0; the page shows a canvas filling the window and the Tailwind label; no console errors.

<a id="t1-2"></a>

### 1.2 Set module boundaries

- **Action:** Create `src/world` (geometry), `src/sim` (simulation, animation state), `src/ui` (dashboard), `src/data` (client store and data sources), `src/shared` (types, schema), `collector/` (Node only), `electron/` (main + preload). Add an Oxlint `no-restricted-imports` rule: `src/**` may not import `collector/**` or Node built-ins; `collector/**` may not import React or Three.
- **Test:** Add a temporary file that violates each rule and run `vp check`.
- **Done when:** each violation fails `vp check`; removing them passes.

<a id="t1-3"></a>

### 1.3 Test harness and debug API

- **Action:** Configure Vitest via `vp test` with one sample unit test. Install Playwright with one smoke test that opens the dev server and asserts the canvas exists. Add `window.__nexus` (dev only) through a typed registry exposing `getCamera()`, `project(worldPos)`, `rendererInfo()`. Later steps add their own hooks: `emit`, `setClock` in 1.6; `getAgent` in 4.5.
- **Test:** `vp test`; `npx playwright test`; `vp build` fails if `__nexus` or a Node built-in reaches the bundle.
- **Done when:** both test commands exit 0; the production build passes its `__nexus` guard.

<a id="t1-4"></a>

### 1.4 Canonical event schema

- **Action:** In `src/shared/schema.ts`, define entities `Project`, `Session`, `Agent` (with `provider: 'claude' | 'codex'`, `parentId`, `stage`, `lastProgressAt`) and events `session_start`, `session_end`, `agent_spawn`, `agent_end` (`ok | error | cancelled`), `message`, `tokens`, `tool_call_start`, `tool_call_end` (`ok | error`), `needs_attention`, `attention_cleared`, `handoff`, `task_queued`. Validate with zod. Add JSON fixtures for each event.
- **Test:** Unit tests: every fixture parses; malformed fixtures (missing id, unknown type, bad enum) are rejected.
- **Done when:** schema tests pass; the schema file is the only place event shapes are declared (grep finds no duplicates).

<a id="t1-5"></a>

### 1.5 Deterministic mock event generator

- **Action:** `src/data/mock.ts`: seeded generator producing projects, sessions, agents and subagents across both providers, with tool calls, errors, hand-offs, a queue, one agent that stops progressing, and one that needs attention. Supports time scaling.
- **Test:** Unit: same seed gives an identical event stream (snapshot); different seeds differ; scripted scenario contains at least one of every event type.
- **Done when:** tests pass and the stream replays identically across three runs.

<a id="t1-6"></a>

### 1.6 Data source interface and transport

- **Action:** Define `DataSource` (`subscribe(onSnapshot, onEvent)`, `status`). Implement `MockSource` and `LiveSource` (WebSocket client, snapshot then deltas, auto-reconnect). Select with `?source=mock|live` (default `mock` until Phase 4). Define the wire protocol in `src/shared/protocol.ts`. Register `__nexus.emit(event)` and `__nexus.setClock(ms)` with `registerNexusModule`.
- **Test:** Unit: `LiveSource` against an in-test WebSocket server receives snapshot, then events, then reconnects after server restart. e2e: `emit` delivers an event to the client and `setClock` moves the mock clock.
- **Done when:** tests pass; switching the query param switches the source with no code change.

<a id="t1-7"></a>

### 1.7 Packaging spike: blank Electron app

- **Action:** Set Vite `base: './'`. Add `electron/main.ts` that loads `dist/index.html`, and an electron-builder config with a macOS `dir` target. Add script `vp run pack`.
- **Test:** Stop all dev servers, run `vp run build && vp run pack`, double-click `release/mac-arm64/Nexus One.app`.
- **Done when:** the app window opens and shows the canvas and label; `lsof -nP -iTCP -sTCP:LISTEN | grep -i vite` returns nothing.

<a id="t1-8"></a>

### 1.8 Performance overlay

- **Action:** Dev-only FPS / draw-call / memory overlay (drei `StatsGl` or `r3f-perf`), toggled with backtick. `__nexus.rendererInfo()` returns draw calls, triangles, geometries, textures.
- **Test:** e2e reads `rendererInfo()`; toggle overlay by key.
- **Done when:** overlay toggles; e2e gets numeric draw-call and triangle counts.

<a id="t1-9"></a>

### 1.9 CI

- **Action:** GitHub Actions workflow on push and PR: `vp install`, `vp check`, `vp test`, `vp run build`, Playwright smoke.
- **Test:** Push a branch; then push a deliberate type error.
- **Done when:** clean branch is green; the type-error branch is red.

**Phase 1 gate:** all steps done, CI green, blank `.app` opens by double-click.

---

## Phase 2 — Procedural building and geometry

Goal: a readable futuristic campus, fully procedural, inside the performance budget.

<a id="t2-1"></a>

### 2.1 Isometric stage and zone registry

- **Action:** Orthographic camera at isometric pitch (~35°) and 45° yaw; ground plane; campus grid units. `src/world/zones.ts` registry: each zone has `id`, `name`, axis-aligned bounding box, and floor index (Lobby, Floor N, Garage, Loading Bay, Server Room, Break Room, Roof).
- **Test:** Unit: zone lookup by id and by point; boxes don't overlap within a floor.
- **Done when:** tests pass; screenshot shows the ground and camera at iso angle.

<a id="t2-2"></a>

### 2.2 Material palette and geometry cache

- **Action:** One shared palette (glass, panels, trim emissives, floor, furniture, vehicle paints) and a geometry cache keyed by parameters. Futuristic look: dark panels, cyan/white emissive trims, tinted glass.
- **Test:** Unit: cache returns the same instance for the same key. e2e: `rendererInfo()` material count.
- **Done when:** under 30 unique materials in the full scene; cache test passes.

<a id="t2-3"></a>

### 2.3 Tower shell with glass walls

- **Action:** Parametric tower: floor slabs, columns, transparent glass curtain walls (low-opacity, `depthWrite: false`, sorted), roof with named AC units. Floor count derives from desk capacity needs (step 2.5).
- **Test:** Unit: `floors = 6` yields 6 slabs and wall sets. Screenshot from all four 90° rotations.
- **Done when:** interiors are visible through the glass from every side with no transparency sorting artifacts (z-fighting or popping) in the four screenshots.

<a id="t2-4"></a>

### 2.4 Floor layout generator

- **Action:** Deterministic per-floor layout: central core (elevators, stairwell), offices with desk clusters, restrooms, meeting rooms. Ground floor: lobby, reception desk, waiting chairs, escalators to floor 2, cost-ticker wall. One floor gets the break room. A dedicated server room (basement or top floor).
- **Test:** Unit: every floor has a core; rooms don't overlap (AABB); same seed gives the same layout; every required room type exists somewhere in the tower.
- **Done when:** tests pass; screenshot labels each room type.

<a id="t2-5"></a>

### 2.5 Desk kit and desk allocation

- **Action:** Instanced desk, chair, monitor (emissive screen = activity-glow target), lamp, and a beacon mount point above each desk. `allocateDesk(agentId)` returns a stable slot (hash-based, collision-resolved), places subagents near their parent, and adds a floor when full.
- **Test:** Unit: 200 agents get 200 unique desks; same id gets the same desk across runs; subagent desk is on the parent's floor when space allows.
- **Done when:** tests pass; desks render with 1 draw call per desk part type.

<a id="t2-6"></a>

### 2.6 Elevators, escalators, stairs

- **Action:** Elevator shafts and cars as movable groups with exposed floor-stop heights; escalators with animated steps; stairwell geometry.
- **Test:** Unit: car stop heights equal floor slab heights. Visual: escalator steps animate.
- **Done when:** tests pass; each element is visible through the glass.

<a id="t2-7"></a>

### 2.7 Parking garage, loading bay, delivery entrance

- **Action:** Ground-level garage with ramps and numbered bays; procedural car, bike and motorcycle generators (type and paint from agent hash); one bay per worker, growing as needed. Loading bay with dock doors; separate delivery entrance.
- **Test:** Unit: bay count ≥ worker count for 1, 50, 200 workers; vehicle type for an id is stable.
- **Done when:** tests pass; screenshot of the garage shows all three vehicle types.

<a id="t2-8"></a>

### 2.8 Campus exterior, task belt, server racks

- **Action:** Roads, sidewalks, plaza, low-poly trees and street lamps. Conveyor belt from the loading area into the tower (geometry and moving belt surface). Server room racks with instanced LED points.
- **Test:** Visual screenshots; `rendererInfo()` for draw calls.
- **Done when:** all elements visible; racks and LEDs cost under 5 draw calls total.

<a id="t2-9"></a>

### 2.9 Navigation graph

- **Action:** Waypoint graph for walkable paths: garage to lobby, lobby to elevators and escalators, corridors to every desk, break room, restrooms, reception; vehicle lanes; courier route from loading bay. A* path search.
- **Test:** Unit: a path exists from the garage to every desk, break room and restroom; no edge crosses a wall (segment vs wall AABB).
- **Done when:** tests pass; debug toggle draws the graph.

<a id="t2-10"></a>

### 2.10 Geometry performance check

- **Action:** Static scene sized for 100 desks and full campus.
- **Test:** e2e reads `rendererInfo()`; manual FPS reading at 2560×1440.
- **Done when:** under 300 draw calls and 60 fps with an empty office.

**Phase 2 gate:** campus reads as a working building from any angle; budget met; all layout tests green.

---

## Phase 3 — Camera and interaction system

<a id="t3-1"></a>

### 3.1 Pan, rotate, zoom

- **Action:** Left-drag pan, right-drag rotate around the vertical axis (pitch clamped near iso), wheel and pinch zoom with min/max clamps, pan bounds limited to the campus.
- **Test:** e2e: drag changes camera target; right-drag changes yaw only; wheel changes zoom within clamps; touch-emulated pinch zooms.
- **Done when:** all four e2e assertions pass; camera never leaves campus bounds.

<a id="t3-2"></a>

### 3.2 Picking and hover

- **Action:** Raycast picking for characters and desks with instance-id to agent-id map; hover outline and pointer cursor; name tag on hover.
- **Test:** e2e: click the projected screen position of a known agent (`__nexus.project`) and assert `selectedId`.
- **Done when:** clicks select the right agent for 20 random agents in a row.

<a id="t3-3"></a>

### 3.3 Camera glide to target

- **Action:** Eased fly-to (~800 ms) for position and zoom; any user input cancels it.
- **Test:** Unit: tween function endpoints and easing. e2e: after selecting, the camera target is within 0.1 units of the agent after 1 s.
- **Done when:** both tests pass; user drag during a glide stops it.

<a id="t3-4"></a>

### 3.4 Follow mode

- **Action:** Selected agent is followed while it moves; manual pan breaks follow; a Follow toggle restores it.
- **Test:** e2e: move the agent via `__nexus.emit`, camera target tracks within 0.2 units; pan, then move again, camera stays.
- **Done when:** both behaviors pass.

<a id="t3-5"></a>

### 3.5 Zone fly-to API

- **Action:** `flyToZone(id)` frames the zone's bounding box; floor zones also cut away (hide or fade) floors above for a clear view.
- **Test:** e2e for each zone: its box center projects inside the viewport and the box fills at least 40% of it.
- **Done when:** all zones pass.

<a id="t3-6"></a>

### 3.6 Keyboard and input hygiene

- **Action:** Esc deselects; arrow keys pan; `F` toggles follow. UI panels stop pointer events from reaching the canvas.
- **Test:** e2e: dragging on a panel does not move the camera; each key works.
- **Done when:** all assertions pass.

**Phase 3 gate:** every interaction requirement passes e2e.

---

## Phase 4 — Agent and simulation layer

<a id="t4-1"></a>

### 4.1 Collector: Claude Code transcript adapter

- **Action:** `collector/adapters/claude.ts`: watch `~/.claude/projects/**/*.jsonl` (including subagent transcripts), read incrementally by byte offset, map lines to schema events (session, subagent spawn via Task tool, tool calls and results, tokens from usage, messages). The format is undocumented: version the adapter, count unknown lines, never crash on them. Fixtures from sanitized real transcripts.
- **Test:** Unit: fixtures give the expected event list; appending a line to a watched file emits an event within 1 s; a corrupt line increments `unknownLines` only.
- **Done when:** tests pass on fixtures from at least 3 real sessions, one with subagents.

<a id="t4-2"></a>

### 4.2 Collector: Codex rollout adapter

- **Action:** `collector/adapters/codex.ts` for `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, same rules as 4.1.
- **Test:** Same test set as 4.1 on Codex fixtures.
- **Done when:** tests pass on fixtures from at least 3 real sessions.

<a id="t4-3"></a>

### 4.3 Collector: derived signals

- **Action:** Per agent: `lastProgressAt`, rolling tokens/min, cost from a configurable price table, error streak, `needs_attention` heuristics (Claude: permission prompt or final question awaiting user; Codex: approval request), lifecycle stage.
- **Test:** Unit with fake clock and fixtures for each signal.
- **Done when:** every signal has a passing test, including a case that must not trigger.

<a id="t4-4"></a>

### 4.4 Collector server

- **Action:** WebSocket server on `127.0.0.1` only: snapshot on connect, then deltas; config file for paths, port, thresholds, price table. `vp run dev` starts collector and Vite together. UI default source becomes `live` with fallback banner to mock.
- **Test:** Integration: start the collector on a fixture directory, connect a client, assert snapshot, append a line, assert delta. Check it refuses non-loopback connections.
- **Done when:** integration test passes; `vp run dev` shows real local sessions.

<a id="t4-5"></a>

### 4.5 Client store

- **Action:** Zustand store for projects, sessions, agents, selection, and a bounded event ring buffer; pure reducer from events. Register `__nexus.getAgent(id)`.
- **Test:** Unit: reducer for every event type; 10,000 events in one minute processed with no loss and under 4 ms per frame batch. e2e: `getAgent` returns an emitted agent.
- **Done when:** tests pass.

<a id="t4-6"></a>

### 4.6 Procedural character

- **Action:** Low-poly person (head, torso, arms, legs as separate pivots) with appearance from the agent-id hash (skin, hair, shirt, accessory) and a provider badge color (Claude vs Codex). Subagents get a visible lanyard showing their parent's color.
- **Test:** Unit: same id gives the same appearance; 100 ids give at least 90 distinct combos. Screenshot of 20 characters.
- **Done when:** tests pass; every character is distinguishable in the screenshot.

<a id="t4-7"></a>

### 4.7 Animation state machine

- **Action:** States: idle, walk, sit-and-type, wave-with-phone (needs attention), slumped (stuck pose), eat, carry-document. Procedural limb animation, no skeletons.
- **Test:** Unit: allowed transitions table; invalid transitions rejected.
- **Done when:** tests pass; each state is visible in a debug gallery view.

<a id="t4-8"></a>

### 4.8 Agent to world binding and lifecycle stages

- **Action:** Each agent gets a desk and a vehicle. Map events to stages **Queued, Planning, Executing, Waiting on Tool, Reviewing, Done** with written rules (for example: first tool call moves Planning to Executing; open tool call longer than 2 s is Waiting on Tool). Stage drives animation.
- **Test:** Unit: rule table, one case per transition.
- **Done when:** tests pass; rules are documented in `docs/STAGES.md`.

<a id="t4-9"></a>

### 4.9 Movement and elevators

- **Action:** Path following on the nav graph; elevator controller with call queue, capacity, door dwell; escalator and stair use for one-floor moves.
- **Test:** Unit: controller serves 50 random calls with no starvation. e2e: an agent goes from lobby to a floor-4 desk.
- **Done when:** tests pass; elevators visibly carry people.

<a id="t4-10"></a>

### 4.10 Shift schedule and subagent spawn

- **Action:** Session start: worker drives in, parks, walks to the elevator, sits. Session end: reverse and drive out. Subagent start: new worker walks out of the elevator to a desk near the parent; leaves via the elevator on finish.
- **Test:** e2e with mock: `agent_spawn` gives a character at the elevator, seated within 15 s sim time; `agent_end` gives an empty desk within 15 s.
- **Done when:** both e2e pass for Claude and Codex agents.

<a id="t4-11"></a>

### 4.11 Activity glow

- **Action:** Desk monitor and floor-tile emissive intensity from normalized tokens/min with decay.
- **Test:** Unit: mapping curve. e2e: active desk screen luminance > idle desk luminance in a screenshot crop.
- **Done when:** both pass.

<a id="t4-12"></a>

### 4.12 Live message bubbles

- **Action:** Billboard bubbles with the last output snippet, stripped of control characters, truncated to 60 characters, faded after 6 s; at most 12 visible, nearest first.
- **Test:** Unit: truncation and sanitizing. e2e: a `message` event shows the truncated text.
- **Done when:** tests pass; never more than 12 bubbles.

<a id="t4-13"></a>

### 4.13 Error sparks

- **Action:** `tool_call_end` with error emits a short particle burst at the desk.
- **Test:** e2e: emit error, spark system active count > 0 for that desk, then 0 after 1.5 s.
- **Done when:** passes.

<a id="t4-14"></a>

### 4.14 Hand-off visualization

- **Action:** `handoff` event (parent delegates to subagent, or result returns) sends a document prop along the nav path between the two desks, or a worker carries it across floors.
- **Test:** e2e: emit handoff, document reaches target desk within 10 s sim time.
- **Done when:** passes.

<a id="t4-15"></a>

### 4.15 Task queue belt

- **Action:** Pending tasks (`task_queued`, Queued-stage agents) appear as trays moving on the belt into the tower; count equals queue length (cap 30 visible plus counter).
- **Test:** e2e: queue 5 tasks, 5 trays; dequeue 2, 3 trays.
- **Done when:** passes.

<a id="t4-16"></a>

### 4.16 Server room load

- **Action:** Lit LED count and blink rate scale with compute load (active agents and tokens/min).
- **Test:** Unit: mapping is monotonic and clamped.
- **Done when:** passes; visual difference between idle and busy is obvious.

<a id="t4-17"></a>

### 4.17 Lobby cost meter

- **Action:** Ticker on the lobby wall (canvas texture) showing spend today and across sessions, updated live.
- **Test:** e2e: ticker text equals store total spend after events.
- **Done when:** passes.

<a id="t4-18"></a>

### 4.18 Ambient life

- **Action:** Visitors waiting at reception, couriers doing deliveries and pickups via the loading bay, food deliveries to the break room with workers eating there during long waits. NPCs use a neutral grey palette, are not pickable, and are capped in count.
- **Test:** e2e: NPCs never become selected; NPC count stays under cap over 10 min sim time.
- **Done when:** passes.

<a id="t4-19"></a>

### 4.19 Simulation performance

- **Action:** 100 agents plus NPCs, all systems on.
- **Test:** e2e draw-call reading; manual FPS.
- **Done when:** within the performance budget.

**Phase 4 gate:** real local Claude and Codex sessions appear as characters; all sim e2e green; budget met.

---

## Phase 5 — Dashboard UI

<a id="t5-1"></a>

### 5.1 Frosted glass design system

- **Action:** Tailwind tokens and a `GlassPanel` component (`backdrop-blur`, translucent fill, hairline border, shadow) and the overlay layout grid. Minimum width 1280 px.
- **Test:** Playwright visual snapshot; contrast check on panel text.
- **Done when:** snapshot approved; text contrast at least 4.5:1.

<a id="t5-2"></a>

### 5.2 Top bar

- **Action:** Logo (procedural SVG), search (fuzzy over agents, sessions, projects; Enter flies to the result), area switcher (uses 3.5), weather menu, live clock, alerts bell, day/night toggle, user menu (data source, paths, thresholds). Weather, alerts and day/night are wired as stubs here and completed in Phases 6 and 7.
- **Test:** e2e per control; clock advances each second.
- **Done when:** all controls render and the working ones pass e2e.

<a id="t5-3"></a>

### 5.3 KPI cards

- **Action:** Three cards: **Agents working** (including subagents, split Claude/Codex), **Stuck agents** (red when > 0; click cycles through them), **Spend today**.
- **Test:** Unit: selectors. e2e: values equal the mock scenario's expected numbers.
- **Done when:** passes.

<a id="t5-4"></a>

### 5.4 Right detail panel

- **Action:** Agent view: name, provider, model, project, session, parent and children, stage, current tool, time since last progress, tokens/min sparkline, cost, recent messages, errors. Zone view: occupants and zone stats. Updates live.
- **Test:** e2e: select agent, emit events, panel fields update within 1 s.
- **Done when:** passes for both agent and zone views.

<a id="t5-5"></a>

### 5.5 Bottom-left agent flow tracker

- **Action:** Same position and purpose as the original Arrived → Triage → Assessment → Treatment → Admitted → Discharged tracker, relabeled **Queued → Planning → Executing → Waiting on Tool → Reviewing → Done**, with live counts. Clicking a stage highlights its agents in the scene.
- **Test:** e2e: counts equal store; clicking a stage outlines only matching agents.
- **Done when:** passes.

<a id="t5-6"></a>

### 5.6 Tabbed table

- **Action:** Tabs **Projects**, **Sessions**, **Agents**; sortable columns; filtered by search; row click selects and flies; virtualized.
- **Test:** e2e: tab switch, sort, filter, row click; 1,000 rows scroll smoothly.
- **Done when:** passes.

<a id="t5-7"></a>

### 5.7 Selection sync

- **Action:** One selection source for scene, search, table, alerts, KPI cycling.
- **Test:** e2e: selecting from each entry point updates all others.
- **Done when:** passes.

<a id="t5-8"></a>

### 5.8 Empty, loading and error states

- **Action:** Collector disconnected banner with retry, no-agents empty state, parse-error counter in the user menu.
- **Test:** e2e: kill collector, banner shows; restart, banner clears.
- **Done when:** passes.

**Phase 5 gate:** every dashboard requirement passes e2e; visual snapshots approved.

---

## Phase 6 — Weather and day/night

<a id="t6-1"></a>

### 6.1 Environment controller

- **Action:** Pure function `(timeOfDay, weather) → { sunDir, sunColor, ambient, skyColor, fogDensity, exposure }`, applied to scene with 2 s blends.
- **Test:** Unit: outputs for noon, dusk, midnight in each weather.
- **Done when:** passes.

<a id="t6-2"></a>

### 6.2 Time modes

- **Action:** Real local time, or fast-forward (1 day per 10 min); toggle in the user menu; persisted.
- **Test:** Unit with fake clock.
- **Done when:** passes; setting survives reload.

<a id="t6-3"></a>

### 6.3 Night lighting

- **Action:** Lit windows where offices are occupied, street lamps, exterior trims; day/night toggle in the top bar.
- **Test:** e2e screenshot luminance: occupied floors brighter than empty floors at night.
- **Done when:** passes.

<a id="t6-4"></a>

### 6.4 Clear weather

- **Action:** Baseline sky, sun shadows.
- **Test:** Visual snapshot.
- **Done when:** approved.

<a id="t6-5"></a>

### 6.5 Monsoon

- **Action:** Instanced rain, darker wet ground, grey sky; couriers move at 0.6× speed.
- **Test:** e2e: rain system active; courier speed multiplier is 0.6.
- **Done when:** passes within budget.

<a id="t6-6"></a>

### 6.6 Fog

- **Action:** Higher fog density, distant zones dimmed. Beacons, attention markers and alerts ignore fog.
- **Test:** e2e: farthest stuck beacon still detected (see 7.2 method).
- **Done when:** passes.

<a id="t6-7"></a>

### 6.7 Heatwave

- **Action:** Warm grade, bright sky, roof AC fans spin faster with vent particles.
- **Test:** e2e: AC fan speed higher than in Clear.
- **Done when:** passes.

<a id="t6-8"></a>

### 6.8 Weather menu wiring

- **Action:** Manual select of Clear, Monsoon, Fog, Heatwave in the top bar.
- **Test:** e2e: each option changes environment state.
- **Done when:** passes; budget met in each weather.

**Phase 6 gate:** 4 weathers × day/night snapshots approved; budget met in all.

---

## Phase 7 — Stuck detection and alerts

<a id="t7-1"></a>

### 7.1 Stuck rules engine

- **Action:** Configurable rules: no progress for X min (default 5) while not Done or waiting on the user; same tool call repeated N times (default 5); error streak (default 3). Separate states: **stuck**, **needs attention** (waiting on user), **slow tool** (one tool call running long).
- **Test:** Unit with fake clock: each rule triggers and clears; waiting-on-user never counts as stuck.
- **Done when:** passes.

<a id="t7-2"></a>

### 7.2 Stuck visual

- **Action:** Red rotating beacon plus vertical light column above the desk, pulsing red outline on the character, slumped pose. Renders on top of fog, visible at night and at max zoom-out from any yaw.
- **Test:** e2e: for each weather × day/night × 4 yaws at max zoom-out, a red pixel cluster exists at the beacon's projected position.
- **Done when:** all 32 cases pass.

<a id="t7-3"></a>

### 7.3 Needs-attention visual

- **Action:** Wave-with-phone animation plus amber marker; clearly different from stuck.
- **Test:** e2e: marker color is amber, not red; animation state is wave.
- **Done when:** passes.

<a id="t7-4"></a>

### 7.4 Alerts menu

- **Action:** List of stuck, attention and error entries with age; click flies to the agent; acknowledge and snooze; bell badge count.
- **Test:** e2e: entries appear and clear with state; click selects agent.
- **Done when:** passes.

<a id="t7-5"></a>

### 7.5 Incident siren

- **Action:** Agent error-out causes a 1.5 s red flash of tower lights, rate-limited to once per 10 s; softened when `prefers-reduced-motion` is set.
- **Test:** e2e: flash state toggles; second error within 10 s does not retrigger.
- **Done when:** passes.

<a id="t7-6"></a>

### 7.6 Off-screen indicators

- **Action:** Edge-of-screen arrows pointing to stuck agents outside the view.
- **Test:** e2e: pan away from a stuck agent, arrow appears; click arrow flies to it.
- **Done when:** passes.

<a id="t7-7"></a>

### 7.7 Replay tuning

- **Action:** Replay recorded real sessions through the rules engine and count alerts.
- **Test:** Hand-label each alert true or false.
- **Done when:** results and chosen thresholds recorded in `docs/STUCK.md`; no known-stuck case missed.

**Phase 7 gate:** a stuck agent is noticed from across the scene in every weather and time; alerts list matches rules.

---

## Phase 8 — Standalone packaging

<a id="t8-1"></a>

### 8.1 Collector inside Electron

- **Action:** Run the collector in an Electron `utilityProcess`; serve the UI via a custom `app://` protocol; pass the WebSocket port through preload.
- **Test:** Packaged app shows live sessions.
- **Done when:** passes with no dev server.

<a id="t8-2"></a>

### 8.2 Electron security baseline

- **Action:** `contextIsolation: true`, `nodeIntegration: false`, sandbox on, strict CSP, minimal preload API, block external navigation.
- **Test:** In renderer devtools: `typeof require === 'undefined'`; navigating to an external URL is blocked.
- **Done when:** both pass.

<a id="t8-3"></a>

### 8.3 macOS build targets and icon

- **Action:** electron-builder `dmg` and `zip` for arm64; app icon generated by a script from procedural SVG.
- **Test:** `vp run dist` produces `.dmg` and `.zip`.
- **Done when:** both artifacts exist and the icon shows in Finder.

<a id="t8-4"></a>

### 8.4 Settings persistence

- **Action:** Paths, thresholds, weather, time mode saved in `app.getPath('userData')`.
- **Test:** Change settings, quit, relaunch.
- **Done when:** settings survive relaunch.

<a id="t8-5"></a>

### 8.5 Signing and Gatekeeper

- **Action:** Ad-hoc sign by default; notarize when a Developer ID is available. Document the first-launch path for unsigned builds.
- **Test:** `codesign --verify --deep --strict "Nexus One.app"`.
- **Done when:** verify exits 0; first-launch steps documented in README.

<a id="t8-6"></a>

### 8.6 Release workflow

- **Action:** GitHub Actions on `macos-latest` builds the `.dmg` on tags and uploads it to a GitHub Release.
- **Test:** Push a test tag.
- **Done when:** the Release has a downloadable `.dmg`.

**Phase 8 gate:** release `.dmg` builds in CI and locally.

---

## Phase 9 — Prove double-click launch on macOS

<a id="t9-1"></a>

### 9.1 Clean-account install

- **Action:** On a fresh macOS user account (no Node, no repo, no dev tools on PATH), download the `.dmg` from the Release, drag to Applications, double-click.
- **Test:** Time from double-click to rendered scene.
- **Done when:** window opens and scene renders in under 5 s.

<a id="t9-2"></a>

### 9.2 No server, offline

- **Action:** Turn Wi-Fi off and relaunch.
- **Test:** `lsof -nP -iTCP -sTCP:LISTEN` shows only the app's loopback collector port; no port 5173.
- **Done when:** app works offline and only listens on `127.0.0.1`.

<a id="t9-3"></a>

### 9.3 Live data in the packaged app

- **Action:** Start a Claude Code session with a subagent and a Codex session in a terminal.
- **Test:** Watch the scene.
- **Done when:** both agents and the subagent appear within 5 s of their first event.

<a id="t9-4"></a>

### 9.4 Logs and crash recovery

- **Action:** Logs in `~/Library/Logs/Nexus One/`; collector crash restarts it automatically.
- **Test:** Kill the utility process.
- **Done when:** collector restarts within 3 s and the UI reconnects.

**Phase 9 gate:** recorded screen capture of steps 9.1 to 9.3 attached to the issue.

---

## Phase 10 — Final integration testing

<a id="t10-1"></a>

### 10.1 Full mock scenario

- **Action:** One Playwright run: 1 project, 3 sessions, 8 subagents, errors, hand-offs, one stuck, one needing attention.
- **Test:** Assert every requirement in the traceability matrix (10.6) that mock can cover.
- **Done when:** all pass.

<a id="t10-2"></a>

### 10.2 Live mixed-provider scenario

- **Action:** Real Claude Code session with Task subagents and a real Codex session at the same time.
- **Test:** Manual checklist from 10.6.
- **Done when:** every item checked.

<a id="t10-3"></a>

### 10.3 Real stuck scenario

- **Action:** Pause a live agent process with `kill -STOP <pid>`, then resume with `kill -CONT <pid>`.
- **Test:** Time to beacon and alert; time to clear after resume.
- **Done when:** beacon and alert appear within threshold + 10 s; both clear after progress resumes.

<a id="t10-4"></a>

### 10.4 One-hour soak

- **Action:** 100 mock agents for 1 hour, weather and time cycling.
- **Test:** Sample FPS and heap every minute.
- **Done when:** FPS stays at budget; heap growth under 10%.

<a id="t10-5"></a>

### 10.5 Visual regression suite

- **Action:** Snapshots per zone × weather × day/night.
- **Test:** Playwright `toHaveScreenshot`.
- **Done when:** suite runs in CI and passes.

<a id="t10-6"></a>

### 10.6 Requirements traceability matrix

- **Action:** `docs/TRACEABILITY.md`: every requirement from the product brief mapped to a test id or manual check.
- **Test:** Review for unmapped requirements.
- **Done when:** zero unmapped requirements and all mapped tests green.

<a id="t10-7"></a>

### 10.7 Docs

- **Action:** README: dev setup, data sources, config, packaging, first launch on macOS.
- **Test:** A person new to the repo follows it from clone to running app.
- **Done when:** they succeed without asking questions.

**Phase 10 gate:** all of the above green; tag v1.0.0.
