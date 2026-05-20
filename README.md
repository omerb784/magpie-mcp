# site/

Source for **https://omerb784.github.io/magpie-mcp/**.

Authored here on `main`. A GitHub Action (`.github/workflows/deploy-site.yml`) mirrors this folder to the `gh-pages` branch on every push that touches `site/**`. GitHub Pages serves from `gh-pages` — do not edit that branch by hand.

Pages:
- `index.html` — landing
- `guide.html` — user guide mirror (canonical lives in `seed/user-guide/`)
- `why.html` — Owner's project-context page

Assets live under `site/assets/{brand,dashboard}/`. Brand rasters are checked in (chroma-keyed PNGs); regenerate via `scripts/strip-bg-brand-assets.mjs` + `scripts/resize-brand-assets.mjs`.
