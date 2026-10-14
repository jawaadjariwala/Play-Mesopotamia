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

Phase 0 (look-dev). A test street in Ur with a courtyard house and the
ziggurat on the horizon, generated from layout data. See [PLAN.md](PLAN.md)
for the design and roadmap.

Play the latest build: https://jawaadjariwala.github.io/Play-Mesopotamia/

## Running it

```
npm install
npm run dev          # http://localhost:5173
node scripts/shoot.mjs   # headless check: fps, errors, screenshots (dev server running)
```

Camera presets: `?view=street`, `?view=courtyard`, `?view=aerial`. Lighting can
be tuned from the URL too, for example `?exp=0.9&sun=5&env=0.3&bounce=8&tm=aces`.

## Tech

Three.js (WebGPU renderer with automatic WebGL 2 fallback, TSL shaders and
post-processing), Vite and TypeScript, with Rapier physics and Ink dialogue
coming in Phase 1. Static hosting on GitHub Pages, no server needed to play.

## Historical sources

The reconstruction leans on the excavation records of Ur (Leonard Woolley,
1922 to 1934, digitised as Ur Online by the Penn Museum and British Museum), the British Museum collection, the Cuneiform
Digital Library Initiative and the Electronic Text Corpus of Sumerian
Literature. Where the evidence runs out and the game has to guess, it says so.

## License

Code: MIT. Historical content and art: to be decided before the first release.

Textures from [Poly Haven](https://polyhaven.com) (CC0): Clay Plaster, Brown
Brick 02, Dirt Floor, Clay Block Wall, Weathered Brown Planks, Bark Willow.
