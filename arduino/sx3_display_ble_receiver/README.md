# SX3 BLE Receiver

Receives images and animations over Bluetooth Low Energy and plays them on
the SX3 display. The companion sender is the web editor's **Send via BLE…**
button.

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

## What you need

- ESP32-C3 wired to the display as above
- Arduino IDE with ESP32 board package installed (provides the BLE library)
- A computer or Android phone with Chrome / Edge / Opera

## Upload and run

1. Open `sx3_display_ble_receiver.ino` in Arduino IDE
2. Select the right board (e.g. **ESP32C3 Super Mini** / ESP32-C3 Dev Module)
3. **Tools → USB CDC On Boot → Enabled**
4. Upload
5. After boot, the display shows three dim dots in its middle row — that's the
   "ready, waiting for a connection" indicator
6. Open the web editor in Chrome, click **Send via BLE…** → **Connect…** →
   pick **SX3 Display** → **Send animation**

## Browser support

Web Bluetooth works in Chrome, Edge and Opera on desktop and Android. It does
**not** work in:
- any browser on iOS/iPadOS (Apple disables the API in all WebKit-based
  browsers, which means all browsers on iOS regardless of brand)
- Safari and Firefox on any platform

iPad users can install **Bluefy** from the App Store as a workaround.

## Protocol

The sender writes opcoded packets to the RX characteristic and waits for
ACK notifications on the TX characteristic between chunks. See the top of
`sx3_display_ble_receiver.ino` for the exact byte layout. Image bytes are the
same container format as the [editor](../../editor/README.md)'s export and
the `sx3_display_gallery` sketch — see the
[guide](../../guide/README.md#4-the-image-and-animation-format) for the full
format spec.

## Limits

- **Max image size**: 64 KB (`MAX_IMAGE_BYTES` in the sketch).
  A full 20-row × 30-frame animation is ~2.5 KB, so this is generous.
- **Throughput**: a few KB/s. A typical animation arrives in ~200-500 ms.
- **Range**: ~5-10 m line of sight.
- **Persistence**: image stays in RAM. Power-cycle = blank display until
  the next send. (Adding flash storage is a small extension; see roadmap.)
