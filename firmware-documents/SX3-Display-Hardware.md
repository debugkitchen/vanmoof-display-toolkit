# VanMoof SX3 Matrix Display — Hardware Documentation

This document describes the hardware-side of the VanMoof SX3 e-bike's matrix display: the LED controllers, the I²C protocol used to drive them, the initialization sequence, the frame transfer mechanism, and the mapping from physical LED positions to framebuffer offsets. It is based on reverse engineering of the original VanMoof SX3 firmware (`mainware_1_9_3.bin`). The complementary documents `SX3-Image-Protocol.md` (binary image format), `../guide/README.md` (practical reuse on a new MCU), and `SX3-Firmware-Function-Reference.md` (firmware function index) cover other aspects. This document also includes, as an appendix, the practical ESP32 bring-up pitfalls and quick-reference card from the earlier hardware notes (§14–15).

## 1. Display Overview

The SX3 display is a **20 × 9 LED matrix** with rounded corners (certain corner LEDs are physically absent). It is built around **two IS31FL3742A LED matrix driver ICs** (ISSI) which share a single I²C bus with the host MCU and an ambient-light sensor.

Viewed from the rider's perspective, a (slightly off-centre) vertical line splits the display into two halves, each driven by its own controller IC:

| Half | Controller IC | I²C address (7-bit) | Columns | LED column indices |
|---|---|---|---|---|
| **Left** | IS31FL3742A | `0x60` | 5 | 0–4 |
| **Right** | IS31FL3742A | `0x66` | 4 | 5–8 |

The asymmetric split (5 vs 4 columns) means the left controller drives the slightly larger half. The **BLE status indicator** at the top of the display lives in column 4 (one position left of the centre line) and is therefore on the left controller. The vertical line between the two halves runs between columns 4 and 5.

The display has rounded corners — six positions at the top (row 0, columns 0–2 and 6–8) and eight at the top/bottom edges (rows 1–2 and 18–19, columns 0 and 8) are not populated. Of the 20 × 9 = 180 grid positions, **166 LEDs are physically present**.

## 2. MCU and Pin Assignment

The host MCU is an **STM32F413VGT6** — an ARM Cortex-M4F in LQFP100 package with 1 MB flash and 320 KB SRAM. All peripheral base addresses observed in the firmware (RCC, GPIOA–D, I2C1, I2C3) match the STM32F4 reference manual, and the NVIC vector numbers used for I²C interrupts (31/32 for I2C1, 72/73 for I2C3) confirm this.

| Signal | STM32 pin | Pin number | Direction | Connected to |
|---|---|---|---|---|
| `I2C1_SCL` | PB6 | 92 | bidir (open-drain) | both LED controllers + ALS |
| `I2C1_SDA` | PB7 | 93 | bidir (open-drain) | both LED controllers + ALS |
| `LED_SDB` | PD15 | 62 | output | SDB pin of both LED controllers |
| `LED_INT` | PD14 | 61 | input | INT pin of both LED controllers (not used by firmware) |

A second bus, `I2C3` on PA8 (SCL) / PC9 (SDA) at 100 kHz, is used for unrelated peripherals and is **not** involved with the display.

Each IS31FL3742A on the display PCB has the following pin connections:

- **5 V** — LED supply (separate from logic 3V3)
- **GND**
- **SCL, SDA** — shared I²C1 bus
- **SDB** — software shutdown (active-low); a shared line driven by the MCU's PD15
- **INT** — open/short error indication; a shared line monitored by the MCU's PD14 (firmware does not read it — see §10.2)

## 3. I²C Bus Configuration

The display bus runs at **400 kHz (Fast Mode)**. This is initialised by the firmware function `I2C1_Initialize400kHz` at `0x0802eef0`, which fills a `I2C_HandleTypeDef`-style structure and calls the ST HAL `HAL_I2C_Init`. The clock-rate constant (`0x000186A0` = 400 000) is stored in the function's literal pool at `0x0802ef28`.

| Parameter | Value | Source |
|---|---|---|
| Bus | I2C1 (base `0x40005400`) | Verified pool constant |
| Clock | 400 000 Hz | Verified pool constant |
| Addressing | 7-bit | HAL configuration |
| Slaves | `0x60` (left), `0x66` (right), `0x10` (CM3232E ALS) | Verified by firmware code |

Note: the ST HAL convention passes the *8-bit write address* to `HAL_I2C_Master_Transmit`. So `0x60` (7-bit) is passed as `0xC0` (8-bit), `0x66` is passed as `0xCC`, and `0x10` (ALS) is passed as `0x20`. The firmware uses the 8-bit form throughout.

## 4. The IS31FL3742A Controller

Each LED controller is an **ISSI IS31FL3742A** — a 30×11 matrix driver with 8-bit PWM per LED, paged register access, and an open/short detection feature. The firmware uses three of its pages:

| Page | Register `0xFD` value | Purpose |
|---|---|---|
| 0 | `0x00` | PWM registers (one byte per LED, 0x00–0xFF) |
| 1 | `0x01` | LED scaling registers (not used by SX3 firmware) |
| 2 | `0x02` | Function registers (configuration, global current, reset) |

Two registers are used outside the page mechanism:

| Register | Name | Purpose |
|---|---|---|
| `0xFD` | Command Register | Selects the active page (0/1/2) |
| `0xFE` | Command Register Write Lock | Must be written with magic word `0xC5` to unlock `0xFD` |

The **write-lock** is a safety feature: any write to `0xFD` (or to any register on Page 2 / Function Page) must be immediately preceded by a write of `0xC5` to `0xFE`. The lock automatically re-engages after a single transaction.

### 4.1 Function Page Registers (Page 2)

The SX3 firmware writes the following function-page registers during initialisation:

| Register | Value | Meaning |
|---|---|---|
| `0x00` | `0x41` | Configuration: SSD = 1 (Normal Operation), B_EN = 1 (sync enabled) |
| `0x01` | `0x80` | Global Current Control (≈ half maximum current) |

The Global Current register (Page 2, `0x01`) is the **hardware brightness** knob, applied uniformly to all LEDs of the chip. The SX3 firmware updates it at runtime via `Display_SetGlobalBrightness` (see §7).

## 5. Display Initialisation Sequence

Initialisation is performed per-chip by `Display_InitController(i2c_addr)` at `0x0802f288`. It is called twice from `Display_Initialize` — once for `0x60`, once for `0x66` — with up to three retries each.

The sequence performs the following I²C writes:

| Step | Reg | Value | Description |
|---|---|---|---|
| 1 | `0xFE` | `0xC5` | Unlock command register |
| 2 | `0xFD` | `0x02` | Select Function Page |
| 3 | `0x00` | `0x41` | Configure: Normal Operation, Sync enabled |
| 4 | `0x01` | `0x80` | Global Current = 0x80 |
| 5 | `0xFE` | `0xC5` | Unlock (again — lock re-engaged) |
| 6 | `0xFD` | `0x00` | Select PWM Page |
| 7 | `0x00`, then 150 × `0xFF` | (block write) | Write 150 bytes of `0xFF` starting at PWM register `0x00` (all LEDs full brightness — this is overwritten almost immediately by the first rendered frame, so users will not actually see a full-bright flash) |
| 8 | `0xFE` | `0xC5` | Unlock |
| 9 | `0xFD` | `0x00` | Select PWM Page (kept selected for subsequent frame writes) |

After init, `0xFD` is left at `0x00` (PWM Page selected). The page is **not** changed during normal frame updates — the frame-push routine simply writes 150 bytes starting at register `0x00` of the current page.

## 6. Frame Transfer Protocol

### 6.1 Framebuffer Layout in MCU SRAM

The MCU keeps two **150-byte framebuffers** in SRAM, one per controller:

| Symbol | SRAM address | Maps to |
|---|---|---|
| `Display_LeftBuffer` | `0x200007E0` | Chip `0x60` (left, 5 columns) |
| `Display_RightBuffer` | `0x20000877` | Chip `0x66` (right, 4 columns) |

Each byte is the **8-bit PWM value (0–255)** for one position in the controller's PWM register space. Of the 150 register slots, only the positions corresponding to wired-up LEDs produce visible output — the remaining bytes are written but ignored by the controller because no LED is connected at those SW/CS positions. See §8 for the complete LED-to-offset mapping.

The byte at offset *N* in the framebuffer corresponds to the controller's PWM register *N*.

### 6.2 Push Sequence (per frame)

For every frame, **302 bytes** are written over I²C in two transactions:

1. **Transaction 1** — to address `0x60` (left controller):
   - 1 byte: register pointer `0x00`
   - 150 bytes: PWM values from `Display_LeftBuffer`
2. **Transaction 2** — to address `0x66` (right controller):
   - 1 byte: register pointer `0x00`
   - 150 bytes: PWM values from `Display_RightBuffer`

The MCU uses the IS31FL3742A's **register auto-increment**: a single I²C write transaction containing `[register_addr, value0, value1, ...]` writes consecutive registers starting at `register_addr`.

In the firmware, the framebuffers are stored with the leading `0x00` byte already in place — that's why the push state machine reads from `Display_LeftBuffer − 1` (`0x200007DF`) and sends 151 bytes. This avoids per-frame buffer copying.

### 6.3 Non-Blocking Push State Machine

The firmware does **not** push frames synchronously. Instead, `Display_I2CPushStateMachine` (`0x0802f8bc`) is called every main-loop tick and advances through five states:

```
              ┌─────────┐
       ┌─────▶│ State 0 │ Idle, frees timer slot
       │      │  Idle   │
       │      └────┬────┘
       │           │ Push trigger flag set
       │           ▼
       │      ┌─────────────┐
       │      │ State 1     │ I2C_Transmit(0x60, leftbuf, 151)
       │      │ Send left   │ → starts IRQ-driven transfer
       │      └──────┬──────┘ Clear i2c_done_flag, state := 2
       │             │
       │             ▼
       │      ┌─────────────┐
       │      │ State 2     │ Poll i2c_done_flag
       │      │ Wait left   │ ←── ISR sets flag on TX complete
       │      └──────┬──────┘ state := 3
       │             │
       │             ▼
       │      ┌─────────────┐
       │      │ State 3     │ I2C_Transmit(0x66, rightbuf, 151)
       │      │ Send right  │
       │      └──────┬──────┘ state := 4
       │             │
       │             ▼
       │      ┌─────────────┐
       └──────┤ State 4     │ Poll i2c_done_flag
              │ Wait right  │ → state := 0
              └─────────────┘
```

A non-zero `Display_PushSMState` indicates a frame transfer is in progress; the main loop must not modify the framebuffers during this time. The completion flag is set by the I²C peripheral's "transfer complete" interrupt handler.

### 6.4 Error Recovery

If the I²C transfer doesn't complete within a watchdog-timed window, the state machine falls into a recovery branch that:

1. Calls `I2C1_HandleError` — disables I²C1 (clears `CR1.PE`), de-initialises the peripheral
2. Re-runs `I2C1_Initialize400kHz` to bring the bus back up
3. Resets the push state machine to State 0

The recovery branch also toggles a few GPIO pins that are nominally associated with the *other* I²C bus (I2C3, on PA8/PC9) — this appears to be a vestigial code path, perhaps carried over from an earlier development board where pins were assigned differently, or a precautionary "wiggle everything I²C-related" routine. **For a clean ESP32 reimplementation it can be ignored**: a simple "on transfer error, deinit + reinit the I²C bus, then retry from state 0" strategy is sufficient.

## 7. Global Brightness Control

Beyond the per-pixel 8-bit PWM values written to each controller's PWM page, there is a **chip-wide hardware brightness** controlled by the Global Current Control register (Page 2, `0x01`). The firmware function `Display_SetGlobalBrightness(uint8_t value)` at `0x0802fe68` sets this register on both controllers, with caching (no write if the value is unchanged) and 3 retries per chip.

This is used at runtime to dim the display at night or in low-light conditions. The actual brightness value applied is not directly proportional to the ambient-light sensor reading — it is selected from a discrete set of values by higher-level state machines (main bike state machine, content controller).

Per-chip register-write sequence (called twice, once for `0x60`, once for `0x66`):

| Reg | Value | Purpose |
|---|---|---|
| `0xFE` | `0xC5` | Unlock |
| `0xFD` | `0x04` | Select function page (*see note below*) |
| `0x01` | *brightness* | Write Global Current |
| `0xFE` | `0xC5` | Unlock |
| `0xFD` | `0x00` | Return to PWM page |

> **Note on page 4:** the firmware writes `0xFD = 0x04` to select the function page, but the IS31FL3742A datasheet documents the function page as **page 2**. Two interpretations are possible: (a) the firmware was originally written for a different ISSI chip (e.g. IS31FL3737, which uses page 4 for its Function register set) and was carried over without change, or (b) the IS31FL3742A silently accepts `0x04` as an alias for `0x02`. In practice the firmware works on the SX3 hardware, so the controller does accept this value. **For a clean ESP32 reimplementation, use `0xFD = 0x02` per the IS31FL3742A datasheet.**

## 8. LED-to-Buffer Mapping

This section describes how a physical LED position `(row, column)` on the bike's 20×9 display maps to a byte offset in one of the two framebuffers. The mapping was derived from the firmware's pixel-decoding routine `Display_RenderFullImage` and cross-verified against the offsets used by `Display_UpdateBLEConnectionStatus` and `Display_UpdateShifterGearDot`.

### 8.1 Coordinate Convention

- **Row** R ∈ {0, ..., 19}, where row 0 is the top of the display (from the rider's perspective) and row 19 is the bottom.
- **Column** C ∈ {0, ..., 8}, where column 0 is the leftmost and column 8 is the rightmost.

This matches the convention in `SX3-Image-Protocol.md`.

### 8.2 Which Controller Drives Which Column?

| Column C | Controller | I²C addr |
|---|---|---|
| 0, 1, 2, 3, 4 | Left | `0x60` |
| 5, 6, 7, 8 | Right | `0x66` |

The vertical split runs between columns 4 and 5.

### 8.3 Offset Formula

The LED at position (R, C) corresponds to one byte in either the left or right framebuffer:

**Left controller (C ∈ {0..4}):**

```
LeftBuffer[ 121 − 30·C + R ]
```

**Right controller (C ∈ {5..8}):**

```
RightBuffer[ 121 − 30·(C − 5) + R ]
```

Both formulas reflect the same underlying chip behaviour: within one controller, a "column" of the bike display corresponds to one **SW (source) line** of the IS31FL3742A, and each SW line occupies 30 consecutive register bytes. Of those 30 bytes, only 20 are mapped to LED rows of the bike display (offsets 1..20 of each block); bytes 0 and 21..29 of each block do not drive a wired LED.

### 8.4 Tabular View

For convenience, here is the offset of the **top row (R = 0)** and **bottom row (R = 19)** for each column:

| Column | Buffer | Offset for R = 0 | Offset for R = 19 |
|---|---|---|---|
| 0 | Left | 121 (`0x79`) | 140 (`0x8C`) |
| 1 | Left | 91 (`0x5B`) | 110 (`0x6E`) |
| 2 | Left | 61 (`0x3D`) | 80 (`0x50`) |
| 3 | Left | 31 (`0x1F`) | 50 (`0x32`) |
| 4 | Left | 1 (`0x01`) | 20 (`0x14`) |
| 5 | Right | 121 (`0x79`) | 140 (`0x8C`) |
| 6 | Right | 91 (`0x5B`) | 110 (`0x6E`) |
| 7 | Right | 61 (`0x3D`) | 80 (`0x50`) |
| 8 | Right | 31 (`0x1F`) | 50 (`0x32`) |

Each column occupies 20 consecutive bytes (rows 0..19 in increasing offset order). Bytes 0, 21–30, 51–60, 81–90, 111–120, and 141–149 of each buffer are unused — writing to them has no visible effect.

### 8.5 Physical Non-Existence (Rounded Corners)

Of the 180 (row × column) positions covered by the formula, 14 are not actually wired to LEDs because of the rounded display shape:

- Row 0: columns 0, 1, 2, 6, 7, 8 (6 missing — only columns 3, 4, 5 exist at the very top)
- Rows 1 and 2: columns 0 and 8 (4 missing)
- Rows 18 and 19: columns 0 and 8 (4 missing)

Writes to the corresponding buffer offsets are harmless — the firmware writes 0 to them as part of normal rendering and they simply produce no light.

### 8.6 Verification Points

The mapping was cross-checked against three independent firmware-defined LED positions:

| Firmware reference | Buffer offset | Derived LED position | Description |
|---|---|---|---|
| `LeftBuffer[1]` (BLE dot) | 1 | (R=0, C=4) | Top of display, just left of centre |
| `LeftBuffer[0x1f]` (BLE icon ext.) | 31 | (R=0, C=3) | Top, one column further left |
| `RightBuffer[0x79]` (BLE icon ext.) | 121 | (R=0, C=5) | Top, one column right of centre |
| `LeftBuffer[0x66]` (shifter gear 1) | 102 | (R=11, C=1) | Lower-mid row, left side |
| `LeftBuffer[0x2a]` (shifter gear 2) | 42 | (R=11, C=3) | Lower-mid row, near centre-left |
| `RightBuffer[0x84]` (shifter gear 3) | 132 | (R=11, C=5) | Lower-mid row, near centre-right |
| `RightBuffer[0x48]` (shifter gear 4) | 72 | (R=11, C=7) | Lower-mid row, right side |

The three top-row LEDs together form the rounded "shoulders + dot" at the top of the display. The four shifter-gear dots sit in row 11 in alternating columns (1, 3, 5, 7) — a horizontal row of four indicators with a gap between each.

## 9. Pixel Brightness Lookup Table

The image protocol (see `SX3-Image-Protocol.md`) encodes each LED's brightness with only **3 bits** (8 levels), but the IS31FL3742A's PWM registers are **8 bits** (256 levels). The mapping is done through a small lookup table in flash:

**`PixelBrightness_LookupTable`** at `0x08042372` (8 bytes):

| Image-protocol intensity (3 bits) | PWM value written to controller |
|---|---|
| 0 (`000`) | `0x00` (0) |
| 1 (`001`) | `0x04` (4) |
| 2 (`010`) | `0x08` (8) |
| 3 (`011`) | `0x10` (16) |
| 4 (`100`) | `0x20` (32) |
| 5 (`101`) | `0x40` (64) |
| 6 (`110`) | `0x80` (128) |
| 7 (`111`) | `0xFF` (255) |

The table is a near-exponential ramp where each step roughly doubles the previous value — a gamma-correction curve well-matched to human perception of brightness. Both render functions (`Display_RenderFullImage` and `Display_RenderOverlayImage`) use this same table.

Status-indicator pixels (BLE dot, shifter gear dot) bypass the LUT and use a fixed PWM value of `0x50` (80) directly.

## 10. Display Control Pins (SDB and INT)

### 10.1 SDB — Software Shutdown

The SDB pin (active-low Software Shutdown) is shared between both controllers and driven by the MCU's PD15. Pulling SDB low places both controllers in low-power shutdown; releasing it (driving high) brings them out of shutdown and into active mode.

The firmware sets PD15 **high exactly once**, at the very beginning of `Boot_InitAndHandleErrors` (one of the earliest boot routines):

```c
/* SDB (standby) to display */
HAL_GPIO_WritePin(GPIOD, 0x8000, 1);
```

After this single boot-time write, **PD15 is never toggled again**. The firmware does not use SDB as a runtime reset mechanism — even when I²C recovery is invoked (§6.4), only the I²C peripheral itself is reset, not the LED controllers.

For an ESP32 reuse: drive SDB high once at startup (after a short delay, e.g. 1 ms after power-up, to be safe) and leave it high. If something goes very wrong, pulling it low and re-running the init sequence (§5) is a clean way to reset both controllers from a known state.

### 10.2 INT — Open/Short Error Interrupt

The IS31FL3742A's INT pin is an output that signals **open/short LED detection** results. When the chip's built-in self-test (controlled by the Open/Short Detection registers on Page 2) is run, INT goes low if any LED's forward voltage is outside the expected range, indicating either an open (broken LED, bad solder joint, missing connection) or a short (LED bridged or wiring fault). The host can then read dedicated status registers to identify exactly which LED is faulty.

In the SX3 firmware, **INT is not read**. PD14 is configured as an input but no code path samples it, no EXTI line is wired to it, and no diagnostic state machine consumes the open/short results.

**Why is this feature unused?** Three plausible reasons:

1. **Limited end-user value.** A single dead pixel on a status display is cosmetic — the bike still functions. Surfacing "Display LED #47 is open" to a non-technical owner serves no purpose, and using it to gate operation would degrade the user experience.
2. **Production-time use only.** VanMoof may have used open/short detection in a separate factory test image that was overwritten by the release firmware after end-of-line testing. This pattern is common in SoC manufacturing.
3. **State-machine complexity.** Running detection requires interrupting the normal frame-push flow, executing a test sequence, reading status registers, then resuming — a non-trivial integration for a display that is not safety-critical.

For an ESP32 reuse: **INT can be left unconnected**. If someone later wants to add diagnostics (e.g. "check display health" on a maintenance page), the hardware is ready for it — see the IS31FL3742A datasheet, Open/Short Detection Enable Register and Open/Short Information Registers on Page 2.

## 11. Daughterboard Ribbon Pinout

The display assembly is split into two boards: the LED matrix board with the two IS31FL3742A controllers and the CM3232E sensor, and a small **daughterboard** that breaks the connection out to an **8-pin ribbon cable** going to the bike's main board (the "Smart Cartridge" with the STM32F413).

The ribbon is labelled as follows:

| Ribbon pin | Label | Goes to (STM32) | Function |
|---|---|---|---|
| 1 | `SDA` | PB7 (pin 93) | I²C1 data — display controllers + sensor |
| 2 | `SCL` | PB6 (pin 92) | I²C1 clock |
| 3 | `5V` | 5 V rail | LED supply (the IS31FL3742A LED anodes) |
| 4 | `GND` | Ground | Common ground |
| 5 | `INTB` | PD14 (pin 61) | IS31FL3742A open/short interrupt — **unused by firmware** (see §10.2) |
| 6 | `3V3` | 3V3 rail | Logic supply (sensor, I²C pull-ups, controller logic side) |
| 7 | `SDB` | PD15 (pin 62) | Software shutdown — driven high once at boot (see §10.1) |
| 8 | `5Vsw` | PA6 (pin 31) | See below |

### 11.1 The `5Vsw` Pin (Ribbon Pin 8)

This pin is **not** a digital identification line. It connects to **PA6 = ADC1_IN6**, an analogue input on the STM32. On the LED FPC there is a **10 kΩ / 10 kΩ resistive divider** that taps the **switched 5 V rail** (the same rail that powers the LEDs) and presents half its voltage to the ADC.

The firmware reads this channel (via the DMA-fed ADC1 scan) and the routine `ADC_Read5VswitchedRail_mV` at `0x08025ED8` scales the raw value back up by ×2 to recover the real rail voltage. It is exposed through the debug CLI command `adc`, which prints:

```
HW version %d        <- ADC1 ch4: a separate resistor-divider hardware-revision ID
Vbat %d mV           <- ADC1 ch7: the main bike battery (≈35–42 V via divider, 10-sample average)
Vgsm %d mV           <- ADC1 ch5: the GSM modem rail
5Vsw %d mV           <- ADC1 ch6 = PA6 = this pin: the switched 5 V rail (LED supply)
```

So `5Vsw` is really a **5 V-rail voltage monitor** used for production/service diagnostics ("is the switched 5 V actually present at the display?"). It is **not consulted by any runtime display logic** — initialisation, rendering, and brightness are all completely independent of it.

**For an ESP32 reuse: leave ribbon pin 8 (`5Vsw`) unconnected.** It is a passive sense line back toward the bike's main board and has no effect on the display module itself. Likewise pin 5 (`INTB`) stays unconnected (§10.2). Of the eight ribbon conductors you only need six: SDA, SCL, 5V, GND, 3V3, SDB.

A useful confirmation falls out of this: because the ribbon carries **3V3 and 5V on separate conductors** (pins 6 and 3), the logic side (I²C, including the on-daughterboard pull-ups) runs at 3V3 while only the LED anodes use 5V. This is why the I²C lines can be wired straight to a 3V3 MCU like the ESP32 with no level shifter.

## 12. Ambient Light Sensor

The display PCB also carries a **CM3232E** ambient light sensor (Capella Microsystems) on the same I²C1 bus.

| Parameter | Value |
|---|---|
| I²C address (7-bit) | `0x10` |
| Command register | `0x00` (configure on init) |
| Data register | `0x50` (16-bit lux reading, little-endian) |
| Polling interval | 1.5 s (`0x5DC` ms) |

The firmware function `CM3232E_ReadLux` at `0x0802d198` performs a write-then-read sequence: it writes the command register byte `0x50` to address `0x10`, then reads 2 bytes back. The polling loop is in `AmbientLight_PollAndUpdate` at `0x0802ff90`.

## 13. Summary Table

| Aspect | Value |
|---|---|
| MCU | STM32F413VGT6 (LQFP100, 1 MB flash, 320 KB SRAM) |
| Display dimensions | 20 rows × 9 columns (166 LEDs physically present) |
| LED controllers | 2× IS31FL3742A |
| Left controller (`0x60`) | columns 0–4 (5 columns) |
| Right controller (`0x66`) | columns 5–8 (4 columns) |
| BLE status dot position | row 0, column 4 (left controller) |
| I²C bus | I2C1, 400 kHz |
| I²C pins (STM32F413) | PB6 (SCL, pin 92), PB7 (SDA, pin 93) |
| LED control pins | PD15 (SDB, pin 62, output) — set high once at boot; PD14 (INT, pin 61, input) — unused |
| Framebuffer size | 150 bytes per controller (300 total) |
| Bytes pushed per frame | 302 (2× 151) |
| LED-to-offset formula (col 0–4) | `LeftBuffer[121 − 30·C + R]` |
| LED-to-offset formula (col 5–8) | `RightBuffer[121 − 30·(C−5) + R]` |
| Brightness range per pixel | 8 levels (3-bit) via LUT → 8-bit PWM |
| Brightness LUT | `{0, 4, 8, 16, 32, 64, 128, 255}` |
| Global brightness | 0–255 via Global Current register |
| Ambient light sensor | CM3232E @ I²C1, addr `0x10` |
| Ribbon cable | 8-pin; only 6 needed for reuse (SDA, SCL, 5V, GND, 3V3, SDB). Pins 5 (`INTB`) and 8 (`5Vsw`, a 5V-rail sense via PA6 ADC) are unused by display logic. |

## 14. Appendix: Known Pitfalls (ESP32 Reuse)

Compiled from bringing the panel up on an ESP32-C3 from a bare ribbon
connection. Each of these *alone* produces "nothing lights"; encountered
together they make diagnosis much harder than any one of them alone.

1. **Ribbon read mirrored** — wrong pins entirely. Verify ribbon pin 1
   unambiguously before wiring anything (§11).
2. **USB CDC not enabled** on an ESP32-C3 — no serial output, blind
   debugging. Enable Tools → USB CDC On Boot in the Arduino IDE.
3. **GPIO 8/9 used for I²C on a C3** — these are boot-strapping pins;
   the board will not boot reliably with the bus on them. Use
   strapping-free GPIOs instead (e.g. 2/3/4).
4. **8-bit vs 7-bit I²C address confusion** — `0x60` → `0x30`,
   `0x66` → `0x33`, `0x20` → `0x10`. Arduino `Wire` wants 7-bit; this
   document's addresses are the firmware's 8-bit form (§3).
5. **5 V not supplied** — chips ACK on I²C and the ID register (`0xFC`)
   reads back correctly, but **no LED lights**, because the LED current
   sources (AVCC/PVCC) are unpowered by 3V3 alone. Supply real 5 V with
   a shared ground.
6. **Un-chunked I²C block write** — a host I²C stack that silently
   truncates long transactions (common on the ESP32-C3 Arduino core)
   produces a partial frame — typically only the first column lights.
   Chunk the 150-byte push to ≤24 data bytes per transaction, re-sending
   the register pointer each chunk.
7. **PWM/Scaling pages swapped** — frame data must go to the PWM page
   (`0xFD = 0x00`); the all-`0xFF` init block goes to the Scaling page
   (`0xFD = 0x02`, or `0x04` per the firmware's Function-page value,
   see §5). Getting these backwards gives sporadic or no LEDs.
8. **Buffer mapping taken from the datasheet formula instead of
   measured** — use `LeftBuffer[121 − 30·C + R]` /
   `RightBuffer[121 − 30·(C−5) + R]` (§8), not a naive reading of the
   IS31FL3742A datasheet's own SW/CS numbering.
9. **Image layout assumed row-sequential** — it is frame-interleaved;
   see `SX3-Image-Protocol.md`. This silently scrambles every
   multi-frame animation while leaving single-frame (static) images
   looking correct, which is what makes it easy to miss.

## 15. Appendix: Quick Reference Card

```
I2C: 400 kHz, 8-bit addr LEFT 0x60 / RIGHT 0x66 / ALS 0x20
     (7-bit for Arduino Wire: 0x30 / 0x33 / 0x10)
Pins (STM32): I2C1_SCL=PB6 I2C1_SDA=PB7 LED_SDB=PD15 LED_INT=PD14
5 V mandatory for LED current sources; common ground with host MCU

Init per controller:
  C5->FE; 02->FD (Function page); 41->00; 80->01;
  C5->FE; 00->FD (PWM page); [00 + 150x FF]; C5->FE; 00->FD

Push per controller: 00 + 150 PWM bytes (151 total), page stays 0x00,
  chunk to <=24 data bytes per transaction on constrained I2C hosts

Map LEFT : off = 121 - 30*C + R     (C 0..4)
Map RIGHT: off = 121 - 30*(C-5) + R (C 5..8)
LUT: 00 04 08 10 20 40 80 FF
```
