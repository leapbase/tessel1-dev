# Board 3

Tessel 1, recorded 2026-11-18. See also [board-1.md](board-1.md) and [board-2.md](board-2.md).

**Status: faulty USB link. Scripts start on the board, but the computer cannot reliably talk to it, so no module could be tested.**

## Identity

| Item | Value |
| --- | --- |
| Board ID / USB serial | `TM-00-04-f0009a30-005a434f-6e5c65c2` |
| Firmware before | commit `e59e352` (v0.1.8, 2014-07-19), runtime `2396b5a`, Wi-Fi 1.26 |
| Firmware now | commit `3b8c922`, runtime `dd434be` (v0.2.0), flashed 2026-11-18 from [firmware/](../firmware/README.md). Wi-Fi 1.26 unchanged |
| CLI used | `tessel` 0.3.25 on Node 0.12.18, with a patched log-error handler (see below) |

## Symptoms

- `tessel list` and `tessel version --board` work.
- Any command that runs or stops code (`tessel run`, `tessel stop`, `tessel erase` in normal mode) fails with `LIBUSB_TRANSFER_STALL`, `LIBUSB_ERROR_PIPE` or `LIBUSB_TRANSFER_TIMED_OUT`.
- After a failed session, the board stays stuck until it is reset. The first command after a fresh boot gets furthest; later ones fail at once.
- The red error LED was lit at one point after the firmware flash.

## What was ruled out

| Test | Result |
| --- | --- |
| Replug the USB cable | No change |
| All modules removed | Same failure, so no module is the cause |
| Board 2 on the same cable and USB port | `blink.js` runs cleanly twice, so the cable and port are good |
| `tessel erase` in normal mode | Reported no error, no change |
| Config + Reset, then `tessel erase` in bootloader mode (runs `tessel-erase.bin` from RAM, erases the saved-code sector) | "Tessel filesystem erased". First run after it got as far as "Deploying bundle", then stalled |
| Flash firmware v0.2.0 with `tessel update --dfu` | Flash completed, board reports the new commits. Same stalls afterwards |
| Minimal 4 KB `blink.js` from an empty folder, fresh boot | Deploys, then stalls. **Green and blue LEDs did blink**, so the script runs on the board |
| CLI patched to clear the halt and keep polling on log errors | The log channel recovers once, but the message channel (used for commands and results) then stalls on write and read too |

## What this means

The fault looks internal to the board, probably its USB stack or hardware. Boards 1 and 2 run the same scripts on the same cable, port and computer. Because results cannot be returned reliably, no port was scanned and no module was tested. All modules were unplugged for most of the diagnosis.

## CLI patch

`~/.nvm/versions/node/v0.12.18/lib/node_modules/tessel/src/tessel_usb.js`: the log-endpoint `error` handler used to print and `process.exit(-5)`. It now clears the halt and restarts polling (up to 25 retries) and then carries on without logs. The original is saved next to it as `tessel_usb.js.orig`. Only the error path changed, so boards 1 and 2 are unaffected.

## Open options

- Treat the board as faulty.
- Flash v0.2.0 to board 2 or board 1 to find out whether it fixes the module-library crash (`tointegervalue`). Board 3 could not answer that.
- A rebuild from source (`tessel/t1-firmware`, needs the ARM toolchain) was not attempted.
