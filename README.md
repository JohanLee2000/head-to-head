# Head to Head

A tiny offline-first PWA for keeping score with your favourite person. No build step, no dependencies.

## Run locally

```bash
python -m http.server 5173
```

Then open http://localhost:5173.

## Put it on your phones

Service workers (offline mode) and "Add to Home Screen" need HTTPS, so host the folder on any static host,
for example GitHub Pages, Netlify Drop or Cloudflare Pages. Then:

- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** ⋮ → Install app

## Data

Scores live in each device's local storage. To move them between phones, use
Settings → Export backup, then Import backup on the other device.

## Updating

After changing any file, bump `CACHE` in `sw.js` (e.g. `h2h-v2`) so installed copies pick up the new version.
