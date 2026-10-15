# Arena: parrying sniper rounds, and an impact frame on a kill (addendum)

**Status:** the user asked on 2026-10-14: "lets add parry sniper bullets with melee and impact frame on
kill". The details below are choices made without them (§3). This addendum amends the PvP spec
(`2026-10-14-arena-pvp-design.md`).

## 1. The parry

- **What it takes.** A punch or a kick parries a sniper round that flies into its strike box within
  `PARRY_TIME` = 0.2 s of the strike.
  - The box is the strike's own box (`strikeBox`), moved with the striker as it moves.
  - Only sniper rounds can be parried (`GUNS.sniper.parry`). Deagle and rifle rounds pass through the box
    into the body as before.
  - A round coming from behind meets the body first, and the body takes it.
  - A round that starts inside a box is not parried by that box. It has to fly into the box.
- **What it does.** The round turns straight back the way it came (its angle + π) from the point where it
  met the box.
  - It now belongs to the parrier: its hits, headshots and kills are theirs.
  - It gets a fresh sniper range from that point, and keeps the sniper's damage, knock and stun.
  - It does not count against the parrier's in-flight cap.
  - The shooter can parry it back the same way, as can anyone else.
- **The referee rules on it** (`src/referee.js`, `tick`). A round's motion over a tick meets either a body
  or a strike box, and the earlier of the two wins. The window is clipped to
  `[strikeAt, strikeAt + PARRY_TIME]`. A strike is timed from when it reaches the server, as before. Online,
  a parry therefore takes a strike thrown when the round is still about one round trip away. The aim line,
  which brightens 0.3 s before the next shot is ready, is the cue.
- **The wire.** The referee sends `{ t: 'pr', id: parrier, n: old bullet, n2: new bullet, x, y, a, w: 'n' }`.
  It puts `pr: 1` on the `h` (and the `k`) that a parried round causes.
  - Clients stop drawing bullet `n`. They draw `n2` from `(x, y)` along `a`, as if fired half a round trip
    ago (the same rule as `s`).
  - They show a spark and `parry!` in flash white. The parrier gets the small headshot shake.
  - Old clients ignore `pr`. They draw the round on to its old end, and the `h` still lands.
- **The feed.** A kill by a parried round ends `↩ parry`, for example "you popped Bo ↩ parry".

## 2. The impact frame on a kill

When I pop someone (the dummy too), or someone pops me, the fight's picture freezes for a moment, the way a
fighting game's hitstop does:

- **The flash.** The frame of the kill is drawn, then shown for `IMPACT.flash` = 200 ms inverted, grey and
  at high contrast: a stark black-and-white impact frame. It is a CSS filter on the stage, so it works the
  same in all three renderers.
- **The hold.** The picture stays frozen until `IMPACT.hold` = 400 ms after the kill. Then the next frame is
  drawn. (Both were 70 and 150 ms at first. The user asked on 2026-10-14 to "make the impact frame last
  longer".)
- **Only the picture freezes.** The fight goes on underneath: other players, the server and my own body
  can't be paused. After the hold, the picture catches up in one frame.
- **A flee doesn't count.** Leaving within 3 s of a hit still gives the hitter the kill, but there is no
  impact frame for it, since nobody is hit at that moment. Nor is there one for kills I'm not part of.
- **Reduce Motion:** neither the flash nor the hold. Both are motion, and the flash is a strobe.
- **Each one is kept as a picture** (`src/shots.js`). The user asked: "add it as a screen shot that u can
  view and save, the server doesnt save it so u lose it when u reload the page".
  - The kill's frame is copied from the stage's canvas right after it is drawn, before the browser shows
    it, since a WebGL canvas reads blank after that.
  - Once the hold is over, the copy gets the same filter, baked in, and becomes a PNG blob. It uses the 2D
    context's `filter` where that really works (tested with a one-pixel probe), and otherwise
    `impactPixels`. The copy is at most 1920 px wide.
  - It is kept in memory only, with the kill's line as its caption ("you popped Bo ◎ headshot"). A reload
    loses it. The newest 20 are kept.
  - **`[I]` in the HUD**, or the I key, opens them: newest first, each with a `save` link. The link
    downloads `impact-YYYY-MM-DD-HH-MM-SS.png`. On a phone you can also long-press the picture.
  - The button shows in the arena always, and elsewhere once a picture has been kept. Opening it takes you
    out of the fight, as the map does. The first picture kept gives a note: "impact frame kept · I to see
    and save it".
- **Off switch.** The user asked: "add a disable button for impact frames". At the top of the `[I]` panel,
  `impact frames: on/off` turns off the flash, the hold and the keeping. It is remembered in this browser
  (`localStorage` `ascii-impact`), unlike the train's look: a switch that turned itself back on at every
  visit would be no use.

## 3. Choices made for you

| question | choice |
| --- | --- |
| Which rounds can be parried? | Sniper only, as asked. One flag in `GUNS` would open it to the others. |
| Where does a parried round go? | Straight back along its line, at whoever fired it if they haven't moved. Not along the parrier's aim. |
| How long is a strike a parry? | 0.2 s, less than the punch's 0.3 s cooldown, so mashing K can't keep a parry up all the time. |
| Its range? | A fresh sniper range from the parry point. |
| Impact frame for which kills? | Mine: I popped someone, or I was popped. Not other people's, which in a busy arena would strobe. |
| Impact frame on a parry? | No, just the spark, the `parry!` and a small shake. |
| Offline? | The dummy doesn't shoot, so a parry needs a second player (`npm run dev:live`, two windows). |

## 4. Tests

- `test/referee.test.js`:
  - a punch facing the round in time parries it: `pr`, no `h` on the parrier, and the round comes back and
    hits the shooter with `by` the parrier and `pr: 1`;
  - a strike too early, or one facing away, is no parry;
  - a deagle round is never parried;
  - a kill by a parried round gives the parrier the kill, with `pr: 1`;
  - the parried round doesn't count against the parrier's cap;
  - the shooter parries it back.
- `test/fx.test.js`: `parry` stops drawing the old round, draws the new one back the other way, and shows
  `parry!`.
- `test/pvp.test.js`:
  - `pr` swaps the drawn round;
  - the feed's `↩ parry`;
  - `onImpact` for my kill, my death and the dummy's pop, but not for a flee, someone else's kill, or under
    Reduce Motion.
