# Sound credits

Every clip here (and the music in `../music/`) was trimmed, normalised and re-encoded as a small mp3 for the
station; none is an original file. Everything else you hear in the station (the fluorescent hum, the faulty tube's
buzz and crackle, the steam, the train's rumble and wind, the rail clatter, the turnstile beeps and buzz, the fare
machine's bleeps and chime, the emergency alarm and the PA chime and voice) is synthesized in `src/rpg/audio.js`.

## CC0 (public domain)

| File | Source | Author | Licence |
| --- | --- | --- | --- |
| `step-tile-0…2.mp3` | `footstep_concrete_000…002.ogg`, Impact Sounds, https://kenney.nl/assets/impact-sounds | Kenney | CC0 1.0 |
| `clank.mp3` | `impactMetal_heavy_001.ogg`, Impact Sounds, https://kenney.nl/assets/impact-sounds | Kenney | CC0 1.0 |
| `ratchet.mp3` | `metalClick.ogg`, RPG Audio, https://kenney.nl/assets/rpg-audio | Kenney | CC0 1.0 |
| `latch.mp3` | `metalLatch.ogg`, RPG Audio, https://kenney.nl/assets/rpg-audio | Kenney | CC0 1.0 |
| `cloth-0.mp3`, `cloth-1.mp3` | `cloth1.ogg`, `cloth3.ogg`, RPG Audio, https://kenney.nl/assets/rpg-audio | Kenney | CC0 1.0 |
| `coo.mp3` | "creatures-pigeon.wav", https://freesound.org/s/175217/ | MinigunFiend | CC0 1.0 |
| `wings.mp3` | "short pigeon wing flap", https://freesound.org/s/414671/ | zouzmusic | CC0 1.0 |
| `squeak.mp3` | "rat-squeak.wav", https://freesound.org/s/288941/ | toefur | CC0 1.0 |
| `drip-0.mp3` | "Water Drip Free", https://freesound.org/s/842164/ | AardsReal | CC0 1.0 |
| `drip-1.mp3` | "Water_drop_9.wav", https://freesound.org/s/166325/ | deleted_user_2104797 | CC0 1.0 |
| `screech.mp3` | "Train Wheels Ringing Around Bend.wav", https://freesound.org/s/700035/ | JotrainG | CC0 1.0 |

## CC BY 4.0 (attribution)

The museum's music: three noir jazz tracks, one played per visit, chosen with `?track=1` (the default), `2` or `3`
(`src/track-choice.js`). Only the chosen file is fetched, and the credit under the map (M) and in the sound button's
tooltip names the one playing.

| `?track=` | File | Source | Author | Licence |
| --- | --- | --- | --- | --- |
| 1 | `../music/signs-to-nowhere.mp3` | "Signs To Nowhere" (2020, ISRC UKEZT2000010), https://www.silvermansound.com/free-music/signs-to-nowhere | Shane Ivers (silvermansound.com) | CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ |
| 2 | `../music/spy-glass.mp3` | "Spy Glass" (ISRC USUAN1500058), https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1500058 | Kevin MacLeod (incompetech.com) | CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ |
| 3 | `../music/covert-affair.mp3` | "Covert Affair" (ISRC USUAN1100795), https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100795 | Kevin MacLeod (incompetech.com) | CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ |

Licences, as checked on 2026-10-16: Silverman Sound's track page offers a free licence under CC BY 4.0 with the credit
"Music: Signs To Nowhere by Shane Ivers - https://www.silvermansound.com" (also on the Free Music Archive,
https://freemusicarchive.org/music/shane-ivers/single/signs-to-nowhere/, "Attribution 4.0 International", marked not
AI-generated); incompetech licenses everything under CC BY 4.0 with the credit text in its FAQ,
https://incompetech.com/music/royalty-free/faq.html.

What was done to each: the start kept as it is and played once; then a loop to a point where the music comes round to
the same place (Signs To Nowhere: 48 bars at 90 bpm, 23.32 s to 151.32 s; Spy Glass: 84 bars at 110 bpm, 19.60 s to
202.88 s, where the head comes back; Covert Affair, played freely around 68 bpm: 5.50 s to 178.44 s), its last 0.3 s
crossfaded into the 0.3 s before the loop's start, then 0.3 s of what follows the start as a tail, and the ending
cut; brought to -17.4 LUFS integrated with a limiter at -2.2 dB (true peak at most -2.7 dBTP); 96 kbps stereo mp3.

## Adobe Audition sound effects

From Adobe's free Audition sound effects (https://www.adobe.com/products/audition/offers/AdobeAuditionDLCSFX.html),
only the files named below, cut down to what plays. Terms, from that page: "Subject to the restrictions stated in the
EULA, you may use, display, modify, reproduce, and distribute the associated Content File. However, you may not
distribute the Content File on a standalone basis (i.e., in circumstances in which the Content File constitute the
primary value of the product being distributed)". So these are used only as part of the station, never as a pack.

| File | Original (Adobe category zip / file) | What was done |
| --- | --- | --- |
| `step-grit-0…3.mp3` | Foley Footsteps / "Foley Footstep Work Boots Concrete Walking 01.wav" | four single steps cut out, mono, 22 kHz |
| `step-hollow-0…3.mp3` | Foley Footsteps / "Foley Footstep Cowboy Boots Walk Down Stairs Mic At Top 01.wav" | four single steps cut out, mono, 22 kHz |
| `clunk.mp3` | Foley / "Foley Lock Metal Lock Movement Short 01.wav" | 0.3 s, mono |
| `train-bed.mp3` | Transportation / "Transportation Train Pass By 01.wav" | 4 s from the middle of the pass, crossfaded into a loop, mono |
| `city.mp3` | Ambience 2 / "Ambience Traffic Under Road 01.wav" | 8 s crossfaded into a loop, mono, low-passed |
