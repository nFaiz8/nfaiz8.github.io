# faiz.pics

A photo gallery you walk through: a top-down ASCII building, lit by a lantern you carry, with the
photos hung on the walls as coloured characters. Walk up to one and press E to open it.

## Adding photos

Put image files in the `photos/` folder and push. That's it: the GitHub Action makes the web
sizes, reads the camera details, sorts every photo into a room by its colour, and publishes the
site. Film scans go to the darkroom: the build recognises lab scanners (Noritsu, Frontier,
Epson…) and lab-numbered files like `000091570014.jpg`; anything in `photos/film/` counts as
film too. Black & white digital photos get their own room.

From the GitHub website: open the `photos` folder → **Add file** → **Upload files** → drag the
images in → **Commit changes**. The site updates a few minutes later (watch the **Actions** tab).

- JPEG, PNG, WebP, TIFF and AVIF work. Export from Lightroom or similar as JPEG.
- The GitHub website takes files up to 25 MB, 100 at a time. A long edge of about 4000–6000 px
  is plenty; the site's largest size is 4096 px.
- To remove a photo, delete it from `photos/`. To hide one without deleting it, mark it hidden on the
  edit page (see below), which records it in `photos/edits.json`.
- The published copies carry no metadata, so no GPS location ever reaches the site. Photos have
  no titles; opening one shows its camera, lens, aperture, shutter, ISO and date.

## Prints

Opening a photo (from a wall or the grid) shows a **buy print** button when that photo is for sale on
[Darkroom](https://faiz.darkroom.com). `photos/prints.json` maps each photo id (its file name in lower
case, as in `edits.json`) to its Darkroom product number, the number at the end of
`faiz.darkroom.com/products/…`. Add a line there when you list a new print; a photo with no line has no
button. The build warns about lines whose photo no longer exists.

## Editing from any browser

Open **faiz.pics/edit/** (it is not linked from the gallery). The first time on a device, it asks for
a GitHub token:

1. GitHub → Settings → Developer settings → [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new).
2. Repository access: **Only select repositories** → `nfaiz8.github.io`.
3. Repository permissions: **Contents → Read and write**. Nothing else.
4. Paste it into the page. It stays in that browser; **sign out** removes it.

Then tap a photo to mark it film (and name the stock), hide it, delete it, or correct its date,
camera, lens or place. **Select** applies film/digital/hide/unhide to several photos at once, which is
handy for a whole roll. **+ add photos** uploads from your camera roll or computer. Nothing is sent
until **save**, which makes one commit; the site rebuilds a few minutes later and the page shows
**live ✓** when it has.

Edits are stored in `photos/edits.json`, keyed by photo id (the file name in lower case). You can
also edit that file by hand; the build applies it every time.

## Multiplayer

Other people walking through the gallery at the same time show up as `@` with their name under
them. Keys: **1–5** emotes (♥ ! ? ★ ~o/, or the `[☺]` button), **H** sends a heart to the photo
you're standing at (or tap the ♥ in its caption), **N** sets a short name, and tapping someone's `@`
follows them (Esc or moving stops). There are no accounts, and nothing is stored. Down in the station,
other people are stick figures in their colour with their name over them, **T** or **Enter** chats (the
words float over your head), the train is the same for everyone, and the lobby's `▼ SUBWAY` sign counts
who's below.

`server/` is a Cloudflare Worker (`faiz-live`, a Durable Object per gallery instance of up to 30
people). Setting `MULTIPLAYER.enabled = false` in `src/config.js` turns it off completely. Pushes that
touch `server/**` redeploy it via `.github/workflows/server.yml`, which needs a `CLOUDFLARE_API_TOKEN`
repo secret (a Cloudflare API token with **Workers Scripts: Edit**); until that exists, deploy by hand
with `cd server && npx wrangler deploy`. `npm run e2e:live` runs two browsers against `wrangler dev`, and `node e2e/station-mp.mjs` three in the station.

## Working on it locally

```
npm install
npm run dev      # prepares photos/ into public/photos, then serves at localhost:5173
npm test         # unit tests
npm run e2e      # live checks in headless Chrome
npm run build    # what the Action runs
```

Keys: WASD / arrows to walk (hold Shift to sprint), E to open a photo, M for the map, R to switch
between the WebGL and canvas renderers. Add `?debug` to the address for frame rate and position.
