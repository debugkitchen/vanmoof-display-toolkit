# SX3 Display — Web Editor

A single-page, offline-capable image/animation editor for the SX3 20×9
display. Open [`index.html`](index.html) directly in a browser (Chrome,
Edge or Opera recommended — see [BLE](#send-via-ble) below) — no build step,
no server, no dependencies.

It draws, imports, and exports the exact binary container format the
display firmware uses, described in the main [guide](../guide/README.md#4-the-image-and-animation-format).
Pair it with [`arduino/sx3_display_ble_receiver`](../arduino/sx3_display_ble_receiver)
to push what you draw straight to a real panel over Bluetooth — see
[How the editor and the BLE sketch fit together](#how-the-editor-and-the-ble-sketch-fit-together).

## Editing

- **Grid**: click a cell to paint it with the active brightness (click again
  to toggle off), right-click to clear, drag to paint multiple cells.
  Physically-absent corner LEDs are shown dashed — you can still draw on
  them, they just won't light on real hardware.
- **Brightness palette**: 8 levels (0–7, off to full), or press `0`–`7`.
- **Tools**: clear frame, fill frame, invert, shift (↑↓←→), flip horizontal/vertical,
  copy/paste frame.
- **Onion skin**: show the previous frame ghosted behind the current one,
  for easier animation drawing.
- **Live preview**: a glowing mini-panel next to the edit grid shows exactly
  what the current frame looks like.
- **Image bounds**: shows the used pixel bounds; export auto-fits `start_row`
  / `graphic_rows` to them.

## Frames & animation

- Add / duplicate / delete frames; reorder with ↑ / ↓, or reverse the whole
  sequence.
- Per-frame duration (ms), with **All** (apply to every frame) or
  **Selected** (apply to checked frames) — checkboxes support click,
  shift-click range select, an explicit from–to **Range** box, and
  **Select all** / **Clear**.
- **Play / pause** to preview the animation in the editor.

## Import

- **Import… (hex/bin)**: paste hex bytes in almost any format (spaces,
  commas, newlines, with or without `0x`), or load a `.hex`/`.bin` file.
  Parses the container header and drops the frames straight into the editor.
- **PNG/GIF…**: import a PNG, JPEG or animated GIF (the GIF decoder is
  built in, no library). Options: fit mode (contain/cover/stretch),
  brightness threshold, Floyd–Steinberg dithering, and inversion. Live
  per-frame preview before committing; replace the current frame, add as a
  new frame, or replace the whole project with all decoded frames.
- **Drag & drop**: drop a `.hex`, `.bin`, PNG, JPEG or GIF anywhere on the
  page.

## Export

Export… opens a dialog with three views of the current project, all backed
by the same container bytes:

- **Hex bytes** — copy, or download as `.bin`.
- **C array (PROGMEM)** — copy, with an editable array name; matches the
  format used by `arduino/sx3_display_gallery/sx3_images_all.h`.
- **Project JSON** — the full editor state (frames + durations), for
  re-importing later or backing up between devices. Copy or download.

## Generators

- **Text…** — turn a string into a scrolling animation. Two bitmap fonts
  (5×7, 3×5) and three scroll modes: upright bottom-to-top (letters stacked,
  reads straight off the panel), upright left-to-right ticker, and a
  rotated long-axis ticker (read with the panel turned 90°, roomier since it
  uses the full 20-row length). Replace the project or append to it.
- **Number…** — render a 0–99 number the way the original firmware's
  `Display_UpperNumber` does (tens digit left, ones digit right, blank
  column between), with position and brightness controls.
- **Battery…** — draw the firmware's battery gauge: the rounded-rectangle
  frame plus 0–21 proportionally-filled interior dots, computed from a
  state-of-charge percentage with the same formula the firmware uses
  (`CalculateBatteryDots`). Separate brightness controls for the fill, the
  normal frame, and the "charging from power bank" bright frame.
- **Gallery…** — browse and load the 54 original VanMoof firmware images
  (see [`gallery/`](gallery)). Click a thumbnail to preview, then **Replace**
  or **Append**; double-click to replace immediately; tick "keep gallery
  open" to import several in a row.

## Send via BLE

**Send via BLE…** pushes the current animation to a real display running the
[`sx3_display_ble_receiver`](../arduino/sx3_display_ble_receiver) sketch,
over Web Bluetooth. Connect, watch the byte count and a progress bar, send.

Web Bluetooth only works in **Chrome, Edge or Opera** (desktop or Android).
It does not work in Safari, Firefox, or any browser on iOS/iPadOS (iPad
users: the **Bluefy** app is a workaround). The dialog detects lack of
support and disables itself with a warning instead of failing silently.

## Persistence

The current project auto-saves to browser LocalStorage, so a reload or an
accidental tab close doesn't lose your work. There's no cloud sync — use
Export → Project JSON to back up or move a project between devices/browsers.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `0`–`7` | Set active brightness |
| `←` / `→` | Previous / next frame |
| `Space` | Play / pause |
| `Ctrl/⌘ D` | Duplicate frame |
| `Delete` | Clear frame (`Shift+Delete` deletes the frame) |
| `Ctrl/⌘ C` / `Ctrl/⌘ V` | Copy / paste frame |

(Also shown in-app under the **?** button.)

## How the editor and the BLE sketch fit together

The editor and the `sx3_display_ble_receiver` sketch are two halves of one
workflow, but neither depends on the other being open continuously:

1. Flash `sx3_display_ble_receiver` once. It advertises as **SX3 Display**
   and shows three dim dots while idle, waiting for a connection.
2. Open the editor, draw or import something, hit **Send via BLE…** →
   **Connect…** → **Send animation**. The image transfers and starts playing
   immediately.
3. You can close the editor tab at that point — the display keeps showing
   whatever it received; it doesn't need an active connection to keep
   playing. Image data lives in the receiver's RAM, so a power-cycle blanks
   it until the next send.
4. To drive the display *without* the editor at all (e.g. a fixed rotation
   of images with no wireless control), flash `sx3_display_gallery`,
   `sx3_display_animation`, or `sx3_display_text_scroller` instead — those
   sketches embed their own image data and need no BLE, no editor, no phone
   or laptop nearby.

## Files

| Path | Purpose |
|---|---|
| [`index.html`](index.html) | The app shell (layout, styles, modals) |
| [`editor.js`](editor.js) | All editor logic — drawing, import/export, generators, BLE, GIF decoding |
| [`gallery/`](gallery/README.md) | The 54-image firmware gallery data + naming tool — see that folder's own README |

No build step and no external network requests — `index.html` loads
`gallery/firmware_gallery.js` and `editor.js` as plain `<script>` tags, so
the whole folder works straight from `file://` with no server.
