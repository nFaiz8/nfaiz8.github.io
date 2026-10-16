// What makes each station itself (subway ride spec §5): its props, clock, departures board, ticker, kiosk, vent,
// newspaper, the tape across a closed exit, and where its creatures and commuters start. scene.js builds any station
// from its map and this. Pure. Coordinates are the station's own map's.
import { STATION_LIFE } from './life.js';

const FAR = 1.03; // the wall face across the north track, facing the platform
export const DECOR = {
  MUSEUM: {
    stop: 0,
    exitSign: '▲ MUSEUM',
    // [prop, x, z, lift]
    props: [
      ['bin', 11.35, 13.72], ['closed', 4.5, 7.03, 1.25], ['map', 8.1, 5.06, 1.15], ['vending', 11.05, 5.15],
      ['bin', 23.5, 10.1], ['bin', 35.5, 10.1], ['bin', 59.5, 10.1], ['bin', 83.5, 10.1],
      ['nowShowing', 24.6, FAR, 1.15], ['gap', 38.5, FAR, 1.75], ['nowShowing', 62.6, FAR, 1.15], ['gap', 76.5, FAR, 1.75], ['nowShowing', 92.6, FAR, 1.15],
    ],
    torn: { x: 28.4, z: FAR, lift: 1.45 },
    clock: { x: 12.5, y: 2.5, z: 6.02 },
    board: { x: 15.7, y: 2.0, z: 6.02 },
    ticker: { x: 26.5, z: 9.5, w: 4.6, text: '   PLEASE STAND BEHIND THE YELLOW LINE  ·  STAND CLEAR OF THE CLOSING DOORS  ·  EXPRESS TRAINS DO NOT STOP AT THIS STATION  ·  MIND THE GAP  ·  faiz.pics: NOW SHOWING UPSTAIRS  ·  KEEP YOUR BELONGINGS WITH YOU  ·' },
    kiosk: { x: 4.5 },
    vent: { x: 6.5, z: 12.2 },
    news: { x: 30.5, z: 12.4, range: [21, 99] },
    tape: null,
    life: STATION_LIFE,
  },
  'CANAL ST': {
    stop: 1,
    exitSign: null,
    props: [
      ['bin', 15.5, 10.1], ['bin', 63.5, 10.1], ['bin', 79.5, 10.1],
      ['nowShowing', 20.6, FAR, 1.15], ['gap', 58.5, FAR, 1.75], ['nowShowing', 74.6, FAR, 1.15],
    ],
    torn: null,
    clock: null,
    board: { x: 48.5, y: -0.7, z: 12.02 }, // on the closed stairs' south wall, over the platform
    ticker: { x: 22, z: 9.5, w: 4.6, text: '   THIS IS CANAL ST  ·  STREET EXIT CLOSED: OPENING SOON  ·  STAND CLEAR OF THE CLOSING DOORS  ·  MIND THE GAP  ·' },
    kiosk: null,
    vent: null,
    news: null,
    tape: { x: 52.5, z: 9.5 },
    life: {
      pigeons: [{ x: 20.2, z: 6.2 }, { x: 66.5, z: 12.8 }, { x: 72.1, z: 7.4 }],
      rats: [{ x: 30, track: 0 }, { x: 70, track: 1 }],
      commuters: [],
    },
  },
};
