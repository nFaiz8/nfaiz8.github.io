# Chat: swears starred, slurs mute (addendum)

**Status:** the user asked on 2026-10-14: "auto censor messages instead of not sending at all but mute if
really bad words like slurs", then "but like one character like sh*t". This addendum amends the
multiplayer spec (`2026-10-13-multiplayer-design.md`), which since grew chat (T, one line every 2 s,
80 characters). Before this, any blocked word refused the whole line ("try different words").

## 1. Swears are starred

- A line with a swear in it is still sent. One letter of each swear is starred:
  - `sh*t`, `f*ck`, `d*ck`, `c*nt`, `motherf*cker`, `f*cking sh*t`;
  - the starred letter is the first vowel after the word's first letter, or its middle letter if it has no
    vowel.
- **How words are matched** is unchanged (`cleanText`, `server/rules.js`):
  - lower-cased;
  - digit swaps undone (`sh1t`);
  - punctuation dropped (`f.u.c.k`);
  - single letters run together (`f u c k` → `f * c k`).
  Some words match anywhere in a word, some only at its start (so "Scunthorpe" is fine), and some only
  as the whole word (so "cockpit", "cumulus" and "Dickens" are fine).
- **The list:** fuck, shit, whore, slut, pussy, porn, bitch and hitler match anywhere; cunt and nazi at the
  start; cum, cock, dick, rape(d), rapist, tits and twat as whole words.
- **Where it happens.** The page stars my line before it shows it and sends it. The server stars what it
  receives again, so a modified page can't send a swear in full.

## 2. Slurs mute

- A line with a slur in it (`hasSlur`) is never sent. It mutes the sender's chat for `LIMITS.muteS` =
  600 s (10 minutes).
  - The page clears the box and says "chat muted for 10 min". Every send until then says how many minutes
    are left, as does opening the chat box.
  - The page remembers the mute in this browser (`localStorage` `faiz-chat-muted`), so a reload doesn't
    lift it.
- **The server's own mute.** A modified page could send the line anyway. The server then mutes that
  connection, and the IP it comes from, for 10 minutes, kept in the Durable Object's storage so a
  reconnect doesn't lift it either.
  - It sends the sender `{ t: 'chat-muted', s }`, with the seconds left, for that line and every line
    after until the mute ends. Nobody else hears them.
  - The page then mutes itself too.
- **The list:** nigg and kike match anywhere; fag and retard at the start; spic, chink, coon, tranny and
  trannie as whole words.
  - Innocent words that start like one are let through: snigger, retardant, fagioli.
  - The matching is the same as for swears: spaced-out letters and digit swaps count.
- **Mute vs. muting a person.** Clicking someone's name in the log still hides that person on your own
  screen. This mute is different: it stops the sender's lines reaching anyone.
- **Names** are unchanged: a name with any blocked word in it is refused ("try another name").

## 3. Choices made for you

| question | choice |
| --- | --- |
| Which letter is starred? | The first vowel after the first letter (`sh*t`, `f*ck`), or the middle one. |
| How long is a slur's mute? | 10 minutes, on the page and on the server. |
| Is the slur sent to the server? | Not from the page: it never leaves the browser. The server mutes on its own only if a modified page sends one. |
| The server's mute is by? | The connection and its IP (hashed, as the connection limit's tag), for 10 minutes. |

## 4. Tests

- `test/rules.test.js`:
  - the starred lines, through spacing, punctuation and digits;
  - innocent words untouched;
  - slurs found and their look-alikes not;
  - `LIMITS.muteS`.
- `test/live.test.js`: `chat-muted` reaches `onChatMuted` with the seconds left.
- `server/test/server.test.js`: a swear arrives starred; a slur gets `chat-muted` (600), and so does the
  next line; neither reaches anyone else.
- `e2e/multiplayer.mjs`: "oh shit" arrives on the other page as "oh sh*t"; a slur says "chat muted for
  10 min", and nothing reaches the other page.
