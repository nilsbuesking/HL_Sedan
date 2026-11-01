# HL Sedan

A turn-based hex wargame of the Franco-Prussian War, 1870–71, in the spirit of Blue Byte's *History Line 1914–1918*. It runs in a phone browser and is designed first for the iPhone 17 Pro, in portrait and landscape.

The first scenario is **Wörth (Froeschwiller), 6 August 1870**. You can command either side against the computer, or two players can share one phone.

## Playing

Open `dist/index.html` in a browser, or serve the repository with GitHub Pages and open that file. Everything is in one file, with no build step needed to play. Fonts load from Google Fonts; without a connection the page falls back to Didot and Avenir Next Condensed on iOS.

- Choosing a side opens a short introduction: the road to war, Wissembourg, the two commanders and the morning of 6 August, then your orders. *Skip to your orders* jumps to the end, and *The situation* in the menu shows it again.
- Tap one of your units to select it. Outlined pale hexes show where it can move; white rings mark enemies it can fire on.
- Tap a ringed enemy to see the combat forecast, then tap it again or press **Fire**.
- **Next unit** cycles through units that have not acted; **Undo move** takes back the last move if the unit has not fired.
- Drag to pan and pinch to zoom, including while the computer is moving.
- The game saves to the browser after every action and offers to continue on the opening screen.

The full rules, with unit and terrain tables, are under *How to play* in the game.

## The Wörth scenario

| | |
|---|---|
| Map | 16 × 18 hexes, about 600 m per hex: Reichshoffen to Preuschdorf, Langensoultzbach to Morsbronn |
| Time | 14 turns of 45 minutes, 08:00 to nightfall |
| French | MacMahon's I Corps with Conseil-Dumesnil's division of VII Corps, on the Froeschwiller–Elsasshausen ridge; Guyot de Lespart's division arrives late |
| German | V Corps in the centre, II Bavarian Corps from the north, XI Corps via Gunstett; further Bavarian and Württemberg troops arrive during the day |
| Victory | Froeschwiller 4 VP, Elsasshausen 2, Wörth 1, Morsbronn 1, Niederwald 1. At nightfall the Germans win with 6 or more, the French with 3 or fewer; otherwise indecisive. A side reduced to 30% of its committed strength collapses at once. |

### Commanders

Maréchal de MacMahon is on the field from the start, north of Froeschwiller. Crown Prince Friedrich Wilhelm, who had ordered that no battle be fought that day, arrives at 13:15 (turn 8) by the Sulz road. A commander does not fire and cannot take places. Units next to him fire ×1.1. Only a unit next to him can attack him. If he falls, his whole army fires ×0.95 for the rest of the day.

### Places and reserves

All eleven villages and the Niederwald can be held; a flag shows the holder. At the start of its turn a side draws reserves from what it holds: Froeschwiller 2, every other place 1. Reserves buy two things:

- **Refit** (4): a worn unit in or next to a village you hold, with no enemy next to it and not fired on since your last turn, regains up to 3 strength. It must not have fired, and it can do nothing else that turn.
- **Call up** (10): tap an empty village you hold, away from the enemy, to form a composite battalion of strength 5 that can act from your next turn. The Germans may do this five times, the French twice.

Taking a village therefore costs the enemy income and a place to refit, as well as giving it to you.

### The Sauer

The Wörth bridge was down on 6 August and infantry waded the river breast-deep (Moltke). In the game infantry can wade it, which takes their whole move and leaves them exposed in the water. Cavalry and guns cross only at the Wörth and Gunstett bridges and the ford at Spachbach.

### Units

The units are deliberately asymmetric. The Chassepot fires two hexes and the Dreyse one; Krupp guns outrange the French muzzle-loaders; mitrailleuses are deadly to infantry and weak against guns; cuirassiers fight at half effect when charging into woods, villages or vineyards. Guns may move or fire in a turn, not both.

### Balance

Measured with `node test/sim.js 40 1000` and `node test/sim.js 40 1040` (80 games, computer against computer): Germans 47.5%, French 42.5%, indecisive 10%. Each commander falls in about one game in eight, usually when his line has already broken. The computer refits a worn unit 2 (German) to 6 (French) times a game and uses all its call-ups, but leaves 25–50 reserves unspent, so reserve costs are a balance lever still to be tuned. A human will usually beat the computer from either side; difficulty levels are a planned lever.

Two rules were set by measurement rather than history. Refits are barred to units under fire, because without that the French on the ridge refitted every turn and won 70% of games. The French get two call-ups to the Germans' five, which also reflects how few reserves MacMahon had.

### Historical basis and limits

The geography and the roles of the corps follow period and reference accounts, including the 1911 *Encyclopædia Britannica* article on Wörth, Émile Ollivier's *La Guerre de 1870* and Moltke's *The Franco-German War of 1870–71*. The introduction's account of the morning (the water party fired on near Gunstett, skirmishers wading into an empty Wörth at about 07:00, the Crown Prince's order not to bring on a battle, Kirchbach fighting on his own responsibility, the Crown Prince reaching the field at about 13:00) follows Moltke and the *Britannica*. Reserves and composite battalions are a game abstraction for stragglers, detachments and ammunition columns, not a historical mechanism. The map is schematic rather than surveyed. Brigade designations follow standard Prussian and Bavarian numbering but have not been checked unit by unit against an order of battle, and strengths are game values, not headcounts.

## Project layout

```
src/engine.js   rules, scenario data and computer opponent (no DOM; runs in Node)
src/ui.js       map rendering, touch input, cards, overlays, AI playback
src/index.html  page template, styles and markup; build.py inlines the scripts
build.py        writes dist/woerth.html (claude.ai artifact body) and dist/index.html (standalone)
test/           headless simulations and browser checks
```

Scenarios are self-contained data in `SCENARIOS` in `src/engine.js`: terrain and elevation as strings (one character per hex, odd rows offset to the right), roads and the river as hex paths, holdable places (`objectives`, each with victory points and reserve income), reserve costs and call-up units, units with optional arrival turns (commanders are units of type `cmd`), briefing and historical note. The introduction pages and orders are in `src/ui.js`. A new battle should need only a new entry there. A campaign layer would then be a sequence of scenarios with unit strength carried between them.

## Development

```sh
python3 build.py              # rebuild dist/ after editing src/
node test/sim.js 80 1000      # computer-v-computer balance runs: games, first seed
node test/trace.js 3          # print the computer's decisions for the first turns
node test/dmg.js 20           # damage dealt and taken by unit type
pip install playwright && playwright install chromium
python3 test/shots.py shots   # iPhone-size screenshots, portrait and landscape
python3 test/fullgame.py shots  # plays a whole game through the interface
```

Set `CHROME=/path/to/chrome` to make the browser checks use an installed Chrome instead of Playwright's Chromium.

## Ideas for later

- Further scenarios: Spicheren, Mars-la-Tour, Gravelotte–St Privat, Sedan
- Campaign layer with carried-over strength, experience and reserves
- Difficulty levels; fog of war; line of sight; subordinate leaders (corps commanders such as Kirchbach and Bose)
