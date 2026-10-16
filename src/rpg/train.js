import { PERIOD } from './schedule.js';

// The shared clock (station spec, Multiplayer): every player's station time is the same moment of one schedule,
// the server's clock in ms (or this machine's) in seconds, modulo PERIOD: a day, whole cycles of the schedule's locals
// and expresses (schedule.js). So everyone sees the same train at the same time; at the wrap the schedule starts again.
export { PERIOD };
export const sharedTime = (epochMs) => { const s = epochMs / 1000; return s - PERIOD * Math.floor(s / PERIOD); };
// The server's clock less mine, from a message stamped `now` by the server that came back rtt ms after I asked:
// it was sent about half the round trip ago.
export const clockOffset = (serverNow, rtt, localNow) => serverNow + (rtt || 0) / 2 - localNow;
