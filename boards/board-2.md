# Board 2

Tessel 1, recorded 2026-11-18, modules updated 2026-11-19. Board 1 is in [board-1.md](board-1.md).

## Identity

| Item | Value |
| --- | --- |
| Board ID / USB serial | `TM-00-04-f000da30-0061473c-22102586` |
| Firmware commit | `3b8c922` (v0.2.0), flashed 2026-11-18 from [firmware/](../firmware/README.md). Was `e59e352` (v0.1.8, same as board 1) |
| Runtime commit | `dd434be`. Was `2396b5a` |
| Wi-Fi firmware | 1.26 |
| CLI used | `tessel` 0.3.25 on Node 0.12.18 (see the README for setup) |

Find it again with `tessel list`, which prints the board ID. USB vendor and product IDs were not recorded separately for this board.

## Modules and ports (current layout)

| Port | Module | Chip | Status |
| --- | --- | --- | --- |
| A | BLE | BLE113A (BGAPI over UART, 9600 baud, reset pin `digital[2]`) | Alive. After a reset pulse it sent its boot event (`80 0c 00 00 01 00 02 00 02 00 5d 00 03 00 01 06`): firmware 1.2.2 build 93, link layer 3, protocol 1, hardware 6. My raw BGAPI `hello` and `get_info` commands got no reply (unresolved), but the `ble-ble113a` 0.2.0 library works on A: `ready`, and a 15 s scan saw 145 advertisements from 23 nearby devices (needs `bglib`, `async`, `bleadvertise` installed beside it). Not flashed. A first probe (115200 baud, no reset pulse) got 0 bytes, which was wrong on both counts. Scripts: `raw-ble-test.js`, `ble-lib-scan.js`. UART works on A, not on C |
| B | Relay | Two relays, plain GPIO (channel 1 = `digital[0]`, channel 2 = `digital[1]`) | Working. Verified by ear on 2026-11-18: `raw-relay-test.js` pulsed channel 1 three times, then channel 2 three times, and clicks were heard. Both channels left off. There is no chip to identify, so a software read-back alone proves nothing |
| C | RF | nRF24L01 | Working on C (retested 2026-11-19): 9 of 9 registers at power-on defaults, RF channel write and readback works. `RF_SETUP` reads `0x0f` (original nRF24L01). Radio stayed in standby (CE low) and never transmitted. Earlier notes (2026-11-18) had this module in port A |
| D | IR | ATtiny84-based | Chip responds on SPI, but reports firmware version `0x01` (library expects `0x04`) and module ID `0x00` (should be `0x0B`). **Not flashed.** The IR library would flash it on first use |

## Wi-Fi and web server (2026-11-20)

- Joined the 2.4 GHz WPA2 network `leapo` (got `192.168.1.75`, saved on the board; `tessel wifi -d` erases it). The first two joins timed out, the third worked with `-t 40`. Password not recorded.
- `hello-server.js` and `status-server.js` served pages to a browser and `curl` on the same network. They answered only when run first after a Reset.
- Status page data: board, uptime, request count, Wi-Fi address, BLE summary (BLE off by default).

## Moved off this board

| Module | Note |
| --- | --- |
| SD card | Was on C, working (15.3 GB SDHC, `TESSTEST.TXT` written and read back). Removed from this board, so it is not in the layout above. Chip select was `G1` driven by hand |

### RF test results (when it was on A)

Working. 9 of 9 registers read their power-on defaults, a write and readback of the RF channel register works. `RF_SETUP` reads `0x0f`, the default of the original nRF24L01 (the L01+ defaults to `0x0e`). Radio never transmitted, CE held low

## Moved to another board

| Module | Note |
| --- | --- |
| Climate (Si7005) | Was on this board and tested working on ports A and B (ID `0x50`, about 24 C, 32 %RH). Moved to board 1, so it is no longer on this board |
| SD card | Was in port C of this board with a 15.3 GB SDHC FAT32 card (read and write verified on 2026-11-18: `raw-sd-ls.js` listed 25 root entries, `raw-sd-write.js` wrote `TESSTEST.TXT`). Moved to board 1 (port A) on 2026-11-19, so it is no longer on this board. The card there was later damaged by the logger and reformatted: see the logger notes in [board-1.md](board-1.md) |

## Check on 2026-11-19

Board 2 was connected again (`tessel list` shows ID `TM-00-04-f000da30-0061473c-22102586`) and the USB link was stable: four scan scripts ran back to back with no errors. `raw-board-scan.js` on ports A to D identified nothing. It only recognises climate, GPS, camera, servo and SD modules, so that is expected for the radio, relay and IR modules that are on this board. Port A heard 26 bytes of serial noise in the passive UART listen once, which does not identify a module. Afterwards the radio test was run on port C and passed, which is where the nRF24 module is now (see the table above). The relay (port B) and IR (port D) rows were not re-verified: they still reflect the 2026-11-18 tests.

## Modules tried and not working

| Module | What happened |
| --- | --- |
| Accelerometer (MMA8452Q) | No I2C reply at `0x1D` or `0x1C` on ports A, B and D, and a full I2C scan of port A found nothing. Port A is proven good by other modules, so the module is most likely faulty |
| Ambient | `ff ff ff` on every read of the ATtiny handshake, on ports B and D. Port D is proven good by the IR module, so the module is most likely blank or faulty. Never flashed |

## Known limits on this board

Same as board 1:

- **Firmware v0.2.0 fixed the bitwise-operator crash on this board (2026-11-18).** Before the flash, a script using `<<`, `>>`, `|`, `&` or `^` died with `attempt to call field 'tointegervalue' (a nil value)`. After it, a test script gave correct results for all five operators, and the `rf-nrf24` npm library (which uses bitwise operators) initialized on port A and emitted `ready`. Other libraries are untested on this board. `blink.js` still works.
- The probe results in the tables above were taken on the old v0.1.8 firmware with raw scripts. They are still valid, but were not rerun after the flash.
- Port C cannot do UART. Use A, B or D.
- `tessel update` does not work (the build server is gone). Firmware was never changed.
- Flashing an ATtiny module (ambient, IR) goes through library code that uses bitwise operators. That code may now run on v0.2.0, so the IR library would flash the IR module on first use. Do not call `ir-attx4` unless you want that.
- `process.sendfile` saves files only with `tessel run <file> -u <dir>`.

## Scripts used for this board

`raw-ble-test.js` (BLE113A boot event and BGAPI check, port A), `raw-board-scan.js` (per-port identify: I2C, climate, GPS, camera), `raw-climate-test.js`, `raw-sd-test.js`, `raw-nrf24-test.js`, `raw-attiny-test.js` (read-only identity check for ambient and IR), `raw-ambient-test.js`, `raw-accel-sd-test.js`, `raw-i2c-scan.js`, `raw-relay-test.js` (switches real loads, use with care), `raw-sd-ls.js` (root-folder listing, needs an SD module), `raw-sd-write.js` (writes one test file to a FAT32 card; defaults to a dry run with sector backups, set `WRITE = true` to write). Port letters and the module settings at the top of each script match the table above, so edit them if a module sits elsewhere.
