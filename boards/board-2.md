# Board 2

Tessel 1, recorded 2026-11-18. Board 1 is in [board-1.md](board-1.md).

## Identity

| Item | Value |
| --- | --- |
| Board ID / USB serial | `TM-00-04-f000da30-0061473c-22102586` |
| Firmware commit | `e59e352` (same as board 1) |
| Runtime commit | `2396b5a` (same as board 1) |
| Wi-Fi firmware | 1.26 |
| CLI used | `tessel` 0.3.25 on Node 0.12.18 (see the README for setup) |

Find it again with `tessel list`, which prints the board ID. USB vendor and product IDs were not recorded separately for this board.

## Modules and ports (current layout)

| Port | Module | Chip | Status |
| --- | --- | --- | --- |
| A | RF | nRF24L01 | Working. 9 of 9 registers read their power-on defaults, a write and readback of the RF channel register works. `RF_SETUP` reads `0x0f`, the default of the original nRF24L01 (the L01+ defaults to `0x0e`). Radio never transmitted, CE held low |
| B | Climate | Si7005 (ID `0x50`) | Working. 24.1 C, 32.6 %RH. Also tested working on port A. Chip select `digital[0]` must be low |
| C | SD card | SD card on SPI | Working. Card answers CMD0 with `0x01` and CMD8 with `01 AA`: an SD v2 card at 3.3 V. Chip select is pin `G1` driven by hand |
| D | IR | ATtiny84-based | Chip responds on SPI, but reports firmware version `0x01` (library expects `0x04`) and module ID `0x00` (should be `0x0B`). **Not flashed.** The IR library would flash it on first use |

## Modules tried and not working

| Module | What happened |
| --- | --- |
| Accelerometer (MMA8452Q) | No I2C reply at `0x1D` or `0x1C` on ports A, B and D, and a full I2C scan of port A found nothing. Port A is proven good by other modules, so the module is most likely faulty |
| Ambient | `ff ff ff` on every read of the ATtiny handshake, on ports B and D. Port D is proven good by the IR module, so the module is most likely blank or faulty. Never flashed |

## Known limits on this board

Same as board 1:

- The npm module libraries crash on this firmware because bitwise operators compile to a missing `tointegervalue` call. Raw scripts that avoid `<<`, `>>`, `|`, `&` and `^` work.
- Port C cannot do UART. Use A, B or D.
- `tessel update` does not work (the build server is gone). Firmware was never changed.
- Flashing an ATtiny module (ambient, IR) goes through library code that uses bitwise operators, so it would probably crash on this firmware too.
- `process.sendfile` saves files only with `tessel run <file> -u <dir>`.

## Scripts used for this board

`raw-board-scan.js` (per-port identify: I2C, climate, GPS, camera), `raw-climate-test.js`, `raw-sd-test.js`, `raw-nrf24-test.js`, `raw-attiny-test.js` (read-only identity check for ambient and IR), `raw-ambient-test.js`, `raw-accel-sd-test.js`, `raw-i2c-scan.js`. Port letters and the module settings at the top of each script match the table above, so edit them if a module sits elsewhere.
