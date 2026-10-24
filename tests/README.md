# UI regression checks

Browser-level checks for the app in `Frontend/`, run in jsdom against the real
`Frontend/index.html` + `Frontend/script.js` (no build step, no browser needed).

```bash
npm install jsdom          # once, from this folder
node tests/test-ui.js      # command palette, toasts, message structure, stat chips
node tests/test-flipkart.js# Flipkart connector: intents, URLs, link/unlink, UI states
node tests/test-chat.js    # end-to-end turn: tool reply -> chat bubble -> saved memory
```

Each script prints `PASS`/`FAIL` per check and exits non-zero on failure.
They are development aids only — nothing here ships to the browser.
