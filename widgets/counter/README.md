# Counter widget for iCUE (XENEON EDGE)

A simple tap counter. Tap the big number to add one (or your chosen step),
tap the small reset button in the corner to clear it back to zero.

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
| Step size | How much each tap adds (1 to 100). |
| Label | Optional short text shown above the number, for example "Pushups" or "Standups". |
| Confirm before reset | Ask "Reset to 0?" before clearing the count. Turn off to reset instantly. |
| Colors, Transparency | Used when Custom Style is on for the XENEON EDGE. |

The count is saved as you tap, so it survives restarting iCUE or the PC.

## Testing in a browser

Open `Counter/index.html` directly, tap the number to count up, use the
corner button to reset.

## Files

```
Counter/
  manifest.json      widget metadata
  index.html         settings (x-icue-property) and markup
  styles/main.css    layout and responsive tile sizes
  scripts/widget.js  counting logic, localStorage persistence
  translation.json   labels for the iCUE settings panel
  resources/         icon.svg
```

See the [main README](../../README.md) for the other widgets and how releases work.

Not affiliated with or endorsed by CORSAIR. [MIT license](../../LICENSE).
