// AI-vs-AI balance and robustness runs: node test/sim.js [games] [firstSeed]
const E = require('../src/engine.js');
const games = +process.argv[2] || 40;
const seed0 = +process.argv[3] || 1000;
const tally = { de: 0, fr: 0, draw: 0 };
const reasons = {};
let vpSum = 0;
const turnMs = [], ctrl = {};
const spend = { de: { refit: 0, callup: 0, left: 0 }, fr: { refit: 0, callup: 0, left: 0 } };
const cmdLost = { de: 0, fr: 0 };
const sc = E.SCENARIOS.woerth;
for (let g = 0; g < games; g++) {
  const s = E.newGame('woerth', { de: 'ai', fr: 'ai' }, seed0 + g);
  let guard = 0;
  while (!s.over && guard++ < 100) {
    const t0 = Date.now();
    E.aiPlayTurn(s);
    turnMs.push(Date.now() - t0);
  }
  if (!s.over) throw new Error('game did not end');
  tally[s.over.winner]++;
  reasons[s.over.reason] = (reasons[s.over.reason] || 0) + 1;
  const v = E.vp(s);
  vpSum += v.de;
  sc.objectives.forEach((o, i) => { if (o.vp) ctrl[o.name] = (ctrl[o.name] || 0) + (s.control[i] === 'de' ? 1 : 0); });
  for (const side of ['de', 'fr']) {
    spend[side].refit += s.log.filter(l => l.side === side && / refits: /.test(l.text)).length;
    spend[side].callup += s.callups[side];
    spend[side].left += s.res[side];
    if (s.cmdLost[side]) cmdLost[side]++;
  }
  const de = E.strength(s, 'de'), fr = E.strength(s, 'fr');
  if (g < 6) console.log(`game ${g}: ${s.over.winner} (${s.over.reason}, turn ${s.over.turn}) VP de=${v.de} str de ${de.now}/${de.committed} fr ${fr.now}/${fr.committed} res de ${s.res.de} fr ${s.res.fr}`);
}
turnMs.sort((a, b) => a - b);
const per = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +(v / games).toFixed(2)]));
console.log('result', tally, reasons, 'avg German VP', (vpSum / games).toFixed(2));
console.log('German capture rate', per(ctrl));
console.log('per game: refits/call-ups/unspent', { de: per(spend.de), fr: per(spend.fr) }, 'commanders lost', cmdLost);
console.log('AI side-turn ms: median', turnMs[turnMs.length >> 1], 'p95', turnMs[Math.floor(turnMs.length * 0.95)], 'max', turnMs[turnMs.length - 1]);
