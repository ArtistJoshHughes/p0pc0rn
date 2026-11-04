# Troll-E, Level 1 (the tutorial)

A 3D game in p0pc0rn. Every character in its world is a robot; you are the equipment trash trolley a01, in a run-down reclaim hall.
Level 1 teaches the trolley: drive to a line, a turning slalom, a spin in a dead end, crab into a bay, pick up the grab arm kit, dock
and fit the arm, grab trash into the bin (and leave the diesel can standing), a 3 cm cable cover, an emergency stop, then push a
wheeled ramp to the stairs, square it up and drive up. The level ends only when the trolley rests on the landing at the top of the
stairs: all four tyres on it, under 0.05 m/s for 1 s. Juli, the hall's AI, talks on the radio from the start and, from the tutorial's grab
step on, gets up to mischief you see and feel (v4: below, Juli in the game).
v4 opens the hall onto a world round it, the tutorial's testing ground: four quadrants (the industrial dock, a dead park, a ruined metro,
a dead forest in rusty mud with cadmium puddles) and a plaza where they meet (below: The world round the hall).
v5 makes that world a survival game once the tutorial is done: the hall's shutters roll up, and a01 scavenges supplies and salvage
into its bin, crafts 24 obscure machines, builds a shelter piece by piece, charges on solar panels by day and hides from energy
leeches by night (and from day 10 by day too); a save game, death at an empty battery and a fresh start, no win (below: v5: the open world).

It is its own page (`games/trolley/index.html`), opened from Games › On your own › Troll-E › Play. Play replaces p0pc0rn's page,
so the app's models and memory are gone while the game runs; the game's Back opens p0pc0rn again. Play waits while a job is queued or
running (that page would look like it had died in the job). v4: the page opens on its landing screen (Start, Load saved game, Skip the
tutorial, Settings, Controls, About) with nothing of the game in memory; the game loads only after the choice (below).

## Pinned versions (vendored in `vendor/`, nothing loads from a CDN)

| package | version | released | files |
|---|---|---|---|
| three.js | **0.186.1** (r186) | 2026-09-24 | `three.module.js`, `three.core.js`; add-ons `GLTFLoader.js`, `BufferGeometryUtils.js`, `SkeletonUtils.js`, `RoomEnvironment.js`, `RoundedBoxGeometry.js` |
| @dimforge/rapier3d-compat | **0.21.0** | 2026-09-25 | `rapier.mjs` (the WebAssembly is inside, base64) |

Both from registry.npmjs.org, both more than a month old when vendored (2026-10-31). Changes: the add-ons' `from 'three'` imports point
at `./three.module.js` (the page's CSP allows no inline import map), and the source-map comment is removed from `rapier.mjs`.
Licences: `licenses/LICENSE-three.js-MIT.txt`, `licenses/LICENSE-Rapier-Apache-2.0.txt`. v2 vendored nothing new.

## The page's rules

The same CSP as `index.html`, plus `'wasm-unsafe-eval'` in script-src (Rapier's WebAssembly) and `blob:` in connect-src and img-src
(GLTFLoader decodes the model's embedded textures from blob URLs). No other host. No inline script or style (the HUD's moving parts
are set through the CSSOM, which the CSP allows).

## Files

| file | what |
|---|---|
| `trolley_spec.js` | the trolley as rigid bodies: masses, pivots, hinge axes, free ranges and limits, colliders, collision groups (pure data, USD -> game axes) |
| `world_spec.js` | v4: the world round the hall: its bounds, the quadrants and the plaza, the ground slabs and their friction, the puddles and the yard's oil, every fence, wall, block and prop (and its collider), the dead trees, the world's spawn points; pure data |
| `world_view.js`, `world_decor.js` | v4: the world drawn (ground, boundaries, blocks, signs, lamps, the props instanced, the dead trees, puddles, a01's mud tracks, the sky, the top view's map) and its textures, all in code |
| `tracks.js` | v4: a01's mud tracks: prints sampled by the distance each tyre rolls in mud, a ring buffer of 4,096 (pure maths) |
| `assets/world/*.glb` | v4: the world's set dressing and the dead-tree kit (NVIDIA SimReady, CC BY 4.0, modified): 25 files, 18 MB, loaded the first time a01 comes near their area |
| `level_spec.js` | the room (16 x 12 m, 0.2 m walls and floor; v4: a door in the south wall and one in the east wall), the staircase (4 risers of 17.5 cm, 28 cm treads, 0.7 m landing), the ramp, posts, bay, cable cover, the tutorial's zones; v2: the dock, the arm kit, the trash and where new trash may appear |
| `items_spec.js` | v2: each kind of trash (size, mass, friction, collider, ROMs), the pickups and dressing, the diesel spill's numbers |
| `arm_spec.js` | v2: the grab arm's rig (from the converter), servos, named poses, forward kinematics and the claw-down IK |
| `power.js` | v2: the battery: what each part draws, the pack tiers, the charger, limp mode |
| `sim.js` | the physics (Rapier), the trolley's controller (the modes, the hub motors, the steering servos), the objective; v2: the bin's lock, the dock's hoist and shutter, the arm and its GRAB sequence, trash in the bin, spills, the battery. No drawing, runs in Node too |
| `events.js` | v2: every world change (the dock's shutter, barrier blocks, new trash) is a checked command queued here and applied by the physics; Level 1's fixed rules (the director) post them. A controller could post the same commands later (`setController`); none is wired, no AI |
| `progress.js` | v2: ROMs, the battery tier bought, the best time; one localStorage key, every access wrapped |
| `view.js`, `decor.js` | the room, stairs, ramp and props; v2: rust, grime and neon (decor.js, below) |
| `props_view.js` | v2: the dock, the hoist, the shutter, the arm's links, the arm kit, the trash, barriers, the oil decals |
| `assets.js` | v2: the asset-loading layer: each prop has a placeholder on the physics' sizes until its glTF loads (one line each) |
| `assets/props/*.glb` | v2: the grab arm and the props, NVIDIA SimReady (CC BY 4.0), converted for the phone: 13 files, 5.1 MB |
| `trolley_mesh.js` | the trolley's drawing: the converted model bound to the bodies, or a placeholder from the same boxes and cylinders |
| `controls.js`, `audio.js`, `tutorial.js`, `main.js` | touch controls, the parts' sounds, the beats, the loop |
| `survival.js` | v5: the open world next to the physics: the clock, the supplies and salvage, the bin's manifest, crafting and what each crafted thing does, the shelter, the solar panels, the leeches (Rapier's character controller), death, the save game. Runs in Node too |
| `survival_rules.js`, `inventory.js`, `crafting.js`, `shelter.js`, `save.js` | v5: the day and night, the sun and the panels, the leeches' numbers; the bin's manifest; the recipes' checks; the shelter kits' geometry and build order; the versioned save. Pure logic |
| `boot.js` | v4: the page's first module: the landing screen, then Juli's plotting in the loading screen and a fresh page, then the game (main.js, imported only now); ?bench runs the bench's steps with no scene here and goes to the game only for one that needs it; the desk goes straight to the game |
| `landing.js` | v4: the landing (title) screen, its settings, its loading state, the pause sheet (DOM and one picture: `assets/landing/keyart.webp`) |
| `juli.js`, `juli_link.js` | Juli: her prompt, her answers parsed and checked against the guard rails, her pranks; her line to the app's engine (v4: the game's own layout, her backend going offline when her second process ends, one retry) |
| `plan.js`, `plot.js` | v4: the Bigger brain's plan for the shift (the closed schema, its triggers, the runner that fires each planned move through the same guard rails), and the loading screen's plotting |
| `voice.js`, `voice_standin.js`, `voice_pick.js`, `voice_worker.js` | v4: Juli's voice: a queue of her lines, synthesised off the frame (a Worker), played through the radio chain in audio.js; CMU Flite's slt voice goes in `vendor/flite/` (a stand-in until it is there) |
| `stack.js`, `stack_spec.js`, `stack_view.js` | v4: the stack-the-trash mini game: a01 stacks trash on a pad while Juli's physical tools try to topple it |
| `mem_account.js` | v4: the game's own page memory, counted as it is made (textures, buffers, the drawing buffer, canvases, decoded images, Rapier's memory, the JS heap) |
| `bench.js`, `bench_plan.js` | v4: the Troll-E + Juli phone bench (Settings › Benchmark › Troll-E + Juli) |
| `boot_crumbs.js` | the crash breadcrumbs: where the boot is (and what is loading), kept in localStorage as it goes; the next start card and the app's Diagnostics say where the last page stopped |
| `survival_view.js`, `survival_ui.js` | v5: the open world drawn (sites, the shelter, the machines, the leeches instanced, the panels on the bin, the night, the bubble's turntable) and its screens (the HUD's chips, CRAFT, BUILD, BIN, the collect bubble) |
| `data/*.json` | v5: the catalog (87 collectibles), the recipes (24 and the Loom's), the shelter kits, the salvage sites and spawn points |
| `assets/survival/*.glb`, `assets/craft/*.glb` | 4.0: the open world's models (NVIDIA SimReady, CC BY 4.0, modified): the supplies, the shelter kits, the night lights, the leech, the solar panel and its three age textures, the 24 crafted machines; 66 files, 42 MiB, loaded the first time they are needed |
| `assets/trolley.glb`, `assets/trolley_parts.json` | NVIDIA SimReady `equipment_trash_trolley_a01` (CC BY 4.0), converted for the phone: 304,967 triangles, 16.7 MiB |

## Controls

- Thumbstick at the bottom right: up/down drives. It no longer jumps to the thumb: a touch takes it only if it starts on its ring or
  just round it (a 162 px circle, 1.3x the ring; hit-testing follows the circle), so every other touch is free for the camera. DRIVE: sideways skid-turns (tank style). CRAB: sideways slides sideways.
  SPIN: sideways sets the turn rate on the spot.
- DRIVE / CRAB / SPIN: the trolley stops first, then swings its four steering modules (about 0.6 s).
- HOLD: stop now (the hub motors' peak torque; about 5.5 m/s² from full speed) and hold.
- The view (anywhere that is not a control): one finger swings the camera round; **two fingers pinched together zoom out to the top view
  (78° down over the whole world; v3's was 9.2 m out over the trolley), spread apart they come back to v1's chase view**; the blend is smooth and stops wherever the
  fingers stop; their midpoint dragged sideways turns it too. v4: the top view frames the whole world (about 45-65 m up, depending on the
  screen and the heading) with a map over it: each quadrant tinted, bordered and labelled, drawn only there. A double tap puts the chase view back behind a01. A finger that lands on
  the stick or a button belongs to that control and never moves the camera. Mouse wheel: the same zoom.
- On the left: DOCK (shown whenever a01 is parked in the bay: the slots, any number of times), DRIVE / CRAB / SPIN, and at the bottom
  HOLD with GRAB beside it, one size (v4, Nov 3; Josh: "the grab button can be moved to the bottom next to the 'HOLD' button"). GRAB
  shows with the arm fitted; it glows when trash is in reach, and reads DROP while the claw carries something. On a 440 x 956 phone
  (`desk_trolley_controls.mjs`) the row stays inside the safe area and the left thumb's reach, clear of the stick and the message area,
  upright and sideways.
- The compass chip (v4, Nov 2: `hud_ui.js`; Josh: "the entire UI could use some work") turns with the view (N, E, S, W and ticks); a
  magenta diamond marks the next objective's bearing. A new objective shows in full ("NEXT ◆ DOCK 01 · 6.2 m") for about 5 s, then folds
  into the small chip with the compass and the distance; a tap opens it again. A name shown in the last 20 s doesn't pop again. Juli's
  line and her "JULI · …" move chip have their own block (`#comms`) with an on-air badge. A magenta beacon floats over the objective
  in the room, and an arrow at the screen's edge points to it when it is out of view, in the chase and the top view. The objective is
  the tutorial's step; after the tutorial, the nearest trash, or the dock when the battery is under 25 % (or the claw carries something
  and the bin is off).
- v4: the compass also carries the other quadrants' names at their bearings from a01 (DOCK, PARK, METRO, FOREST), and a chip under it
  says where a01 is (DOCK · HALL, DOCK · YARD, PLAZA, PARK, METRO, DEAD FOREST).
- The round arrow puts a01 back at the current step's start.
- Keyboard: arrows or WASD, 1 2 3 for the modes, Space HOLD, G GRAB, V chase / top view, F the dock's slots.

## Physics (all measured in `v39/tests/trolley/`)

- Rapier: fixed 1/60 s steps with an accumulator (at most 3 a frame), 8 solver iterations (4 PGS passes each), allowed linear error
  0.2 mm. The trolley spawns 3 mm above the floor.
- **Multibody tree, chassis as root:** steering modules -> tyres, 8 clamps, 4 latches, 4 bumper brackets -> 4 bumper arms (the asset's
  own chain): 28 hinges in reduced coordinates, so a 0.24 kg bracket on a 53 kg chassis cannot drift off its hinge. rapier.js 0.21 gives
  multibody joints no motors or limits, so each hinge also has a generic impulse joint that locks nothing and carries only that hinge's
  limit and motor: Rapier's own implicit solver runs the hub motors (velocity), the steering servos (position) and the passive springs.
- **Passive hinges:** damping 0.03-0.05 N·m·s/rad on all; a 3 N·m/rad return spring on the latches and clamps (the latches droop about
  8° under gravity against it). Limits: the free range from the assessment / the converter's `trolley_parts.json`, minus 2° at each
  end that stops against something; an end at 0 (where the part rests) stays at 0.
- **Collision groups:** the world meets everything; the crate meets the chassis, tyres, clamps, the arm and trash; the arm meets the
  world, the bin and trash, never the trolley it is on; an item in the claw does not meet the arm holding it; nothing else inside the
  robot meets.
- **Hub motors:** speed-controlled, capped at 12 N·m to drive straight, crab or push, and at a 20 N·m peak to skid-turn, spin or HOLD.
  12 N·m cannot skid 143 kg round on rubber (measured: 0.1°/s), so DRIVE's turns use the peak. DRIVE closes the loop on its yaw rate
  (a gyro), because a skidding tyre turns the trolley less than its speed says. Top speed 1.2 m/s, 0.8 m/s² up, 1.5 m/s² down.
- **Tyre and mount compliance:** each module rides a stiff vertical spring on its kingpin (4 mm under the trolley's weight). Without
  it a rigid four-wheeler on a flat floor stands on two diagonal tyres (measured: 694 N on two, 10 N on the others) and cannot turn.
- **Friction:** rubber on sealed concrete 0.6 (all four tyres; the asset's wheel_04 painted-metal material is not copied), the ramp's
  tread 0.9, crate on deck 0.35. Tyre restitution 0.05.
- **CCD:** Rapier's soft CCD (predictive contacts, 3 cm) on the chassis, crate and tyres, 2 cm on the arm and the trash. Rapier's hard
  CCD moves a multibody link on its own: on the cable cover the whole trolley jumped 15 mm in a step and threw the crate against its lip.
- **Walls:** every fixed obstacle but the floor has a 3 mm contact skin, so no trolley collider reaches into a wall even with all four
  motors pushing a latch against it.
- rapier.js 0.21 does not mark a multibody's colliders as moved, so the narrow phase kept old contacts (the crate's with the deck); the
  game re-sets each trolley (and arm) collider's offset every step, which makes Rapier compute its contacts afresh.

## v2: the bin, the dock, the arm, trash, spills, the battery

- **The bin (slot 1, top):** the 39.8 kg crate sits in the deck pocket (its base 40 mm deep inside the lips, 8 mm of play), held by a
  fixed joint while its clamps and latches are closed (v1's passive springs). Detach: the clamps' and latches' servos turn them to the
  far ends of their ranges (0.7 s), the joint goes, and the crate is a loose body. Nothing pulls it out of the pocket by magic: the
  dock's hoist head (a kinematic body on the gantry) comes down, grips the rim with a fixed joint, lifts it 32 cm straight up, carries
  it over the low guide wall and sets it on the stand, where it is let go (about 13 s). It is then an ordinary rigid body: knock it and
  it moves. Attach is the same backwards; the hoist lines the bin up with the pocket from the trolley's pose each step, lowers it to
  4 mm above the deck, lets go, and the clamps lock it after it settles. The trolley is held still (HOLD) while the dock works on it.
- **The dock:** a 1.4 x 2 m bay against the north wall in the north-east corner (deep enough for the stowed arm, 1.13 m ahead of
  the trolley's centre), low guide walls, a roller shutter (a fixed slab whose
  collider rolls up into the header), the gantry and hoist, the stand, a charger plate, a rack for the arm. Parked = chassis within
  18 cm across and 22 cm along the charger, facing north within 10°, under 0.05 m/s for 0.5 s. Only then do slot changes and battery
  upgrades work (the menu opens by itself on parking; DOCK reopens it); anywhere else every slot action is refused.
- **The grab arm (slot 2, the front tool mount):** NVIDIA SimReady's `robotic_system_arm_b01` with an oil-filter-pliers jaw as a ring
  claw (assets/props/arm_cobot_claw.glb, 1.2x; its rig, limits and named poses come with it, collision-swept against the trolley by
  the converter). Its welded bracket sits on the back wall of the light-grey recessed tread-plate channel on the chassis front between
  the front wheels (0.2916, 0.17, 0 in the chassis frame) and carries the base 25 cm forward, clear of the bin. Its kit (a 12 kg crate
  north of the crab bay under a blue ring) is carried once the trolley's body touches it; Mount at the dock adds the arm as six more
  links of the trolley's multibody (base yaw, shoulder, elbow, a wrist roll held at -90°, wrist pitch, the jaw: 10.8 kg with its
  bracket), each with a servo on a generic impulse joint plus gravity feed-forward. The bodies are built in a reference pose (the stow
  with the wrist mid-range, so no servo target ever crosses ±180°); the arm's colliders stay off for the second it takes to fold to the
  stow, so fitting it never strikes anything near. GRAB finds the nearest trash small enough for the ring (0.11 m inside) 0.30-0.88 m
  from the base's yaw axis and within 95° either side, solves the arm (damped least squares, the claw straight down, inside the joint
  limits) and runs: above it, down round it, close the jaw (a fixed joint at the claw if it really is in the ring, else "missed"),
  raise, the converter's lift and over-bin poses, open: it falls 0.6 m into the bin. With the bin off the claw keeps the item and
  carries it (DROP sets it down on the floor ahead, or drops it into the bin once the bin is back on). About 9 s. The tutorial never
  dead-ends: a step that needs the bin waits, its hint says "Your bin is off. Back into Dock 01 and attach it" and the compass points
  to the dock. Parking is forgiving (30 cm across, 35 cm along, 20°): the hoist lines itself up with the trolley. While the ring closes round the item, and for 0.8 s after it lets go, the item does not meet the arm (it would
  snag the tight ring); it meets everything else, so it can bounce off the rim or be thrown about in a hard stop.
- **The arm's look and mount:** the converter's bracket is replaced by a low-poly steel pedestal (a plate bolted in the channel, a
  riser arm with two gussets and a flange the base sits flush on; under 400 triangles, the hall's rust), shown with the arm. The arm's
  clean white plastic gets the hall's grime in its shader (no UVs on the model, so procedural: dirt in object-space noise, darker
  towards the floor, rust specks from the metal, lighter scuffs, rougher where dirty; no textures), the claw is darkened metal with
  worn edges, and two thin neon rings sit on its joints (cyan on the elbow, magenta on the wrist).
- **Trash** (NVIDIA SimReady props): a soda can, a food tin, a water bottle, a glass bottle, a juice carton, a crisp packet, and a 1 L
  diesel can (1.1 kg full; its cap is its own node), laid out at Boot through the events module. In the bin (its centre inside the
  walls, at rest relative to the bin for 0.6 s) an item is banked once: soda can, food tin, water bottle 3 ROMs, glass bottle 4, carton
  and crisp packet 2, the diesel can 25 delivered safely (5 once it has spilled). Every 75 s, once the tutorial is past the trash, the
  director drops a new piece while fewer than 3 lie loose. A spare car battery lies near the ramp: driven into, it tops the pack up by
  35 %. Two rusty drums (40 kg) and a big cardboard box are bodies the trolley can shove; the bin's stand is a wooden pallet; the events
  module's barrier blocks are road barricades (15 kg).
- **The diesel can:** knocked over (lying tilted past 60°) or hit hard (its speed jumps 0.9 m/s in one step, about 5.5 g) anywhere but inside
  the bin, it spills. The patch grows to 0.85 m over 2.5 s and stays for the rest of the run: a dark oily decal, and a sensor disc on
  the floor. A tyre touching the sensor gets oil's friction, 0.08 combined by the minimum (Rapier's own friction; clean: 0.6). Measured:
  HOLD from 1.2 m/s stops in 0.16 m on clean floor and slides 0.90 m on the oil; skid turns slip.
- **The battery:** every step the hub motors draw |torque x speed| / 0.85 plus a copper loss 0.12 W/(N·m)² (their torque is the speed
  loop's command, capped), plus rolling resistance (0.02 x weight x speed: the physics has none), 18 W of electronics, 16 W per steering
  module while it swings, and the arm's servos the same way (geared: 0.0016 W/(N·m)²). Skid-steering is costly (about 570 W while DRIVE
  turns), so ordinary play (0.38 m/s on average with turns and pauses) draws about 270 W, and the Mk I pack (450 kJ, 125 Wh) lasts
  about 27 minutes of it (the test measures 25-30). Pushing a wall at full stick draws about 300 W, standing still 18 W. The charger
  fills an empty Mk I pack in 30 s while parked. Upgrades, bought with ROMs at the dock: Mk II (+50 %, 40 ROMs), Mk III (+120 %, 100).
- **Limp mode (0 %):** the trolley never soft-locks. The last of the pack is a protected reserve the hub motors may still use at a third
  of the speed (DRIVE 0.4 m/s, CRAB and SPIN at 40 %), enough to crawl back to the dock; the arm stays parked. It ends once the dock has
  charged the pack to 5 %.
- **Progress** (ROMs, the tier, the best time) is kept in localStorage (`p0pc0rn:trolley:progress`); a fresh run starts with a full pack,
  the bin locked on, the arm kit back on the floor and no spills.

## The world round the hall (v4: world_spec.js, world_view.js, world_decor.js, tracks.js)

```
 z -6.2 +--------------------------+-------------------+
        |  INDUSTRIAL DOCK          |  PARK             |
        |  the hall (x -8..8,       |  dead grass,      |
        |  z -6..6) + its yard      |  cracked paths,   |
        |  (rail tracks, oil)       |  a dry fountain   |
 z  8.6 +-------------------- PLAZA +-------------------+
        |  DEAD FOREST              |  METRO            |
        |  mud, dead trees,         |  asphalt, ruined  |
        |  cadmium puddles          |  blocks, rubble   |
 z 19.0 +--------------------------+-------------------+
      x -8.2                     x 10.6              x 24.0
```

- **Size.** The brief asked for "about a minute of driving across" a quadrant and "roughly 3-4x the current hall in total"; these pull apart
  (a minute at 1.2 m/s is 72 m). The total wins: the world inside its fence is 32.2 x 25.2 m (811 m², 4.2x the hall's 192 m²), the
  quadrants 13.4-18.8 m a side (the dock 18.8 x 14.8 m with the hall, the park 13.4 x 14.8, the forest 18.8 x 10.4, the metro
  13.4 x 10.4): 11-16 s straight across at full speed, 25-40 s with the turns, the mud and the obstacles (the desk's drive through all
  four takes about a minute and a half). The asset set's design pack proposed 48 x 48 m (12x the hall) with the same quadrant order; that is
  three times the brief's area and the phone's draw budget, so the world stays at about 4x.
- **The hall** is the dock quadrant's core, unchanged at its coordinates. Two doorways (2 m high under a lintel) open it: one in the
  south wall (x 1.9-3.5), between the third slalom post and the dead end's corridor, one in the east wall (z 0.2-1.8), between the arm
  kit and the drum by the crab bay. Both keep off every approach the desk's wall checks drive (the east wall at z -4.3..-0.8, the west
  wall, the north wall at x 3). The RECLAIM sign moved over the crab bay and a pipe drop off the south door; nothing else in the hall
  moved. Outside, a 2.4 m wide yard runs round its south and east walls (concrete, rail tracks flush in it, oil stains, an old oil patch
  that is slick like a spill, a pallet rack, a tote and crates in the nook north of the east door, a pallet jack, a stacker parked on
  the track, the dock-edge rail, two containers).
- **The plaza** (a 4.8 m square of worn pavers at the quadrants' common corner) has a painted compass rose and a signpost with an
  arrow board to each quadrant. Its sides are open to all four; elsewhere the quadrants are bounded by iron railings (the park) and
  broken brick walls (the forest), each with a gap or two, and the world by a 2.2 m chain-link fence (beyond it, dark wasteland into the
  smog and a ruined skyline).
- **The park:** dead grass, cracked concrete paths to a dry fountain with a rusted robot on it, visitor sofas for benches, dumped
  armchairs, a coffee kiosk still glowing magenta, a water cooler, bins, flood-light towers, a hopper dumped over the railing, big dead
  trees. **The metro:** four ruined blocks (concrete and brick facades, windows dark, broken, boarded, a few still lit, broken parapets,
  roof clutter), streets with crosswalks and centre lines, rubble, a METRO neon sign (its own magenta light) and a dead HOTEL sign, a
  stripped car shell, jersey barriers, a vending machine with a cyan strip, an info kiosk, a utility cabinet, siren poles, wheelie bins,
  a fallen duct. **The dead forest:** mud, 25 dead trees off the routes through it (an old track along its wall and four tracks between
  the gates), logs, stumps, half-sunk drums, a wheelbarrow, a pipe bundle sunk along the fence, rotten boards, seven cadmium puddles.
- **Everything outside the hall is static** (fixed colliders, from world_spec.js), none of it within reach of a tutorial spawn or a
  test path. The props are NVIDIA SimReady (credits below); the ground, walls, blocks, lamp posts, containers, fountain, signpost and
  the textures are the game's own, drawn in code like the hall's (world_decor.js).

**The ground** is a floor slab per kind, each with its own Rapier friction (the tyres are 0.6) and combine rule:

| ground | where | friction (rule) | with the tyres |
|---|---|---|---|
| concrete | the hall, the yard | 0.6 (average) | 0.6 |
| pavers | the plaza | 0.55 (min) | 0.55 |
| dead grass | the park | 0.45 (min) | 0.45 |
| asphalt | the metro | 0.64 (average) | 0.62 |
| mud | the forest | 0.3 (min) | 0.3, plus a drag force |

No ground uses Rapier's max or multiply rule, so a puddle's or a spill's min always wins.

- **Mud is real physics.** Half the grip (Rapier's own friction, above), and while a tyre rolls on the ground in mud, a drag force on
  that tyre (`addForce`, opposite its motion): rolling resistance 0.08 x its share of the weight (eased in under 5 cm/s, so it never
  pushes a resting tyre) plus a churn term 92 N·s/m x its speed. Measured (`trolley_world.test.mjs`): top speed 0.84 m/s in mud vs
  1.19 on concrete (70 %), the tyres slip 22 % at it (the hub motors' 12 N·m spin them past the grip; under 1 % on concrete), HOLD from
  0.83 m/s stops in 0.07 m in mud (the drag helps) vs 0.10 m on concrete, skid turns are slower (33° in 2 s vs 80°). The battery pays
  for it twice: the hub motors' own torque against the drag, and the rolling-resistance term goes from 0.02 to 0.11 x weight x speed
  with all four tyres in mud (power.js `crrMud`): about 760 W at the mud's top speed against about 190 W cruising on concrete.
- **Cadmium puddles** (#E3B505 with a #C89400 glow and a rust-brown rim, the emissive sheen shimmering): seven in the forest, two in the
  metro. They are the spill's mechanism (sensor discs, the tyre's own friction set to 0.26 by the minimum while it touches one) plus a
  drag (0.02 x weight + 30 N·s/m per tyre) and a drain of 160 W per tyre in it (the sludge in the hub seals). On top of the mud a01
  crosses at about half speed (0.84 down to about 0.45 m/s) and the battery draws about 500 W more. They are the map's: they never go
  away, and a new run keeps them.
- **Mud tracks:** each tyre rolling on the ground in mud leaves a rusty print (the rust tile's (0.35, 0.21, 0.12) tint, chevron tread,
  wet dark edges) every 15 cm it travels, sampled by distance each physics step (tracks.js), never in a puddle. They go into one
  InstancedMesh ring buffer: **cap 4,096 prints** (about 150 m of all four tyres in the mud) and they stay for the whole run; only past
  the cap does the oldest slot get reused. A new run clears them.
- **The sky:** a smoggy dome (rust-brown at the horizon, near black overhead) and a ring of ruined towers, both following the camera,
  outside the fog; the fog is the horizon's colour, 14-38 m.

**Juli on the bigger map.** Her spawn points are the hall's S1-S8 and the world's Y1-Y2 (yard), P1-P4 (park), M1-M4 (metro) and F1-F4
(forest), all on clear floor a01 can reach (S9 is still nobody's). Her lanes are the hall's L1-L6 and LY1, LP1-LP2, LM1-LM2, LF1-LF2,
each clear of every collider, and she may use a lane only in the area a01 is in (her pranks are for a01 to see); a barricade still has
to pass the path check, which now covers the whole world (paths.js: a 10 cm grid over 32.2 x 25.2 m, 81k cells, a typed-array heap,
about 30 ms on a desktop PC) and keeps one point in each quadrant and the plaza reachable. During the tutorial the director's new trash stays
in the hall; after it, any spawn point at least 2 m from a01. The events module accepts any position on the world's floor.

## v5: the open world (survival.js, survival_rules.js, inventory.js, crafting.js, shelter.js, save.js, survival_view.js, survival_ui.js)

The tutorial (15 steps) stays the hall's testing ground: during it both of the hall's doorways have roller shutters (fixed slabs in the
wall's thickness, like the dock's) and they stay down. Once a01 rests on the landing the done card offers **Into the open world**: the
shutters roll up and the four quadrants round the hall become a survival game. There is no win: only the next night.

**Data-driven.** `data/catalog.json` (87 collectibles: the asset maker's collect catalog from glb2-glb4, each with the game's rules in
its `game`: how a01 gets it, its body, what it weighs in the bin), `data/recipes.json` (the 24 recipes, `inputs` with counts -> `output`,
plus the Matter Loom's printed fuse), `data/shelters.json` (the three shelter kits with each piece's slots) and `data/sites.json` (the
salvage sites and the supplies' spawn points, generated clear of every collider, route, gate, spawn point, Juli lane and puddle; the
tests check it). A new recipe or item in the JSON is crafted and collected the same way; an output's function is a hook named in its
recipe (`effect`), and one with no hook is just an owned thing. Fetched at load; without it the tutorial still runs.

**Carried in the bin or the claw.** The bin's manifest is the inventory: a supply the claw GRABs into the bin is stowed in the manifest
once it rests there (its body goes) and weighs on the trolley (the crate's mass is its own plus the load: `sim.setBinLoad`, the battery
pays for it too); the bin holds 120 kg and 300 litres. What the claw holds counts too (crafting can use it). With the bin off on the
dock's stand, its contents are there, not on a01.
- **GRAB** (the stock ring claw): anything with a grip of 0.11 m or less and 3 kg or less (cans, bottles, the diesel can, a wrench, 9 V
  batteries, hoses, bulbs, fuses, pliers, the mask, tea candles: a flat thing is pinched at floor level). The **Tetrabrachion** (R01)
  raises that to 0.24 m and 15 kg (car batteries, CCTV domes, clamp meters, jumper clamps, work and inspection lamps, extinguishers lying
  loose), the reach envelope by 25 % (the arm's own kinematics still decide) and takes up to 4 in a press.
- **SALVAGE** (the GRAB button reads SALVAGE over a ringed site): what no claw lifts is stripped in place: the arm turns to it, reaches
  out and works its jaw for 2-6 s (real servo work: the battery pays) and the parts go into the bin. 44 sites (the alternators, monitors,
  shop fans, IV poles, solar panels, car batteries, fuel jugs, a beam, leech husks, the shelter pieces...) and 14 of the world's own props
  (the car shell, the vending machine, the forklift, the pallet jack, the racks, the tote, the duct, the cabinet, the drums...; some give
  copper cable, bulbs or hose besides). A stripped site comes back after its `restock` days.
- **Shelter pieces** are claimed, not carried (a 2.7 m mesh panel never fits a 0.75 m bin): SALVAGE claims them where they lie, and the
  arm places them at the site.
- New supplies lie about each dawn (up to 22 loose), some buried in the forest's mud (the Echo Psalter and the Skiagraph Pillar find them).
- **The first of a kind** a01 collects (or crafts) opens a full-screen **collect bubble**: its name, what it really is, its kind, where it
  is found, its size, what it weighs in the bin, what it feeds, a 3D turntable of its model (loaded for the bubble at full detail and
  disposed of when it closes; the game pauses behind it) and, last, its cryptic hint, under a rim in its accent colour. Sizes are the
  sizes in play: a few source assets are far bigger than the thing they stand for (the Heliostat Rail's source is a 6.79 m bundle of
  T-slot rails; it is one panel's 40 cm mount on the bin), so the catalog gives them `game.scale` and its size, mass, collider and
  turntable follow it (the rail 0.059, the Tetrabrachion 0.3 and the Dioscuri Rig 0.32 as they are fitted, the Coherent Lance 0.35, the
  Contrast Syringe 0.3, the copper harness 0.065, the Ley Junction 0.7: at 3.6 m it found no place in the Cage Hive or the Rack Fort). A
  salvage site's size reads "as found": it is stripped where it stands.

**Crafting** (CRAFT): only in a01's sealed shelter (at its workbench) or parked in the dock. Each recipe takes exactly its inputs (the bin
first, then the claw) and gives its output: fitted to a01 (R01, R03, R08, R09, R17, R20, R21), mounted on the bin (R02), carried in the bin
(R13, R24, coolant, the printed fuse) or a machine that stands in the shelter (the rest, at the kit's station slots, each a fixed body).
Tier 2 needs the Matter Loom (R14); tier 3 the Loom and a tier-2 machine; the Skiagraph Pillar a Roentgen Furnace. What each one does:

| recipe | what it does | recipe | what it does |
|---|---|---|---|
| R01 Tetrabrachion | GRAB stats (above); its four-armed mesh stands in for the arm's (display only: the arm's own links still do the work) | R02 Heliostat Rail | mounts the best panel in the bin on the next of the bin's 8 slots |
| R03 Dioscuri Rig | the arm twice as fast (display mesh on the bin) | R04 Lumen Vigil | UV round the shelter for 3 nights: leeches keep 8 m off |
| R05 Mole Courier | each dawn it brings one thing (often what no site has: a shelf, a scaffold, a hex grid, a roof slab, strip lights) | R06 Roentgen Furnace | at night on the shelter's pad, one diesel can = 10 % of the pack |
| R07 Skiagraph Pillar | once a day: buried supplies within 15 m come up | R08 Coherent Lance | a latched leech is burnt off (dead: a husk) after 2 s |
| R09 Echo Psalter | buried supplies within 10 m of a01 come up | R10 Cadmium Leachfilter | one coolant a dawn: clears the panels' dust, restores one panel a tier, +15 % speed for 60 s |
| R11 Somnus Bellows | one night: leeches within 6 m of the gate lie dormant | R12 Iron Breath | no overnight corrosion (panels age at the normal rate) |
| R13 Lazarus Clamps | once: at 0 %, 25 % back and every latched leech shocked dead | R14 Matter Loom | tier 2, and prints a fuse from three pieces of plastic trash |
| R15 Arc Forge | the Rack Fort's and the bunker's racks, roof, panels and gates | R16 Ley Junction | the shelter's charger at the dock's full rate (else a trickle) |
| R17 Charge Oracle | shows each panel's tier and true efficiency | R18 Photon Altar | each dawn one mounted panel back up a tier |
| R19 Salamander Lung | night's cold drain 30 % lower in the shelter | R20 Dynamo Heart | +25 % top speed asked of the hub motors (their torque unchanged) and regenerative braking |
| R21 Leech Collar | the first leech each night to latch on is zapped dead | R22 Contrast Syringe | a dose: 60 s at double speed and double drain |
| R23 Warmth Eye | a warning about 30 s before leeches come | R24 Small Vigil | set down: a UV lamp, leech-free 4 m round it until dawn |

**The shelter** (BUILD): choose one of the three concepts and mark its site where a01 stands (a01 in its middle, the gate the way a01
faces, snapped to 90°). A site must stand inside the fence on clear floor: clear of every fixed thing, the salvage sites, the dock and its
approach, both doorways, the stairs and the ramp, and every quadrant, the dock and both doors must stay reachable from its gate (paths.js).
In this town that is the hall's open floor ("Find a site that fits" points the compass at the nearest). Then piece by piece in the kit's
order (an optional piece a01 has none of is skipped): the arm places each one (a fixed body; never over a body: "a01 is in the way").
Sealed once every needed piece stands: the Cage Hive (the charger, 7 mesh walls, the accordion gate, a patch roof of 9 pallets, the
workbench; first night, no crafting needed), the Rack Fort (3 racks, the roof and the dock gate need the Arc Forge) or the
warehouse-corner bunker (its two modules are found in place, sunk 1.3 m; 12 guard panels and two half gates need the Arc Forge). The
gates follow `extras.door`: the accordion's lattice scales on its x and its far post follows; they open while a01 is within 2.6 m and
their colliders move with them. Inside a sealed shelter: safe from leeches, crafting, and its charger's pad charges a01 (a trickle,
1.8 kW, or the dock's 15 kW with the Ley Junction). BIN > Wait for dawn runs the clock 24x while a01 sits it out inside.

**The day and the night** (survival_rules.js): a day is 10 minutes: light from 06:00 to 20:00 (7 min), night to 06:00 (3 min). The sun,
the sky, the fog, the hemisphere and the key light follow it, and the hall's fluorescent strips sag to a third; at night a01 lights its headlamp (one light from a pool made at the start:
adding lights later would recompile every shader). Night adds a cold drain of 12 W.

**Solar panels** (only by day): each found panel rolls an age tier (new 85-100 %, aged 45-70 %, ruined 10-30 %) and a batch quality
(0.6-1.0); on the bin's 8 slots (4 sides x 2) each gives 60 W x efficiency x quality x (1 - dust/2) x the sun x its side's facing
(1.0 towards the sun, 0.6 beside, 0.25 away); nothing at night. Each dawn a mounted panel gathers dust and may age a tier (3 % new,
5 % aged; twice that without the Iron Breath's shelter). Each panel's face shows its tier's texture.

**Energy leeches** (at night; from day 10 by day too): 1 + the day's number come out of the cadmium puddles (the forest's first) over
the first 45 s of the night, up to 8. From day 10 they no longer wait for the dark: `LEECH.perDay(day)` = 0 before day 10, then
min(4, 1 + floor((day - 10) / 2)) (1 on days 10-11, 2 on 12-13, 3 on 14-15, 4 from day 16, under the night's 8); they come out over the
first 2 minutes of the morning and stay out (the night's melt at dawn, the day's do not; at dusk they count towards the night's). Each is a kinematic body moved by Rapier's character controller (it slides along walls, never through them, and meets
only fixed things; when stuck it detours sideways), crawling at 0.3-0.6 m/s at a01 when a01 is out within 18 m. Within 0.78 m it latches
on (riding a01's side) and drains 1.5 % of the pack a second; several stack. They let go inside a sealed shelter (and never get in: they
press on its mesh), in UV (a Small Vigil, the Lumen Vigil), or to a crafted counter; at dawn they melt back. A dead one leaves a husk to
salvage (the Leech Collar's input). At night their bodies carry a faint cold rim (a Fresnel term in their own emissive, `LEECH.rim`:
1.6 at night, 0.25 by day) so their shapes read against the dark ground without a brighter night; their cadmium eyes stay the brightest
thing on them.

**The battery's line** (survival_rules.js `BATTERY`). In the tutorial a flat pack is limp mode and nothing more (the protected reserve
takes a01 home; it never dies there). In the open world limp mode starts under **10 %**, however the pack got there (the motors, the arm,
the cold, a puddle, the leeches): a third of the speed, the arm parked; full power again at 12 %. At **0 %**, from any cause, a01
**dies**: the death card (it says how: the leeches, or the battery ran flat), the save gone, and it starts again from the beginning: the
tutorial, or **skip the tutorial** straight into a fresh open world (the arm fitted, the ramp docked). The ROMs and battery tiers of
progress.js are kept. No soft-lock after the line: the limp crawl (0.4 m/s) draws 76 W by day and 88 W at night (measured), so a Mk I
pack's 10 % (45 kJ) is about 8.5 minutes, some 170 m of crawl at night (Mk II 250 m, Mk III 370 m); the farthest spot in the world is
29 m from the dock as the crow flies, and the shelter's pad charges too. a01 brought out of the tutorial already flat is limp, not dead,
until it has had a charge. The HUD shows the line only in the open world: the battery chip's top edge becomes a gauge with a tick at
10 % (and the icon's bottom tenth is marked red); under it the LIMP chip says to charge; at 3 % or less the chip, the battery (DYING)
and the screen's edge pulse fast and a toast says so.

**The save game** (save.js, `p0pc0rn:trolley:save`, versioned, every access wrapped; the game runs with storage blocked): not a save
state (no physics is kept): the day and time, the bin's manifest and claims, the panels on the bin, what was crafted and its charges, the
shelter (concept, site, pieces built), the machines, the world (stripped sites and when, the loose supplies, the husks, the buried
things) and the battery. Autosaved on the shelter's pad (every 20 s at most), when it is sealed and at every dawn spent inside. The start
card then offers **Continue · day N** (a01 wakes on its pad) and **Skip the tutorial**.

**Juli in the open world**: the same guard rails (one call per 8 s, at most 3 trash a minute, her measured answer limit (v4: 3-7 s), no
diesel, the radio filter, barricades only where no route grows by more than 2 m; the tutorial radio-only until its grab step). Her state also carries the day, the clock, the
night, the leeches near and latched, the shelter and what a01 last crafted, and her prompt says she may comment on crafting and the night
(her words are her model's). A spawn point inside the shelter or under a site is refused, and her barricades never stand on or in it.

**The cost.** The open world adds its own models only where they are needed: the sites' models load once a01 comes within 18 m and are
drawn within 11 m of the camera (one InstancedMesh per material for each kind), the loose supplies instanced by kind within 12 m and
with no shadows, the shelter's pieces instanced by kind (only the walls, the racks, the charger and the roof cast shadows), the leeches as
one InstancedMesh per part (the slither is per instance), the bin's 8 panels in about 6 draw calls, the crafted machines one mesh per
material each (no shadows); every instanced set has bounds from its instances, so it is skipped when off screen; from the top view only the shelter
is drawn. Their textures are drawn down to 512 px at load (the bubble's model alone keeps
its own and is disposed of). glb4 adds 66 files, 42 MiB to the download; a phone loads only what it meets. Measured in the desk
(`desk_trolley_survival.mjs`, the arm fitted, with the shadow pass, the chase view), after the fix round (below: Performance): the hall
with a01's Cage Hive 322 draw calls and 795k triangles by day (306 and 798k at night, leeches out), the park 224 and 587k, the metro 220
and 674k, the dead forest 260 and 768k, the top view 250 and 372k (before it: 381 / 1.19 M, 376 / 1.15 M, 290 / 949k, 278 / 1.03 M,
315 / 1.12 M, 297 / 380k). After a whole run (every model met loaded) the JS heap is 136 MB and the textures about 411 MB of GPU
memory (RGBA with mipmaps, estimated from their sizes). Three more lights are in every fragment's loop (two pooled point lights and a01's headlamp, at 0 until the open world needs them).

## Juli (juli.js, juli_link.js, paths.js)

The hall's AI. Every 8 s (never while she is still thinking) she reads a compact state (about 300 tokens: a01, the objective, the 8
nearest pieces of trash, the shutter, a bounty, her barricades, recent events) and answers with ONE JSON call; the prompt says who she
is and what she may do, her model decides, nothing is scripted. Mode `mischief` (Level 1): playful, net-neutral or net-positive:
`spawn_trash` (no diesel, spawn points S1-S8, at most 3 a minute, never within 2 m of a01), `bounty` (1-10 ROMs, 15-60 s, one at a time),
`say` (her radio line, at most 80 characters, filtered: no links, no profanity or slurs, judged word by word), `prank` (a sign flickers or
changes colour, a radio sting, a barricade nudged into lane L1-L6 only if a path check shows every objective still reachable and no detour
over 2 m, at most two of hers; the dock's shutter closed as a tease only with a01 over 6 m away and no hoist at work, reopened within 8 s
or at once if a01 comes back; v4: lights_out and chute_drop, below) and `pass`. During the tutorial: radio only until its grab step
(v4), then her moves in the hall. Mode `opponent` is defined (more handles, looser limits) and unused. A reply that
breaks a rule is refused (her move, and it did nothing); unreadable, slow (over 3 s) or silent replies are passes; the level's own
director keeps running and the game never waits for her. She runs on p0pc0rn's engine with the E2B model already downloaded in the app
(on iOS 27 Safari partly in the app's second process), only if the person agreed in the app's rights lesson; otherwise the HUD shows
"Juli offline" and nothing else changes. The start card has Juli on/off, Radio on/off and "Probe: Juli + FPS" (FPS and its 1 % low,
her read-in and generation times, her last call, memory, frames while she thinks; the game drops to 30 fps while she generates if frames
run long). Tests: `trolley_juli.test.mjs`, `desk_trolley_juli.mjs` (a fake model: scripted, random, garbage, slow, silent).

## v4: Juli in the game (Nov 1)

Josh: "We need additional work done on Troll-E if Juli doesn't provide mischievous actions it's not a game".

**Her model beside the game.** On Josh's iPhone her model loading beside the game ended the page (Juli was off on phones since). The
app's second process (the shared worker sw.js serves with COEP require-corp) has a memory budget of its own: the game asks the engine for
its own layout (`juli_link.js` GAME_SPLIT; an opt-in `splitAt` + `splitMirror` in engine/llm, the app's own Juli unchanged at 0-12).
- The game's layout is **0-20** (v4, Nov 2): of the layouts the bench tried, it is the one that lived beside the game; with more
  layers in the helper the helper ended as the page grew. The greedy answers are the same at every split, with and without the
  drafter (`desk_trolley_layout.mjs`).
- A WebKit page without that second process keeps her offline (no one-process fallback beside the game). Juli is on by default on
  phones; a saved off still wins.
- **When her second process ends** (iOS ends it first when the page grows): its heartbeat stops, she goes offline within ~4 s (a toast,
  the HUD chip), the game never waits. A minute later, while nothing loads and the game is inside its budget, she gets ONE retry on a
  fresh engine:
  - on 0-12 (REVIVE_AT) where the page has room for its share;
  - else on 0-20 again.

  A second end leaves her offline for the page.
- **Her context and her limit**: the prompt is compact (Level 1's ~470 tokens with its template, the open world's ~650), the state too
  (the 5 nearest pieces as [kind, x, z, d]), her context 1,536. Since Nov 2 her state also says what works right now: `can`, the moves her
  rails would pass, and `spawns`, the points she may use. On Josh's phone 4 of her 6 turns were refused. How long the game gives an
  answer is measured from her last turn: her read-in and an answer half again as long, 3-9 s (her answers took 6.6 s median there). She
  never blocks a frame.
- **The page's budget** (`main.js` PAGE): the page's ceiling on a phone, less WebKit's own share, less her page share on the game's
  layout, less a margin = **the game's own counted memory**. `desk_trolley_budget.mjs` checks every zone against it, and the probe
  shows the game's memory against its budget.

**Her mischief in Level 1** (juli.js MODES, `MISCHIEF_FROM = 'grab'`): before the grab step she only talks; from it (step 9: a01 has
driven, slalomed, spun, crabbed, docked and fitted its arm) her moves work in the hall. Two new pranks, both real and both hers:
- `lights_out` {seconds 4-8}: the hall's strips flicker and die (the neon signs stay lit), a01's headlamp comes on, the strips flicker
  back. Never in the ramp's steps (push, lineup, climb), never by the stairs, the landing or the ramp, never with a01 off the floor, once a
  minute.
- `chute_drop` {at S1-S8, trash, count 1-3}: a hatch in the hall's ceiling glows for a second, then the pieces fall from 2.05 m one after
  another (real bodies, Rapier's hard CCD while they fall: they land, bounce and roll; tested never below the floor), never onto a01 (a
  piece waits while a01 is under it), inside her trash limits (3 a minute with spawn_trash, 8 loose).
- Every move of hers shows as hers: her own radio line, a chip ("JULI · LIGHTS OUT 5 s", "JULI · TRASH FROM THE CHUTE ×2", "JULI · NEW
  TRASH · S3", "JULI · BOUNTY", ...), a sting. Her subtitles are always on: nothing hides them (the Radio switch is the radio sound on her
  voice).

**The stack game** (`stack.js`, `stack_spec.js`, `stack_view.js`, sim.js's arena and PLACE; Josh: "one mini game like stacking physical
trash against Juli trying to prevent it. Early on. So that there is direct interaction with Juli"): as the grab step is done, Juli
challenges a01 to stack 3 cans 0.25 m high on a weigh pad by the start (-5.3, 2.6) and hold them 5 s, inside 180 s, for 15 ROMs. At the
pad GRAB keeps a can in the claw (the bin stays on), GRAB again over the pad places it (the arm's IK sets it on the stack and lets go 4-5
mm up). Her four tools are real physics, each warning first (its light, a sound, the JULI chip; 1.6-2.0 s) and cooling down after (10-16 s),
one at a time, never while a01 places: the floor vent's gust (a 12.5 m/s jet, at most 1 N a body, 5.8 N in all: a lone can or the trolley
does not move), the plate's rattle (3 mm at ~13.5 Hz for 0.8 s; never with a tyre on it), a can rolled from a ceiling chute (lying on its
side) and a 3.2 kg sweeper bot at 0.3 m/s along its lane (it stops for a01). Measured on neat stacks, one call each: the vent topples
about half, the plate a third, the sweeper a third of those on the pad's south half, the roller none (it shoves the foot). While the game is
on her turns are its own (a ~250-token prompt and the pad's state); afterwards she gets one last word, the arena goes, the tutorial goes on.
The arena is 4-5 draw calls, ~1.1k triangles, no textures, and stands only while the game does.

**In Troll-E v1 the Bigger brain is her planner, nothing else** (v4, Nov 3; Josh: "Big brain brains before it loads on all. In V1 of
troll-e"). On every device it plans her shift in the loading screen, then lets go, and she plays live on her own model (E2B). The landing
has no brain choice; a 'p0pc0rn:trolley:brain' saved before is ignored. On the phone its page share at its split never fit beside the
game: the bench's live steps
(e4b-24, e4b-25) ended the page twice, the second time 60 s after the plot's close. Those steps are gone from the bench; a run saved
before still shows their lines. The Bigger brain live beside the game is a later idea.

**The Bigger brain plots her shift in the loading screen** (`plot.js`, `plan.js`; Josh: "Like inside a loading screen"): after Start or
Load, with Juli on and the Bigger brain downloaded, it loads in the page while nothing else is in it, reads a compact session (where a01 is
in the game, the day, the ROMs, last time's mood), writes her plan in a closed schema (her mood line and up to 6 intents: a trigger the game
can check (a step, an area, seconds of play, pieces binned, an event, the stack's height, the day) and a call with the same handles as her
live ones), is closed, and the page reloads into the game (the sure way to get its GPU memory back). In play each planned move fires when
its trigger comes true, through the same guard rails at that moment (a refused one tries again for 30 s, then it is dropped). Her live
model (E2B) improvises beside it with the same rate limits; without it the planned moves still happen. Every planned move and line is her
model's.

**Her voice** (Josh: "Voice 4 is what we go with"): CMU Flite 2.2 with its cmu_us_slt voice (the CMU ARCTIC slt voice), compiled to WebAssembly for p0pc0rn
(`voice/`: juli_tts.mjs + juli_tts.wasm 722 KB, the voice file 11.2 MB, juli_tts.c its entry point; Flite's own sources unchanged;
BSD-style + MIT, NOTICE.md), loaded with her first line (never on the landing screen), synthesised in a Worker (desk: 12 lines, 33 s of
speech in ~340 ms, ~97x real time, the longest line 34 ms, nothing on the page's thread; load ~50 ms) and played through the radio chain
(highpass 350 Hz, lowpass 3.2 kHz, a light bit-crush, a compressor, a squelch), never while a model loads. `voice/flite_voice.js`
VOICE_FILE names the voice file (a smoother Juli voice built the same way can replace it). If it cannot load, a quiet stand-in murmurs
her lines. "Juli's voice" on the landing's Settings turns it off; her subtitles stay.

**The landing screen** (`boot.js`, `landing.js`): the title art (FLUX.2 [klein] 9B, NOTICE.md), TROLL-E in neon, Start (a new game; over a
save it asks first), Load saved game (the day, where a01 wakes, the battery, the ROMs, when; greyed out without a save), Skip the tutorial
(once it was finished, or with a save), Settings (Juli, her voice, the radio, the sound, the probe, the plotting by the Bigger brain where it
fits), Controls, About, Back to p0pc0rn. The landing loads nothing of the game; the same screen is the loading screen.
The HUD's pause button: Resume, Save and quit to the landing screen (the open world saves where a01 is), Back to p0pc0rn.

**The phone bench** (`bench.js`, `bench_plan.js`; Settings › Benchmark › Troll-E + Juli, one button, ~12 min, each step in a fresh page,
a page the phone ends recorded and the run goes on): the game alone; game + Juli at 35, 29, 21 and 13 layers in the helper (her real prompt
and state, 8 turns: load, tokens/s, decide times, FPS idle and while she thinks, the helper alive); the stack game with her live (a01's arm
places three cans, her tools try to stop it); the Bigger brain's plotting and Level 1 with its plan; ballast in 64 MB steps beside the best
layout until the page or the helper ends; her voice's cost (Flite on the phone: load, ms per line, real-time factor). (Until Nov 3 it
ended with game + the Bigger brain live; Troll-E v1 has none.)

Why that order, and the rest of its survival rules (v4, after Josh's first phone run on Nov 1: three page ends in a row, then Safari stopped
reopening the page and the card had nothing to show):
- Headroom, the step most likely to end the page (it does so on purpose), runs last.
- A step that ends the page is recorded where it ended and the run moves on. It gets one more try later in the run, before headroom. A
  second end is "THE PAGE ENDED (twice …)" and it is skipped. Headroom (its page end is its reading) is never tried again. Her plan in play
  goes after the plot's second try.
- Right after a page end, headroom is not run: the phone's memory then is no fair reading of the room. Twice on Josh's phone its helper
  ended at her second turn there (SPLIT_RETRY), even after a 59 s wait, on the layout that lived in every step before (v4, Nov 3).
- On WebKit, a step that loads the scene or a model first waits 8 s, so the page before's GPU memory can come back (iOS 27 gives it back
  late; the app waits the same 8 s). The first such step's "page before" is the app's own page. Her plan in play doesn't wait, because it
  times the game's own loading-screen path.
- The time the run spends on Safari's "A problem repeatedly occurred" screen, or back in the app, is not counted against its 14 minutes.
  Reload on that screen goes on with the next step. If p0pc0rn opens instead, Settings › Benchmark shows the unfinished run (every step it
  measured, where and why it stopped, Copy) and offers "Continue from step N" beside a new run. Continue puts the steps left in this
  version's order.
- Each step writes a row in the app's Diagnostics (a step's code, a page end, the run's last line). A new run started over an unfinished one
  writes the old one's line first.
- Josh's two runs on Nov 1 (v054, the 6cd0d1a bench) both stopped on step 6, "Game + Juli · layers 0-28". It was the first heavy step
  after a planned reload from a page with a live helper, with no settle. That page loaded the game's code before it marked its step begun,
  so a page that ended there left the handover looking planned. Every reopen then ran step 6 again, until Safari gave up. Now:
  - A handover opened twice counts as a page end of that step ("its page opening").
  - A Juli step tells her helper to free its memory and waits 1.5 s before the next page.
  - Every step has a watchdog (240 s: "stuck at <stage>", and the run goes on).
  - Her backend's alive() answers within 3 s.
  - Her answers never overlap.
- The steps with no scene (this phone, the plot, the voice) run from boot.js and never load the game's code. A planned reload clears the
  game's crash crumb, so it no longer reads as "stopped while loading".

From Josh's card for c4e20c6 (Nov 3):
- **Order:** headroom runs LAST (its page end was the one Safari did not reopen).
- **A layout that can't fit beside the game is skipped** (bench_plan.js fitsBeside: the game's measured memory, her page share, WebKit's
  share and the margin against the page's ceiling).
- **After a step whose helper ended,** the next model step waits 40 s for its GPU memory to come back. The plot tries once more after
  20 s if her helper wasn't ready.
- **After the Bigger brain, or a page the phone ended** (v4, Nov 3, Josh's phone on iOS 27.0.1: "THE PAGE ENDED (at loading the Bigger
  brain 80%, 21 s in; the helper before: plot's, closed 3 s before; its close confirmed in 157 ms)"):
  - A closed model's GPU memory comes back late on WebKit, even with its helper's end confirmed, and a reload stays in the same process.
    3.8 learned the same thing: never load a big model again right after one.
  - So a model step starts 60 s after the Bigger brain's helper closed (the plot) or after a page end (`BIG_SETTLE_S`), and the card
    says it waited.
  - The wait is the phone's, not the run's own: it doesn't count in the 14 minutes.
  - On that run, headroom's helper ended at her second turn (SPLIT_RETRY) 20 s after the Bigger brain's page end. That is the same late
    memory: headroom's layout lived in every step before it.
  - Josh's clean-phone run (023dda3) settled the rest: the Bigger brain live still ended the page at 80 % of its load, 60 s after the
    plot's close. Its page share at its split simply doesn't fit beside the game. In Troll-E v1 it only plans (above), and right after a
    page end headroom is not run (its helper ended at her second turn there again, after a 59 s wait).
  - In the game, on a phone, Juli's first load waits until 60 s after the loading screen's plot closed the Bigger brain. Her plan's
    record is written after the close, and the trail says she is waiting.
- **Her plot's say lines** (Nov 3, the same run: "NO PLAN (no valid intents) · … 60 tokens · 0 intents, 2 cleaned by the schema"):
  - `desk_trolley_plotrepro.mjs` runs the real Bigger brain on the desk with the game's prompt and lists. For the bench's session it wrote
    the same 60 tokens: `{"call":"say","args":{}}` with no line. The prompt's "say {}: the line only" was read as no line at all.
  - Now the say handle reads "say {}: the line goes in "say"". In the tutorial (only say works before the grab step) the example is a
    say with its line.
  - The schema takes a say's line from its args when that is where it went: one desk answer had `{"args":{"":"Time to roll!"}}`.
  - The desk's six sessions (the bench's, Level 1 twice, into the open world, two later days) all give a plan now.
  - The card gives the schema's reasons when there is no plan.
  - A failed plan was already safe in the game: the loading screen says "She will improvise", the game reloads if her model was in the
    page, and plays without a plan.
- **The stack game** has its own loading screen in the game and the bench: every world area lets go first. The bench logs the page's and
  her helper's MB every second (and her helper's last heartbeat) until the game ends.
- **The card** names what she wrote for each refused move, explains its words, and shows her kept prompt (hit, partial, miss, the tokens
  read in).
- **Her calls are read as she meant them** (juli.js normCall): case, a target after the name ("barricade_nudge L3"), plain words for calls.
  "not a handle" was 7 of her 11 refusals.
- **Her helper's watch** gives no verdict on a round where the page itself stalled (its timer 2.5 s late).
- **Her prompt's fixed start can be kept in her helper** (the engine's prefix snapshot, eed8c76; `keepPrefix { page: false }`), warmed
  at load; her turns then read in only her state, which comes last.
  - It is OFF in the game until the phone proves it (`p0pc0rn:trolley:snapshot` = 1 turns it on).
  - The bench runs the game's layout both ways ("0-20" and "0-20 with her prompt kept").
  - The engine's `helperCapMB` caps the helper's whole memory, so it is her helper's own MB + 64. With 64 alone nothing was kept, so on Josh's
    phone run it had never engaged.
  - It is skipped when her helper plus that margin would pass the helper's own cap (`SNAP_HELPER_MAX_MB`).
  - On the desk's real split (`desk_trolley_snap.mjs`, a desktop integrated GPU, 0-20): every turn a hit, 125-182 tokens read in instead of 615-672,
    her turns 6.4-7.3 s instead of 11.0-11.9 s, 9.3 MB in the helper, no error.
- **From the card for bf2bbb1** (Nov 3; the snapshot desk repeated, 5 turns off and on twice): on the desk's real split her decode is the
  same with it on (6.8-8.8 tokens/s), her read-in 0.7-1.2 s instead of 5.4 s, her turns ~6 s instead of ~10.4 s. On the phone the
  snapshot step ran second and slower, so the bench now runs it first (a phone warms as it runs). The switch stays off until the phone
  agrees.
- **"a01" as her call or her target** (most of her refusals on the phone): read as aimed at the player.
  - As her call it is a prank if she named one, trash if she named a kind, else her line.
  - As a spawn point or lane, or when she names one too close to a01, it is the nearest legal point (`juli.js` aimPoint). The card says
    "aimed at a01: S1→S4".
- **Her model reads a compact state** (`juli.js` modelView): no coordinates, the 3 nearest pieces as [kind, metres], empty fields left
  out. About 60-70 tokens a turn instead of ~270. Her rails still check the whole state.
- **The stack game's turns use her measured window** (3-9 s) like her mischief turns. The fixed 3 s turned every stack answer on the
  phone into a timeout. The card lists each stack turn: time and limit, the tokens read in, read-in seconds, tokens/s.
- **The Bigger brain:**
  - After two failed helper starts in a run, its remaining steps are skipped ("the Bigger brain's helper wouldn't start").
  - Settings offers "Start: the Bigger brain first" (its plot on a fresh page before any of Juli's steps).
  - A model step's page end names the helper that went before it.
- **Continue:**
  - Settings shows "Continue the bench" first, the moment an unfinished run is found, and records each Continue.
  - A Continue whose page ends before its step begins is that step's page end. A step that ended the page is never offered again.
  - A headroom page end makes the card complete, with the ballast it reached.
- **Confirmed closes** (the engine's 8acc293: a second process's end is confirmed before the next starts):
  - In the bench, a Juli step awaits her helper's confirmed close before the next page, and the card shows it ("confirmed in N ms" or
    "unconfirmed after 15 s").
  - Each load shows how long it waited for earlier helpers and the helpers the page knew.
  - The plot's close is on its line.
  - After a helper ended, the next model step waits about 10 s when the close was confirmed, else the full 40/60 s. The page-end note
    says which.
  - In the game: the loading screen's plot waits for the Bigger brain's confirmed close before it reloads (runPlot, up to 16 s), and her
    one revive waits for the old engine's close (releaseEngine).
- **The play trail** (`trail.js`; Josh's play crash, "when I went into the dock to recharge" and "as soon as the store opened", left
  nothing in Diagnostics):
  - A ring of 40 entries in localStorage, written every 4 s and at every zone change, loading screen, the store opening and closing,
    her loads, helper ends and turns. Each entry has the zone, the area, what is loading, the page's counted memory, her helper's memory,
    its state and last heartbeat, Juli's state and model, and the last event.
  - Memory is now counted on every phone so the trail has it.
  - A clean leave closes the trail. A trail that never closed is reported once, as one line ("Troll-E stopped in the dock zone (area
    hall), page … MB, helper … MB (busy), Juli online (e2b), last: the store opened …"). It goes into the app's Diagnostics on the next
    open of p0pc0rn (Settings) or of the game, and onto the game's landing.
- **The store** (the dock's slots and upgrades) is DOM only: no models, no textures, no second WebGL context. The phone still ended at it
  a second time. Its trail showed the page over the game's budget, with her turn running. Now:
  - The store waits for her turn to finish (12 s at most). No new turn, model load or revive starts once a01 is on the charger.
  - It is a plain opaque panel: no glows, no large shadows, no transitions or animations.
  - While it is open the 3D canvas and the HUD are gone (display: none). The scene is not drawn at all; the physics still steps, so
    the charger charges.
  - Its opening is four entries in the trail: before the panel, the panel built, the drawing stopped, its first paint.

  The bench has a store step: a01 drives onto the charger with Juli live, the store opens once her turn ends, and the page's and her
  helper's memory are logged each second. Each trail entry also says what the page's memory is made of (textures, the screen, canvases,
  pictures, buffers).
- **The page's memory as the phone draws it** (`desk_trolley_phone.mjs`: `?test&phonelike` is quality high at pixel ratio 2 on a 440 x
  956 screen at 3x, the heap as Safari's 100 MB guess). The other desks draw at quality low and 1x, which hid about 100 MB. The dock
  zone was 484 MB in the hall, 536 in the yard and 542 after the store; now 379, 426 and 429. What went:
  - 2D canvases, 80 → 31 MB: textures already on the GPU kept their CPU copies. That was a01's maps drawn down to 1024 px, and the
    hall's and the world's textures drawn in code. `assets.js` dropCpuCopies lets them go every 3 s on a phone. Nothing draws on a
    texture's canvas again or uploads one twice.
  - Decoded pictures, 64 → 43 MB: the open world's items (assets/survival/, assets/craft/) are 256 px on a phone. Their models load for
    the zone whether any of that kind is out or not; 99 of their textures were never drawn. The collect bubble still loads its own at
    full size, and lets go of its pictures when it closes.
  - The sun's shadow map is 1024 px on a phone: 8 MB, 32 MB at 2048.
- **Zone changes** load the new zone's models one at a time (no pile of decoded pictures at once) and log the page before, after the
  old zone let go, its peak and after. Desk: 450 → 440 → peak 465 → 465 MB.
- **The Bigger brain's plot at a game's start** happens on a phone only once a Troll-E bench has seen its plot work there.
- **Juli doesn't repeat herself** (Josh: "Juli also repeated herself a lot about driving down the hallway to spin around"):
  - A line like one she said in the last 5 minutes (70 % of the same words) is dropped.
  - On one tutorial step her lines space out (her gap × 1, 2, 3) and stop after three. A new step starts again.
  - Her last 3 lines are in her state (`said`) with a line in her prompt not to repeat them.
- **The play view, decluttered** (Josh: "It's impossible to see with all of the notifications and text"; `hud_ui.js` createMessages,
  createHintChip, createZoneFlash):
  - One message area just above the controls, one message at a time and queued, Juli's lines first. Her line shows as a compact
    subtitle for 60 ms a character (at least 2.5 s) and stays while she is still speaking.
  - The tutorial step's hint shows for 5 s, then folds into a "10/15" chip; a tap shows it again.
  - The speed and mode pills are hidden. The zone shows for 2 s when it changes. The stack is a small counter during its game.
  - The top bar is Back, Pause, the hint chip, and a small battery and ROMs. Sound and restart moved into the pause sheet.
  - Nothing of the HUD sits over the trolley or its path at 390×844.
- **The drive sound** (Josh: "sounds like crying cats"):
  - A soft, low electric hum. One oscillator of whole-number harmonics, 60-104 Hz with speed, no vibrato.
  - A gentle low-pass that opens 300 → 640 Hz, low pink-noise tyre roll, and smooth wind-up and wind-down.
  - Servos at 150, 118 and 96 Hz.
  - Everything through one motor bus (`DRIVE.level` 0.5) and a 1.6 kHz low-pass.
  - At cruise the spectral centroid falls from 2,099 Hz to 217 Hz. Old and new were rendered from the same drive for listening first.
- **A full localStorage:** a save that fails is pruned (the bench's Diagnostics rows, then its long logs) and retried, and the card says so.
- **Load failures:** the card gives every load failure's message ("SPLIT_UNAVAILABLE: no second process here: …"). A failed second
  process counts as a helper end: the next model step waits, 60 s for the Bigger brain. A model's load shows its progress in tenths in
  the stage, so a page that ends in a load says how far it got.

**The area loading screens** (v4, Nov 2; Josh: "a loading screen between areas so that memory use is lower but if being chased by
leeches then leeches spawn in random locations within the new area loading to"; "Juli should do the work during those loading screens"):
- In the open world only one zone's models are loaded: the dock (the hall, its yard and the plaza), the park, the dead forest or the metro.
- Crossing into another zone (0.8 m past its edge, so a border never flickers) holds the game behind a loading screen. The screen shows
  the zone's name in its colour, then her line if it comes in time.
- Every other zone lets go of its models first (`world_view.js` unloadArea: the placeholders back, the meshes freed, a model freed once
  no loaded area uses it, through `assets.js` release). Only then does the new zone load its own.
- The leeches chasing a01 (crawling within 12 m) come down at random clear points of the new zone (`survival.js` relocateLeeches). Never
  in or round the shelter, never in the hall, never within 5 m of a01.
- Juli writes her plan for the zone during the screen, with her live model (the Bigger brain where it is the one live). It uses the
  plot's closed schema, the zone's areas, at most 3 intents, and triggers after_s, binned or event. Its moves fire through the same guard
  rails, and her live turns wait while she writes. The game never waits for her plan.

**Memory** (v4, Nov 2): every model texture lets go of its CPU copy (its canvas or its decoded ImageBitmap) once it is on the GPU
(`assets.js` releaseOnUpload; `?keepcopies` turns it off). A lost WebGL context can't restore those textures, so the game saves (in the
open world) and opens a fresh page.

**Juli in the tutorial** (v4, Nov 2; Josh: "Juli should talk in the tutorial"):
- Before the grab step, her prompt asks for a line on a01's step every turn; the old prompt let her pass.
- A new tutorial step brings her next turn in 1.5 s (`juli.js` nudge).
- Her answers run one at a time in the engine.

**The first shelter** (v4, Nov 2): the Cage Hive seals with 10 pieces: the charger, 7 mesh walls, the gate and the workbench. Its patch
roof is a bonus now. The hint names the next piece and the one thing to do for it.

**Tests** (kept outside this repository): `trolley_bench.test.mjs` (the bench's order, page ends, second tries, the twice rule, the Bigger
brain skip, paused time, the unfinished card, Continue on Josh's first run), `trolley_mischief.test.mjs` (the grab step, both pranks'
rails, the real fall, the game layout's engine options, her backend's death and one revive), `trolley_plan.test.mjs`,
`trolley_voice.test.mjs`, `trolley_stack.test.mjs`, desks
`desk_trolley_mischief.mjs`, `desk_trolley_flow.mjs` (the landing first, Start, pause, a plan played out, the stack game), `desk_trolley_bench.mjs`,
`desk_trolley_budget.mjs`, `desk_trolley_landing.mjs`, `desk_trolley_voice.mjs`, `desk_trolley_layout.mjs` (the real model, on a desktop GPU).

## The ramp

A 15° wedge (2.61 m long for 0.71 m) on four ball casters, 45 kg, with low side curbs and a lip plate at its high end. Push it on its
long side with the trolley's end face. When its high end is within 12 cm of the landing's free (east) face, square to it within 6° and
wholly along it, its casters lock (its light turns green, two clacks) so it cannot be driven out from under the trolley.

## The look (v2)

All drawn in code at load from a fixed seed (decor.js): rusted corrugated wall panels with seams, rivets, streaks and soot; stained,
cracked concrete with oil stains and skid marks; worn diamond tread plate on the treads, landing and ramp; teal paint flaking off rust on
the stairs; rusty pipes high on the walls; worn hazard stripes. Each colour map has one packed data map (height for bump, roughness,
metalness). Neon signs (generic words only: DOCK 01, CHARGE, NO SPILLS, RECLAIM, LANDING, SORT · CRUSH · REPEAT) are tube lettering on
canvases with additive halos, each with its own seeded flicker (NO SPILLS has a dying letter); four PointLights (distance 5-5.5 m, decay
2, no shadows) carry their light onto the walls and floor and follow the flicker.

**Bloom: not used.** It could not be measured on an iPhone for this version (the test desk draws with SwiftShader on the CPU, which
says nothing about an A18 Pro's GPU), and three's UnrealBloomPass means about ten extra full-screen passes plus a half-float
render target the size of the screen (about 30 MB at 1320 x 2868, more with MSAA), on top of a 610k-triangle scene with a shadow pass.
So the fallback the brief asked for: emissive signs, additive halos and real point lights. A phone probe could add it later behind a
flag if it measures cheap.

## Performance

**The boot (a phone's memory).** Josh's iPhone 16 Pro Max closed the page twice after loading, before a touch; the tutorial alone had
run there. What the page loads, and when (`desk_trolley_boot.mjs` checks it):
- **To the start card:** the physics (Rapier's WASM), the hall and the world's code-drawn textures (about 70 MB of GPU memory at the
  first frame), the open world's data (four JSON files, 140 KB: the start card's Continue and Skip need it), the trolley's model, the
  arm and the tutorial's props (the pallet, the drums, the box). No quadrant model loads before Play, nor through the tutorial (its hall
  is shut): world_view.js's load gate opens with the hall's shutters (or once a01 or the camera is out of the hall), and an area not
  loaded yet is not drawn up close. Nothing of the open world's own (assets/survival, assets/craft) loads before it is met.
- **On a phone** (iPhone or iPad Safari, a device with 4 GB or less, `?lowmem` on the desk) every model's textures are drawn down to
  1024 px at load, before they are first drawn (mipmaps kept; the decoded originals closed): the trolley's 3072 x 2048 maps were
  104 MB of GPU memory and are 19 MB.
- **Juli's model** (Gemma E2B, run by the app's engine) no longer loads at Play: she starts at the first real input after Play, or
  after 8 s of play, and only when no model is loading; the quadrants' loads wait while hers runs.
- **The breadcrumbs** (boot_crumbs.js, `p0pc0rn:trolley:boot`): each stage (`rapier`, `tex:hall`, `first-frame`, `ready`, `play`,
  `world:open`...) and each load in flight (`gltf:trolley`, `gltf:<model>`, `data`, `juli:load`) is written as it happens; a clean
  leave or 10 s of stable play with nothing loading clears it. A record still there at the next launch puts one line on the start card
  ("Last time Troll-E stopped while loading the trolley's model.") and a row into Settings > About > Diagnostics.

Measured on the desk (Chrome, 390 x 844 at 2x; WebGL's own textures, buffers and renderbuffers counted as they are given, and the
decoded images alive):

| moment | before | after | after, the phone path |
|---|---|---|---|
| the first frame | 71 MB GPU textures, heap 51 MB | 69 MB, heap 48 MB | 69 MB, heap 48 MB |
| the start card | 244 MB GPU textures + 17 MB buffers, 127 MB decoded images, 64 files (32 MB) | 235 + 14 MB, 107 MB, 55 files (27 MB) | 122 + 14 MB, 29 MB, 55 files |
| 6 s after Play, no input | Juli's model loading since Play | Juli waiting | Juli waiting; 122 MB, 44 MB decoded |
| the peak | 262 MB GPU, 142 MB decoded | 251 MB, 122 MB | 137 MB, 107 MB (for a moment: the trolley's maps decoded at full size before they are drawn down) |

Physics: about 3 ms a step on a desktop CPU in Chrome (WASM); the arm and a dozen loose bodies add little. Drawing (measured in the
desk at 390 x 844, the arm fitted, the props loaded): about 810k triangles a frame with the shadow pass (the arm is 53k, the props
about 90k), about 260 draw calls, 54 textures. The v2 canvas textures add about 36 MB of GPU memory with mipmaps and the props' JPEGs
about 25 MB more (the trolley's own are about 120 MB). Up to 2x pixel ratio; if frames run long it steps the pixel ratio down to 1,
then the shadow map to 1024, then turns the sign lights off, then (v4) draws the world's small things and props nearer only, then draws
every other frame.

**v4, the world** (`desk_trolley_world.mjs`, the same desk, the arm fitted, every world model loaded; draw calls / triangles a frame
with the shadow pass, in the chase view):

| view | calls | triangles |
|---|---:|---:|
| the hall | 278 | 846k |
| the dock's yard | 270 | 888k |
| the plaza | 281 | 907k |
| the park | 234 | 825k |
| the metro | 234 | 921k |
| the dead forest | 249 | 931k |
| the top view (the whole world) | 226 | 208k |

The trolley and its arm are about 720k of those with their shadows. What keeps the rest down:
- **Instancing.** Every repeat is one InstancedMesh: the dead trees by variant, the lamp posts, every prop kind per area, the puddles,
  the drums and the mud tracks. The rest is merged per material: the ground per kind, the fence, the railings, the brick walls, the
  facades, the roofs, the rails.
- **Distance culling.** Each area's small things are drawn only within 13 m of the camera, each prop kind within 12 m. The hall's own
  insides are not drawn while the camera is outside it and over 7 m from its walls, which hide them anyway.
- **Lazy models.** An area's models load the first time a01 comes near it.
- **Shadows.** Only the big silhouettes cast them (the blocks, the brick walls, the containers, the fountain, the rack and the pipes),
  not the 32 trees or the props with many materials.
- **The top view** draws a01 as a box (its 305k-triangle model hidden) and every prop as a flat footprint in one draw call, and it draws
  its shadow map once on the way in instead of every frame.
- **Lights.** One new light only, the METRO sign's. The lamp posts glow with an additive pool on the ground instead.
- **Textures.** The world's canvas textures are 512 px or less (the skyline 1024 x 256): about 25 MB. The props' textures are drawn down
  to 512 px at load: about 80 MB once every area has loaded (estimated from the maps' sizes; the set's 16 maps at 1024 px alone
  would have been 90 MB).
- **Juli's path check** over the world's 81k-cell grid takes about 30 ms on a desktop PC.

**v5, the fix round.** The trolley's model drew itself twice a frame (its 305k triangles in the shadow pass too, some 60 draws): about
a third of every frame. Now:
- **The robot's shadow** comes from the placeholder's own boxes (the colliders' measurements), merged into one shadow-only mesh for the
  chassis and one for the bin (drawn in the shadow pass; in the main pass they write no colour and no depth), and the arm's link boxes
  the same way; the model's meshes cast none, and the wheels and small parts under the body cast none (the body's shadow covers them).
  About 50 fewer draws and 330k fewer triangles in every view.
- **The hall's static boxes and posts** (the staircase alone is some 60 boxes: risers, treads, balusters; the skirting, the coves, the
  door frames, the posts and their bands) are merged into one mesh per material at load: 46 draws of the hall's insides become about 12.
- **A crafted machine** is merged into one mesh per material when it is placed (a station's dozen or two parts).
- The quadrants' props were already culled by distance (13 m) and by the frustum; from inside the hall what is left of the world is what
  the doors show (one draw each for the grounds, the fences and railings, and the forest's sunk drums through the south door): about 24
  draws and 58k triangles.

| view (desk_trolley_survival.mjs) | before: calls | triangles | after: calls | triangles |
|---|---:|---:|---:|---:|
| the hall with the Cage Hive, by day | 381 | 1187k | 322 | 795k |
| the hall with the Cage Hive, at night (leeches out) | 376 | 1154k | 306 | 798k |
| the park | 290 | 949k | 224 | 587k |
| the metro | 278 | 1032k | 220 | 674k |
| the dead forest | 315 | 1119k | 260 | 768k |
| the top view | 297 | 380k | 250 | 372k |

## Models and credits

| model | where | licence |
|---|---|---|
| Trolley: `equipment_trash_trolley_a01` | `assets/trolley.glb` | NVIDIA SimReady, CC BY 4.0 (`licenses/NOTICE-trolley-model.md`) |
| The grab arm: `robotic_system_arm_b01` with a `serviceTool_pliers_oilFilter_a01` claw (bracket textured with `structure_beam_a01`) | `assets/props/arm_cobot_claw.glb` | NVIDIA SimReady, CC BY 4.0, modified |
| Diesel can: `consumable_antifreeze_diesel_engine_a01` | `assets/props/diesel_can.glb` | NVIDIA SimReady, CC BY 4.0, modified |
| Trash: `food_beverage_can_b01`, `food_processed_cannedFood_b01`, `food_beverage_bottledWater_b01`, `food_beverage_beerBottle_a01`, `food_beverage_boxedDrink_a01`, `food_processed_chips_a01` | `assets/props/trash_*.glb` | NVIDIA SimReady, CC BY 4.0, modified |
| Big box `warehouse_box_cube_a07`, battery `electricalSystem_battery_a01`, drum `drum_steel_a01` (rusted), pallet `pallet_wood_recycled_a05`, barricade `environment_barricade_a01` | `assets/props/` | NVIDIA SimReady, CC BY 4.0, modified |
| The world's set dressing (v4): the dock's forklift (`vehicle_forklift_orange_a01`), pallet jack (`palletJack_heavyDuty_a01`), tote (`ibcTank_a02`), crate (`crate_plywood_b02`), rack (`rack_large_empty_a01`), hopper (`hopper_dumpling_steel_red_a07`), edge rail (`barrier_gate_safetyDock_a02`); the park's sofa (`sofa_visitor_a01`), armchair (`sofa_soft_b01`), cooler (`water_cooler_a01`), coffee kiosk (`machine_coffee_vending_a01`), bin (`trashCan_domed_blue_b01`), flood-light (`lighting_taskLight_tripodFlood_a01`); the metro's car shell (`carFrame_car_frame_assembled_a01`), info kiosk (`digitalSystem_infoKiosk_vertical_a01`), vending machine (`machine_vending_snacksDrinks_a01`), jersey barrier (`barrier_wall_plastic_orange_a03`), cabinet (`electrical_power_terminal_a01`), siren pole (`equipment_alarm_siren_a01`), wheelie bin (`trashCan_wheeled_black_a01`), duct (`hvac_vent_system_straight_a01`); the forest's wheelbarrow (`construction_wheelbarrow_metal_a01`), pipes (`pipe_plastic_black_b06`), board (`misc_boards_wooden_a02`); the dead trees' bark (`pallet_wood_recycled_a05`), grime from `structure_beam_a01` | `assets/world/` | NVIDIA SimReady, CC BY 4.0, modified (the dead trees' shapes are the game's own) |
| The open world (v5): the 24 crafted machines, the supplies, the salvage, the shelter kits, the night lights, the energy leech (a rearrangement of NVIDIA parts), the solar panel (an LED panel re-faced as cells), the robot charger, the LED hex grid, the hydraulic-oil jug, the rusty beam; the full per-asset list is in `licenses/NOTICE-trolley-props.md` and on the end and death cards | `assets/survival/`, `assets/craft/` | NVIDIA SimReady, CC BY 4.0, modified |
| The room, the dock, the stairs, the ramp, the signs, the arm kit's crate; v4: the world's ground, fence, walls, blocks, lamp posts, containers, fountain, signpost, rubble and textures | `view.js`, `decor.js`, `props_view.js`, `world_view.js`, `world_decor.js` | the game's own |

Every prop and its changes: `licenses/NOTICE-trolley-props.md`. Credit line on the start and end cards: "3D assets: NVIDIA SimReady
Assets (CC BY 4.0), modified." The brand names on some labels are NVIDIA's fictional artwork that comes with the assets.
Physics: Rapier (Apache-2.0). Drawing: three.js (MIT).
