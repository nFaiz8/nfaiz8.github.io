# Station maps

How to draw a map for the station (`src/rpg/station.txt`) or a later area. This is the format the game
reads; the spec is `docs/specs/2026-10-15-station-design.md` §3.

## The file

```
name: MUSEUM
; a line starting with ; is a comment (# is a wall)
<the grid>
```

One character is one tile of 1 × 1 world units. Rows go south, columns go east. Every row is the same width.
The player is about 0.5 wide and 1.6 tall.

| Char | Tile | Floor level | Walk |
|---|---|---|---|
| `#` | wall, tiled, 4 above the highest floor beside it | – | no |
| `.` | ticket-hall floor | 0 | yes |
| `_` | platform floor | −3 | yes |
| `!` | platform edge (the yellow line); the last row before a track | −3 | yes |
| `=` | track bed; trains run along these rows | −4.2 | no |
| `v` `^` `<` `>` | stairs; the floor goes **down** in the arrow's direction, from the level behind the run to the level in front | sloped | yes |
| `|` | pillar | – | no |
| `b` | bench | as the floor around it | no |
| `t` | turnstile post | 0 | no |
| `:` | turnstile gate: shut coming from the west without a ticket, free from the east (see below) | 0 | yes |
| `k` | kiosk (closed) | 0 | no |
| `n` | wall with the station's name sign on its face | – | no |
| `~` | puddle, with drips | as the floor around it | yes |
| `S` | spawn: where you arrive (exactly one) | as the floor around it | yes |
| `E` | exit up to the museum (at least one) | as the floor around it | yes |

Fluorescent tubes are placed for you: along the middle row of each platform band every 5 columns, and on a
4-tile grid over the hall. A track row that reaches the map's edge goes into a tunnel there.

## Turnstiles

A column of `:` gates (with `t` posts between them) is a ticket line. The game treats **west as outside**:
walking east into a gate without a ticket stops you there and opens the ticket machine; walking west through
one is always free. So put the gates with the way in on their west side and the paid area to the east, and
leave a tile of floor on both sides of each gate. A single is used up once you come out of a gate on its east
side; a day pass lasts the visit (`src/rpg/gates.js`).

## What the checker wants

Run `node src/rpg/check.js <file>` (no file: the shipped station). It prints `row R, col C: problem`
(0-based, header lines not counted) and `ok` when there are none. It reports:

- rows of different widths, and characters not in the table;
- not exactly one `S`, or no `E`;
- a walkable tile, or an `E`, that can't be reached from `S`;
- stairs without floor at both ends of the run, or that go up in their arrow's direction;
- floor beside a stair run (wall the sides off);
- a walkable tile (an `S`, `E` or `~`) with no floor beside it to take a level from: put floor beside it;
- two different floor levels side by side (a drop: put stairs or a wall between);
- a track row that isn't `=` from edge to edge, a track with no `!` row beside it, or a `!` not next to `=`.

## Tips

- Draw the silhouette first: walls, the floors at their levels, the stairs between them. Then the
  furniture.
- Leave at least 2 tiles of open floor in front of every stair run and around every exit.
- Keep the camera in mind: it looks north from the south at 35°. Tall walls on a room's south side hide
  what's behind them (they fade when you're near), so put the interesting things on north walls.
