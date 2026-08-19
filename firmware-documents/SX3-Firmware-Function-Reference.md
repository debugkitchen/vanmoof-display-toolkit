# VanMoof SX3 Firmware — Display Function Reference

This document is a curated index of the firmware functions, data symbols, and image catalogue relevant to the SX3 LED matrix display, as identified during reverse engineering of the original VanMoof firmware (`mainware_1_9_3.bin`). It is intended as a quick reference for navigating the firmware in Ghidra or a comparable disassembler.

The complementary documents `SX3-Display-Hardware.md` (hardware-side), `SX3-Image-Protocol.md` (binary image format), and `../guide/README.md` (practical reuse on a new MCU) cover other aspects.

**About the addresses.** All addresses in this document refer to the analysed firmware binary loaded at the STM32F4 flash base (`0x08020000`). They will be stable across rebuilds of the same firmware version but may differ slightly for other VanMoof firmware revisions.

**About the names.** Functions and data symbols have been renamed during analysis from Ghidra's default `FUN_xxxxxxxx` / `DAT_xxxxxxxx` to meaningful identifiers. Names like `HAL_GPIO_Init` indicate functions that are direct copies (or near-copies) of ST's STM32 HAL library; this is confirmed by their register-write patterns. Names like `Display_*` are custom firmware code that builds on top of the HAL. The image symbol names (`display_content_*`) were already in place when this analysis began.

## 1. Layered Overview

The display subsystem can be understood as four layers, from low to high:

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  Layer 4: Application content                                       │
  │    Display_ContentController, Display_BatteryGaugeHandler,          │
  │    Display_InitiateBLENotification4sec, ...                         │
  └─────────────────────────────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────────────────────────────┐
  │  Layer 3: UI composition                                            │
  │    Display_RenderFullImage, Display_RenderOverlayImage,             │
  │    Display_UpperNumber, Display_LowerNumber,                        │
  │    Display_UpdateBatteryDots, Display_UpdateBLEConnectionStatus,    │
  │    Display_UpdateShifterGearDot                                     │
  └─────────────────────────────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────────────────────────────┐
  │  Layer 2: Framebuffer push + chip-level control                     │
  │    Display_Initialize, Display_InitController,                      │
  │    Display_I2CPushStateMachine, Display_SetGlobalBrightness,        │
  │    Display_WriteGlobalCurrent                                       │
  └─────────────────────────────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────────────────────────────┐
  │  Layer 1: HAL (I²C, GPIO, timing)                                   │
  │    HAL_I2C_Master_Transmit, HAL_I2C_Init, HAL_I2C_MspInit,          │
  │    HAL_GPIO_Init/WritePin/ReadPin, HAL_Delay,                       │
  │    I2C1_Initialize400kHz, I2C1_HandleError, I2C_Transmit            │
  └─────────────────────────────────────────────────────────────────────┘
```

The sections below cover each layer.

## 2. Boot and Entry

| Address | Symbol | What it does |
|---|---|---|
| `0x0803F3A4` | `System_ResetHandler` | First code after reset. Copies `.data` from flash to RAM, clears `.bss`, fills a third region with `0x0E` (likely stack painting), then calls the clock/FPU init, the C runtime init, and `Main_Application`. |
| `0x0803D2BC` | `System_InitClocksAndFPU` | Clock tree and FPU setup, equivalent to `SystemInit`. |
| `0x0803F420` | `System_ExecuteInitSequence` | C runtime init (equivalent to `__libc_init_array`). |
| `0x08031E68` | `Main_Application` | Real application entry. Initialises peripherals (including I2C1 at 400 kHz and I2C3 at 100 kHz), starts the main loop, and dispatches the high-level state machines on every tick. |

## 3. Layer 1 — STM32 HAL

These functions are recognisable as ST's HAL library, identified by characteristic register patterns. They are not display-specific — the rest of the firmware uses them too.

### 3.1 GPIO

| Address | Symbol | Signature | Notes |
|---|---|---|---|
| `0x08021D6C` | `HAL_GPIO_Init` | `void HAL_GPIO_Init(void *GPIOx, uint32_t *GPIO_Init)` | Configures up to 16 pins of one GPIO port. Writes MODER, OSPEEDR, OTYPER, PUPDR, AFR[2], and (for EXTI mode) SYSCFG-EXTICR. Textbook implementation. |
| `0x08022040` | `HAL_GPIO_WritePin` | `void HAL_GPIO_WritePin(void *GPIOx, uint16_t pin_mask, int state)` | Uses the BSRR register at offset `0x18` (lower halfword sets, upper halfword resets). |
| `0x08022034` | `HAL_GPIO_ReadPin` | `int HAL_GPIO_ReadPin(void *GPIOx, uint16_t pin_mask)` | Reads IDR at offset `0x10`. |

### 3.2 Timing

| Address | Symbol | Signature | Notes |
|---|---|---|---|
| `0x08020EF0` | `HAL_Delay` | `void HAL_Delay(uint32_t ms)` | Blocking spin-loop on the SysTick-driven tick counter. Used throughout the firmware. |

### 3.3 I²C — Generic

| Address | Symbol | Signature | Notes |
|---|---|---|---|
| `0x0802241C` | `HAL_I2C_Init` | `int HAL_I2C_Init(void *hi2c)` | The real ST HAL `HAL_I2C_Init`. Computes CCR and TRISE from the APB1 clock, configures the peripheral. Calls `HAL_I2C_MspInit` for the pin-level setup. |
| `0x0802EF68` | `HAL_I2C_MspInit` | `void HAL_I2C_MspInit(void *hi2c)` | Configures GPIO pins, RCC clocks, and NVIC for the I²C peripheral. Has two branches: one for I2C1 (PB6/PB7, NVIC 31/32), one for I2C3 (PA8/PC9, NVIC 72/73). |
| `0x0802F0DC` | `HAL_I2C_MspDeInit` | `void HAL_I2C_MspDeInit(void *hi2c)` | Reverses `HAL_I2C_MspInit`. Used during error recovery. |
| `0x080225A0` | `HAL_I2C_Master_Transmit` | `int HAL_I2C_Master_Transmit(void *hi2c, uint8_t addr, uint8_t *data, uint16_t size, uint32_t timeout)` | Blocking master-mode transmit. The address is passed in the 8-bit-write form (7-bit shifted left, R/W bit 0). Returns 0 on success, 1 on error, 2 on timeout. |
| `0x08022A30` | `I2C_Transmit` | (interrupt-driven variant) | Non-blocking I²C transmit. Used by `Display_I2CPushStateMachine` to push 151-byte frames without blocking the main loop. The completion is signalled via `Display_SetI2COperation` from the interrupt handler. |
| `0x080233F8` | `I2C_InterruptHandler` | (ISR) | Generic I²C peripheral interrupt handler (event & error vectors). Drives non-blocking transfers and sets the done-flag when complete. |

### 3.4 I²C — Bus-specific setup

| Address | Symbol | Notes |
|---|---|---|
| `0x0802EEF0` | `I2C1_Initialize400kHz` | One-call setup of I2C1 at 400 kHz. Fills the I2C handle (peripheral base `0x40005400`, clock `0x000186A0` = 400 000) and calls `HAL_I2C_Init`. **This is the display bus.** |
| `0x0802EF2C` | `I2C3_Initialize100kHz` | Same pattern, for I2C3 at 100 kHz. Used for the non-display peripherals (sensors etc.). |
| `0x0802F188` | `I2C1_HandleError` | Disables I2C1 (clears `CR1.PE`), calls `HAL_I2C_MspDeInit`, clears the handle state. Used in display error recovery before re-running `I2C1_Initialize400kHz`. |
| `0x0802F194` | `I2C3_HandleError` | Same, for I2C3. Not display-related. |
| `0x0802F1A0` | `I2C3_FullInit_WithBusRecovery` | Initialises I2C3 with a bit-bang bus-recovery phase up front (toggles SCL up to 200 times if SDA is stuck low). Not display-related. |
| `0x0802F160` | `I2C1_WaitReady` | Spin-waits for the I2C1 BUSY flag to clear, with a 50-tick timeout. |

## 4. Layer 2 — Framebuffer + Chip Control

This layer manages the two LED controllers and the two in-SRAM framebuffers that mirror their PWM registers.

### 4.1 Initialisation

| Address | Symbol | Signature | Notes |
|---|---|---|---|
| `0x0802F480` | `Display_Initialize` | `void Display_Initialize(void)` | Boot-time display setup. Clears both framebuffers to 0, calls `Display_InitController(0x60)` and `Display_InitController(0x66)` with up to 3 retries each, then sets the two state-machine state variables to 0 and the refresh flag to 1. |
| `0x0802F288` | `Display_InitController` | `int Display_InitController(uint8_t i2c_addr)` | Per-chip init: unlocks the command register (`0xFE = 0xC5`), selects the function page, writes the configuration and global current registers, then writes 150 × `0xFF` to the PWM page. See `SX3-Display-Hardware.md` §5 for the full sequence. |

### 4.2 Frame Push

| Address | Symbol | Signature | Notes |
|---|---|---|---|
| `0x0802F8BC` | `Display_I2CPushStateMachine` | `void Display_I2CPushStateMachine(void)` | The non-blocking push state machine. Called every main-loop tick; advances through 5 states (idle → send left → wait left → send right → wait right → idle). Each push transmits 151 bytes (1 register pointer + 150 PWM values) over I²C using `I2C_Transmit` and waits for the ISR-set done flag. See `SX3-Display-Hardware.md` §6.3 for the diagram. |
| `0x0802FA24` | `Display_SetI2COperation` | `void Display_SetI2COperation(void)` | One-liner called by the I²C interrupt handler to set the "transfer complete" flag (`Display_I2CTransferDoneFlag`) that the push state machine polls. |

### 4.3 Brightness Control

| Address | Symbol | Signature | Notes |
|---|---|---|---|
| `0x0802FE68` | `Display_SetGlobalBrightness` | `void Display_SetGlobalBrightness(uint8_t value)` | Public API for runtime brightness change. Caches the last written value; on change, writes the new value to both controllers' Global Current register (function-page `0x01`) with up to 3 retries each. |
| `0x0802F3C8` | `Display_WriteGlobalCurrent` | `int Display_WriteGlobalCurrent(uint8_t i2c_addr, uint8_t current_value)` | Per-chip helper used by `Display_SetGlobalBrightness`. Sends the 5-write unlock/page/write/unlock/page sequence required to update the Global Current register on a single controller. |

### 4.4 Error Handling and Diagnostics

| Address | Symbol | Notes |
|---|---|---|
| `0x0802F3A8` | `Display_LogI2CNakIfActive` | Reads the display "enabled" status and, if the display is on, logs `" ERR dsp freeze\r\n"` (string at `0x080422CD`) via a function-pointer-based logger. Called after each failed I²C transaction in the various retry loops. |
| `0x08026E9C` | `Display_IsOnES4` | Reads a bit field at SRAM offset `+0x145` to determine whether the display is "on" (return 1) or "off" (return 0). Used by the logger and by various state machines to gate display-affecting actions. |

### 4.5 Lifecycle Helpers

| Address | Symbol | Notes |
|---|---|---|
| `0x0802F52C` | `Display_TurnOff` | Sets a state flag that causes subsequent renders to skip output. |
| `0x0802F540` | `Display_ClearAndTurnOff` | As above, plus clears the framebuffers. |
| `0x0802F570` | `Display_IsEnabled` | Boolean accessor for the "display on" flag. |
| `0x0802F58C` | `Display_IsOverlayIdleOrOff` | Returns true if the display is disabled OR if the overlay render state machine is idle (state == 0). Used by callers that want to decide whether they may safely start a new overlay. |
| `0x0802F5A8` | `Display_IsTransferIdleOrOff` | Returns 1 if the display is disabled OR if `Display_I2CTransferDoneFlag` is set (last push completed). Used by the bike main state machine to decide whether it may compose a new frame. |

## 5. Layer 3 — UI Composition

These functions know how to render specific kinds of content (full images, transparent overlays, numbers, status dots, bargraphs) into the framebuffers. They do not push to the controllers — they rely on `Display_I2CPushStateMachine` to do that asynchronously.

### 5.1 Image Renderers

| Address | Symbol | Signature | Notes |
|---|---|---|---|
| `0x0802F5C0` | `Display_RenderFullImage` | `void Display_RenderFullImage(void)` | Tick function for full-image rendering. 4-state machine (idle, header-parse, render-frame, wait-duration). Reads the image pointed to by `PTR_Display_RenderFull_ImageDataPtr`. Writes every pixel including zeros — replaces the underlying content. See `SX3-Image-Protocol.md` §5.1. |
| `0x0802F738` | `Display_RenderOverlayImage` | `void Display_RenderOverlayImage(void)` | Identical structure to `Display_RenderFullImage` but skips PWM = 0 pixels. Used for overlaying e.g. the battery indicator on top of an existing scene. |
| `0x0802F4F0` | `Display_SetContent` | `void Display_SetContent(void *image_data_ptr)` | Public setter that swaps the image pointer for `Display_RenderFullImage`. |
| `0x0802F508` | `Display_SetOverlayContent` | Setter for the overlay renderer's image pointer. |

### 5.2 Number Rendering

| Address | Symbol | Signature | Notes |
|---|---|---|---|
| `0x0802FD84` | `Display_UpperNumber` | `void Display_UpperNumber(int number, int offset)` | Renders a 2-digit number (0–99, clamped) at a given offset using the upper-number font. Splits into tens/ones; each digit is a 7-column × 4-row glyph. The two digits straddle the controller boundary (digit 1 mostly on the left chip, digit 2 mostly on the right). Font table at `0x080422DF` (70 bytes). |
| `0x0802FCFC` | `Display_LowerNumber` | `void Display_LowerNumber(int digit, int offset)` | Renders a single digit using the lower-number font. Slightly more complex pixel placement than the upper variant (uses 5 bits per byte vs 4). Font table at `0x08042325` (70 bytes). |

### 5.3 Status Indicators

| Address | Symbol | Signature | Notes |
|---|---|---|---|
| `0x0802FCBC` | `Display_UpdateBLEConnectionStatus` | `void Display_UpdateBLEConnectionStatus(uint state)` | Writes the BLE indicator pixels directly into the framebuffers. State 1 lights only `LeftBuffer[1]` (LED at row 0, col 4). State 3 lights an extended 3-LED icon (the top "shoulders" of the display, row 0 cols 3, 4, 5). All other states clear the icon. Fixed brightness `0x50`. |
| `0x0802FA30` | `Display_UpdateShifterGearDot` | `void Display_UpdateShifterGearDot(uint gear)` | Writes one of four gear-indicator pixels (row 11, columns 1, 3, 5, 7) into the framebuffers. Gear 0 clears all four; gears 1–4 light the corresponding LED at brightness `0x50`. |
| `0x0802F228` | `Display_UpdateBatteryDots` | `void Display_UpdateBatteryDots(int dot_count)` | Writes a horizontal bargraph indicator. Up to 21 LEDs total (12 on the left chip + 9 on the right) light up depending on `dot_count`. Each "dot group" is 3 LEDs in a row at full brightness (`0xFF`); when `dot_count >= threshold[i]` the i-th group lights up. |

### 5.4 Battery State Machine

| Address | Symbol | Signature | Notes |
|---|---|---|---|
| `0x0802FAC0` | `Display_BatteryGaugeHandler` | `void Display_BatteryGaugeHandler(uint soc, uint powerbank_soc, ...)` | High-level battery display logic. Routes between the various battery image variants based on SOC: < 6 % → critical-low blink; 6–13 % → 1-reserve-dot; 14–18 % → 2-reserve-dots; 19–22 % → 3-reserve-dots; ≥ 23 % → normal bargraph via `CalculateBatteryDots` + `Display_UpdateBatteryDots`. Also handles charging animations and powerbank-attached cases via separate image variants. |
| `0x08033CD8` | `CalculateBatteryDots` | `int CalculateBatteryDots(uint soc, uint min_value, uint max_value, uint min_dots, uint max_dots)` | Linear scaling helper. Maps `soc` (clamped to `[min_value, max_value]`) to `[min_dots, max_dots]`. Called by `Display_BatteryGaugeHandler` as `CalculateBatteryDots(soc, 7, 0x5c, 0, 0x15)` to map 7–92 % SOC to 0–21 dots. |

### 5.5 Shifter Helpers

| Address | Symbol | Notes |
|---|---|---|
| `0x0803620C` | `Shifter_UpdateDetailsWithHysteresis` | Higher-level gear-selection logic with hysteresis on the gear-change inputs. Decides what to pass to `Display_UpdateShifterGearDot`. |
| `0x080363A8` | `Shifter_UpdateDetails` | Simpler variant of the above. |

## 6. Layer 4 — Application Content Dispatcher

`Display_ContentController` at `0x0802C340` is the top-level dispatcher, called from `Main_Application` every tick. On each call it:

1. Reads the current "display mode" byte (0–41).
2. If the mode just changed (and the previous mode was > 4), performs cleanup of the previous mode by calling `Display_ClearAndTurnOff`. Additionally, when the **new** mode is 6, 7, or 15, two state flags are reset based on bits in `System_Status[0xF0]` and `[0xF1]`.
3. Maintains a **1 Hz blink phase** by toggling a byte every 1000 ms via `Timer_SetSlotAndDuration` / `Timer_IsExpired`. This shared "blink phase" is consumed by various image and indicator routines.
4. Reads GPIOC pin 2 (PC2) via `HAL_GPIO_ReadPin(GPIOC, 0x4)` — likely a button or limit switch; the value is read but not used in the controller itself.
5. Calls `Display_UpdateBLEConnectionStatus` every tick to refresh the BLE indicator.
6. Dispatches into a **42-case switch** based on the current mode (value 0..41).

### 6.1 Complete Case Table

The table below maps every dispatcher case to its branch target and the action performed there. Where the case is a simple "set this image" (the most common pattern), the image symbol is named directly. Cases that perform more elaborate composition (number rendering, conditional routing, etc.) are described in §6.2.

| Case | Target | Action |
|---|---|---|
| 0 | `0x0802C42C` | If display enabled: requests blink-routine `0x07` and sets mode := 6. Otherwise return. (idle path) |
| 1 | `0x0802C7C4` | (complex) Checks a battery-detection flag; if set, returns. Else sets mode to a state-byte value (the previously decided battery routine). |
| 2 | `0x0802C428` | no-op (return) |
| 3 | `0x0802C800` | Free a timer slot (the "speed-display fade-out" timer); reset state; **set image `display_content_lock_locking`** (chained via case 4) |
| 4 | `0x0802C7EE` | Conditional: if a flag is set AND display is on, set image `display_content_lock_opening`. Then fall through to case 3 behaviour. |
| 5 | `0x0802C41E` | **Set image `display_content_vanmoof_startup`**; sets mode := 0 (run once then idle). |
| 6 | `0x0802C43E` | (complex) Low-speed routing — see §6.2. |
| 7 | `0x0802C4EC` | (complex) Speed display with shifter gear and upper-number — see §6.2. |
| 8 | `0x0802C63A` | (complex) Battery + powerbank charging composition — see §6.2. |
| 9 | `0x0802C620` | (complex) Battery handling without powerbank — see §6.2. |
| 10 | `0x0802C754` | (complex) Boost mode display — see §6.2. |
| 11 | `0x0802C428` | no-op (return) |
| 12 | `0x0802C77A` | (complex) Error/diagnostic with code as number — see §6.2. |
| 13 | `0x0802C594` | (complex) Lower-number display with optional `speed_circle` background — see §6.2. |
| 14 | `0x0802C5FC` | (complex) Lower-number variant; clears a state at the end — see §6.2. |
| 15 | `0x0802C878` | (complex) Tick-parity alternating display — see §6.2. |
| 16 | `0x0802C81E` | Sets image `display_content_ERR_text`, then renders a fault code as upper number (similar to case 36). |
| 17 | `0x0802C82C` | Display-enabled check; sets image `display_content_temperature_below_zero`. |
| 18 | `0x0802C842` | Display-enabled check; sets image `display_content_skull_angry` (anti-theft alarm). |
| 19 | `0x0802C850` | Display-enabled check; sets image `display_content_firmware_download`. |
| 20 | `0x0802C85E` | Display-enabled check; sets image `display_content_hourglass`. |
| 21 | `0x0802C98C` | Display-enabled check; sets image `display_content_diagnose_scan`. |
| 22 | `0x0802C5AE` | Resets mode := 2 (no-op next tick). |
| 23 | `0x0802C86C` | Sets image `display_content_rocket_success`, then resets mode := 2. |
| 24 | `0x0802C874` | Display-enabled check; sets image `display_content_rocket_failure`. |
| 25 | `0x0802C942` | Calls `Display_TurnOff`, then sets image `display_content_vanmoof_shutdown`. |
| 26 | `0x0802C94A` | Sets image `display_content_lock_closed_static`, then resets mode := 2. |
| 27 | `0x0802C94E` | Sets image `display_content_ship`, then resets mode := 2. |
| 28 | `0x0802C952` | Sets image `display_content_ship`, then resets mode := 2. (Different entry path — different state setup.) |
| 29 | `0x0802C86C` | (shared with case 23) Sets image `display_content_rocket_success`. |
| 30 | `0x0802C956` | Display-enabled check; sets image `display_content_backup_code_first_number`. |
| 31 | `0x0802C964` | Display-enabled check; sets image `display_content_backup_code_second_number`. |
| 32 | `0x0802C972` | Display-enabled check; sets image `display_content_backup_code_third_number`. |
| 33 | `0x0802C980` | Sets image `display_content_lock_opening`, then resets mode := 2. |
| 34 | `0x0802C984` | Sets image `display_content_backup_code_wrong_X`, then resets mode := 2. |
| 35 | `0x0802C99A` | Sets image `display_content_battery_diagnosis_check`, then resets mode := 2. |
| 36 | `0x0802C7D4` | (complex) Same as case 16: turns off display, sets `display_content_ERR_text`, then renders a 2-digit fault code via `Display_UpperNumber`. |
| 37 | `0x0802C988` | Sets image `display_content_reset_circle`, then resets mode := 2. |
| 38 | `0x0802C99E` | Display-enabled check; sets image `display_content_findme_pair_radar`. |
| 39 | `0x0802C9AC` | Display-enabled check; sets image `display_content_findme_disable`. |
| 40 | `0x0802C9BA` | Display-enabled check; sets image `display_content_findme_enable`. |
| 41 | `0x0802C9C8` | Display-enabled check; sets image `display_content_findme_unpair`. |

### 6.2 The Complex Cases in Detail

These cases combine multiple operations: number rendering, state-machine transitions, conditional image selection, and so on.

#### Case 6 (target `0x0802C43E`) — Low-speed routing

Reads the speed value at `r4 + 0x3CA` of the bike state structure. The speed is stored in **dezi-km/h** (units of 0.1 km/h), so a value of 10 means 1.0 km/h.

If the speed is greater than 9 (i.e. > 0.9 km/h), this case sets mode := 7 (the real speed display) and falls through to a common battery-handler call. Otherwise — when the bike is essentially stopped — it routes between several battery-related image setters based on flags in `System_Status[0xF0]` and `[0xF1]`, then calls `Display_BatteryGaugeHandler` with the SOC fields from the system state.

This case acts as a hysteresis pair with case 7: it switches **into** the speed display once you cross 0.9 km/h moving upward, while case 7 switches **out** when you fall below 0.8 km/h. The 0.1 km/h gap prevents the display from flickering between the two modes at standstill.

Effectively: "the bike is stopped — show a battery/idle indicator instead of the speed".

#### Case 7 (target `0x0802C4EC`) — Speed display

Reads the speed value (in dezi-km/h, see case 6); if it is ≤ 8 (i.e. ≤ 0.8 km/h), drops back to case 6 (handle as idle). This is the lower edge of the hysteresis pair — the bike must reach > 0.9 km/h via case 6 to enter case 7, and only falls back below 0.8 km/h. Otherwise:

1. Allocates and arms a fade-out timer (state byte `0x2000007E`) at 1000 ms.
2. Calls `Display_UpdateShifterGearDot(gear @ r4+0x3D4)` to render the gear indicator.
3. Reads the unit-system flag at `r4 + 0x10A` to pick the display format:
   - **Flag = 0 (km/h)**: shows `speed_raw / 10` via `Display_UpperNumber` at offset 3. Since `speed_raw` is in dezi-km/h, dividing by 10 gives whole km/h (e.g. raw 235 → display "23").
   - **Flag ≠ 0 (imperial / mph)**: shows `(speed_raw >> 4)` via `Display_UpperNumber`. This is a clever cheap shift-based conversion: `1 dezi-km/h ≈ 0.0621 mph ≈ 1/16 mph`, so dividing the raw value by 16 (via `>> 4`) gives mph accurate to within ~1 mph across the relevant range (e.g. raw 235 = 23.5 km/h → "14" mph, where the exact value is 14.6 mph).

The display only shows the speed once the wheel turns at least 1 km/h (handled by the case-6 → case-7 transition above).

This is the canonical "in-ride speed display" mode.

#### Case 8 (target `0x0802C63A`) — Battery + powerbank charging

Reads system flags at `r4 + 0x3C0`. Checks bit 21 (charging state) and a 16-bit battery voltage at `r4 + 0x408`. Based on these:

- If charging and voltage is in a low range: sets up a charging-with-powerbank composition using `display_content_battery_frame_charging_powerbank` and `display_content_powerbank_initialize`.
- Calls `Display_BatteryGaugeHandler` with SOC + powerbank SOC at the end.

#### Case 9 (target `0x0802C620`) — Battery without powerbank

Display-enabled check; sets image `display_content_temperature_below_zero` (used here as a base layer apparently). Then checks battery voltage and either returns or transitions to mode 8.

#### Case 10 (target `0x0802C754`) — Boost mode

1. If display is enabled, dims the global brightness to 0x14 (~8% — much darker than the normal 0x80) and sets `display_content_lightning_pulsating` as the background.
2. Reads a 16-bit signed boost level at `r4 + 0x3E2`. If -1, returns.
3. Otherwise: `boost_level / 10 + 9` becomes the parameter to a battery-handler-like routine.

The dimming makes the boost overlay visually pop against an otherwise dark display.

#### Case 12 (target `0x0802C77A`) — Diagnostic error display

Reads system flags. If a particular flag bit and a voltage range condition are both met:

- Turns off the display and sets image `display_content_temperature_below_zero`.

Otherwise:

- Turns off the display, sets image `display_content_ERR_text`, and renders a fault code (computed from the 64-bit value at `r4 + 0x3C0` modulo something — likely an error code) as a 2-digit upper number.

#### Case 13 (target `0x0802C594`) — Lower-number with conditional speed_circle

1. Calls `Display_TurnOff`.
2. If the byte at `r4 + 0x3D1` is non-zero, sets background image `display_content_speed_circle`.
3. Renders that byte as a lower number at offset 11 via `Display_LowerNumber`.

The "speed_circle" name suggests this might be a "lock count" / "PIN-entry digit indicator" mode where the rendered digit sits inside a circle.

#### Case 14 (target `0x0802C5FC`) — Lower-number variant

Almost identical to case 13 but:
- Uses byte at `r4 + 0x3D2` instead of `+0x3D1`.
- Tracks state separately.
- At the end, clears a 16-bit state variable.

These two cases together support a two-digit input flow where digits are shown one at a time, presumably for backup-code entry sequences.

#### Case 15 (target `0x0802C878`) — Alternating-display

Reads the SysTick counter, divides by 10, and uses bit 0 of the result as an alternator. Two paths:

- **Bit = 1**: Uses content base offset `r4 + 0x00` (the start of the bike-state struct as image data?).
- **Bit = 0**: Uses content base offset `r4 + 0x3C` (a different region).

Both call `Display_SetContent`. This produces a roughly 5 Hz alternating display — likely a test/debug pattern or a "double-checking the user" prompt.

#### Case 36 (target `0x0802C7D4`) — Same as case 12 simplified

A simpler version of case 12's error path: always turns off the display, sets `display_content_ERR_text`, then renders the 2-digit fault code via `Display_UpperNumber(value, offset=4)`. Used when no temperature-related routing is needed.

### 6.3 Other Top-Level Dispatcher Functions

| Address | Symbol | Notes |
|---|---|---|
| `0x0802CA34` | `Display_InitiateBLENotification4sec` | Queues a 4-second BLE-related notification image. |
| `0x0802CA90` | `Display_InitiatePowerLevelNotification4sec` | Queues a 4-second power-level notification image. |
| `0x0802CA1C` | `Display_SetContentIndexValue` | Setter into an indexed lookup of display modes / content pointers. |
| `0x0802CA28` | `Display_GetContentIndexValue` | Corresponding getter. |

## 7. Image Catalogue

The firmware contains **35 known images** referenced from `Display_ContentController` and `Display_BatteryGaugeHandler`. All are stored using the protocol described in `SX3-Image-Protocol.md`. The table below was extracted by parsing the image headers directly from the firmware binary.

Columns: **addr** = flash address; **sr** = `start_row`; **gr** = `graphic_rows`; **nf** = `num_frames`; **dur** = first frame duration in ms; **size** = total image size in bytes.

### 7.1 Static Images (1 frame)

| Address | sr | gr | size | Symbol | Description |
|---|---:|---:|---:|---|---|
| `0x08045F50` | 12 | 5 | 36 | `display_content_ERR_text` | "err" text in the lower part of the display |
| `0x08046588` | 5 | 10 | 56 | `display_content_hourglass` | Hourglass — typically shown during loading/waiting |
| `0x08046AD0` | 13 | 5 | 36 | `display_content_battery_frame` | Battery indicator outline (bright) |
| `0x08046AF4` | 13 | 5 | 36 | `display_content_battery_frame_dark` | Same outline but dim — alternates during charging |
| `0x08047BE0` | 1 | 16 | 80 | `display_content_ship` | The ship icon (one of the BLE-notification images) |
| `0x0804A784` | 7 | 13 | 68 | `display_content_battery_diagnosis_check` | "V"-shape check mark for battery diagnosis |
| `0x0804A7C8` | 7 | 9 | 52 | `display_content_backup_code_wrong_X` | X-mark indicating wrong backup code |
| `0x0804A7FC` | 3 | 10 | 56 | `display_content_lock_closed_static` | Static padlock icon (locked, no animation) |
| `0x0804A934` | 6 | 9 | 52 | `display_content_reset_circle` | Circular reset / refresh icon |

### 7.2 Short Animations (2–10 frames)

| Address | sr | gr | nf | dur | size | Symbol | Description |
|---|---:|---:|---:|---:|---:|---|---|
| `0x08045888` | 0 | 18 | 2 | 250 | 164 | `display_content_backup_code_first_number` | Prompt for entering the first backup-code digit |
| `0x0804592C` | 0 | 18 | 2 | 250 | 164 | `display_content_backup_code_second_number` | Prompt for second digit |
| `0x080459D0` | 0 | 20 | 2 | 250 | 180 | `display_content_backup_code_third_number` | Prompt for third digit |
| `0x08045A84` | 1 | 11 | 4 | 80 | 204 | `display_content_lock_opening` | Padlock-opening animation |
| `0x08045F74` | 1 | 11 | 4 | 80 | 204 | `display_content_lock_locking` | Padlock-closing animation |
| `0x0804A3E8` | 2 | 15 | 6 | 200 | 396 | `display_content_temperature_below_zero` | Snowflake / sub-zero temperature warning |
| `0x08046040` | 5 | 12 | 8 | 50 | 428 | `display_content_skull_angry` | Angry skull — anti-theft / alarm indicator |
| `0x08045DDC` | 2 | 9 | 9 | 100 | 372 | `display_content_lightning_flashing` | Lightning bolt — flashing variant |
| `0x0804569C` | 0 | 11 | 10 | 0 | 492 | `display_content_speed_circle` | Speed-related "M"/circle animation |
| `0x08048D58` | 4 | 9 | 10 | 200 | 412 | `display_content_powerbank_drops_energy` | Powerbank giving energy to battery |

### 7.3 Medium Animations (11–22 frames)

| Address | sr | gr | nf | dur | size | Symbol | Description |
|---|---:|---:|---:|---:|---:|---|---|
| `0x0804A1CC` | 1 | 11 | 11 | 150 | 540 | `display_content_findme_unpair` | Find-My: unpair animation |
| `0x080461EC` | 2 | 18 | 12 | 100 | 924 | `display_content_firmware_download` | Firmware-download progress (upward arrow) |
| `0x08048EF4` | 4 | 7 | 12 | 100 | 396 | `display_content_powerbank_initialize` | Powerbank initialise / detect |
| `0x08049D04` | 1 | 11 | 12 | 150 | 588 | `display_content_findme_disable` | Find-My: disable animation |
| `0x08046704` | 13 | 5 | 13 | 50 | 324 | `display_content_battery_2_reserve_dots_blinking` | Battery low (SOC 14–18 %) — 2 reserve dots blinking |
| `0x08049F50` | 1 | 11 | 13 | 150 | 636 | `display_content_findme_enable` | Find-My: enable animation |
| `0x08045B50` | 2 | 9 | 16 | 100 | 652 | `display_content_lightning_pulsating` | Lightning bolt — pulsating variant (boost?) |
| `0x08048908` | 13 | 5 | 22 | 100 | 540 | `display_content_battery_frame_charging_powerbank` | Battery frame charging (with powerbank attached) |

### 7.4 Long Animations (23+ frames)

| Address | sr | gr | nf | dur | size | Symbol | Description |
|---|---:|---:|---:|---:|---:|---|---|
| `0x08048B24` | 13 | 5 | 23 | 100 | 564 | `display_content_battery_frame_discharging_powerbank` | Battery frame discharging (with powerbank attached) |
| `0x080451E0` | 0 | 9 | 30 | 75 | 1212 | `display_content_pulse` | Pulsing mountain / pyramid |
| `0x08044754` | 0 | 20 | 32 | 50 | 2700 | `display_content_vanmoof_shutdown` | Shutdown animation (full screen) |
| `0x08049080` | 1 | 20 | 38 | 150 | 3204 | `display_content_findme_pair_radar` | Find-My: pairing / radar sweep (full screen) |
| `0x08047C30` | 0 | 20 | 39 | 50 | 3288 | `display_content_rocket_failure` | Rocket failure (full-screen animation) |
| `0x0804A968` | 0 | 20 | 46 | 50 | 3876 | `display_content_diagnose_scan` | Diagnostic scan animation (full screen) |
| `0x08046B18` | 0 | 20 | 51 | 50 | 4296 | `display_content_rocket_success` | Rocket success (full-screen animation) |
| `0x08043050` | 0 | 20 | **70** | 50 | 5892 | `display_content_vanmoof_startup` | **Startup animation** (full screen, longest in the firmware) |

### 7.5 Total Image Storage

The 35 catalogued images together occupy **~40 KB** of flash. The largest single image is the startup animation at 5892 bytes; the smallest is `display_content_ERR_text` at 36 bytes. Static images average ~50 bytes; animations average ~1 KB.

## 8. Fonts and Lookup Tables

| Address | Symbol | Description |
|---|---|---|
| `0x080422DF` | `Display_Font_UpperNumber_7x4` | 70-byte font table for `Display_UpperNumber`. 10 digits × 7 columns; each byte's low 4 bits select which rows of that column are lit. |
| `0x08042325` | `Display_Font_LowerNumber_7x4` | 70-byte font table for `Display_LowerNumber`. Same shape as above, slightly different pixel placement. |
| `0x08042372` | `PixelBrightness_LookupTable` | 8 bytes. Maps the 3-bit intensity (0–7) used in the image protocol to an 8-bit PWM value: `{0x00, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0xFF}`. See `SX3-Display-Hardware.md` §9. |

## 9. Ambient Light Sensor

| Address | Symbol | Notes |
|---|---|---|
| `0x0802D198` | `CM3232E_ReadLux` | Performs a write-then-read I²C transaction against the CM3232E at address `0x10`: writes command-register byte `0x50`, then reads 2 bytes as a 16-bit lux value. Uses the same I²C1 bus as the LED controllers. |
| `0x0802FF90` | `AmbientLight_PollAndUpdate` | Polling loop that calls `CM3232E_ReadLux` every ~1.5 s (timer-driven). The result is stored in SRAM and consumed by various higher-level state machines that may then call `Display_SetGlobalBrightness` to adjust brightness for ambient conditions. |

## 10. ADC Voltage Diagnostics

The STM32 runs ADC1 in a DMA-fed scan of four channels. None of these feed the display rendering path — they are battery/power telemetry surfaced through the `adc` debug-shell command — but channel 6 is wired to the display ribbon's `5Vsw` pin, so the group is documented here for completeness.

| Address | Symbol | Notes |
|---|---|---|
| `0x080373FC` | `CLI_Command_adc_ShowVoltages` | Debug-shell `adc` handler. Prints HW version, `Vbat`, `Vgsm`, and (if HW version > 5) `5Vsw`. |
| `0x08025DD0` | `ADC_DetectHardwareVersion` | Reads ADC1 ch4 (DMA offset +0), scales to mV, and walks a 16-entry resistor-divider table to identify the hardware revision. Falls back to `Get_StoredHardwareRevisionByte` on no match. |
| `0x08025E58` | `ADC_ReadVbat_BikeBattery_mV` | Reads ADC1 ch7 (DMA offset +6). Applies the Vbat divider scaling and returns a 10-sample rolling average in mV (the main bike battery, ≈35–42 V). |
| `0x08025EBC` | `ADC_ReadVgsm_ModemVoltage_mV` | Reads ADC1 ch5 (DMA offset +2). Returns the GSM modem rail voltage in mV. Also used by `GSM_PowerOffModem`. |
| `0x08025ED8` | `ADC_Read5VswitchedRail_mV` | Reads ADC1 ch6 = **PA6 = ribbon pin 8 `5Vsw`** (DMA offset +4). The daughterboard places a 10K/10K 1:1 divider on the switched 5 V rail; this routine multiplies the reading back by ×2 to recover the rail voltage. Diagnostic only — no runtime display code consults it. |
| `0x08031D7C` | `Get_StoredHardwareRevisionByte` | Returns `SystemStruct[+0x147]`, a stored/override HW-revision byte used as a fallback by `ADC_DetectHardwareVersion`. |

The DMA buffer is shared; per-channel access uses the `PTR_ADC_DMABuffer_for*` pointers, and each reader clears a `PTR_ADC_*_ConsumedFlag` after sampling. The hardware-version match table is at `PTR_HWVersion_VoltageDividerTable` with tolerance `FLOAT_HWVersion_MatchTolerance`.

**Relevance to display reuse:** none. This confirms that ribbon pin 8 (`5Vsw`) is a passive 5 V-rail sense line, not a digital ID the display needs. See `SX3-Display-Hardware.md` §11.

## 11. Key RAM Symbols

The SRAM region around `0x200007E0` holds the active framebuffers and most display state. The most useful symbols:

| Address | Symbol | Notes |
|---|---|---|
| `0x200007DF` | (`Display_LeftBuffer − 1`) | First byte of the raw transmit buffer (the `0x00` register pointer prepended to the framebuffer). Used by `Display_I2CPushStateMachine`. |
| `0x200007E0` | `Display_LeftBuffer` | 150-byte framebuffer for the left controller (chip 0x60, columns 0–4). |
| `0x20000876` | (`Display_RightBuffer − 1`) | First byte of the raw transmit buffer for the right controller. |
| `0x20000877` | `Display_RightBuffer` | 150-byte framebuffer for the right controller (chip 0x66, columns 5–8). |
| `0x20000920` | `Display_BrightnessCache` | Cached value of the last-written Global Current; prevents redundant register writes. |
| `0x20000921` | `Display_BLEConnectionStatus` | Last-written BLE indicator state. |
| `0x20000930` | `Display_PushSMState` | Current state (0–4) of `Display_I2CPushStateMachine`. |
| `0x20000931` | `Display_RenderFullState` | Current state (0–3) of `Display_RenderFullImage`. |
| `0x20000932` | `Display_RenderOverlayState` | Current state (0–3) of `Display_RenderOverlayImage`. |
| `0x20000933` | `Display_RefreshNeeded` | Flag: set by content-updating functions, read by the main loop to trigger a push. |
| `0x2000090D` | `Display_I2CTransferDoneFlag` | Set by the I²C ISR (via `Display_SetI2COperation`), polled by `Display_I2CPushStateMachine`. |

Within `Display_ContentController`, additional state bytes coordinate between cases:

| Address | Purpose |
|---|---|
| `0x20000079` | Current display mode (the value used as the switch index) |
| `0x2000007A` | Previous display mode (used to detect mode changes for cleanup) |
| `0x2000007C` | State byte for the speed/lock display modes |
| `0x2000007E` | Timer slot for the speed-display fade-out |
| `0x2000007F` | Timer slot for skull/anti-theft notification |
| `0x20000080` | Timer slot for the global 1 Hz blink |
| `0x20000421..0x20000429` | Various per-case flags (charging detected, powerbank detected, lock state, etc.) |
| `0x20000429` | The 1 Hz blink phase (XOR-toggled each second) |

The render state machines have several additional internal state variables (current frame index, frame duration, image pointer, header fields) — see the prefix `PTR_Display_RenderFull_*` and `PTR_Display_RenderOverlay_*` in Ghidra for the full list.

## 12. Function Call Graph (selected paths)

A simplified call graph showing how the major paths fit together:

```
Main_Application
├── Display_Initialize                  (boot, once)
│   └── Display_InitController          (× 2, one per chip)
│       └── HAL_I2C_Master_Transmit
│
├── Display_ContentController           (every tick)
│   ├── Display_SetContent              (selects a full-image)
│   ├── Display_SetOverlayContent      (selects an overlay)
│   ├── Display_UpperNumber             (renders speed/etc)
│   ├── Display_LowerNumber
│   ├── Display_UpdateBLEConnectionStatus
│   ├── Display_UpdateShifterGearDot
│   ├── Display_BatteryGaugeHandler
│   │   ├── CalculateBatteryDots
│   │   ├── Display_UpdateBatteryDots
│   │   └── (queues a battery image via Display_SetContent / overlay setter)
│   └── Display_SetGlobalBrightness
│       └── Display_WriteGlobalCurrent  (× 2, one per chip)
│
├── Display_RenderFullImage             (every tick — state machine)
│   └── (writes into Display_LeftBuffer / Display_RightBuffer)
│
├── Display_RenderOverlayImage          (every tick — state machine)
│   └── (writes into Display_LeftBuffer / Display_RightBuffer, skipping zeros)
│
├── Display_I2CPushStateMachine         (every tick — state machine)
│   ├── I2C_Transmit (non-blocking) → fires interrupt → Display_SetI2COperation
│   └── (on error) I2C1_HandleError + I2C1_Initialize400kHz
│
└── AmbientLight_PollAndUpdate          (every ~1.5 s)
    └── CM3232E_ReadLux
        └── HAL_I2C_Master_Transmit (write) + I2C_ReadDevice (read)
```

## 13. What's Still Open

This reverse-engineering pass left a few areas unexplored. They are not required for understanding or reimplementing the display, but make good starting points for further analysis:

- **The exact bit semantics of the system-state flags** at `r4 + 0x3C0`, `r4 + 0xF0`, `r4 + 0xF1`, `r4 + 0x3D1`, `r4 + 0x3D2`. The complex cases (6, 7, 8, 9, 10, 12) read these and route accordingly; a complete decode would require tracing where these flags are set elsewhere in the firmware.
- **`Shifter_UpdateDetailsWithHysteresis` / `Shifter_UpdateDetails`** — the higher-level gear-selection logic with hysteresis. Functional but its exact thresholds and timing have not been documented.
- **GPIO recovery sequence inside `Display_I2CPushStateMachine` case 0** — toggles pins on GPIOA/GPIOC/GPIOB in a way that does not match a clean I²C1 bus recovery (the pins involved overlap with the I2C3 bus). Possibly vestigial code. For an ESP32 reuse it can be safely ignored.
- **Open/short detection on the INT line (PD14)** — the IS31FL3742A hardware feature exists but is unused by the firmware. See `SX3-Display-Hardware.md` §10.2.
- **The exact mode-byte progression**: which mode follows which in normal use? The dispatcher reads the mode byte but does not (mostly) set it — that happens in the bike main state machine and various event handlers. Mapping out the full mode-transition graph would require tracing all writes to `0x20000079`.

None of these gaps prevent driving the display from a custom MCU, since everything we need (init sequence, frame format, brightness control, content images) is fully documented.
