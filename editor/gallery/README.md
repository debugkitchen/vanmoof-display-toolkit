# SX3 Firmware Gallery

54 images extracted from `mainware_1_9_3.bin`, address range
`0x08043050 .. 0x0804B88B`. Each image is in the same container format
the editor produces, so loading one is just a one-click operation.

## How it was built

1. Ghidra was used to identify all `display_content_*` pointer
   references in the firmware code section.
2. A walker started at `0x08043050` and parsed back-to-back container
   headers. The container layout (3 u32 header words + N duration words
   + N×rows pixel words) self-describes its size, so the walker
   discovered all 54 images including those that weren't directly
   referenced by pointers from code (they're accessed via indexed
   lookups instead).
3. **Names are the official VanMoof identifiers** recovered from the
   firmware, assigned with [`naming_tool.html`](naming_tool.html) (see
   below). Each entry has both a machine-readable `name` (snake_case
   identifier, e.g. `angry_skull`) and a human-readable `display` label
   (e.g. "Angry skull").

## Files

| File | Purpose |
|---|---|
| `firmware_gallery.json` | Raw JSON dump (human-readable, for tooling) |
| `firmware_gallery.js`   | Same data wrapped as a JS `const` for direct browser loading |
| `naming_tool.html`      | Standalone dev tool used to assign the `name`/`display` labels (see below) — not used by the editor itself |
| `README.md`             | This file |

The editor loads `firmware_gallery.js` via a `<script>` tag in
`index.html` — no fetch, no CORS, works from `file://`. The `.json` file
is not read by the editor at runtime; it exists as the plain-data source
for tooling — [`firmware-tools/extract_images.py`](../../firmware-tools/extract_images.py)
reads it to know which names/addresses to extract, and it's a convenient
format for any other script that wants the catalogue without parsing JS.

### `naming_tool.html`

A one-off authoring tool, not part of the end-user editor workflow: it
displays every extracted image next to an editable name/display-label
pair, tracks progress ("N / 54 named") with autosave to LocalStorage, and
exports the finished naming as JSON. That export is what was used to
regenerate `firmware_gallery.json` / `firmware_gallery.js` with the final,
correct names — you'd only reopen it if VanMoof ships a firmware update
with different/additional images to name.

## Entry format

Each entry has:

| Field | Meaning |
|---|---|
| `addr` | Firmware address the image was extracted from |
| `name` | Official snake_case identifier (e.g. `low_battery_two_digits`) |
| `display` | Human-readable label shown in the gallery UI (e.g. "Low battery (two digits)") |
| `description` | Technical note (frame count / type) |
| `start_row`, `graphic_rows`, `num_frames` | Container header values |
| `size` | Size in bytes |
| `hex` / `bytes_hex` | The raw container bytes as a hex string |

## What's in there

The 54 images cover the full lifecycle of the bike's display:

- **Animations**: startup, standby, idle pulse, locking/unlocking,
  the long finale animation
- **States**: charging, charge attempt, error, angry skull, hourglass
- **Battery**: low-battery variants (0–3 digits), battery frames,
  power-bank charge states
- **Find My**: pairing, enable, disable, turn-off
- **Settings glyphs**: light mode (auto/on/off), sounds on/off,
  region (EU/US/Japan/Offroad), alarm on/off, speed format (km/miles)
- **Bells**: Submarine, Ding Dong, Party Troot
- **Misc**: checkmark, failure, lock, reset, diagnostic scan, backup
  code digit prompts, level selector, temperature-below-zero

The complete index → name mapping lives in `firmware_gallery.json`. This
same set (with these exact names) is what
[`arduino/sx3_display_gallery`](../../arduino/sx3_display_gallery) plays
back on real hardware.
