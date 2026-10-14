// What visitors read about you. No email here, on purpose.
export const SITE = {
  name: 'Faiz',
  tagline: '', // optional word under the name in the lobby
  about: '', // optional line under the name in the lobby; empty shows nothing
};


// Real visitors seeing each other (server/ is the Cloudflare Worker). An empty url turns it off.
export const MULTIPLAYER = { enabled: true, url: '' };
