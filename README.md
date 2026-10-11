# faiz.pics

A photo gallery you walk through: a top-down ASCII building, lit by a lantern you carry, with the
photos hung on the walls as coloured characters. Walk up to one and press E to open it.

## Adding photos

Put image files in the `photos/` folder and push. That's it: the GitHub Action makes the web
sizes, reads the camera details, sorts every photo into a room by its colour, and publishes the
site. Black & white photos go to the darkroom.

From the GitHub website: open the `photos` folder → **Add file** → **Upload files** → drag the
images in → **Commit changes**. The site updates a few minutes later (watch the **Actions** tab).

- Files must be under 25 MB to upload through the website. **faiz.pics/shrink/** shrinks photos
  to fit and keeps their camera details; it runs in your browser and uploads nothing. Files
  already under the limit are left exactly as they are. (It's also at `public/shrink/index.html`,
  which you can open straight from your computer.)
- JPEG, PNG, WebP, TIFF and AVIF work. Export from Lightroom or similar as JPEG.
- The GitHub website takes up to 100 files at a time. The site's largest size is 4096 px, so
  bigger originals don't show more detail.
- To remove a photo, delete it from `photos/`. To hide one without deleting it, add its file name
  in lower case (e.g. `dscf7326`) to `EXCLUDE` in `src/config.js`.
- The published copies carry no metadata, so no GPS location ever reaches the site. Photos have
  no titles; opening one shows its camera, lens, aperture, shutter, ISO and date.

## Working on it locally

```
npm install
npm run dev      # prepares photos/ into public/photos, then serves at localhost:5173
npm test         # unit tests
npm run e2e      # live checks in headless Chrome
npm run build    # what the Action runs
```

Keys: WASD / arrows to walk (Shift walks slower), E to open a photo, M for the map, R to switch
between the WebGL and canvas renderers. Add `?debug` to the address for frame rate and position.
