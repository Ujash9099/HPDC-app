# HPDC Parameter Calculation — Windows .exe build

## What's in here
- `main.js` — the Electron wrapper. It starts a tiny local web server and loads
  the app from it, rather than from `file://`. This is deliberate: `file://`
  blocks module imports and blob URLs, which is what caused the earlier
  "bundle error" messages.
- `renderer/` — the actual application (HTML, scripts, defect images).
- `package.json` — build configuration.

## Build the installer
Requires Node.js and an internet connection **on the build machine only**.

```
npm install
npm run build -- --publish=never
```

Output: `dist/HPDC Parameter Calculation Setup 1.0.0.exe`

Copy that single `.exe` to the target Windows PC and double-click it. Nothing
else needs to be transferred — no Node, no npm, no internet on that machine.
If SmartScreen warns, click "More info" → "Run anyway" (it warns about any
installer without a paid code-signing certificate).

## Building via GitHub Actions (no Windows machine needed)
Upload this folder's contents to a repo with `.github/workflows/build.yml`:

```yaml
name: Build Windows EXE
on: workflow_dispatch
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npm run build -- --publish=never
      - uses: actions/upload-artifact@v4
        with:
          name: windows-installer
          path: dist/*.exe
```

Then: Actions tab → "Build Windows EXE" → Run workflow → download the
`windows-installer` artifact when it finishes.

## Test locally before building
```
npm start
```

## Updating the app
Replace the files inside `renderer/` with newer versions, then rebuild.

## Two features that need internet at runtime
The app itself works fully offline **except**:
- **Fonts** — loaded from Google Fonts. Offline, the app falls back to the
  system sans-serif. Cosmetic only.
- **3D CAD viewer** — loads the three.js library from a CDN. Offline, the CAD
  part-analysis view won't render; everything else works.

Both can be made fully offline by downloading those two files into `renderer/`
and pointing the `<script>`/`<link>` tags in `renderer/index.html` at the
local copies instead of the CDN URLs.

## Optional: custom icon
Add a 256x256 `icon.ico` to this folder, add `"icon": "icon.ico"` inside the
`win` block in `package.json`, and `icon: path.join(__dirname, 'icon.ico')` to
the `BrowserWindow` options in `main.js`.
