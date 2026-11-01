# HL Sedan

A turn-based hex wargame of the Franco-Prussian War, 1870–71, in the spirit of Blue Byte's *History Line 1914–1918*. It runs in a phone browser and is designed first for the iPhone 17 Pro, in portrait and landscape.

The first scenario is **Wörth (Froeschwiller), 6 August 1870**. You can command either side against the computer, or two players can share one phone.

## Playing

Open `dist/index.html` in a browser, or serve the repository with GitHub Pages and open that file. Everything is in one file, with no build step needed to play. Fonts load from Google Fonts; without a connection the page falls back to Didot and Avenir Next Condensed on iOS.

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

The units are deliberately asymmetric. The Chassepot fires two hexes and the Dreyse one; Krupp guns outrange the French muzzle-loaders; mitrailleuses are deadly to infantry and weak against guns; cuirassiers fight at half effect when charging into woods, villages or vineyards. Guns may move or fire in a turn, not both.

### Balance

Measured with `node test/sim.js 80` (computer against computer): Germans 49%, French 41%, indecisive 10%. A human will usually beat the computer from either side; difficulty levels are a planned lever.

### Historical basis and limits

The geography and the roles of the corps follow period and reference accounts, including the 1911 *Encyclopædia Britannica* article on Wörth and Émile Ollivier's *La Guerre de 1870*. The map is schematic rather than surveyed. Brigade designations follow standard Prussian and Bavarian numbering but have not been checked unit by unit against an order of battle, and strengths are game values, not headcounts.

## Project layout

```
src/engine.js   rules, scenario data and computer opponent (no DOM; runs in Node)
src/ui.js       map rendering, touch input, cards, overlays, AI playback
src/index.html  page template, styles and markup; build.py inlines the scripts
build.py        writes dist/woerth.html (claude.ai artifact body) and dist/index.html (standalone)
test/           headless simulations and browser checks
```

Scenarios are self-contained data in `SCENARIOS` in `src/engine.js`: terrain and elevation as strings (one character per hex, odd rows offset to the right), roads and the river as hex paths, objectives, units with optional arrival turns, briefing and historical note. A new battle should need only a new entry there. A campaign layer would then be a sequence of scenarios with unit strength carried between them.

## Development

```sh
python3 build.py              # rebuild dist/ after editing src/
node test/sim.js 80           # computer-v-computer balance runs
node test/trace.js 3          # print the computer's decisions for the first turns
node test/dmg.js 20           # damage dealt and taken by unit type
pip install playwright && playwright install chromium
python3 test/shots.py shots   # iPhone-size screenshots, portrait and landscape
python3 test/fullgame.py shots  # plays a whole game through the interface
```

Set `CHROME=/path/to/chrome` to make the browser checks use an installed Chrome instead of Playwright's Chromium.

## Ideas for later

- Further scenarios: Spicheren, Mars-la-Tour, Gravelotte–St Privat, Sedan
- Campaign layer with carried-over strength and experience
- Difficulty levels; fog of war; line of sight; leaders
