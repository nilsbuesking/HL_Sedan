const E = require('../src/engine.js');
const s = E.newGame('woerth', { de: 'ai', fr: 'ai' }, 1000);
const maxT = +process.argv[2] || 4;
while (!s.over && s.turn <= maxT) {
  const side = s.side; let n = 0;
  console.log(`--- turn ${s.turn} ${side}`);
  while (s.side === side && !s.over) {
    const a = E.aiNextAction(s);
    if (!a) break;
    const u = s.units.find(x => x.id === a.unitId);
    const from = [u.c, u.r];
    E.aiApply(s, a);
    const t = a.targetId ? s.units.find(x => x.id === a.targetId) : null;
    console.log(`${a.kind} ${u.short} ${from}->${a.toCR} val ${a.val.toFixed(2)} ${t ? 'vs ' + t.short + ' str now ' + t.str + ' / me ' + u.str : ''}`);
    if (++n > 60) break;
  }
  E.endSideTurn(s);
}
console.log(s.log.slice(-5).map(l=>l.text).join('\n'));
