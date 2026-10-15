// What visitors read about you. No email here, on purpose.
export const SITE = {
  name: 'Faiz',
  tagline: '', // optional word under the name in the lobby
  about: '', // optional line under the name in the lobby; empty shows nothing
};


// Real visitors seeing each other (server/ is the Cloudflare Worker). An empty url turns it off.
export const MULTIPLAYER = { enabled: true, url: 'wss://faiz-live.faiz-live.workers.dev' };

// The arena, west of the lobby: one photo behind each of its maps (a photo id from photos.json: what the
// train and the gorge were drawn from; E opens it). Change an id and push to change it; enabled: false
// removes the room. pvp: false turns the fight off (no guns, no dummy, no scoreboard): the arena is then
// just a room to run and jump in. Which map is up is the server's (gorge addendum).
export const ARENA = { enabled: true, photos: { train: 'dscf9139', gorge: '000091570034' }, pvp: true };
