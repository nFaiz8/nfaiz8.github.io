# The subway ride: stopping trains, a walkable car, the bridge, and a second station

**Status:** built on 2026-10-16 (branch `claude/elegant-edison-cgvclt`; plan `docs/plans/2026-10-16-subway-ride-plan.md`). Changed while building, at Faiz's asks: no ad cards; the camera comes in closer inside a car and tips up on the bridge; the bridge crosses open water between a tall Manhattan and a low Brooklyn. Design approved in conversation on 2026-10-16. Faiz wants the trains to work: one stops at the
station, you walk on, it runs for about a minute, and it pulls into a new station. They also want the trains
to look like New York trains (the current ones are ugly), people to be seen leaving on the train from the
platform, and a bridge on the way with a crazy city skyline and sunlight raking into the cabin. This is a
laptop-first feature; phones only need to keep working, not to look their best.

The second station is a **placeholder**: a real stop you can walk around, but its way up is closed. The
real place above it is the next feature. Its name is `CANAL ST` for now (one constant).

Builds on the station spec (`docs/specs/2026-10-15-station-design.md`), whose numbering (§3 map, §5 train,
§8 sound, Multiplayer) this refers to.

## 1. The line

Everything below ground is one continuous world: **the line**. It runs east–west along world x, and is
made of pieces placed end to end:

```
west tunnel · Station 1 (MUSEUM) · tunnel · bridge · tunnel · Station 2 (CANAL ST) · east tunnel
```

- **Pieces are their own modules.** The two stations are `.txt` maps (§3 of the station spec, extended in
  §6 below); the tunnels and the bridge are built pieces with a length. `src/rpg/line.js` (pure) describes
  the line: the pieces in order, each one's x offset and length, where each station's platform centre is,
  and `pieceAt(x)`.
- **The tracks line up.** Both stations put their two track bands at the same world z (Station 1's rows 1–3
  and 15–17 today). Station 2's map declares its offset so its tracks fall on the same z. The line checker
  (§6) reports a station whose tracks don't line up.
- **World coordinates.** Station 1 keeps x = 0 at its west edge, so its map coordinates are line
  coordinates. Every other piece is placed east of it. Positions everywhere (the walker, commuters,
  multiplayer) are in line coordinates.
- **Only the near pieces are drawn.** A piece is built the first time the camera comes near it and is hidden
  while the camera is away from it, so nothing far off costs a frame. (Pieces are kept once built rather
  than disposed, so coming back never hitches; the line has only seven.) The tunnels are drawn as a stretch
  that follows the camera.

## 2. The schedule and how trains move

All of it is a pure function of the shared clock (station spec, Multiplayer): `trainsAt(t, line)` in
`src/rpg/train.js` replaces `trainAt(t, map)` and returns **every train** on the line at time t. Each one
is `{ id, kind: 'local' | 'express', track, dir, head, speed, doors (0 shut … 1 open), stopAt (station or
null) }`, with `head` its front's x. Everyone computes the same trains in the same places.

### Locals (the ones you ride)

- **One a minute at MUSEUM, alternating direction.**
  - **Eastbound** locals run on the **north** track: out of the west tunnel, stop at MUSEUM, run to
    CANAL ST, stop, and go on into the east tunnel, where they end.
  - **Westbound** locals run on the **south** track, the mirror image: stop at CANAL ST, then MUSEUM, then
    off west.
  - At MUSEUM a local arrives every 60 s, the direction alternating, so a ride to CANAL ST boards every
    2 minutes.
  - At CANAL ST they come 30 s and 90 s apart in turn. (With a ride of about a minute both stations can't
    be evenly spaced; MUSEUM, where people wait, is.)
- **A stop is 18 s standing, about 30 s with braking and pulling out:** brake in 6 s, doors open 1–2 s
  after it stops and stay open until 15 s, a 2 s chime and close, it leaves at 18 s, then 6 s pulling out.
- **The ride is 57 s from leaving one station to stopping at the next** (780 tiles): speed up through the
  tunnel to 20 tiles/s and cruise, slow to 10 for the bridge (about 21 s of skyline), speed up into the
  second tunnel, brake into the other station.
- **Motion is a closed-form curve.** Position along the line comes from a speed profile made of constant
  speeds joined by smooth (eased) changes, so position and speed are continuous and any moment can be
  computed directly, with no stepping. The exact distances (the gap between the stations, the bridge's
  length) are tuned so the numbers above come out; the plan fixes them.

### Expresses (the ones that go through)

- **One every 30 s**, at 25 tiles/s as now, from tunnel mouth to tunnel mouth, never stopping.
- **Placed per piece.** An express belongs to a piece (a station, a tunnel, the bridge) and runs from one
  end of it to the other. A slot is skipped on a track where it would overlap a local in that piece during
  its pass. So the rule the tests check holds: **no two trains ever overlap on one track.**
- A rider sees expresses roar past on the other track in the tunnels and on the bridge. On the platform, an
  express can thunder through on the far track while a local stands with its doors open.

### The departures board and the ticker

- The board over the stairs shows real service, the next local each way:
  ```
  TO CANAL ST     1 MIN
  LAST STOP       2 MIN
  ```
  A local ending its trip here says `LAST STOP`; one standing says `NOW`. It switches to the
  `EXPRESS TRAIN · STAND BACK` warning from `SERVICE` seconds before an express until it has gone. Pure (`departures(t, line, station)`), so it only redraws when its text changes.
- The ticker's "THE NEXT TRAIN DOES NOT STOP AT THIS STATION" goes; it gets lines that fit
  (`STAND CLEAR OF THE CLOSING DOORS`, `EXPRESS TRAINS DO NOT STOP AT THIS STATION`, …).

## 3. The trains

New York style. One model serves locals and expresses (an express's signs are dark and its inside is
dim).

- **Five cars**, each about **15 × 3 × 3.5** tiles (long × wide × tall), so a person stands about a
  person's height against it. The whole train is about 78 tiles.
- **Outside:** stainless steel with fluted (ribbed) sides, a dark window band, three double doors per
  side with door lights over them, gangway diaphragms between the cars.
- **Cab cars** at both ends: a route bullet, an LED destination sign (`CANAL ST` / `MUSEUM`), headlights,
  red tail lights at the back.
- **Inside**, lit warm so people show through the windows from the platform:
  - orange and yellow benches along both walls;
  - vertical poles at the doors and a grab bar along the ceiling;
  - an end door at each car end, so the whole train is walkable;
  - ad cards over the windows (Faiz's photos, from `photos/`);
  - a strip map over each door: the stations as dots, the next one lit.
- **Doors** are modelled on both sides. Which side opens depends on the platform: at both stations' island
  platforms the north track opens its south doors and the south track its north doors.
- **The roof** of the car you're in fades away, the way the station's south walls fade near you now, so
  the camera sees in. Other cars keep their roofs.
- The old 4-box train and its textures in `scene.js` go.

## 4. Getting on, riding, getting off

### Frames

- **Riders live in the train's frame.** On board, your position is `{ train, x, z }` relative to the
  train (x along it from its front, z across it). Your world position is the train's pose plus that, so
  walking on a moving train is walking on a small floor plan: no moving-platform physics.
- **The floor plan** (`src/rpg/car.js`, pure): the whole train as one walkable map in its own frame, with
  the same interface the walker already collides with (`solidAt`, `levelAt`): benches, poles, end walls
  with their doors, the gangways, the side walls with door openings. `stepWalker` (`move.js`) walks it
  unchanged.
- The car floor is at platform level (−3), so boarding is level.

### Boarding and alighting

- While a local stands at a station with its doors open, each open door on the platform side joins a `!`
  tile to the car floor. Step through and you switch to the train's frame; step back out and you're in
  the station's. You can't pass a door that is shut or closing.
- **Closing doors nudge you in.** If they close while you're in the doorway, you're pushed inside. Nobody
  gets crushed or stuck in the wall.
- **No new fare.** The turnstiles already charged you; a ticket is still used up when you leave a gate
  eastward (station spec §5b).

### Riding

- **Lurch.** Speeding up pushes standing riders a little toward the back, braking toward the front: the
  train's acceleration is fed to the walker as a small push in the train's frame.
- **Sway.** The whole car rocks gently, more over the bridge's rail joints; the
  camera follows the car, not the sway, so the world doesn't wobble.
- **Sitting.** Near a free seat, a `[E] sit` hint shows; **E** sits you on it, facing across the car. Any
  move key stands you up. Seats are slots in the floor plan.
- **Commuters on board:** a few per car, seated or holding a pole, swaying with the car, some on their
  phones. They're seeded from the train's id, so every player sees the same people on the same train.
  They stay aboard (they don't get on or off).
- **The camera** keeps the station's tilted view, following you in the train's frame. On the bridge it
  eases out and up a little to frame the city, and back in at the tunnel.

### Past the last stop

- At CANAL ST an eastbound local announces `LAST STOP` (the westbound does the same at MUSEUM). It then
  pulls into the end tunnel.
- If you're still aboard 8 s after it leaves, the screen fades, and you come back in the same spot aboard
  the next local the other way into that same station, wherever it is on its way in (at CANAL ST it's
  already braking in; at MUSEUM it's still about 30 s out in the west tunnel). You stay on the shared
  schedule; there's no limbo.

## 5. The places along the line

### Station 1 (MUSEUM), lengthened

- The platform runs east to about **80 tiles**, long enough for the train. The hall, the turnstiles and the
  stairs stay where they are.
- More benches, pillars, tubes and puddles along the new length, and the departures board. Pigeons, rats
  and commuters spread along it (`life.js` reads their homes from the map).
- The tunnel mouths, dark planes at the map's edges today, become openings into the line's tunnels.

### The tunnels

- Dark brick and concrete, a lamp every 12 tiles, red and green signals, cable runs on the walls, the odd
  work light.
- From inside a car, the lamps stream past the windows as bands of light across the seats and floor, so
  you feel the speed underground.

### The bridge

The big moment: the Manhattan Bridge at golden hour.

- **The bridge.** The train runs on a lower deck inside a steel truss. Its diagonals and verticals pass
  between the train and a low sun, so the light into the cabin strobes.
- **The light.** Sun shafts come through the windows and slant across the floor, the seats and the riders,
  cut into rhythm by the truss. They're faked, not ray traced: additive light slabs and bright floor
  patches lined up with the window openings and the sun, with the truss's shadow scrolling across them.
  The ASCII filter turns them into bright bands of dense glyphs.
- **The skyline.** A few hundred towers on both banks, instanced in one draw, their lit windows painted
  into a texture; a handful of tall spires and landmarks; haze fading the far towers into a warm sky with
  a low sun.
- **The river** below: a plane with a streaky reflection of the sun.
- **Always golden hour** for now. Tying the time of day to the real clock could come later.

### Station 2 (CANAL ST), the placeholder

- **An island platform** between the two tracks, like MUSEUM's. (Side platforms were the first idea, but a
  passage under the tracks needs a second floor level, which the map format doesn't have; with an island
  you can catch the train back from the same platform.) Its look is its own: a different tile colour band,
  pillars and benches on a different rhythm, and the closed stairs up in the middle of the platform.
- Its own name sign, departures board and a little life (pigeons, a puddle). No turnstiles yet: they come
  with the street above.
- **The way up is closed:** taped off, with a `STREET EXIT CLOSED · OPENING SOON` sign. The real place up
  there is the next feature.

## 6. Maps and the checker

- **A station may have no `E`.** CANAL ST has none; the checker stops requiring one (it still requires
  every `E` to be reachable).
- **One spawn on the line.** `S` is where you arrive coming down from the museum, so only MUSEUM has one;
  CANAL ST has none.
- **New tiles** as needed for side platforms and the closed exit (the plan names them), added to the table
  in `src/rpg/MAPS.md`.
- **The line checker** (`node src/rpg/check.js --line`) checks each station as now, and that their track
  bands line up in z and reach both edges of their maps.
- **`MAPS.md`** gets a section on the line: how the pieces join, the track alignment, and which side a
  station's doors open.

## 7. Multiplayer

- **One area for everything underground.** The `station` area covers the whole line: both stations and
  the trains. You see everyone below ground wherever they are; the lobby sign keeps counting them.
- **Two kinds of position.** On the ground: `{ x, z, y, a }` in line coordinates, as now. Aboard:
  `{ tr, x, z, a, s }` (the local's number, its frame, the yaw, seated) in the train's frame (`seat` true while seated). Everyone computes that
  train's pose from the shared clock and draws the rider inside it. So the platform watches you pull out
  into the tunnel, and CANAL ST sees you arrive.
- **The server** (`server/rules.js`) checks station positions against the old map's bounds. It gets the
  line's bounds and the aboard form (the train id a whole number, x and z within the train's floor plan).
  This changes `server/`, so the push that carries it deploys the Worker: ask first.
- An old page (sending plain positions within MUSEUM) carries on working.

## 8. Sound

New recorded clips are CC0 and credited in `src/rpg/assets/sound/CREDITS.md`; the rest is synthesized in
`audio.js` as now, with the arithmetic in `sound.js`.

- **The door chime** (the New York two-tone) and the doors closing.
- **On board:** a motor whine that follows the speed, wheel clatter on the rail joints (its rate from the
  speed), a brake hiss as it stops.
- **Tunnel and bridge:** a close rumble in the tunnel, opening to wind and a hollow ring of steel on the
  bridge.
- **From the platform:** a local braking in, its doors, and pulling out, panned and with distance as the
  express is now.
- **Announcements are text,** on the strip map and the cab's LED: `THIS IS A CANAL ST BOUND TRAIN · THE
  NEXT STOP IS …`, with chime tones. No voice; a recorded or synthesized voice could come later.

## 9. Performance

- **Budget:** a steady 60 fps on an ordinary laptop. Phones must keep working but needn't hold 60.
- **How:** only the near pieces exist (§1); the skyline is instanced; light shafts are a few additive
  planes; two trains at once is just two more models.
- **Measured:** the e2e reads frame time at three moments: the platform with a local standing and an
  express passing, inside a car in the tunnel, and on the bridge. Headless Chrome caps at 30 fps, so it
  checks frame time, not fps.

## 10. Code

All in `src/rpg/` unless noted. Pure files are unit tested.

| File | Job | three.js |
|---|---|---|
| `line.js` (new) | The line: pieces, offsets, platform centres, `pieceAt(x)`. | none |
| `train.js` | `trainsAt(t, line)`: locals and expresses, motion, doors; `departures(t, line, station)`. | none |
| `car.js` (new) | The train's floor plan in its own frame, seats, doors; frame changes in and out; the lurch. | none |
| `canalst.txt` (new) | Station 2's map. | none |
| `station.txt` | Station 1, lengthened. | none |
| `map.js`, `check.js` | No-`E` stations, the new tiles, the line check. | none |
| `life.js` | Commuters on board; homes along the longer platform. | none |
| `sound.js`, `audio.js` | The sounds in §8. | none |
| `trainmesh.js` (new) | The NYC train model, its roof fade, its signs and strip maps. | yes |
| `tunnel.js` (new) | The tunnel piece. | yes |
| `bridge.js` (new) | The bridge, the skyline, the river, the sun and the light shafts. | yes |
| `scene.js` | Builds a station piece; loses the old train. | yes |
| `index.js` | The line, building and dropping pieces, the walker's frame, sitting, the turnaround. | yes |
| `peers3d.js`, `src/live.js` | Riders drawn in their train; the aboard position. | yes / none |
| `server/rules.js` | The line's bounds and the aboard position. | none |

Test hooks on `window.__station` gain `trains()`, `line`, `aboard()` (your train and spot, or null) and
`board(trainId, x, z)` for tests.

## 11. Testing

- **Unit:**
  - the schedule: one local a minute at each station, alternating direction; an express slot every 30 s;
    never two trains overlapping on one track;
  - motion: position and speed continuous through braking and pulling out; the ride is 60 ± 5 s door to
    door; about 20 s on the bridge;
  - doors open only while a train is stopped at a station, and only on the platform side;
  - the frame change both ways (world → train → world lands where you were);
  - closing doors push you in; you can't pass a shut door;
  - the lurch's direction; sitting and standing;
  - the turnaround puts you in the same spot on the next local the other way;
  - the departures board's text;
  - the maps and the line checker;
  - the server's new position rules (`server/test`).
- **e2e (`e2e/station.mjs`), with `setTime` and `teleport`:**
  - board at MUSEUM, ride, and get off at CANAL ST;
  - screenshots of the platform with a local standing, the car in the tunnel, and the bridge with its
    light shafts;
  - the frame times in §9;
  - two players (`e2e/station-mp.mjs`): one rides away while the other, on the platform, sees them inside
    the departing train.

## Not in this feature

- The real place above CANAL ST, and story beats.
- A spoken voice for the announcements.
- Time of day following the real clock.
- Commuters getting on and off.
- Phones looking their best on the bridge.
