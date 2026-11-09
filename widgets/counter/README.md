# Counter widget for iCUE (XENEON EDGE)

A simple tap counter. Tap a number to add one (or your chosen step), tap
its small reset button to clear it back to zero. Set **Number of counters**
to track up to 4 independent things in the same widget (for example
Pushups, Squats, Water), each with its own label, value and reset button.

## Install

Download **`counter.icuewidget`** from the [latest release](../../../../releases/latest) (the Releases section on the repository's main page).

In iCUE: select the XENEON EDGE, open the widgets section, click **+** above
the widget list and pick the `.icuewidget` file.

To build it yourself, from the repository root:

```
npm install -g icuewidget-cli
icuewidget package widgets/counter/Counter -o dist/counter.icuewidget
```

## Settings

| Setting | What it does |
|---|---|
| Number of counters | 1 to 4. Adds more tappable counters side by side / in a 2x2 grid. |
| Step size | How much each tap adds (1 to 100), shared by all counters. |
| Confirm before reset | Ask "Reset to 0?" before clearing a counter. Turn off to reset instantly. |
| Counter 1-4 label | Optional short text shown above each counter, for example "Pushups" or "Squats". Only labels up to Number of counters are shown. |
| Colors, Transparency | Used when Custom Style is on for the XENEON EDGE. |

Each counter's value is saved as you tap, so it survives restarting iCUE
or the PC. Values are kept per counter slot (1-4), independent of each
other.

## Testing in a browser

Open `Counter/index.html` directly, tap a number to count up, use its
corner button to reset. To preview 2+ counters outside iCUE, open the
browser console and call:

```js
CounterWidget.apply({ counterCount: 2, label1: 'Pushups', label2: 'Squats' });
```

## Files

```
Counter/
  manifest.json      widget metadata
  index.html         settings (x-icue-property) and markup for up to 4 tiles
  styles/main.css    responsive grid layout for 1/2/3-4 counters
  scripts/widget.js  counting logic, localStorage persistence per counter
  translation.json   labels for the iCUE settings panel
  resources/         icon.svg
```

See the [main README](../../README.md) for the other widgets and how releases work.

Not affiliated with or endorsed by CORSAIR. [MIT license](../../LICENSE).
