# Play Mesopotamia: design and roadmap

## The idea in one paragraph

The whole city of Ur at its real size, walkable in the browser, where
everything you touch teaches you something. The explorable world is exactly
the city inside its wall, about 1.2 km by 0.8 km; past the wall the river,
canal and palm groves are scenery you can see but not reach. Depth beats
breadth: a few streets with great interactions teach more than an empty empire,
so the city fills in with detail one district at a time.

## Setting

**Ur, around 1750 BCE.** Picked because it has the best evidence for daily life
of any Mesopotamian city at street level:

- Woolley excavated whole blocks of houses from this period, so streets, room
  layouts and courtyards can follow real plans instead of guesses.
- The ziggurat of Ur-Nammu was already over 300 years old and still the centre
  of the city.
- Scribal schools in these houses left piles of practice tablets, so the
  writing lessons are based on what real students wrote.
- Ea-nasir's house and the complaint tablet sent to him by Nanni come from
  this neighbourhood and period.
- Ur was under Hammurabi's Babylon, so his laws fit naturally into the world.

Second chapter later: Babylon around 575 BCE (Ishtar Gate, Processional Way).

## Requirements

Functional
- First-person walking around the whole city, with solid collisions (third person once there is a character model)
- Talk to people (branching dialogue), inspect objects, pick some up
- Mini-games tied to real practices
- A codex ("tablet collection") that fills as you learn, each entry citing its source
- Quests that chain places and people together
- Save progress in the browser

Non-functional (targets, to be measured from Phase 0 on)
- 60 fps on an M1 MacBook Air at 1080p, 30 fps on a mid-range phone
- Playable within 10 s on broadband; first download under 20 MB, the rest streamed
- Runs on current Chrome, Edge, Safari and Firefox
- Hosting cost near $0

Constraints
- Solo developer, part time
- No backend for the core game

## Stack and why

| Layer | Choice | Why | Revisit if |
|---|---|---|---|
| Rendering | three.js `WebGPURenderer` | Supported in every major browser since Safari 26; falls back to WebGL 2 on its own. TSL shaders and post-processing work on both backends | Firefox/Linux black screens or a needed library is WebGL-only |
| Scene code | Plain three.js + TypeScript (see ADR-001) | WebGPU/TSL examples are all plain three.js; fewer layers to debug | UI grows complex enough to want a framework (React for DOM overlays only) |
| Physics | Rapier (`@dimforge/rapier3d-compat`) | Fast WASM physics, kinematic character controller built in | |
| Dialogue | Ink (`inkjs`) | Writer-friendly branching scripts, tracks variables for quests | |
| State | Zustand (vanilla store) | Tiny, no framework needed | |
| Build | Vite + TypeScript | | |
| Hosting | GitHub Pages, deployed by GitHub Actions | Free for public repos, no extra account | Assets outgrow Pages' ~1 GB site limit; then Cloudflare R2's free tier |

**What about Higgsfield?** It's an AI video and image tool, not a real-time 3D
engine, so nothing in the walkable world comes from it. It's still useful for
concept art and style frames, the intro cinematic, story cutscenes (the flood,
a temple festival) played as video, and the trailer. Free credits are limited, so
they go on a few key scenes.

**Free resources only.** Everything in the project is free to use: open source
code, CC0 or CC BY assets, and free tiers of AI tools. Where a free tier's
output is licensed for non-commercial use only, that's acceptable because the
game is free, but open licences are preferred.

### ADR-001: plain three.js instead of React Three Fiber

**Status:** accepted, Oct 2026.

**Context.** The renderer is `WebGPURenderer` with TSL post-processing. Most of
drei's helpers are written in GLSL for `WebGLRenderer`, so the main reason to
adopt React Three Fiber (its ecosystem) mostly falls away. The game loop,
physics, streaming and generator are imperative code either way.

**Options.** (A) React Three Fiber + drei: declarative scenes and React UI, but
an extra layer between our code and three.js, and WebGPU examples need
translating. (B) Plain three.js + TypeScript: matches the official WebGPU
examples one to one, less to debug; UI overlays need their own small layer.

**Decision.** B. React can still be used later for DOM overlays (dialogue,
codex) without owning the 3D scene.

**Revisit if** the UI layer grows into a tangle of manual DOM code.

## Where the "real" look comes from

Realism in a browser game comes far more from light and materials than from
polygon count. In order of payoff:

1. **Light.** One strong sun, an HDRI sky, physically based exposure, AgX tone
   mapping. Mudbrick under harsh Iraqi sun is the whole mood.
2. **Materials.** Scanned PBR textures (mudbrick, plaster, reed, bitumen, packed
   earth) from Poly Haven and ambientCG, both CC0. Trim sheets and decals for
   wear, cracks, soot near doorways.
3. **Atmosphere.** Height fog and dust haze, god rays in courtyards, heat
   shimmer at distance, a day/night cycle.
4. **Post-processing.** GTAO ambient occlusion, bloom, subtle colour grade,
   all done in TSL so it runs on both backends.
5. **Baked lighting** for interiors, so rooms read correctly without real-time GI.
6. **Life.** Smoke from ovens, cloth moving, birds, people walking. A still
   street looks fake no matter how good the textures are.

Optional experiment: Gaussian splats (World Labs' Spark renderer) for distant
backdrops like the river and palm groves. Spark is WebGL 2 only right now, so
it only makes the cut if it gains WebGPU support or the game moves to the
WebGL renderer.

## Asset pipeline

Nobody models anything by hand. The city is split by what each kind of thing
needs:

| What | How it's made | Why |
|---|---|---|
| Houses, streets, walls, ziggurat | **Generated in code** from plan data | Ur's buildings are mudbrick boxes around courtyards with flat roofs. A generator gives exact control, real layouts and free colliders |
| Props (pots, looms, ovens, boats, furniture) | Image-to-3D with free tools (TRELLIS 2, MIT; Hunyuan3D free tier; Meshy/Tripo free credits), then cleaned up by script | Too detailed to generate in code, simple enough for AI models |
| Characters | Meshy (pose mode) or Tripo free credits, auto-rigged, free Mixamo animations | Rigging by hand is the slowest part of 3D work |
| Cleanup, decimation, UVs, light baking | Blender driven headlessly by scripts, or through BlenderMCP | Blender does the work but nobody has to click around in it |
| Distant backdrops (river, palm groves, fields) | Experiment: World Labs Marble free tier, splat + collider GLB | Only if Spark works with our renderer (see above) |
| Intro, story cutscenes, trailer | Higgsfield video (free credits), played in-game | Cinematic realism the real-time engine can't match |

### The city generator

Woolley published plans of the Old Babylonian residential quarter at Ur, house
by house. Those plans get traced into data once:

```ts
// content/city/ah-site/example-house.json   (shape only, numbers are made up)
{
  "id": "example-house",
  "walls":   [[[0,0],[12.5,0],[12.5,9.8],[0,9.8],[0,0]]],
  "rooms":   [{ "id": "courtyard", "poly": [[3,3],[7.5,3],[7.5,7],[3,7]], "roof": false }],
  "doors":   [{ "wall": 0, "at": 4.1, "width": 0.9 }],
  "stairs":  [{ "room": "r4", "to": "upper" }],
  "storeys": 2,
  "evidence": "excavated"
}
```

The generator turns that into geometry: extruded walls with wall thickness and
height rules, plastered or bare brick, door frames, roof beams and matting,
stairs, drains, and decals for wear. Physics colliders come from the same data.
Streets are the gaps between houses, exactly as on the plan. The ziggurat's
known dimensions feed the same kind of generator.

Where the plan is guesswork (upper floors, roofs, wall heights), the data says
so with `"evidence": "inferred"`, and the codex can explain the guess.

### Blender without opening Blender

Blender runs in the background (`blender -b -P script.py`) for batch jobs:
decimating AI meshes, fixing normals, making LODs, baking lightmaps. For
one-off work, [BlenderMCP](https://github.com/ahujasid/blender-mcp) (MIT) lets
an AI assistant drive Blender directly and pull Poly Haven textures, Sketchfab
models and Hunyuan3D / Tripo / Rodin generations. Its code-execution tool runs
arbitrary Python inside Blender and its socket has no auth, so it stays on
localhost and work is saved before each session.

### Existing assets worth using

There is no open-source walkable Mesopotamian city to build on. What does exist:

| Asset | Licence | Use |
|---|---|---|
| Poly Haven, ambientCG textures and HDRIs | CC0 | All base materials and skies |
| Ishtar Gate models on Sketchfab (several) | CC BY (check each) | Babylon chapter |
| Ziggurat of Ur drone photogrammetry, Lagash Archaeological Project | Not stated | Reference only for proportions and ruins, unless permission is given |
| Standard of Ur model (British Museum images) | CC BY-NC-SA | Reference only |

Rules
- Every AI-generated object is checked against a real reference before it ships.
  These tools drift toward Egyptian and Greek styles if you let them.
- Check each tool's commercial licence tier before shipping its output. Several
  free tiers are non-commercial.
- Budget per district (target): under 300 draw calls, under 1.5M visible
  triangles, under 40 MB of compressed assets.
- Repeated things (bricks, palms, pots, crowds) use instancing.

## Architecture

```
            +-------------------- Browser --------------------+
            |                                                  |
  input --> | Player controller --> Rapier physics world       |
            |        |                                         |
            |        v                                         |
            | Interaction system (proximity + raycast prompts) |
            |    |            |              |                 |
            |    v            v              v                 |
            | Dialogue     Inspect UI     Mini-game host       |
            | (inkjs)      (codex entry)  (Game of Ur, clay,   |
            |    |            |            market, canals)     |
            |    +-----+------+--------------+                 |
            |          v                                       |
            |   Game state store (Zustand)  <--> localStorage  |
            |          |                                       |
            |          v                                       |
            |   City streamer --> builds blocks near the player |
            |   Renderer (WebGPU, TSL post FX, day/night)      |
            +--------------------------------------------------+
                         ^
                         | static files
               GitHub Pages (code + assets)
```

## The open city

**Layout.** Two layers. A hand-authored macro plan (`content/city/ur.json`)
places what the excavations tell us: the oval wall, the temenos a little
north-west of centre with the ziggurat in its western corner, the West and
North harbours, the Euphrates to the west and the canal around the north-east.
A deterministic generator fills everything else: jittered street lines with a
wider avenue every few streets, blocks between them, one or two rows of plots
per block so every house touches a street, and a courtyard house on each plot
(rooms around a central court, street door into the room that opens onto the
court, the plan Woolley found again and again). Same seeds, same city, every
visit. Excavated houses traced from Woolley's plans will replace generated
ones plot by plot.

**Streaming.**

```
 every frame, at the player's position
   |
   +-- blocks within 75 m ----> build house by house (3 ms/frame budget)
   |                              -> compileAsync (GPU pipelines off the critical path)
   |                              -> attach: meshes + Rapier colliders + pooled pottery
   |                              -> hide that block's massing (one uniform flag)
   |
   +-- blocks beyond 95 m ----> detach, free colliders and pottery slots, show massing
   |
   +-- the whole city ---------> low-detail massing, merged per 4x4-block sector,
                                 built once at load; per-block visibility in the shader
```

Palms switch between a cheap far version and a detailed near version per grove.
The shadow map follows the player. Resolution scales down when frame rate drops.

**Why this shape (ADR-002).** Per-block meshes would mean thousands of draw
calls for the far city; three.js's BatchedMesh issues one draw per instance on
WebGPU, which measured worse (2,000+ draws). Rebuilding merged sectors whenever
a block loaded, and creating new pottery meshes per block, both caused visible
hitches while walking (45 to 135 ms frames). Merging once, hiding with a
shader flag, and pooling instanced props removed them: walking now measures the
same worst frame as standing still.

**Measured** (headless Chrome, M-series Mac, 960x540, a smoke test): 60 fps
while walking through the city, worst frame 22 ms, about 85 to 350 draw calls
and 0.2M to 1.1M triangles per frame depending on the view, 2,567 houses.

## Content model

All learning content lives as data in the repo, separate from code, so facts
can be fixed without touching the engine.

```ts
// content/codex/royal-game-of-ur.json
{
  "id": "royal-game-of-ur",
  "title": "The Royal Game of Ur",
  "summary": "A race game for two players, played across Mesopotamia for over 2,000 years.",
  "body": "…",
  "evidence": "excavated",        // excavated | textual | inferred | invented
  "sources": [{ "label": "British Museum, game board from the Royal Cemetery", "url": "…" }],
  "unlockedBy": ["npc:scribe-teacher", "object:game-board"]
}
```

The `evidence` field is shown in the game. Players should always be able to
tell the difference between what was dug up, what was written down, and what
the game made up to fill a gap.

Dialogue lives in `content/dialogue/*.ink`, quests in `content/quests/*.json`.

## Places and things to do

| Place | People | Interaction / mini-game | What it teaches |
|---|---|---|---|
| A courtyard house | A family | Explore rooms, bake bread in a tannur oven | Family life, house layout, burials under the floor |
| Ea-nasir's house | Ea-nasir | Read Nanni's complaint tablet, sort good copper from bad | Long-distance trade with Dilmun, contracts |
| Scribal school | Teacher, students | Press cuneiform wedges into clay, copy a sign list | Writing, education, how hard it was |
| Market street | Traders | Barter in barley and silver using base 60 | Weights, money before coins, sexagesimal maths |
| Temple precinct | Priest, temple workers | Bring offerings, climb toward the ziggurat | Religion, Nanna the moon god, temple economy |
| A courtyard game | Neighbours | **Play the Royal Game of Ur** | Leisure, the oldest playable board game rules |
| On the city wall | A field overseer | Plan which canal gates to open for the fields you can see beyond the wall | Irrigation, why cities existed here at all |
| Harbour quay | Boatmen | Load a reed boat for Dilmun | Trade routes, the Gulf, what Ur imported |
| City gate | Scribe of the court | Settle a dispute using a law of Hammurabi | Law, justice, social classes |

## Roadmap

Each phase ends with something deployed and playable.

### Phase 0: look-dev and setup (1 week)
- [x] Vite + TypeScript + plain three.js, `WebGPURenderer` with `await renderer.init()`
- [x] WebGL 2 fallback renders the same scene (tested by hiding WebGPU in Chrome)
- [ ] Spike on Safari, Firefox and a phone
- [x] Ground, physical sky, sun with soft shadows, warm bounce light, fog, GTAO, bloom, FXAA
- [x] City generator v0: walls with doors and lintels, baked-brick footing, roofs, collider boxes, ziggurat terraces
- [x] Test block: one courtyard house, six neighbours, a street, the ziggurat at the end
- [x] Worn plaster showing mudbrick underneath, grime at the base of walls, rain streaks
- [x] Eroded, uneven wall tops; wooden door leaves; baked-brick courtyard paving
- [x] Procedural date palms (instanced, swaying in the wind) in groves around the city
- [x] Wheel-thrown pottery generated from jar, cooking-pot and bowl profiles
- [ ] One generated wall that looks real in a screenshot (first pass done, not there yet)
- [ ] Headless Blender script that takes one AI-generated prop and outputs a web-ready GLB with LODs (pots turned out not to need it)
- [x] FPS overlay; `scripts/shoot.mjs` for headless checks
- [x] Record fps on a real laptop: 60 fps in Chrome (before palms and props)
- [x] Re-check the laptop with palms and props: 40 to 45 fps, which led to the streaming and LOD work below
- [ ] Re-check the laptop with the open city, then a phone
- [x] Deploy to GitHub Pages with GitHub Actions

Measured so far:
- Laptop, Chrome: 60 fps with the first test block.
- Headless Chrome (M-series Mac, 960x540, a smoke test only), with palms and
  pottery: 60 fps (vsync-capped), about 135 draw calls, about 670k triangles
  per frame summed over the normal, shadow and main passes, 11 MB of textures,
  256 KB of gzipped JS. Palms are most of the triangles, so they're the first
  thing to give LODs when phones get tested.

Exit: a screenshot people mistake for a render, at measured fps.

### Phase 1: the open city, then a vertical slice (3 to 4 weeks)
- [x] Macro plan of Ur at real size: wall, gates, temenos, ziggurat, harbours, river, canal
- [x] Generated streets, blocks and courtyard houses for the whole city
- [x] Streaming with time-sliced building, async pipeline compile, sector massing, pooled props
- [x] First-person walking with Rapier: collisions, steps, the ziggurat stair is climbable
- [x] Adaptive resolution and a shadow map that follows the player
- [x] Per-house plaster tones
- [ ] Street life on the walls: more doors, benches, drains, rubbish, steps up to raised doorways
- [ ] Less grid-like streets: bends and dead-end alleys
- [ ] Temples and shrines in the temenos, the gipar, a market street
- [ ] Trace one block of Woolley's residential quarter plan into JSON and swap it in
- [ ] City generator v1: stairs, drains, rounded corners and jambs
- [ ] Touch controls for phones and tablets
- [ ] Load Rapier's WASM as its own file instead of inlined (the JS bundle is 1.9 MB gzipped, mostly physics)
- [ ] Interaction prompts, inspect view, codex with 10 entries
- [ ] Two characters with Ink dialogue (a homeowner, Ea-nasir)
- [ ] Royal Game of Ur, fully playable against a simple AI
- [ ] Save/load in localStorage

Exit: a first-time player finishes a 10-minute loop without help.

### Phase 2: the neighbourhood (3 to 4 weeks)
- [ ] Market street, scribal school, temple precinct edge
- [ ] Cuneiform writing and base-60 trading mini-games
- [ ] Day/night cycle, ambient crowds (instanced, simple loops), soundscape
- [ ] Main quest line linking the places
- [ ] Mobile touch controls

### Phase 3: the wider city (3 to 4 weeks)
- [ ] Harbour life: boats, quays, goods
- [ ] Walk the city wall
- [ ] Irrigation and law mini-games
- [ ] Intro cinematic and cutscenes (see Cinematics)
- [ ] Accessibility: subtitles, remappable keys, reduced-motion mode

### Phase 4: ask the city (optional, 2 weeks)
- [ ] Let players ask characters free-form questions, answered by an LLM that
      may only use the codex entries as its source and cites them
- [ ] Evaluation set of 100 questions scored for historical accuracy and refusals
      of things the evidence doesn't support
- [ ] Hard cost cap; scripted dialogue stays the default

### Phase 5: launch
- [ ] Performance pass against the targets above
- [ ] Trailer
- [ ] A short teacher's guide: what each place covers, 5 to 10 minute lessons
- [ ] Decide the content licence

Later: Babylon chapter, WebXR mode, classroom multiplayer.

## Risks

| Risk | Mitigation |
|---|---|
| Looks great in screenshots, runs badly | Measure fps from Phase 0; budgets per district; test on a phone every phase |
| AI-generated assets look generic or wrong for the period | Reference first, generate second; architecture generated from excavation plans |
| Generated buildings look procedural and repetitive | Per-house variation in plaster, wear, clutter and lighting; hand-placed props on top |
| Scope grows into "all of Mesopotamia" | One city, one decade, until Phase 5 ships |
| Generated streets feel like a grid | Bends, alleys and dead ends in the generator; traced real blocks near the spawn |
| Historical errors | Every fact cited; evidence labels in-game; invite corrections via issues |
| WebGPU edge cases | Automatic WebGL 2 fallback (verified); real-browser spike in Phase 0 |

## Cinematics

The player never flies a free camera, so everything seen from the air is a
video made with Higgsfield and played in the game. To keep the videos matching
the game, each one starts from an in-game frame (image to video), not from a
text prompt alone.

| Shot | Length | Start frame | Prompt notes |
|---|---|---|---|
| Intro: drone over the Euphrates and palm groves, across the city wall, toward the ziggurat, ending at street level | 10 to 15 s | `?view=aerial` screenshot | Morning haze, low warm sun, flat-roofed mudbrick houses with courtyards, narrow lanes, a stepped brick ziggurat with one long stair. Slow forward drone move. |
| Festival procession up to the ziggurat | 8 to 10 s | `?view=ziggurat` screenshot | Crowd in plain wool and linen, priests, offerings carried on heads |
| Boats unloading copper from Dilmun at the harbour | 8 to 10 s | harbour screenshot | Reed boats, ingots, scribes recording on clay tablets |

Every prompt also lists what must not appear: no pyramids, no stone columns,
no domes, no glass, no Egyptian or Greek styling, no horses or camels.

Videos go in `public/video/` as MP4 (H.264), under about 15 MB each.

## Open questions
- Language for characters: English with occasional Akkadian words and greetings?
- Should the Game of Ur be playable online against friends?
