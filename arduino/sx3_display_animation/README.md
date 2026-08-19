# SX3 Display — Minimal Animation

The smallest useful starting point: no BLE, no external data files, just the
init sequence and a smooth diagonal wave animated forever. This is the
reference implementation from the main [guide](../../guide/README.md)
(section 6) — read that first if anything here is unclear.

Good sketch to flash first, just to confirm your wiring and I²C init are
correct before moving on to the gallery or BLE receiver.

## Wiring

| Signal | ESP32-C3 GPIO |
|--------|---------------|
| SDA    | GPIO4         |
| SCL    | GPIO3         |
| SDB    | GPIO2         |
| 5V     | 5V            |
| 3V3    | 3V3           |
| GND    | GND           |

SDB is the controllers' hardware shutdown/enable line — pulsed low then high
at boot to guarantee a known state. See the [guide](../../guide/README.md#2-the-connector-and-how-to-wire-it-up)
for the full connector pinout and FFC-to-jumper adapter notes.

## Flashing

1. Open `sx3_display_animation.ino` in the Arduino IDE.
2. Select an ESP32-C3 board (e.g. **ESP32C3 Super Mini** / ESP32-C3 Dev Module).
3. **Tools → USB CDC On Boot → Enabled**.
4. Upload.

The panel should immediately show a travelling diagonal wave. No serial
output is used — if nothing lights up, double-check wiring and that 5 V is
actually present (the controllers answer I²C without it, but no LED lights).
