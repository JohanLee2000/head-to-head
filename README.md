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

Without live sync, scores live in each device's local storage. Settings → Export / Import backup moves them by hand.

## Live sync (Firebase)

1. Create a project at https://console.firebase.google.com (Google Analytics not needed).
2. **Build → Firestore Database → Create database**, pick a location near you, start in **production mode**.
3. In Firestore's **Rules** tab, paste the contents of [`firestore.rules`](firestore.rules) and **Publish**.
4. **Project settings → Your apps → Web (`</>`)**, register an app, and copy the `firebaseConfig` object
   into [`firebase-config.js`](firebase-config.js) as `window.H2H_FIREBASE_CONFIG = { ... };`.

Then in the app: Settings → **Start a shared rivalry** on one phone, **Share invite link** to the other.
Changes sync live, and offline changes are queued and sent once back online.

## Updating

After changing any file, bump `CACHE` in `sw.js` (e.g. `h2h-v2`) so installed copies pick up the new version.
