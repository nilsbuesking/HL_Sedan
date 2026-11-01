/* Wörth 1870 — engine: rules, scenario data and AI. No DOM access, so it runs headless for tests. */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- RNG
  function rand(state) { // mulberry32, state.seed mutates so games are replayable
    let t = (state.seed = (state.seed + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ---------------------------------------------------------------- Hex geometry (pointy-top, odd rows shifted right)
  // Direction order: E, NE, NW, W, SW, SE
  const DIRS_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
  const DIRS_ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
  function neighbour(c, r, d) { const o = (r & 1) ? DIRS_ODD[d] : DIRS_EVEN[d]; return [c + o[0], r + o[1]]; }
  function toCube(c, r) { const x = c - (r - (r & 1)) / 2; return [x, -x - r, r]; }
  function hexDist(c1, r1, c2, r2) {
    const a = toCube(c1, r1), b = toCube(c2, r2);
    return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  }

  // ---------------------------------------------------------------- Rules data
  const TERRAIN = {
    '.': { name: 'Open fields', cost: { foot: 1, horse: 1, guns: 1 }, def: 1.0 },
    'w': { name: 'Woods', cost: { foot: 2, horse: 3, guns: 3 }, def: 1.5, cover: true },
    'g': { name: 'Vineyards', cost: { foot: 1.5, horse: 2, guns: 2 }, def: 1.25, cover: true },
    'v': { name: 'Village', cost: { foot: 1, horse: 1, guns: 1 }, def: 1.6, cover: true },
    // On 6 August the Wörth bridge was down and infantry waded breast-deep (Moltke); horses and guns need a ford or bridge.
    '~': { name: 'River Sauer', cost: { foot: 3, horse: null, guns: null }, def: 0.6, water: true },
    'f': { name: 'Ford', cost: { foot: 2, horse: 2, guns: 3 }, def: 0.75, water: true },
    'b': { name: 'Bridge', cost: { foot: 1, horse: 1, guns: 1 }, def: 0.9 },
  };
  const ROAD_COST = { foot: 1, horse: 1, guns: 0.75 };
  const ELEV_NAMES = ['Valley floor', 'Slopes', 'Heights'];

  // att: firepower against foot / horse / guns. rng: [min, max] in hexes. mof: guns may move OR fire, not both.
  const UNIT_TYPES = {
    inf_pr: { name: 'Infantry', kit: 'Dreyse needle gun', cls: 'foot', mv: 3, rng: [1, 1], att: { foot: 6, horse: 6, guns: 7 }, def: 5, zoc: true, sym: 'inf', value: 1 },
    inf_bv: { name: 'Bavarian infantry', kit: 'Werder & Podewils rifles', cls: 'foot', mv: 3, rng: [1, 1], att: { foot: 6, horse: 6, guns: 7 }, def: 5, zoc: true, sym: 'inf', value: 1 },
    jaeger: { name: 'Jäger', kit: 'Light infantry; moves freely in woods', cls: 'foot', mv: 4, rng: [1, 1], att: { foot: 6, horse: 5, guns: 7 }, def: 5, zoc: true, sym: 'jaeger', light: true, value: 1 },
    cav_de: { name: 'Cavalry', kit: 'Uhlans, dragoons, hussars', cls: 'horse', mv: 6, rng: [1, 1], att: { foot: 4, horse: 6, guns: 8 }, def: 3, zoc: true, sym: 'cav', value: 0.9 },
    art_de: { name: 'Field artillery', kit: 'Krupp steel breech-loaders; +1 range on heights', cls: 'guns', mv: 3, rng: [1, 4], att: { foot: 7.5, horse: 7.5, guns: 7 }, def: 3, zoc: false, mof: true, heightRange: true, sym: 'art', value: 1.3 },
    inf_fr: { name: 'Infanterie de ligne', kit: 'Chassepot rifle, range 2', cls: 'foot', mv: 3, rng: [1, 2], att: { foot: 6, horse: 7, guns: 5 }, def: 5, zoc: true, sym: 'inf', value: 1 },
    elite_fr: { name: 'Zouaves / Turcos', kit: 'Chassepot; élan at close quarters', cls: 'foot', mv: 3, rng: [1, 2], att: { foot: 7, horse: 7, guns: 6 }, def: 6, zoc: true, elite: true, sym: 'inf', value: 1.2 },
    cuir: { name: 'Cuirassiers', kit: 'Heavy cavalry; charges fail against cover', cls: 'horse', mv: 5, rng: [1, 1], att: { foot: 7, horse: 7, guns: 9 }, def: 4, zoc: true, sym: 'cav', value: 1 },
    art_fr: { name: 'Artillerie', kit: 'La Hitte muzzle-loaders; +1 range on heights', cls: 'guns', mv: 3, rng: [1, 2], att: { foot: 6, horse: 6, guns: 4 }, def: 3, zoc: false, mof: true, heightRange: true, sym: 'art', value: 1.2 },
    mitr: { name: 'Mitrailleuses', kit: 'Reffye volley guns; deadly to men, weak against guns', cls: 'guns', mv: 3, rng: [1, 2], att: { foot: 9, horse: 9, guns: 2 }, def: 3, zoc: false, mof: true, sym: 'mg', value: 1.1 },
    // Commanders do not fire. rng [1, 0] gives an empty range, so every range loop skips them.
    cmd: { name: 'Commander and staff', kit: 'Units next to him fire ×1.1; can be attacked only from next to him', cls: 'horse', mv: 5, rng: [1, 0], att: { foot: 0, horse: 0, guns: 0 }, def: 5, zoc: false, cmd: true, sym: 'cmd', value: 3 },
  };

  const K = 6; // firepower scale: expected losses = K * strength/10 * att / (att + def)
  const CMD_BONUS = 1.1, CMD_LOST = 0.95;

  // ---------------------------------------------------------------- Scenario: Wörth, 6 August 1870
  function riverPath() {
    const p = [];
    for (let r = 0; r <= 15; r++) p.push([10, r]);
    p.push([11, 16], [11, 17]);
    return p;
  }

  const SCENARIOS = {
    woerth: {
      id: 'woerth',
      title: 'Wörth',
      subtitle: 'Froeschwiller · 6 August 1870',
      cols: 16, rows: 18, hexMetres: 600,
      turns: 14, startMinutes: 8 * 60, minutesPerTurn: 45,
      order: ['de', 'fr'],
      winVP: 6, loseVP: 3,
      terrain: [
        '.wwwwwwww.~...ww',
        '..wwwwwww.~...w.',
        '..vwwwwvw.~..v..',
        '...wwwwww.~.....',
        '..gwwww...~..w..',
        '...g.gg...~....w',
        'v...v.gg.vb....v',
        '....g.g.g.~.....',
        '.....v.g..~.....',
        '....g.....fv..w.',
        '....wwww..~.....',
        '...wwwww..~..w..',
        '....wwww..bv....',
        '.....ww...~...w.',
        '..w....v..~.....',
        '..ww......~.....',
        '...........~....',
        '...........~....',
      ],
      elevation: [
        '2222222110011111',
        '2222222110011111',
        '2222221110011111',
        '1222221110012211',
        '1222221110012211',
        '1222221110012211',
        '0122221110012211',
        '0122221110012211',
        '1122221110012221',
        '1112221110012221',
        '1111111110012221',
        '1111111110012221',
        '1111111110012221',
        '1111111110011111',
        '1111111100011111',
        '1111111100011111',
        '1111111100000111',
        '1111111100000111',
      ],
      river: riverPath(),
      roads: [
        [[0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6], [15, 6]],
        [[4, 6], [4, 7], [5, 8], [5, 9], [6, 10], [6, 11], [7, 12], [7, 13], [7, 14], [7, 15], [7, 16], [7, 17]],
        [[13, 2], [12, 3], [12, 4], [11, 5], [11, 6], [11, 7], [11, 8], [11, 9], [11, 10], [11, 11], [11, 12], [12, 12], [13, 12], [14, 12], [15, 12]],
        [[11, 12], [10, 12], [9, 12], [8, 13], [7, 13]],
        [[9, 6], [8, 5], [8, 4], [7, 3], [7, 2], [7, 1], [7, 0]],
        [[4, 6], [3, 5], [3, 4], [2, 3], [2, 2]],
      ],
      places: [
        { c: 4, r: 6, name: 'Froeschwiller' }, { c: 9, r: 6, name: 'Wörth' }, { c: 5, r: 8, name: 'Elsasshausen' },
        { c: 7, r: 14, name: 'Morsbronn' }, { c: 11, r: 12, name: 'Gunstett' }, { c: 11, r: 9, name: 'Spachbach' },
        { c: 7, r: 2, name: 'Langensoultzbach' }, { c: 2, r: 2, name: 'Neehwiller' }, { c: 13, r: 2, name: 'Görsdorf' },
        { c: 0, r: 6, name: 'Reichshoffen' }, { c: 15, r: 6, name: 'Preuschdorf' },
      ],
      areaLabels: [
        { c: 5.6, r: 11.2, name: 'Niederwald' },
        { c: 4.4, r: 0.9, name: 'Hochwald' },
        { c: 10.15, r: 3.2, name: 'Sauer', river: true },
      ],
      // Places that can be held. vp counts towards victory; inc is the reserves the holder draws each turn.
      objectives: [
        { c: 4, r: 6, name: 'Froeschwiller', vp: 4, inc: 2, owner: 'fr' },
        { c: 5, r: 8, name: 'Elsasshausen', vp: 2, inc: 1, owner: 'fr' },
        { c: 9, r: 6, name: 'Wörth', vp: 1, inc: 1, owner: 'fr' },
        { c: 7, r: 14, name: 'Morsbronn', vp: 1, inc: 1, owner: 'fr' },
        { c: 5, r: 11, name: 'Niederwald', vp: 1, inc: 1, owner: 'fr' },
        { c: 0, r: 6, name: 'Reichshoffen', vp: 0, inc: 1, owner: 'fr' },
        { c: 2, r: 2, name: 'Neehwiller', vp: 0, inc: 1, owner: 'fr' },
        { c: 7, r: 2, name: 'Langensoultzbach', vp: 0, inc: 1, owner: 'de' },
        { c: 13, r: 2, name: 'Görsdorf', vp: 0, inc: 1, owner: 'de' },
        { c: 15, r: 6, name: 'Preuschdorf', vp: 0, inc: 1, owner: 'de' },
        { c: 11, r: 9, name: 'Spachbach', vp: 0, inc: 1, owner: 'de' },
        { c: 11, r: 12, name: 'Gunstett', vp: 0, inc: 1, owner: 'de' },
      ],
      // Requisition: reserves (stragglers, detachments, ammunition columns) bought with income from held places.
      reserves: {
        base: { de: 0, fr: 0 },
        refitCost: 4, refitAmt: 3, callupCost: 10, callupMax: { de: 5, fr: 2 },
        callup: {
          de: { nat: 'pr', type: 'inf_pr', name: 'Kombiniertes Bataillon', sub: 'Formed from detachments and stragglers', short: 'KB', str: 5 },
          fr: { nat: 'fr', type: 'inf_fr', name: 'Bataillon de marche', sub: 'Formed from detachments and stragglers', short: 'BM', str: 5 },
        },
      },
      sides: {
        de: { name: 'German Third Army', short: 'Germans', commander: 'Crown Prince Friedrich Wilhelm', ai: 'attack' },
        fr: { name: 'Armée d’Alsace', short: 'French', commander: 'Maréchal de MacMahon', ai: 'defend' },
      },
      units: [
        // ---- Commanders. The Crown Prince had ordered no battle for the 6th and reached the field at about 13:00.
        { id: 'fr-mm', side: 'fr', nat: 'fr', type: 'cmd', name: 'Maréchal de MacMahon', sub: 'Commander · I Corps and the Armée d’Alsace', short: 'MM', c: 4, r: 5, str: 4 },
        { id: 'de-kp', side: 'de', nat: 'pr', type: 'cmd', name: 'Kronprinz Friedrich Wilhelm', sub: 'Commander · III. Armee', short: 'KP', c: 15, r: 6, str: 4, arrive: 8 },
        // ---- French: I Corps (MacMahon) on the Froeschwiller ridge, with Conseil-Dumesnil's division of VII Corps
        { id: 'fr-d1', side: 'fr', nat: 'fr', type: 'inf_fr', name: '1re brigade', sub: 'Division Ducrot', short: 'D1', c: 4, r: 4 },
        { id: 'fr-d2', side: 'fr', nat: 'fr', type: 'inf_fr', name: '2e brigade', sub: 'Division Ducrot', short: 'D2', c: 6, r: 4 },
        { id: 'fr-r1', side: 'fr', nat: 'fr', type: 'inf_fr', name: '1re brigade', sub: 'Division Raoult', short: 'R1', c: 7, r: 5 },
        { id: 'fr-r2', side: 'fr', nat: 'fr', type: 'inf_fr', name: '2e brigade', sub: 'Division Raoult', short: 'R2', c: 7, r: 7 },
        { id: 'fr-zv', side: 'fr', nat: 'fr', type: 'elite_fr', name: 'Zouaves', sub: 'I Corps', short: 'Zv', c: 8, r: 8 },
        { id: 'fr-l1', side: 'fr', nat: 'fr', type: 'inf_fr', name: '1re brigade', sub: 'Division Lartigue', short: 'L1', c: 6, r: 10 },
        { id: 'fr-l2', side: 'fr', nat: 'fr', type: 'inf_fr', name: '2e brigade', sub: 'Division Lartigue', short: 'L2', c: 7, r: 14 },
        { id: 'fr-tu', side: 'fr', nat: 'fr', type: 'elite_fr', name: 'Tirailleurs algériens', sub: 'I Corps', short: 'Tu', c: 5, r: 11 },
        { id: 'fr-cd', side: 'fr', nat: 'fr', type: 'inf_fr', name: 'Division Conseil-Dumesnil', sub: 'VII Corps', short: 'CD', c: 4, r: 9, str: 9 },
        { id: 'fr-pe', side: 'fr', nat: 'fr', type: 'inf_fr', name: 'Division Pellé', sub: 'ex-Douay, mauled at Wissembourg', short: 'Pe', c: 3, r: 6, str: 6 },
        { id: 'fr-ar', side: 'fr', nat: 'fr', type: 'art_fr', name: 'Réserve d’artillerie', sub: 'I Corps', short: 'AR', c: 5, r: 6 },
        { id: 'fr-ad', side: 'fr', nat: 'fr', type: 'art_fr', name: 'Batteries divisionnaires', sub: 'I Corps', short: 'AD', c: 5, r: 7 },
        { id: 'fr-m1', side: 'fr', nat: 'fr', type: 'mitr', name: 'Mitrailleuses', sub: 'Division Raoult', short: 'M1', c: 5, r: 5 },
        { id: 'fr-m2', side: 'fr', nat: 'fr', type: 'mitr', name: 'Mitrailleuses', sub: 'Division Lartigue', short: 'M2', c: 5, r: 9 },
        { id: 'fr-mi', side: 'fr', nat: 'fr', type: 'cuir', name: 'Brigade Michel', sub: '8e & 9e cuirassiers', short: 'Mi', c: 4, r: 13, str: 8 },
        { id: 'fr-bo', side: 'fr', nat: 'fr', type: 'cuir', name: 'Division Bonnemains', sub: '1er–4e cuirassiers', short: 'Bo', c: 2, r: 8 },
        { id: 'fr-gl', side: 'fr', nat: 'fr', type: 'inf_fr', name: 'Division Guyot de Lespart', sub: 'V Corps, too late to matter?', short: 'GL', c: 0, r: 6, str: 8, arrive: 10 },

        // ---- German: V Corps (Kirchbach) in the centre
        { id: 'de-17', side: 'de', nat: 'pr', type: 'inf_pr', name: '17. Infanterie-Brigade', sub: '9. Division · V. Armeekorps', short: '17', c: 12, r: 5 },
        { id: 'de-18', side: 'de', nat: 'pr', type: 'inf_pr', name: '18. Infanterie-Brigade', sub: '9. Division · V. Armeekorps', short: '18', c: 13, r: 6 },
        { id: 'de-19', side: 'de', nat: 'pr', type: 'inf_pr', name: '19. Infanterie-Brigade', sub: '10. Division · V. Armeekorps', short: '19', c: 12, r: 7 },
        { id: 'de-20', side: 'de', nat: 'pr', type: 'inf_pr', name: '20. Infanterie-Brigade', sub: '10. Division · V. Armeekorps', short: '20', c: 14, r: 7 },
        { id: 'de-j5', side: 'de', nat: 'pr', type: 'jaeger', name: 'Jäger-Bataillon Nr. 5', sub: 'V. Armeekorps', short: 'J5', c: 11, r: 7, str: 6 },
        { id: 'de-ka5', side: 'de', nat: 'pr', type: 'art_de', name: 'Korps-Artillerie', sub: 'V. Armeekorps', short: 'KA', c: 12, r: 6 },
        { id: 'de-da5', side: 'de', nat: 'pr', type: 'art_de', name: 'Divisions-Artillerie', sub: 'V. Armeekorps', short: 'DA', c: 13, r: 8 },
        { id: 'de-cv5', side: 'de', nat: 'pr', type: 'cav_de', name: 'Divisions-Kavallerie', sub: 'V. Armeekorps', short: 'Kv', c: 15, r: 7, str: 6 },
        // ---- German: II Bavarian Corps (Hartmann) in the north
        { id: 'de-b7', side: 'de', nat: 'bv', type: 'inf_bv', name: '7. Infanterie-Brigade', sub: '4. Division · II. bayer. Korps', short: 'B7', c: 8, r: 2 },
        { id: 'de-b8', side: 'de', nat: 'bv', type: 'inf_bv', name: '8. Infanterie-Brigade', sub: '4. Division · II. bayer. Korps', short: 'B8', c: 9, r: 3 },
        { id: 'de-ba', side: 'de', nat: 'bv', type: 'art_de', name: 'Artillerie', sub: 'II. bayer. Korps', short: 'BA', c: 9, r: 1 },
        { id: 'de-b5', side: 'de', nat: 'bv', type: 'inf_bv', name: '5. Infanterie-Brigade', sub: '3. Division · II. bayer. Korps', short: 'B5', c: 7, r: 0, arrive: 3 },
        { id: 'de-b6', side: 'de', nat: 'bv', type: 'inf_bv', name: '6. Infanterie-Brigade', sub: '3. Division · II. bayer. Korps', short: 'B6', c: 9, r: 0, arrive: 4 },
        { id: 'de-b1', side: 'de', nat: 'bv', type: 'inf_bv', name: '1. Division', sub: 'I. bayer. Korps (von der Tann)', short: 'B1', c: 8, r: 0, arrive: 7 },
        // ---- German: XI Corps (Bose) in the south, arriving via Gunstett
        { id: 'de-41', side: 'de', nat: 'pr', type: 'inf_pr', name: '41. Infanterie-Brigade', sub: '21. Division · XI. Armeekorps', short: '41', c: 12, r: 11 },
        { id: 'de-ka11', side: 'de', nat: 'pr', type: 'art_de', name: 'Korps-Artillerie', sub: 'XI. Armeekorps', short: 'KA', c: 13, r: 10 },
        { id: 'de-42', side: 'de', nat: 'pr', type: 'inf_pr', name: '42. Infanterie-Brigade', sub: '21. Division · XI. Armeekorps', short: '42', c: 15, r: 12, arrive: 2 },
        { id: 'de-j11', side: 'de', nat: 'pr', type: 'jaeger', name: 'Jäger-Bataillon Nr. 11', sub: 'XI. Armeekorps', short: 'J11', c: 15, r: 13, str: 6, arrive: 2 },
        { id: 'de-43', side: 'de', nat: 'pr', type: 'inf_pr', name: '43. Infanterie-Brigade', sub: '22. Division · XI. Armeekorps', short: '43', c: 15, r: 12, arrive: 3 },
        { id: 'de-cv11', side: 'de', nat: 'pr', type: 'cav_de', name: 'Divisions-Kavallerie', sub: 'XI. Armeekorps', short: 'Kv', c: 15, r: 14, str: 6, arrive: 3 },
        { id: 'de-44', side: 'de', nat: 'pr', type: 'inf_pr', name: '44. Infanterie-Brigade', sub: '22. Division · XI. Armeekorps', short: '44', c: 15, r: 12, arrive: 4 },
        { id: 'de-da11', side: 'de', nat: 'pr', type: 'art_de', name: 'Divisions-Artillerie', sub: 'XI. Armeekorps', short: 'DA', c: 15, r: 11, arrive: 4 },
        // ---- German: Württemberg Division from the south-east
        { id: 'de-wu', side: 'de', nat: 'wu', type: 'inf_pr', name: 'Württ. Feld-Division', sub: 'Brigade Starkloff', short: 'Wü', c: 14, r: 17, arrive: 7 },
      ],
      briefing: [
        'Marshal MacMahon’s corps holds the wooded ridge between Froeschwiller and Elsasshausen, west of the Sauer. Neither command meant to fight today. Outpost firing at Wörth has drawn in the Bavarians from the north, then the Prussian V Corps in the centre and XI Corps at Gunstett.',
        'The French have the ground and the longer-ranged Chassepot. The Germans have more men arriving by the hour and much better artillery.',
      ],
      history: 'Historically the German Third Army carried Elsasshausen in the afternoon and Froeschwiller fell at about 17:00. Both sides lost on the order of 10,000 killed and wounded; the French also lost several thousand prisoners, and MacMahon retreated through Reichshoffen.',
    },
  };

  // ---------------------------------------------------------------- Map build
  const mapCache = {};
  function buildMap(sc) {
    if (mapCache[sc.id]) return mapCache[sc.id];
    const W = sc.cols, H = sc.rows, N = W * H;
    const ter = new Array(N), elev = new Int8Array(N);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c;
      ter[i] = sc.terrain[r][c];
      elev[i] = +sc.elevation[r][c];
      if (!TERRAIN[ter[i]]) throw new Error('Unknown terrain at ' + c + ',' + r);
    }
    const nbrs = [];
    for (let i = 0; i < N; i++) {
      const c = i % W, r = (i / W) | 0, list = [];
      for (let d = 0; d < 6; d++) {
        const [nc, nr] = neighbour(c, r, d);
        if (nc >= 0 && nc < W && nr >= 0 && nr < H) list.push([d, nr * W + nc]);
      }
      nbrs.push(list);
    }
    const roadEdges = new Set(), roadHex = new Uint8Array(N);
    const key = (a, b) => a < b ? a * 10000 + b : b * 10000 + a;
    for (const road of sc.roads) {
      for (let k = 0; k < road.length; k++) {
        const i = road[k][1] * W + road[k][0];
        roadHex[i] = 1;
        if (k > 0) {
          const j = road[k - 1][1] * W + road[k - 1][0];
          if (!nbrs[i].some(([, n]) => n === j)) throw new Error('Road gap at ' + road[k]);
          roadEdges.add(key(i, j));
        }
      }
    }
    // distance rings for range lookups
    const rings = [];
    for (let i = 0; i < N; i++) {
      const c = i % W, r = (i / W) | 0, byD = [[], [], [], [], [], [], []];
      for (let j = 0; j < N; j++) {
        const d = hexDist(c, r, j % W, (j / W) | 0);
        if (d <= 6) byD[d].push(j);
      }
      rings.push(byD);
    }
    const objIdx = sc.objectives.map(o => o.r * W + o.c);
    const m = { W, H, N, ter, elev, nbrs, roadEdges, roadHex, rings, objIdx, edgeKey: key };
    mapCache[sc.id] = m;
    return m;
  }

  // ---------------------------------------------------------------- State
  const other = s => (s === 'de' ? 'fr' : 'de');
  function scen(state) { return SCENARIOS[state.scenarioId]; }
  function mapOf(state) { return buildMap(scen(state)); }
  function idxOf(state, u) { return u.r * scen(state).cols + u.c; }

  function newGame(scenarioId, players, seed) {
    const sc = SCENARIOS[scenarioId];
    const state = {
      v: 2, scenarioId, turn: 1, side: sc.order[0], seed: (seed >>> 0) || ((Math.random() * 2 ** 31) | 0),
      players: players || { de: 'human', fr: 'ai' },
      control: sc.objectives.map(o => o.owner),
      units: sc.units.map(u => ({
        id: u.id, side: u.side, nat: u.nat, type: u.type, name: u.name, sub: u.sub, short: u.short,
        c: u.c, r: u.r, entry: [u.c, u.r], str: u.str || 10, max: u.str || 10, arrive: u.arrive || 0,
        on: !u.arrive, dead: false, mp: 0, moved: false, fired: false, acted: false, engaged: false, refit: false,
      })),
      res: { de: 0, fr: 0 }, income: { de: 0, fr: 0 }, callups: { de: 0, fr: 0 }, cmdLost: { de: false, fr: false },
      log: [], over: null, lastEvents: [],
    };
    startSideTurn(state);
    return state;
  }

  function isCmd(u) { return !!UNIT_TYPES[u.type].cmd; }
  function commander(state, side) { return state.units.find(u => u.side === side && isCmd(u)) || null; }
  function cmdAdjacent(state, s, sIdx) { // is s, standing at sIdx, next to its own commander?
    const cu = commander(state, s.side);
    if (!cu || !cu.on || cu.dead || cu.id === s.id) return false;
    const W = scen(state).cols;
    return hexDist(cu.c, cu.r, sIdx % W, (sIdx / W) | 0) === 1;
  }

  // ---------------------------------------------------------------- Places and reserves
  function incomeOf(state, side) {
    const sc = scen(state);
    let n = (sc.reserves && sc.reserves.base[side]) || 0;
    sc.objectives.forEach((o, i) => { if (state.control[i] === side) n += o.inc || 0; });
    return n;
  }
  function supplyHexes(state, side) { // villages held by `side`: refits happen in or next to them
    const sc = scen(state), map = mapOf(state), out = [];
    sc.objectives.forEach((o, i) => { if (state.control[i] === side && map.ter[map.objIdx[i]] === 'v') out.push(map.objIdx[i]); });
    return out;
  }
  function inContact(state, idx, side, occ) {
    return mapOf(state).nbrs[idx].some(([, n]) => occ[n] && occ[n].side !== side);
  }
  // Returns null if the unit can refit now, otherwise a short reason.
  function refitBlock(state, u) {
    const R = scen(state).reserves;
    if (!R || state.over || !u.on || u.dead || u.side !== state.side) return 'Not available';
    if (u.refit) return 'Already refitted this turn';
    if (u.fired) return 'Has fired this turn';
    if (u.str >= u.max) return 'At full strength';
    const map = mapOf(state), idx = idxOf(state, u), occ = occupancy(state);
    if (u.engaged) return 'Under fire since your last turn';
    if (inContact(state, idx, u.side, occ)) return 'Too close to the enemy';
    const sup = supplyHexes(state, u.side);
    if (!sup.some(v => v === idx || map.nbrs[v].some(([, n]) => n === idx))) return 'Not in or next to a village you hold';
    if (state.res[u.side] < R.refitCost) return 'Needs ' + R.refitCost + ' reserves';
    return null;
  }
  function refit(state, u) {
    if (refitBlock(state, u)) return null;
    const R = scen(state).reserves;
    const gain = Math.min(R.refitAmt, u.max - u.str);
    state.res[u.side] -= R.refitCost;
    u.str += gain; u.refit = true; u.mp = 0; u.acted = true;
    state.undo = null;
    addLog(state, unitLabel(u) + ' refits: +' + gain + ' strength.', u.side);
    return { gain, unitId: u.id };
  }
  function callupHexes(state, side) {
    const R = scen(state).reserves;
    if (!R || state.over || side !== state.side || state.callups[side] >= R.callupMax[side] || state.res[side] < R.callupCost) return [];
    const occ = occupancy(state);
    return supplyHexes(state, side).filter(i => !occ[i] && !inContact(state, i, side, occ));
  }
  function callup(state, idx) {
    const side = state.side, sc = scen(state), R = sc.reserves;
    if (!callupHexes(state, side).includes(idx)) return null;
    const spec = R.callup[side], n = ++state.callups[side];
    const u = {
      id: side + '-x' + n, side, nat: spec.nat, type: spec.type, name: spec.name + ' ' + n, sub: spec.sub, short: spec.short + n,
      c: idx % sc.cols, r: (idx / sc.cols) | 0, entry: [idx % sc.cols, (idx / sc.cols) | 0], str: spec.str, max: spec.str, arrive: 0,
      on: true, dead: false, mp: 0, moved: true, fired: false, acted: true, engaged: false, refit: false, forming: true, raised: true,
    };
    state.units.push(u);
    state.res[side] -= R.callupCost;
    state.undo = null;
    const place = sc.objectives[mapOf(state).objIdx.indexOf(idx)];
    addLog(state, u.name + ' is formed at ' + place.name + '.', side);
    return { unitId: u.id };
  }

  function live(state, side) { return state.units.filter(u => u.on && !u.dead && (!side || u.side === side)); }
  function occupancy(state) {
    const occ = new Array(mapOf(state).N).fill(null);
    for (const u of state.units) if (u.on && !u.dead) occ[idxOf(state, u)] = u;
    return occ;
  }
  function unitAt(state, c, r) { return state.units.find(u => u.on && !u.dead && u.c === c && u.r === r) || null; }

  function clock(state, turn) {
    const sc = scen(state), m = sc.startMinutes + ((turn || state.turn) - 1) * sc.minutesPerTurn;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }
  function addLog(state, text, kind) {
    state.log.push({ t: state.turn, time: clock(state), side: state.side, text, kind: kind || 'info' });
    if (state.log.length > 400) state.log.shift();
  }
  function unitLabel(u) { return u.sub && u.nat === 'fr' && /brigade|Mitrailleuses/.test(u.name) ? u.name + ' (' + u.sub.replace('Division ', '') + ')' : u.name; }

  // ---------------------------------------------------------------- Movement
  function stepCost(map, T, from, to) {
    const t = TERRAIN[map.ter[to]];
    const road = map.roadEdges.has(map.edgeKey(from, to));
    let cost;
    if (road) cost = ROAD_COST[T.cls];
    else {
      cost = t.cost[T.cls];
      if (cost == null) return Infinity;
      if (T.light && map.ter[to] === 'w') cost = 1;
    }
    if (map.elev[to] > map.elev[from]) cost += road ? 0.25 : (T.cls === 'guns' ? 1 : 0.5);
    return cost;
  }

  function zocSet(state, side, occ) { // hexes adjacent to an enemy of `side` that exerts ZOC
    const map = mapOf(state), z = new Uint8Array(map.N);
    for (const e of live(state, other(side))) {
      if (!UNIT_TYPES[e.type].zoc) continue;
      for (const [, n] of map.nbrs[idxOf(state, e)]) z[n] = 1;
    }
    return z;
  }

  // Returns Map idx -> {cost, prev, end, stop}. `fresh` ignores spent MP (used by the AI to project the enemy's next turn).
  function reachable(state, u, opts) {
    opts = opts || {};
    const map = mapOf(state), T = UNIT_TYPES[u.type];
    const start = idxOf(state, u);
    const occ = opts.occ || occupancy(state);
    const zoc = opts.zoc || zocSet(state, u.side, occ);
    const mp = opts.fresh ? T.mv : u.mp;
    const full = opts.fresh || (!u.moved && u.mp >= T.mv);
    const res = new Map();
    res.set(start, { cost: 0, prev: -1, end: true, stop: false });
    if (mp <= 0) return res;
    const dist = new Float64Array(map.N).fill(Infinity);
    dist[start] = 0;
    const open = [start];
    const closed = new Uint8Array(map.N);
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (dist[open[k]] < dist[open[bi]]) bi = k;
      const cur = open.splice(bi, 1)[0];
      if (closed[cur]) continue;
      closed[cur] = 1;
      const curInfo = res.get(cur);
      if (cur !== start && curInfo.stop) continue;
      for (const [, n] of map.nbrs[cur]) {
        const o = occ[n];
        if (o && o.side !== u.side) continue;
        let c = stepCost(map, T, cur, n);
        if (!isFinite(c)) continue;
        let nd = dist[cur] + c;
        if (nd > mp + 1e-9) {
          // minimum move: a fresh unit may always move one hex into passable terrain
          if (!(cur === start && full)) continue;
          nd = mp;
        }
        if (nd < dist[n] - 1e-9) {
          dist[n] = nd;
          res.set(n, { cost: nd, prev: cur, end: !o, stop: !!zoc[n] });
          open.push(n);
        }
      }
    }
    return res;
  }

  function pathTo(reach, idx) {
    const p = [];
    let k = idx;
    while (k !== -1 && reach.has(k)) { p.unshift(k); k = reach.get(k).prev; }
    return p;
  }

  function canMove(u) { return u.on && !u.dead && !u.fired && u.mp > 0; }
  function canFire(u) { return u.on && !u.dead && !u.fired && !u.refit && !u.forming && !UNIT_TYPES[u.type].cmd && !(UNIT_TYPES[u.type].mof && u.moved); }

  function moveUnit(state, u, c, r) {
    if (state.over || u.side !== state.side || !canMove(u)) return null;
    const map = mapOf(state), sc = scen(state);
    const to = r * sc.cols + c;
    const reach = reachable(state, u);
    const info = reach.get(to);
    if (!info || !info.end || to === idxOf(state, u)) return null;
    const path = pathTo(reach, to);
    const undo = { id: u.id, c: u.c, r: u.r, mp: u.mp, moved: u.moved, control: state.control.slice(), logLen: state.log.length };
    u.c = c; u.r = r;
    u.mp = Math.max(0, u.mp - info.cost);
    if (info.stop) u.mp = 0; // entering an enemy zone of control ends movement
    u.moved = true; u.acted = true;
    const oi = map.objIdx.indexOf(to);
    if (oi >= 0 && state.control[oi] !== u.side && !isCmd(u)) { // a commander's staff does not garrison a place
      state.control[oi] = u.side;
      addLog(state, unitLabel(u) + ' takes ' + sc.objectives[oi].name + '.', 'capture');
    }
    state.undo = undo;
    return { path: path.map(i => [i % sc.cols, (i / sc.cols) | 0]), stop: info.stop };
  }

  function undoMove(state) {
    const un = state.undo;
    if (!un) return false;
    const u = state.units.find(x => x.id === un.id);
    if (!u || u.fired) { state.undo = null; return false; }
    u.c = un.c; u.r = un.r; u.mp = un.mp; u.moved = un.moved;
    u.acted = un.moved;
    state.control = un.control;
    state.log.length = un.logLen;
    state.undo = null;
    return true;
  }

  // ---------------------------------------------------------------- Combat
  function fireRange(state, u, idx) {
    const T = UNIT_TYPES[u.type];
    let max = T.rng[1];
    if (T.heightRange && mapOf(state).elev[idx] >= 2) max += 1;
    return [T.rng[0], max];
  }

  function targetsFrom(state, u, idx, occ) {
    const map = mapOf(state);
    occ = occ || occupancy(state);
    const [lo, hi] = fireRange(state, u, idx), out = [];
    for (let d = lo; d <= hi; d++) for (const j of map.rings[idx][d]) {
      const e = occ[j];
      if (e && e.side !== u.side && (d === 1 || !isCmd(e))) out.push(e); // commanders can be attacked only from next to them
    }
    return out;
  }

  function fireExpect(state, s, sIdx, t, tIdx, counter) {
    const map = mapOf(state), S = UNIT_TYPES[s.type], Tt = UNIT_TYPES[t.type], W = scen(state).cols;
    const st = TERRAIN[map.ter[sIdx]], tt = TERRAIN[map.ter[tIdx]];
    const d = hexDist(sIdx % W, (sIdx / W) | 0, tIdx % W, (tIdx / W) | 0);
    const mods = [];
    let a = S.att[Tt.cls];
    if (st.water) { a *= 0.7; mods.push('Firing from the water ×0.7'); }
    if (S.cls === 'horse' && tt.cover && !counter) { a *= 0.5; mods.push('Charge into cover ×0.5'); }
    if (S.cls === 'foot' && d >= 2) { a *= 0.9; mods.push('Long range ×0.9'); }
    if (S.elite && d === 1 && !counter) { a *= 1.2; mods.push('Élan ×1.2'); }
    if (cmdAdjacent(state, s, sIdx)) { a *= CMD_BONUS; mods.push('Commander at hand ×' + CMD_BONUS); }
    if (state.cmdLost && state.cmdLost[s.side]) { a *= CMD_LOST; mods.push('Commander lost ×' + CMD_LOST); }
    let df = Tt.def * tt.def;
    if (tt.def > 1) mods.push(tt.name + ' cover ×' + tt.def);
    if (tt.def < 1) mods.push('Target in ' + tt.name.toLowerCase() + ' ×' + tt.def);
    if (map.elev[tIdx] > map.elev[sIdx]) { df *= 1.25; mods.push('Target holds higher ground ×1.25'); }
    if (Tt.cls === 'guns' && d === 1) { df *= 0.75; mods.push('Guns rushed at close quarters'); }
    const exp = K * (s.str / 10) * a / (a + df) * (counter ? 0.7 : 1);
    return { exp, mods, dist: d };
  }

  function canCounter(state, def, dIdx, aIdx) {
    const W = scen(state).cols;
    const d = hexDist(dIdx % W, (dIdx / W) | 0, aIdx % W, (aIdx / W) | 0);
    const [lo, hi] = fireRange(state, def, dIdx);
    return d >= lo && d <= hi;
  }

  function spread(exp) { return [Math.floor(exp * 0.5), Math.ceil(exp * 1.5)]; }

  function forecast(state, u, t) {
    const ui = idxOf(state, u), ti = idxOf(state, t);
    const f = fireExpect(state, u, ui, t, ti, false);
    const dmg = Math.min(f.exp, t.str);
    let back = null;
    if (t.str - dmg > 0 && canCounter(state, t, ti, ui)) {
      const g = fireExpect(state, Object.assign({}, t, { str: Math.max(1, t.str - Math.round(dmg)) }), ti, u, ui, true);
      back = { exp: g.exp, range: spread(g.exp).map(x => Math.min(x, u.str)), mods: g.mods };
    }
    return { exp: dmg, range: spread(f.exp).map(x => Math.min(x, t.str)), mods: f.mods, back, dist: f.dist };
  }

  function roll(state, exp) {
    const x = exp * (0.5 + rand(state));
    const f = Math.floor(x);
    return f + (rand(state) < x - f ? 1 : 0);
  }

  function attack(state, u, t) {
    if (state.over || u.side !== state.side || !canFire(u) || t.side === u.side || t.dead) return null;
    const ui = idxOf(state, u), ti = idxOf(state, t);
    if (!targetsFrom(state, u, ui).includes(t)) return null;
    const f = fireExpect(state, u, ui, t, ti, false);
    const dmg = Math.min(roll(state, f.exp), t.str);
    t.str -= dmg;
    t.engaged = true;
    let back = 0, countered = false;
    if (t.str > 0 && canCounter(state, t, ti, ui)) {
      countered = true;
      const g = fireExpect(state, t, ti, u, ui, true);
      back = Math.min(roll(state, g.exp), u.str);
      u.str -= back;
    }
    u.fired = true; u.mp = 0; u.acted = true;
    state.undo = null;
    const killed = t.str <= 0, lost = u.str <= 0;
    if (killed) t.dead = true;
    if (lost) u.dead = true;
    let txt = unitLabel(u) + ' engages ' + unitLabel(t) + ': −' + dmg;
    if (countered) txt += ', return fire −' + back;
    if (killed) txt += '. ' + unitLabel(t) + (isCmd(t) ? ' has fallen' : ' is broken');
    if (lost) txt += '. ' + unitLabel(u) + ' is broken';
    addLog(state, txt + '.', u.side);
    let cmdFell = null;
    if (killed && isCmd(t)) {
      state.cmdLost[t.side] = true; cmdFell = t.side;
      addLog(state, 'The ' + scen(state).sides[t.side].short + ' have lost their commander. Their fire is ×' + CMD_LOST + ' for the rest of the day.', 'end');
    }
    checkCollapse(state);
    return { dmg, back, countered, killed, lost, cmdFell, from: [u.c, u.r], to: [t.c, t.r], attackerId: u.id, targetId: t.id };
  }

  // ---------------------------------------------------------------- Turn flow and victory
  function arrivalHex(state, u, occ) {
    const map = mapOf(state), sc = scen(state), T = UNIT_TYPES[u.type];
    const start = u.entry[1] * sc.cols + u.entry[0];
    const seen = new Set([start]), q = [start];
    while (q.length) {
      const i = q.shift();
      const ok = !occ[i] && TERRAIN[map.ter[i]].cost[T.cls] != null;
      if (ok) {
        const enemyNear = map.nbrs[i].some(([, n]) => occ[n] && occ[n].side !== u.side);
        if (!enemyNear) return i;
      }
      if (seen.size > 40) break;
      for (const [, n] of map.nbrs[i]) if (!seen.has(n)) { seen.add(n); q.push(n); }
    }
    return -1;
  }

  function startSideTurn(state) {
    const sc = scen(state), occ = occupancy(state);
    const arrived = [];
    for (const u of state.units) {
      if (u.side !== state.side) continue;
      if (!u.on && !u.dead && u.arrive && u.arrive <= state.turn) {
        const i = arrivalHex(state, u, occ);
        if (i >= 0) { u.c = i % sc.cols; u.r = (i / sc.cols) | 0; u.on = true; occ[i] = u; arrived.push(u); }
      }
      if (u.on && !u.dead) {
        u.mp = UNIT_TYPES[u.type].mv; u.moved = false; u.fired = false; u.acted = false; u.refit = false; u.forming = false;
      }
    }
    for (const u of arrived) addLog(state, unitLabel(u) + ' arrives on the field.', 'arrive');
    state.arrivals = arrived.map(u => u.id);
    if (sc.reserves) { const inc = incomeOf(state, state.side); state.res[state.side] += inc; state.income[state.side] = inc; }
    state.undo = null;
  }

  function endSideTurn(state) {
    if (state.over) return;
    const sc = scen(state), occ = occupancy(state), map = mapOf(state);
    for (const u of live(state, state.side)) {
      const adj = map.nbrs[idxOf(state, u)].some(([, n]) => occ[n] && occ[n].side !== u.side);
      if (!u.acted && !u.engaged && !adj && u.str < u.max) u.str += 1;
      u.engaged = false;
    }
    const last = state.side === sc.order[sc.order.length - 1];
    if (last) {
      if (state.turn >= sc.turns) { finalVerdict(state); return; }
      state.turn += 1;
    }
    state.side = other(state.side);
    startSideTurn(state);
  }

  function vp(state) {
    const sc = scen(state), out = { de: 0, fr: 0 };
    sc.objectives.forEach((o, i) => { out[state.control[i]] += o.vp; });
    return out;
  }

  function strength(state, side) {
    let now = 0, committed = 0;
    for (const u of state.units) {
      if (u.side !== side || (!u.on && !u.dead) || isCmd(u)) continue;
      committed += u.max;
      if (!u.dead) now += u.str;
    }
    return { now, committed };
  }

  function checkCollapse(state) {
    if (state.over) return;
    for (const side of ['de', 'fr']) {
      const s = strength(state, side);
      if (s.committed > 0 && s.now <= s.committed * 0.3) {
        state.over = { winner: other(side), reason: 'collapse', loser: side, turn: state.turn };
        addLog(state, scen(state).sides[side].short + ' resistance collapses.', 'end');
        return;
      }
    }
  }

  function finalVerdict(state) {
    const sc = scen(state), v = vp(state);
    let winner = 'draw';
    if (v.de >= sc.winVP) winner = 'de';
    else if (v.de <= sc.loseVP) winner = 'fr';
    state.over = { winner, reason: 'time', vp: v, turn: state.turn };
    addLog(state, 'Nightfall. ' + (winner === 'draw' ? 'The day ends without a decision.' : sc.sides[winner].short + ' hold the field.'), 'end');
  }

  // ---------------------------------------------------------------- AI
  const AIP = {
    attack: { cover: 1.2, fear: 0.45, pull: 1.1, capture: 3, garrison: 1.0, fireProspect: 0.45, caution: 0.7, support: 0.5, refit: 0.3 },
    defend: { cover: 2.0, fear: 0.9, hold: 0.9, radius: 2, retake: 0.5, garrison: 2.2, fireProspect: 0.4, caution: 1.0, support: 0.3, refit: 0.6 },
  };

  const fieldCache = {};
  function costField(state, cls, target) { // movement-cost distance from every hex to `target`, ignoring units
    const sc = scen(state), k = sc.id + cls + target;
    if (fieldCache[k]) return fieldCache[k];
    const map = mapOf(state), T = { cls, light: false };
    const dist = new Float64Array(map.N).fill(Infinity);
    dist[target] = 0;
    const open = [target], closed = new Uint8Array(map.N);
    while (open.length) {
      let bi = 0;
      for (let q = 1; q < open.length; q++) if (dist[open[q]] < dist[open[bi]]) bi = q;
      const cur = open.splice(bi, 1)[0];
      if (closed[cur]) continue;
      closed[cur] = 1;
      for (const [, n] of map.nbrs[cur]) {
        const c = stepCost(map, T, n, cur);
        if (!isFinite(c)) continue;
        if (dist[cur] + c < dist[n]) { dist[n] = dist[cur] + c; open.push(n); }
      }
    }
    fieldCache[k] = dist;
    return dist;
  }

  function aiContext(state, side) {
    const map = mapOf(state), sc = scen(state);
    const occ = occupancy(state);
    const enemies = live(state, other(side));
    const threat = Array.from({ length: map.N }, () => []);
    const zocMine = zocSet(state, other(side), occ); // ZOC that my units exert on the enemy
    // adjThreat: enemies that could stand next to a hex after their next move; only a commander needs it
    const myCmd = commander(state, side);
    const needAdj = myCmd && myCmd.on && !myCmd.dead && canMove(myCmd) && !myCmd.moved;
    const adjThreat = needAdj ? Array.from({ length: map.N }, () => []) : null;
    for (const e of enemies) {
      const T = UNIT_TYPES[e.type], ei = idxOf(state, e);
      e._hit = new Set();
      if (T.cmd) continue;
      let positions = [ei];
      if (!T.mof) {
        const R = reachable(state, e, { fresh: true, occ, zoc: zocMine });
        positions = [];
        for (const [k, v] of R) if (v.end || k === ei) positions.push(k);
      }
      const hit = e._hit, adj = needAdj ? new Set() : null;
      for (const p of positions) {
        const [lo, hi] = fireRange(state, e, p);
        for (let d = lo; d <= hi; d++) for (const j of map.rings[p][d]) hit.add(j);
        if (adj) for (const [, n] of map.nbrs[p]) adj.add(n);
      }
      for (const h of hit) threat[h].push(e);
      if (adj) for (const h of adj) adjThreat[h].push(e);
    }
    // how many of my units each enemy can choose between: its fire is shared out among them
    const mine = live(state, side);
    for (const e of enemies) {
      let n = 0;
      for (const m of mine) if (e._hit.has(idxOf(state, m))) n++;
      e._share = n;
      delete e._hit;
    }
    const posture = AIP[sc.sides[side].ai];
    return { state, side, map, sc, occ, enemies, threat, adjThreat, P: posture, mode: sc.sides[side].ai };
  }

  // Where should the commander stand? Next to units that will fire, never where the enemy can reach him.
  function cmdScore(ctx, u, idx) {
    const { state, map, occ } = ctx;
    let s = 0;
    for (const [, n] of map.nbrs[idx]) { const o = occ[n]; if (o && o.side !== u.side) return -100; }
    for (const e of ctx.adjThreat[idx]) s -= 10 * (e.str / 10) * (UNIT_TYPES[e.type].cls === 'guns' ? 0.5 : 1);
    for (const [, n] of map.nbrs[idx]) {
      const o = occ[n];
      if (!o || o.side !== u.side || isCmd(o)) continue;
      const T = UNIT_TYPES[o.type];
      const has = targetsFrom(state, o, n, occ).length > 0;
      s += (has ? 1.6 : 0.5) * (T.cls === 'guns' ? 1.3 : 1) * (o.str / 10);
    }
    const oi = map.objIdx.indexOf(idx);
    if (oi >= 0) s -= 1.5 * ctx.sc.objectives[oi].vp; // leave the key places to the infantry
    return s;
  }

  function placeWorth(o) { return o.vp + 0.6 * (o.inc || 0); }

  function incoming(ctx, u, idx) {
    const list = ctx.threat[idx];
    if (!list.length) return 0;
    const probe = u;
    const vals = [];
    for (const e of list) {
      if (e.dead) continue;
      const sh = ctx.mode === 'attack' ? Math.sqrt(1 + (e._share || 0)) : Math.sqrt(1 + 0.5 * (e._share || 0));
      vals.push(fireExpect(ctx.state, e, idxOf(ctx.state, e), probe, idx, false).exp / sh);
    }
    vals.sort((a, b) => b - a);
    return (vals[0] || 0) + (vals[1] || 0) * 0.8 + (vals[2] || 0) * 0.6;
  }

  function posScore(ctx, u, idx) {
    const { state, map, sc, P } = ctx;
    const T = UNIT_TYPES[u.type], tt = TERRAIN[map.ter[idx]];
    const urgency = 0.6 + 0.8 * state.turn / sc.turns;
    let s = 0;
    s += P.cover * (tt.def * (1 + 0.1 * map.elev[idx]) - 1) * (T.cls === 'horse' ? 0.3 : 1);
    s -= P.fear * incoming(ctx, u, idx) * T.value * (T.cls === 'guns' ? 1.3 : 1) * (u.str / u.max + 0.3);
    if (tt.water) s -= 2.5;
    let friends = 0, enemyAdj = 0;
    for (const [, n] of map.nbrs[idx]) {
      const o = ctx.occ[n];
      if (!o || o === u) continue;
      if (o.side === u.side) { if (UNIT_TYPES[o.type].cls !== 'guns' && !isCmd(o)) friends++; } else enemyAdj++;
    }
    s += P.support * Math.min(friends, 3);
    if (T.cls === 'guns' && enemyAdj) s -= 3 * enemyAdj;
    if (T.cls === 'guns' || T.rng[1] >= 2) {
      let best = 0;
      const [lo, hi] = fireRange(state, u, idx);
      for (let d = lo; d <= hi; d++) for (const j of map.rings[idx][d]) {
        const e = ctx.occ[j];
        if (e && e.side !== u.side && (d === 1 || !isCmd(e))) best = Math.max(best, fireExpect(state, u, idx, e, j, false).exp * UNIT_TYPES[e.type].value);
      }
      s += P.fireProspect * best;
    }
    // places: victory objectives pull the army; any held place is worth occupying for its income
    const objs = sc.objectives;
    const oi = map.objIdx.indexOf(idx);
    if (ctx.mode === 'attack') {
      let best = Infinity;
      objs.forEach((o, k) => {
        if (state.control[k] === u.side || !o.vp) return;
        const f = costField(state, T.cls, map.objIdx[k])[idx];
        best = Math.min(best, f / (0.7 + 0.15 * o.vp));
      });
      if (isFinite(best)) s -= P.pull * urgency * best * (T.cls === 'guns' ? 0.5 : 1);
      if (oi >= 0 && T.cls === 'foot') s += (state.control[oi] === u.side ? P.garrison * objs[oi].vp : P.capture * placeWorth(objs[oi]));
      else if (oi >= 0 && state.control[oi] !== u.side) s += P.capture * placeWorth(objs[oi]) * 0.5;
    } else {
      let hold = Infinity, retake = Infinity;
      objs.forEach((o, k) => {
        if (!o.vp) return;
        const f = costField(state, T.cls, map.objIdx[k])[idx];
        if (state.control[k] === u.side) hold = Math.min(hold, f);
        else if (o.vp >= 2) retake = Math.min(retake, f / o.vp);
      });
      if (isFinite(hold)) s -= P.hold * Math.max(0, hold - P.radius);
      if (isFinite(retake)) s -= P.retake * urgency * retake;
      if (oi >= 0 && T.cls === 'foot') s += (state.control[oi] === u.side ? P.garrison * objs[oi].vp : 3 * placeWorth(objs[oi]));
    }
    return s;
  }

  function attackValue(ctx, u, fromIdx, e, eIdx) {
    const { state, P, map } = ctx;
    const f = fireExpect(state, u, fromIdx, e, eIdx, false);
    const dmg = Math.min(f.exp, e.str);
    const kill = f.exp >= e.str * 0.9;
    let back = 0;
    if (!kill && canCounter(state, e, eIdx, fromIdx)) {
      back = fireExpect(state, Object.assign({}, e, { str: Math.max(0.5, e.str - dmg) }), eIdx, u, fromIdx, true).exp;
    }
    const ve = UNIT_TYPES[e.type].value, vu = UNIT_TYPES[u.type].value;
    let v = dmg * ve * (1 + 0.5 * dmg / Math.max(1, e.str)) + (kill ? 0.6 * e.str * ve : 0) - back * vu * P.caution;
    const oi = map.objIdx.indexOf(eIdx);
    if (oi >= 0 && kill) v += ctx.sc.objectives[oi].vp;
    if (isCmd(e)) v += kill ? 6 : 1.5; // striking at the enemy commander
    return v;
  }

  function aiSpend(state, ctx) {
    const R = ctx.sc.reserves;
    if (!R) return null;
    const side = ctx.side, map = ctx.map, W = ctx.sc.cols;
    const hexes = callupHexes(state, side);
    if (hexes.length) {
      const foes = live(state, other(side)).map(e => idxOf(state, e));
      let bi = -1, bv = -Infinity;
      for (const h of hexes) {
        let dmin = 99;
        for (const f of foes) dmin = Math.min(dmin, hexDist(h % W, (h / W) | 0, f % W, (f / W) | 0));
        const o = ctx.sc.objectives[map.objIdx.indexOf(h)];
        const v = -Math.abs(dmin - 3) + 0.5 * o.vp;
        if (v > bv) { bv = v; bi = h; }
      }
      if (bi >= 0) return { kind: 'callup', to: bi, val: 1 };
    }
    let bu = null, bv = 0;
    for (const u of live(state, side)) {
      if (refitBlock(state, u)) continue;
      const gain = Math.min(R.refitAmt, u.max - u.str);
      if (gain < 2 && !isCmd(u)) continue;
      const v = gain * UNIT_TYPES[u.type].value;
      if (v > bv) { bv = v; bu = u; }
    }
    if (bu) return { kind: 'refit', unitId: bu.id, to: idxOf(state, bu), val: 1 };
    return null;
  }

  function aiNextAction(state) {
    if (state.over) return null;
    const side = state.side;
    const ctx = aiContext(state, side);
    const W0 = scen(state).cols;
    let best = null;
    const consider = (val, act) => { if (!best || val > best.val) best = Object.assign({ val }, act); };
    for (const u of live(state, side)) {
      if (isCmd(u) || (!canMove(u) && !canFire(u))) continue;
      const T = UNIT_TYPES[u.type], ui = idxOf(state, u);
      const cur = posScore(ctx, u, ui);
      const opts = [ui];
      if (canMove(u)) {
        const R = reachable(state, u, { occ: ctx.occ });
        for (const [k, v] of R) if (v.end && k !== ui) opts.push(k);
      }
      for (const idx of opts) {
        let ps = cur;
        if (idx !== ui) {
          // evaluate as if the unit stood there
          ctx.occ[ui] = null; ctx.occ[idx] = u;
          ps = posScore(ctx, u, idx);
          ctx.occ[idx] = null; ctx.occ[ui] = u;
        }
        const mv = ps - cur;
        if (canFire(u) && (idx === ui || !T.mof)) {
          const [lo, hi] = fireRange(state, u, idx);
          for (let d = lo; d <= hi; d++) for (const j of ctx.map.rings[idx][d]) {
            const e = ctx.occ[j];
            if (!e || e.side === side || (d > 1 && isCmd(e))) continue;
            consider(mv + attackValue(ctx, u, idx, e, j), { kind: 'attack', unitId: u.id, to: idx, targetId: e.id });
          }
        }
        if (idx !== ui && mv > 0.15) consider(mv, { kind: 'move', unitId: u.id, to: idx });
      }
      // refitting where it stands, instead of firing, for a worn unit out of contact
      if (ctx.sc.reserves && !refitBlock(state, u)) {
        const gain = Math.min(ctx.sc.reserves.refitAmt, u.max - u.str);
        if (gain >= 2) consider(ctx.P.refit * gain * T.value * (0.8 + 1.2 * (1 - u.str / u.max)), { kind: 'refit', unitId: u.id, to: ui });
      }
    }
    if (!best || best.val <= 0.1) {
      // the commander moves last, once the line is settled, to stand behind it and out of reach
      const cu = commander(state, side);
      if (ctx.adjThreat && cu) {
        const ui = idxOf(state, cu), cur = cmdScore(ctx, cu, ui);
        let bi = ui, bv = cur;
        for (const [k, v] of reachable(state, cu, { occ: ctx.occ })) {
          if (!v.end || k === ui) continue;
          ctx.occ[ui] = null; ctx.occ[k] = cu;
          const sv = cmdScore(ctx, cu, k);
          ctx.occ[k] = null; ctx.occ[ui] = cu;
          if (sv > bv + 0.3) { bv = sv; bi = k; }
        }
        best = { kind: bi === ui ? 'hold' : 'move', unitId: cu.id, to: bi, val: bv - cur };
      } else best = aiSpend(state, ctx);
    }
    if (!best) return null;
    best.toCR = [best.to % W0, (best.to / W0) | 0];
    return best;
  }

  // Applies one AI decision. Returns a list of events for the UI to animate.
  function aiApply(state, act) {
    if (act.kind === 'callup') {
      const r = callup(state, act.to);
      return r ? [{ kind: 'callup', unitId: r.unitId, at: act.toCR }] : [];
    }
    const u = state.units.find(x => x.id === act.unitId);
    if (act.kind === 'hold') { u.mp = 0; return []; }
    if (act.kind === 'refit') {
      const r = refit(state, u);
      if (!r) u.mp = 0;
      return r ? [{ kind: 'refit', unitId: u.id, gain: r.gain, at: act.toCR }] : [];
    }
    const ev = [];
    const ui = idxOf(state, u);
    if (act.to !== ui) {
      const m = moveUnit(state, u, act.toCR[0], act.toCR[1]);
      if (m) ev.push({ kind: 'move', unitId: u.id, path: m.path });
      if (act.kind === 'move') u.mp = 0; // the AI moves each unit once
    }
    if (act.kind === 'attack') {
      const t = state.units.find(x => x.id === act.targetId);
      const r = attack(state, u, t);
      if (r) ev.push(Object.assign({ kind: 'attack' }, r));
      else u.mp = 0;
    }
    if (!ev.length) u.mp = 0;
    return ev;
  }

  function aiPlayTurn(state, limit) { // headless convenience
    let n = 0;
    const side = state.side;
    while (!state.over && state.side === side && n < (limit || 200)) {
      const a = aiNextAction(state);
      if (!a) break;
      aiApply(state, a);
      n++;
    }
    if (!state.over && state.side === side) endSideTurn(state);
    return n;
  }

  // ---------------------------------------------------------------- Persistence
  function serialize(state) { const o = Object.assign({}, state); delete o.lastEvents; return JSON.stringify(o); }
  function deserialize(json) {
    const s = JSON.parse(json);
    if (!s || s.v !== 2 || !SCENARIOS[s.scenarioId]) throw new Error('Unrecognised save');
    s.lastEvents = [];
    return s;
  }

  const api = {
    SCENARIOS, TERRAIN, UNIT_TYPES, ELEV_NAMES, neighbour, hexDist, buildMap, newGame, live, unitAt, occupancy,
    reachable, pathTo, moveUnit, undoMove, canMove, canFire, targetsFrom, fireRange, forecast, attack,
    endSideTurn, vp, strength, clock, idxOf, mapOf, scen, aiNextAction, aiApply, aiPlayTurn, serialize, deserialize,
    unitLabel, other, AIP, isCmd, commander, incomeOf, supplyHexes, refitBlock, refit, callupHexes, callup, CMD_BONUS, CMD_LOST,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
