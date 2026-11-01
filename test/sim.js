// AI-vs-AI balance and robustness runs: node test/sim.js [games]
const E = require('../src/engine.js');
const games = +process.argv[2] || 40;
const tally = { de: 0, fr: 0, draw: 0 };
const reasons = {};
let vpSum = 0, turnMs = [], ctrl = {};
const sc = E.SCENARIOS.woerth;
for (let g = 0; g < games; g++) {
  const s = E.newGame('woerth', { de: 'ai', fr: 'ai' }, 1000 + g);
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
  sc.objectives.forEach((o, i) => { ctrl[o.name] = (ctrl[o.name] || 0) + (s.control[i] === 'de' ? 1 : 0); });
  const de = E.strength(s, 'de'), fr = E.strength(s, 'fr');
  if (g < 6) console.log(`game ${g}: ${s.over.winner} (${s.over.reason}, turn ${s.over.turn}) VP de=${v.de} str de ${de.now}/${de.committed} fr ${fr.now}/${fr.committed}`);
}
turnMs.sort((a, b) => a - b);
console.log('result', tally, reasons, 'avg German VP', (vpSum / games).toFixed(2));
console.log('German capture rate', Object.fromEntries(Object.entries(ctrl).map(([k, v]) => [k, (v / games).toFixed(2)])));
console.log('AI side-turn ms: median', turnMs[turnMs.length >> 1], 'p95', turnMs[Math.floor(turnMs.length * 0.95)], 'max', turnMs[turnMs.length - 1]);
