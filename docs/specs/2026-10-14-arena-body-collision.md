# Arena PvP: fighters collide (addendum)

**Status:** requested by the user on 2026-10-14: "add collision with players too so u cant just walk thru
someone". This addendum amends the PvP spec and wins where they disagree.

## Rule

- **Fighters are solid to each other.** Each body is its `BODY` box (0.8 cells × 3 rows). Moving bodies
  stop at contact on the sides.
- **Heads are one-way platforms.** A body falling onto another body's top lands there and stands on it.
  It is "on the ground" and can jump or double-jump from there. ↓ drops through, as on a `═` platform.
  - Standing on a moving body carries you with its horizontal motion. Jumping up into a body from below
    passes through, one-way, like `═`.
- **Exceptions.** None of these collide; they pass through and are passed through:
  - **Rolling bodies.** A roll is the dodge, and rolling through someone is the move.
  - **Protected bodies** (`safe`). This also covers anyone overlapping them.
  - **Dead bodies.**
  - **The door.** Any part of either box in the door rows of the east wall (the bottom 3 rows, the last
    2 columns of the interior) doesn't collide.
  - **The practice dummy** collides, so you can bump it and stand on it.
- **Overlap recovery.** Two bodies that already overlap, because of lag, a spawn or a knockback, are
  pushed apart horizontally at up to 12 cells/s, each away from the other's centre. They are never
  snapped, and walls win. Overlapping bodies don't block each other until they have separated, so nobody
  gets stuck.
- **Knockback** stops at contact like walking does: a body knocked into another stops there. Strikes
  and bullets are unchanged.

## Where it runs

- **Shared physics.** `stepBody(b, dt, input, kindAt, { …, others })` takes a list of other boxes:
  `{ x, y, vx, solid }`, where `solid` is false for the exceptions. Movement resolves against them in the
  same sub-steps as the grid. It stays pure.
- **Me** (`pvp.js`): `others` = remote fighters' displayed bodies (predicted + correction) and the dummy.
- **Remote fighters** (`fighters.js`): each predicted body collides with me and with the other remote
  bodies, so nobody is drawn inside anyone.
- **Server.** No authority. Movement stays client-side with the server's clamp. A cheater can walk through
  people; that is accepted, as with the rest of movement.

## Tests

- **`test/arena.test.js`:**
  - walking into a standing body stops at contact, both ways;
  - a falling body lands on a head and stands, with `onGround` true, and can jump from it;
  - ↓ drops off a head;
  - jumping up from below passes through;
  - a rolling body passes through, and so does a protected one;
  - in the door rows there is no collision;
  - an overlap separates at ≤ 12 cells/s and never pushes into a wall;
  - standing on a moving body carries you.
- **`test/fighters.test.js`:** a remote body predicted into me stops at contact.
- **`test/pvp.test.js`:** I can't walk through the dummy, and I can stand on it.
- **e2e:** two clients, A runs at B and stops beside B, then A jumps onto B's head and stands.
