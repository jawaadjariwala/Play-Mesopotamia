# Play Mesopotamia: design and roadmap

## The idea in one paragraph

A small, dense, good-looking slice of one real city that you can walk through
in the browser, where everything you touch teaches you something. Breadth comes
later. The first goal is ten minutes in one neighbourhood of Ur that look real
and feel alive, because a beautiful street with five great interactions teaches
more than an empty empire.

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
- Third-person walking around a city, with solid collisions
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
            |   World streamer --> loads/unloads district GLBs |
            |   Renderer (WebGPU, TSL post FX, day/night)      |
            +--------------------------------------------------+
                         ^
                         | static files
               GitHub Pages (code + assets)
```

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
| Fields outside the walls | Farmers | Open canal gates to water fields before the flood season | Irrigation, why cities existed here at all |
| Harbour | Boatmen | Load a reed boat for Dilmun | Trade routes, the Gulf, what Ur imported |
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
- [ ] Re-check the laptop with palms and props, then a phone
- [x] Deploy to GitHub Pages with GitHub Actions

Measured so far:
- Laptop, Chrome: 60 fps with the first test block.
- Headless Chrome (M-series Mac, 960x540, a smoke test only), with palms and
  pottery: 60 fps (vsync-capped), about 135 draw calls, about 670k triangles
  per frame summed over the normal, shadow and main passes, 11 MB of textures,
  256 KB of gzipped JS. Palms are most of the triangles, so they're the first
  thing to give LODs when phones get tested.

Exit: a screenshot people mistake for a render, at measured fps.

### Phase 1: vertical slice (2 to 3 weeks)
- [ ] Trace one block of Woolley's residential quarter plan into JSON
- [ ] City generator v1: stairs, drains, rounded corners and jambs; colliders into Rapier
- [ ] One street and one enterable courtyard house
- [ ] Third-person controller with Rapier
- [ ] Interaction prompts, inspect view, codex with 10 entries
- [ ] Two characters with Ink dialogue (a homeowner, Ea-nasir)
- [ ] Royal Game of Ur, fully playable against a simple AI
- [ ] Save/load in localStorage

Exit: a first-time player finishes a 10-minute loop without help.

### Phase 2: the neighbourhood (3 to 4 weeks)
- [ ] Market street, scribal school, temple precinct edge
- [ ] Cuneiform writing and base-60 trading mini-games
- [ ] District streaming and LODs
- [ ] Day/night cycle, ambient crowds (instanced, simple loops), soundscape
- [ ] Main quest line linking the places
- [ ] Mobile touch controls

### Phase 3: the wider city (3 to 4 weeks)
- [ ] Ziggurat (visible from everywhere), harbour, fields and canals
- [ ] Irrigation and law mini-games
- [ ] Intro cinematic and cutscenes
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
| Historical errors | Every fact cited; evidence labels in-game; invite corrections via issues |
| WebGPU edge cases | Automatic WebGL 2 fallback (verified); real-browser spike in Phase 0 |

## Open questions
- Third person or first person? Third person shows off the clothing and makes
  the world feel inhabited; first person is cheaper to build.
- Language for characters: English with occasional Akkadian words and greetings?
- Should the Game of Ur be playable online against friends?
