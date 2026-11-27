# ArcheAge Classic Skill & Damage Simulator

HTML + vanilla JavaScript (ES Modules) damage, gear, and build economy simulator for ArcheAge Classic.

Open it now in your browser at [the github page.](https://plushie-aa.github.io/aac-skill-sim/)

## Local Install Quick Start

Run the bundled Python dev server from the repo root (enables saving builds/combos/buff presets/economy prices to disk, direct DaruGear URL fetching, AA Classic Buff ID importing, and live DaruGear resync):

```powershell
python tools/serve.py --host 127.0.0.1 --port 8765
```

*(Any static server such as `python -m http.server 8765 --bind 127.0.0.1` or GitHub Pages also works — server-only controls are automatically disabled, and edits persist in `localStorage`.)*

Then open:
- **Simulator:** `http://127.0.0.1:8765/index.html`
- **Engine Unit Tests:** `http://127.0.0.1:8765/tests/run-tests.html` (`62 / 62` tests)

## Sharing Comparisons & Shortcuts

- **Comparison Permalinks:** Click **`🔗 Share Link`** in the top bar to copy a URL hash encoding Build A, Build B, Target/Defender (by DaruGear share code or saved ID), active tab, selected skill, active buffs, and combat flags.
- **Economy (Build Cost) Tab:** Estimates total gold cost per build across equipped gear tiers/grades, socketed lunagems, and lunafrosts with inline price overrides, exportable/importable JSON price books, and optional opt-in Auction House price scraping from `sermeatball.com`.
- **Keyboard Shortcuts & Quick Reset:** Press `/` to focus Skill Search, `Esc` to close any modal, and click **`↺ Reset`** on any modified Character Card to revert in-memory tweaks back to its saved baseline.

## Importing Builds from DaruGear

Click **Import** on any Character Card and either:
1. Paste a **DaruGear share URL** (`https://darugear.com/?s=...`) or share code and click **Fetch URL**
2. Load or paste a previously exported simulator `.json` file, or
3. Use the optional **Export from DaruGear** bookmarklet inside **`⚙ Settings → Sync & Backup`**.

## Updating After an AA Classic Patch

### Gear Catalog, Skills & Saved Builds
Open **`⚙ Settings → Sync & Backup`** and click **Resync All from DaruGear** (or update Gear Catalog, Skills, or Saved Builds individually).

### Live In-Game Skill Tooltip Dumps
1. Copy `addon/skill_dumper/` (both `main.lua` and `lib/michael_client.lua`) into `Documents\AAClassic\Addon\skill_dumper\` and register `skill_dumper` in `addons.txt`.
2. Open it via the in-game **Addon Settings** button or **ESC → Addon Options → Skill Dumper** and follow the on-screen dump guide.
3. Re-run the parser:
   ```powershell
   python tools/parse_dumps.py
   ```

## Project Layout

- `js/engine/` — Pure simulation engine (`constants.js`, `stats.js`, `skills.js`, `damage.js`, `healing.js`, `effective.js`, `combos.js`, `rotation.js`, `compare.js`, `gearswap.js`, `gearbuilder.js`, `skillbuilder.js`, `economy.js`, `index.js`).
- `js/adapters/` — DaruGear API stat calculator (`darugear_calc.js`), URL/bookmarklet/JSON importer (`darugear.js`).
- `js/data/` — AA Classic 1.3.6 / 3.5 Lv 55 skillsets (`skills/*.json`), Skill Builder & ancestral data (`skill_builder_data.json`), and 20-slot Gear Catalog (`gear_catalog/*.json`).
- `js/ui/` — Modular UI views (`app.js`, `state.js`, `buildStore.js`, `characterCards.js`, `skillBrowser.js`, `permalink.js`, `skillsView.js`, `defenderView.js`, `rotationView.js`, `sweepView.js`, `matrixView.js`, `gearBuilderView.js`, `skillBuilderView.js`, `economyView.js`, `modals.js`, `settingsModal.js`).
- `example-builds/` — Tracked anonymized archetype starter builds (`Darkrunner`, `Spellsinger`, `Ebonsong`, `Cleric`, `Skullknight`) deployed to GitHub Pages and used as defaults on fresh clones.
- `builds/` (gitignored), `buffs/`, `combos/`, `economy/` — Local JSON persistence (with automatic browser `localStorage` backup) for personal saved builds, custom buffs & buff loadouts, saved rotations, and economy price books / AH snapshots.
- `addon/skill_dumper/` — In-game ArcheAge Classic Lua skill dumper addon (with Michael Client support).
- `tools/` — Local API dev server (`serve.py`), DaruGear scraper/sync (`darugear_sync.py`), Auction House price scraper (`economy_sync.py`), gear catalog builder (`build_gear_catalog.py`), AA Classic buff importer (`import_buff.py`), metadata fetcher (`fetch_aaclassic_meta.py`), metadata/rank applier (`apply_metadata_and_ranks.py`), and dump parser (`parse_dumps.py`).
- `tests/` — Browser ES Module test suite (`run-tests.html`, `engine.test.js` — `62 / 62` tests).
- `.github/workflows/pages.yml` — Automated GitHub Pages static deployment workflow.

## License

Made by Plushie. Heavy LLM assistance was used here at the request of a client, I promise I don't normally vibe code stuff 🥺. Licensed under the [MIT License](LICENSE).
