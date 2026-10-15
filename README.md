# Play Mesopotamia

A walkable 3D simulation of ancient Mesopotamia that runs in your browser.

You arrive in the city of Ur around 1750 BCE. Walk its streets, step inside
people's houses, climb toward the ziggurat, haggle in the market and sit in on
a scribal school. Every person you meet and every object you pick up teaches you
something about how people actually lived here almost 4,000 years ago, and
everything in the game is tied back to real archaeological finds.

Some things you'll be able to do:

- Play the Royal Game of Ur, the board game found in the city's royal tombs,
  using the rules reconstructed from a cuneiform tablet
- Press wedges into wet clay and write your name in cuneiform
- Trade barley and silver in base 60, the number system we still use for clocks
- Visit Ea-nasir, the copper merchant who received the oldest known customer
  complaint
- Open a canal gate and watch water reach the fields that fed the city

## Status

Phase 1. The whole of Ur at its real size, about 1.2 km by 0.8 km inside its
wall: around 2,000 generated courtyard houses with roof terraces, the canal
through the city with its bridges, the harbours, and the temple district with
the ziggurat and its temples. Walk it in first person; the city builds itself
around you as you go. See [PLAN.md](PLAN.md) for the design and roadmap.

Play the latest build: https://jawaadjariwala.github.io/Play-Mesopotamia/

## Playing

- **Keyboard and mouse:** W A S D or the arrow keys to move, the mouse to look,
  Shift to run. Esc opens the menu.
- **Touch screens (tablets, touch Chromebooks):** the stick moves you, drag
  anywhere to look around, tap Run to run.
- **The menu** lets you jump straight to the ziggurat, the temple district, the
  canal, the West Harbour or the city wall, which helps a whole class get to the
  same place quickly.

## Running it

```
npm install
npm run dev                    # http://localhost:5173
node scripts/shoot.mjs         # headless: fps, errors, screenshots (dev server running)
node scripts/walk-check.mjs    # walking, collisions, the stair, bridges, no way out of the city
node scripts/shake-check.mjs   # per-frame camera motion while walking (or `run`)
```

Fixed camera views for screenshots skip the menus: `?view=street`,
`?view=rooftops`, `?view=temenos`, `?view=ziggurat`, `?view=canal`,
`?view=aerial`, `?view=wall`; add `&autopilot=5` to drift at 5 m/s and test
streaming. `?stats` shows the performance overlay while playing.

## Tech

Three.js (WebGPU renderer with automatic WebGL 2 fallback, TSL shaders and
post-processing), Rapier physics, Vite and TypeScript, with Ink dialogue to come. Static hosting on GitHub Pages, no server needed to play.

## Historical sources

The reconstruction leans on the excavation records of Ur (Leonard Woolley,
1922 to 1934, digitised as Ur Online by the Penn Museum and British Museum), the British Museum collection, the Cuneiform
Digital Library Initiative and the Electronic Text Corpus of Sumerian
Literature. Where the evidence runs out and the game has to guess, it says so.

## License

Code: MIT. Historical content and art: to be decided before the first release.

Textures from [Poly Haven](https://polyhaven.com) (CC0): Clay Plaster, Brown
Brick 02, Dirt Floor, Clay Block Wall, Weathered Brown Planks, Bark Willow.
