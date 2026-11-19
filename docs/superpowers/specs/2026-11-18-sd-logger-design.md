# Tessel 1 standalone SD logger: design

Board 1 (`TM-00-04-f0009a30-00674745-667045c2`), firmware v0.2.0, CLI `tessel` 0.3.25 on Node 0.12.

## Intent

Leave the Tessel 1 running on its own on USB power. It records the room's temperature and humidity every minute and takes a camera photo every 5 minutes, saving both to an SD card so the card can later be read on a computer. It is pushed to the board's flash with `tessel push` so it starts on every power-up, with no host attached.

## Hardware (board 1, as recorded 2026-11-18, port A changed to SD today)

| Port | Module | Use |
| --- | --- | --- |
| A | SD card (SPI, chip select = pin `G1`, card detect = `G2`) | Log and photo storage. SD init and CMD8 verified today: SD v2 card, 3.3 V |
| B | Camera VC0706 (UART 115200, power = `digital[2]`) | Photos. 640x480 JPEG ~47 KB |
| C | GPS A2235-H | Not used |
| D | Climate Si7005 (I2C `0x40`, chip select = `digital[0]` held low) | Temperature, humidity |

## Goals

- `LOG.CSV` in the card's root folder, one line per minute: timestamp, temperature (C), humidity (%RH). Header line written when the file is created.
- A new `IMGnnnn.JPG` in the root folder every 5 minutes, numbered continuing from the highest number on the card, never overwriting.
- Files readable on a normal computer (FAT32, 8.3 names).
- Survives power cuts: it restarts by itself and keeps appending. A `boot` line in the log marks each restart.
- A failed read, failed photo or missing card is logged (when possible) and does not stop the next cycle.

## Non-goals

- GPS, servo, Wi-Fi, a web view, or any use of the other modules.
- Real-time accuracy across power cuts, long file names, subfolders, deleting or rotating files, exFAT or FAT16 cards.
- A general file-system library.

## Anti-goals

- Corrupting the card or any file already on it. Existing files are never modified, deleted or overwritten. The card is never reformatted.
- A script that crashes at boot and sits with the red LED on.

## Constraints

- The runtime crashes on bitwise operators in some paths. The existing raw scripts avoid them (arithmetic only) and so must this one.
- The only filesystem code is `raw-sd-write.js`, which writes one small file into the root of a FAT32 card (with a dry-run mode and sector backups). It does not append or span multiple clusters.
- 32 MB RAM, but a 47 KB photo is streamed to the card in chunks, not held whole.
- No real-time clock (see Timestamps).
- Port C cannot do UART; the layout above does not need it.

## Approaches considered

**File writing.**
- A. Extend the raw FAT32 code to append to one file and create new files (chosen).
- B. An npm SD library: unverified on this runtime, which has crashed on library code before. Rejected.
- C. Raw records with no filesystem: safest, but unreadable on a computer without a converter. Rejected.

**Timestamps.**
- A. Start time baked in when the script is pushed, plus uptime (chosen). No network needed. After a power cut the clock restarts from the pushed time, so times after a restart are wrong. The `boot` line marks where.
- B. Wi-Fi time at boot: accurate across power cuts but needs a network and password. Rejected for now. It can be added later.

## Decided

- Storage approach A and timestamp approach A, picked by the user on 2026-11-18.
- Standalone operation via `tessel push`, stated by the user.

## My calls (not yet confirmed by the user)

- **Existing card contents are left alone.** The user did not say whether the card is blank. The writer only adds files and extends `LOG.CSV`. Recommended: use a spare or freshly formatted FAT32 card for the first run and check it on the Mac before relying on it.
- File names `LOG.CSV` and `IMGnnnn.JPG` in the root, 4-digit numbering.
- Timestamp format `YYYY-MM-DD HH:MM:SS` in the board's local start time as given by the pushing Mac, then uptime added.
- If the card is missing or errors, retry at the next cycle and blink an LED instead of exiting.
- The camera is powered and initialised for each photo and not left running between photos.
- Photos are written directly from camera chunks to the card, with the file's size and FAT chain updated only after the last chunk, so a power cut mid-photo loses that photo but not the card.

## Card facts (read from the card on port A, 2026-11-18, read-only)

SDHC/SDXC (block addressing), 15.3 GB, one FAT32 partition starting at sector 8192, 512 bytes/sector, 64 sectors/cluster (32 KB), 2 FATs, root directory at sector 16384. It is **not blank**: 25 root entries from a phone (`DCIM`, `Android`, `Songs`, `System Volume Information`, and others) plus `TESSTEST.TXT` from the earlier write test. Free space has not been measured.

## More calls from the builder check (mine, minor)

- **Arithmetic only, no bitwise operators.** All packing and 28-bit cluster masking use `*256`, `%` and `Math.floor` helpers, as `raw-sd-write.js` already does. An early on-board spike proves this and single-block writes (CMD24) before the rest is built. Multi-block write is not needed: a photo is written one 512-byte block at a time, with camera chunks (128 bytes) buffered up to a sector.
- **Boot scan.** At boot it scans the root directory once for `LOG.CSV` and the highest `IMGnnnn.JPG`, and caches the numbers. An existing `LOG.CSV` is appended to as is. If its directory entry or chain looks damaged, logging goes to `LOG2.CSV` instead of touching it.
- **Log format.** One CSV with columns `time,temp_c,humidity,note`. A normal reading has an empty `note`. A failed sensor read writes empty values and `note=sensor_err`. A restart writes `time,,,boot`. A failed photo writes `time,,,photo_err`. Every row therefore has four columns.
- **Log durability.** The file size in `LOG.CSV`'s directory entry is updated after every line, written as one sector. Never corrupting the card takes priority over never losing a line: the write order is data, then FAT, then directory entry, so a power cut loses at most the last line.
- **Card full.** If a photo cannot be allocated, stop taking photos, keep logging, and write `photo_err` once per attempt. If a log line cannot be written, blink the LED. About 13 MB/day of photos, so a 15 GB card is not a limit for this run.
- **Push wrapper.** A small shell script copies the logger to a scratch folder, replaces a `START_EPOCH` placeholder with the current time, and runs `tessel push` on it. The first on-board test is `tessel run` of the same file, so a crash shows its error.
- **Crash at boot.** A top-level try/catch around startup writes the error to the log when the card is readable and then retries after 60 s, so one failed init does not leave the red LED on.

## Left to the builder

- FAT32 details: cluster allocation, FAT copy updates, directory entry writes, FSInfo, write ordering.
- How the scheduler staggers the 1-minute log and 5-minute photo when they coincide.
- How the start time is embedded at push time (a wrapper that substitutes it into the script).
- Test plan: dry-run first, then check the card on the Mac for file integrity (`fsck`/`diskutil verifyVolume`).
