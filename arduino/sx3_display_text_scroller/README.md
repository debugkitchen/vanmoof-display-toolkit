# SX3 Display — Text Scroller

Scrolls text vertically on the SX3 display used in **portrait** orientation
(20 LEDs tall, 9 LEDs wide) — letters appear at the bottom, slide up, and
exit at the top, readable at the angle a cyclist sees the top-tube display.
Ships with two bitmap fonts (5×7 and a more compact 3×5) and helpers for
scrolling, centring, and scroll-in-then-hold.

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

1. Open `sx3_display_text_scroller.ino` in the Arduino IDE — it needs
   `sx3_font5x7.h` and `sx3_font3x5.h` in the same sketch folder (they're
   already there).
2. Select an ESP32-C3 board (e.g. **ESP32C3 Super Mini** / ESP32-C3 Dev Module).
3. **Tools → USB CDC On Boot → Enabled**.
4. Upload, then optionally open the Serial Monitor at 115200 baud to see
   what's currently scrolling.

## Using it in your own sketch

The building blocks are plain functions, not a class:

- `scrollText(font, text, speed_ms, brightness)` — scroll fully across and off.
- `showTextCentred(font, text, brightness, hold_ms)` — draw centred, hold.
- `scrollInThenHold(font, text, speed_ms, brightness, hold_ms)` — scroll in, then hold.

Pass `FONT_5X7` or `FONT_3X5` as the `font` argument. The default `loop()`
cycles through a demo of all three with both fonts — replace its body with
whatever you want shown (a clock, a status message, live sensor readout).
