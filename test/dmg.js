const E = require('../src/engine.js');
const by = {}; let games = +process.argv[2] || 20, res = {de:0,fr:0,draw:0};
for (let g = 0; g < games; g++) {
  const s = E.newGame('woerth', { de: 'ai', fr: 'ai' }, 500 + g);
  while (!s.over) {
    const side = s.side;
    let n = 0;
    while (s.side === side && !s.over && n++ < 200) {
      const a = E.aiNextAction(s); if (!a) break;
      const u = s.units.find(x => x.id === a.unitId);
      const ev = E.aiApply(s, a);
      for (const e of ev) if (e.kind === 'attack') {
        const t = s.units.find(x => x.id === e.targetId);
        const k = side + ':' + u.type; by[k] = by[k] || { dealt: 0, taken: 0, n: 0 }; by[k].dealt += e.dmg; by[k].taken += e.back; by[k].n++;
        const k2 = t.side + ':' + t.type + '(def)'; by[k2] = by[k2] || { dealt: 0, taken: 0, n: 0 }; by[k2].dealt += e.back; by[k2].taken += e.dmg; by[k2].n++;
      }
    }
    if (!s.over && s.side === side) E.endSideTurn(s);
  }
  res[s.over.winner]++;
}
console.log(res);
for (const [k, v] of Object.entries(by).sort()) console.log(k.padEnd(22), 'actions', String(v.n).padStart(4), 'dealt', String(v.dealt).padStart(5), 'taken', String(v.taken).padStart(5), 'per action', (v.dealt / v.n).toFixed(2));
