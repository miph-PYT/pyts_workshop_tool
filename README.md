# Workshop timer

A live timer for running workshop schedules. Pick a workshop, run it block by block, rate how the room feels as you go, and get an energy curve at the end.

It's plain HTML, CSS and JavaScript: no build step, no server, no accounts, no AI. Open `index.html` or host the folder anywhere (GitHub Pages works out of the box).

## Using it

**Menu.** Every workshop you've made is listed here: **Open** (or **Resume**), **Edit**, **Duplicate**, and **Energy curves** once you have saved sessions. **New workshop** makes a new one.

**Editing a workshop.** Two ways:
- **Table**: set the start time, then add blocks with minutes, title and an optional note. Each block starts when the one before ends; ↑ ↓ reorder, ✕ removes. Put breaks in as their own blocks.
- **Paste text**: paste a schedule straight from a doc (time range, minutes, title, note, one per line). Switch back to **Table** to check what was found.

A title like `Small groups: discuss 20, harvest 15` gets sub-timers inside the block (the numbers have to add up to the block's minutes). You can also paste a schedule anywhere on the menu to start a new workshop from it.

**Two timing modes** (switch at the top of the timer):
- **Facilitator**: you start, pause and move on yourself. Space = start/pause, ← → = previous/next block, +1 min extends the current block.
- **Follow clock**: blocks advance with the time of day, and you can bend the plan live:
  - **Start now** / **Begin from now** moves the whole day to start when you actually begin.
  - **Move on now** (or →) ends this block and pulls everything after it forward or back.
  - **+5 / −5 min** stretches or shrinks this block; everything after shifts.
  - **Catch up** (shown when you're behind) trims the blocks still to come, each by at most half, to land closer to the planned end.
  - **Back to plan** undoes today's changes.

**Rating the room.** Tap 1–5 (Flat, Low, Steady, Warm, Alive), or press 1–5 on the keyboard, whenever you sense the vibe. Add a quick note if you like.

**Energy curve.** Shows the curve over the blocks with start times, what lit up (4–5), what fell flat (1–2), planned vs actual minutes, and **Copy summary** for pasting into notes. **Save to history & start fresh** keeps the session for comparing later. A session is also saved automatically when you reset, or when you open a workshop on a new day.

**Editing afterwards and post-mortems.** Every session stays editable: change ratings, notes, actual minutes and the date at any time, and fill in the reflection (What worked? / What would I change? / Notes for next time). **Post-mortem** (on the workshop card, or **+ Post-mortem** in the energy curve) logs a workshop afterwards without having run the timer: pick the date, rate each block, note the minutes and reflect. A post-mortem left completely empty is removed when you close it.

## Your data

Everything is stored in the browser's local storage, **on that device only**. Your workshops don't follow you to your phone, another computer or another browser, and clearing browser data or using a private window loses them. The menu page explains this to visitors in a "Saved on this device only" box.

To move workshops: tap **Back up** (downloads a `.json` file), send the file to yourself, then tap **Restore from file** on the other device. Restoring adds the backup's workshops, updates any that are already there, and removes nothing else.

## Putting it online with GitHub Pages

1. On GitHub, open the repository → **Settings** → **Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. The site lives at **https://timer.parts-work.dk** (set in the `CNAME` file).

The domain needs one DNS record at one.com: a **CNAME** record with host `timer` pointing to `miph-pyt.github.io`. Once GitHub has checked it, tick **Enforce HTTPS** on the Pages settings page. To use a different address, change the `CNAME` file and the DNS record to match.

## Changing things

| File | What's in it |
| --- | --- |
| `index.html` | The page shell |
| `app.js` | All the behaviour. Settings at the top: `SITE` (your website link), `FEEDBACK_EMAIL` (where feedback goes), `CHIME`, `DEFAULT_MODE`, the energy labels and colours (`LV`), and the example workshop (`SEED`) |
| `app.css` | Styles specific to this app |
| `theme.css` | Colours, fonts and component styles, matched to parts-work.dk. Change the colours at the top of this file |
| `favicon.svg` | The tab icon (same as parts-work.dk) |
| `vendor/htm-preact.js` | Preact + htm (MIT licence), included so the app needs no internet or build tools |
| `google-sheets/` | The earlier Google Sheets version of the timer |

To try changes locally, run a small web server in the folder (opening `index.html` directly may not load the scripts in some browsers):

```
python3 -m http.server 8000
```

Then open http://localhost:8000.
