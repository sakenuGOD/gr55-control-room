# GR-55 Editor Dev Report

## Scope Delivered

- Patch name is mapped at temporary patch address `18 00 00 01`, length 16 ASCII bytes.
- Patch name RQ1/DT1 helpers validate printable ASCII, encode padded bytes, decode read-back bytes, and are covered by tests.
- USER Patch Manager still lists all 297 USER slots and now tracks slot states: `unread`, `reading`, `loaded`, `dirty`, `saved`, `error`.
- Patch Manager search includes cached real names after they are read or imported.
- PCM1, PCM2, Modeling/COSM and Normal PU are no longer UI-only source stubs. They are normal registry modules and participate in read/write/export/dirty state.
- Save flow no longer marks data clean immediately after the save command. It writes staged changes to temporary memory, sends the GR-55 save command, then RQ1 reads back patch name and changed parameters before showing verified saved state.
- Import parses mapped DT1 messages into editor state, including patch name and mapped parameter values. The raw queue remains visible for inspection/send.
- Export mapped patch now writes readable SysEx text plus parsed mapped JSON. This is not a full raw bulk backup.

## Newly Mapped Source Controls

USER 73-3 hardware read verification passed for the mapped source set on 2026-06-20. Controls that still show `fixture-only` are not fake; the address read back from the GR-55, but that individual write behavior has not been tested for every control.

- PCM1 / PCM2: on/off, PCM tone number, level, octave shift, chromatic, nuance switch, pan, coarse tune, fine tune, portamento switch, release mode, string 1-6 levels, output select, filter type, cutoff offset, resonance offset, TVA attack offset, TVA release offset.
- Modeling/COSM: guitar-mode category, E.GTR model, acoustic model, E.BASS model, synth model, level, on/off, string 1-6 levels, pitch shift, fine shift.
- Normal PU: routing, on/off, level.

## Still Unmapped / Not Claimed

- Full GR-55 single-patch bulk dump/restore.
- Full USER bank backup/restore.
- Real `.g5l` librarian semantics.
- SMF event parsing for `.mid` / `.midi`; current import scans raw SysEx byte ranges only.
- Assign target/source mappings.
- PCM1 / PCM2 Portamento Time. Secondary addresses `18:00:20:0D` and `18:00:21:0D` did not answer single USER 73-3 RQ1 checks, so they were removed from working controls and added to `UNMAPPED_PARAMETER_TODOS`.
- Model-specific COSM controls beyond the core mapped modeling fields above.
- Patch-level sends/routing fields not present in the mapped registry.
- Save response semantics for `0F 00 00 01` / `0F 00 00 02`; current safety uses explicit read-back verification instead.

## Documentation / References Used

- Roland official Owner's Manual: https://static.roland.com/assets/media/pdf/GR-55_OM.pdf
- Roland official PCM Tone List: https://static.roland.com/assets/media/pdf/GR-55_PCM_Tone_List.pdf
- Roland official Parameter Addendum: https://static.roland.com/assets/media/pdf/GR-55_PA.pdf
- Roland official product specs: https://www.roland.com/global/products/gr-55/
- Secondary address reference: https://github.com/motiz88/gr55-remote
- Secondary legacy editor reference: https://github.com/motiz88/GR-55Floorboard

Official Roland docs confirm the patch architecture, tone categories and parameter concepts. The detailed temporary-patch SysEx offsets for patch name and new source controls came from the secondary address references; USER 73-3 now confirms the mapped read path for the expanded registry.

## Verification Run

- `npm test`: 5 files, 46 tests passed after the hardware pacing/unmapped-address patch.
- `npm run build`: TypeScript and Vite production build passed after the hardware pacing/unmapped-address patch.
- `git diff --check`: passed.
- Browser checks on `http://127.0.0.1:5173/`:
  - Desktop and mobile loaded.
  - No visible `Not mapped yet`, `Unmapped source stub`, or design-stub text.
  - No detected text/control overflow in checked viewports.
  - PCM1 source opens a real module editor with registry controls and fixture-only badges.
- UI hardware pass on `http://127.0.0.1:5173/` with Native Bridge running:
  - Selected `USER 73-3` through Patch Manager.
  - UI completed `Mapped read complete for USER 73-3: 109/109`.
  - Patch Manager showed real name `GHOSTLY`.
  - Reloaded page and confirmed unscoped external DT1 no longer pollutes the default unselected slot.

## USER 73-3 Hardware Status

- Verified on USER 73-3 on 2026-06-20:
  - Native Bridge detected GR-55 USB device `0582:0127`, endpoint `cfg 1 / if 2 / alt 0 / out 3 / in 2`.
  - Identity reply returned: `F0 7E 10 06 02 41 53 02 00 00 00 00 00 00 F7`.
  - Patch name read returned `GHOSTLY`.
  - Raw mapped backup captured before writing: `hardware-backups/user-73-3-2026-06-20T14-26-58-137Z-verified-mapped-backup.*`.
  - Expanded mapped read completed `110/110` messages including patch name, no checksum errors.
  - Patch name write/save/read-back passed: `GHOSTLY -> GHOSTLY TMP -> GHOSTLY`.
  - PCM1 Level write/save/read-back passed: `65 -> 66 -> 65`.
  - Final read-back restored USER 73-3 to `GHOSTLY`, PCM1 Level `65`.

Still pending for full verification:
- Full write verification for every individual mapped source/effect control.
- Full raw GR-55 bulk patch backup/restore.
- Binary `.syx` mapped export.

## External Blocker

The project still cannot satisfy "raw SysEx backup before write" as a full patch librarian because the full GR-55 bulk patch map/restore flow is not implemented or hardware-verified. The app now warns that mapped SysEx/JSON export is not a full raw bulk backup.
