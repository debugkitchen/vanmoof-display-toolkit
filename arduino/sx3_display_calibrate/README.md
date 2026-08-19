# SX3 Display — Raw Offset Calibration

Lights exactly one framebuffer byte at a time (no row/col math, no LUT — a
raw `0xFF` at a single offset) so you can watch the panel and note down which
physical LED lights for each `(side, offset)` pair. Useful if you're
verifying the buffer↔pixel mapping on your own panel, or adapting this
toolkit to a different display revision where the mapping might differ.

This is how the `offset = (4 - col) * 30 + row` / `(9 - col) * 30 + row`
formulas in the [guide](../../guide/README.md#3-driving-the-display) were
originally derived and cross-checked.

## Wiring

| Signal | ESP32-C3 GPIO |
|--------|---------------|
| SDA    | GPIO4         |
| SCL    | GPIO3         |
| SDB    | GPIO2         |
| 5V     | 5V            |
| 3V3    | 3V3           |
| GND    | GND           |

Same wiring as every other sketch in `arduino/` — see the
[guide](../../guide/README.md#2-the-connector-and-how-to-wire-it-up) for the
full connector pinout.

## Flashing

1. Open `sx3_display_calibrate.ino` in the Arduino IDE.
2. Select an ESP32-C3 board (e.g. **ESP32C3 Super Mini** / ESP32-C3 Dev Module).
3. **Tools → USB CDC On Boot → Enabled**.
4. Upload, then open the Serial Monitor at 115200 baud.

## What it does

Every 100 ms it advances to the next offset (0–149) within the current
buffer (LEFT first, then RIGHT), lighting exactly one LED at full brightness
and printing `SIDE  offset=NNN (0xNN)` to serial. Watch the panel, note which
physical position lights for each printed offset. A full sweep of both
buffers takes 150 × 2 × 100 ms ≈ 30 s and then repeats forever.
