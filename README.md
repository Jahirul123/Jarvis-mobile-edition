# J.A.R.V.I.S — Mobile Edition

Personal AI assistant (phone-first) + the public build log for the GrowthOS Telugu
J.A.R.V.I.S series.

## What is in this repository

| Path | What it is |
| --- | --- |
| `index.html` | Site entry point → opens the app in `Frontend/` |
| `Frontend/index.html` | The J.A.R.V.I.S app shell (chat, voice, wake word, history, settings) |
| `Frontend/style.css` | App theme: dark/light, mobile drawer sidebar, composer, settings panel |
| `Frontend/script.js` | App logic: Gemini chat, tools, speech, wake word, history, canvas core orb |
| `Frontend/manifest.json`, `Frontend/icon.svg` | PWA manifest + app icon |
| `Frontend/jarvis-build-log.html` | Build-log page (episodes, build flow, links) |

The app is a static site — no build step and no server code.

## Run it locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/> — the site root opens the app
(`http://localhost:8000/Frontend/` directly also works).

Opening the files directly with `file://` will not work, because the app uses
`localStorage` and microphone permissions, which browsers block on `file://`.

## API key

The app talks to Google's Gemini API from the browser. On first use:

1. Open **Settings** (gear icon in the sidebar).
2. Paste a Gemini API key from <https://aistudio.google.com/app/apikey>.
3. Press **Save** — the key is stored only in this browser's `localStorage`
   and is sent only to `generativelanguage.googleapis.com`.

Never commit a key to this repository. If a key is ever exposed, revoke it in
Google AI Studio and create a new one.

## What was fixed in this pass

* **The app had no styling.** `Frontend/style.css` was a 150-line stylesheet for an
  older mini prototype: 61 of the classes used by `Frontend/index.html` had no rules
  at all, so the whole UI rendered as raw unstyled HTML. The stylesheet is now a
  complete, responsive dark/light theme (drawer sidebar, chat bubbles, prompt cards,
  composer, thinking pill, settings sheet, focus states, reduced-motion support).
* **Chat could never answer.** The client posted to a non-existent endpoint
  (`/v1beta/interactions`) with a non-existent model (`gemini-3.8-flash`). It now uses
  the standard `v1beta/models/{model}:generateContent` endpoint, discovers the models
  the key can actually use (`GET /v1beta/models`), prefers a Flash model, falls back to
  another model on 404/unsupported, and reports readable errors for bad keys, rate
  limits and safety blocks.
* **Vision was sent in the wrong shape.** Image parts now use Gemini's
  `inline_data` format.
* **The core orb never rendered.** It depended on `cdn.jsdelivr.net/npm/orbs`,
  which is an unrelated Node scraping package with no `dist/orbs.min.js`. Replaced
  with a dependency-free `<canvas>` orb that reacts to idle / listening / thinking /
  speaking / error states.
* **Blocking API-key prompt on every load.** Replaced with a proper key field in
  Settings; a missing key now gives a clear message and opens Settings instead of a
  `prompt()` dialog (local tools such as time, weather, timers still work without a key).
* **The site root did not open the app.** `index.html` now lands visitors straight in
  the assistant, and the app links to the build-log page.
* **Dead asset requests** — added `manifest.json` + `icon.svg`, removed the 404
  `sw.js` registration and the broken `kalki-logo.png` reference.
* **Readable network errors** — a blocked/offline connection now says so instead of a
  bare `Failed to fetch`, and requests time out instead of hanging.
* Chat is guarded against overlapping sends, and `matchMedia` usage no longer throws
  in older/limited webviews.
