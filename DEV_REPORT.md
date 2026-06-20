# GR-55 Editor Dev Report

## Scope Delivered

- Current mapped registry size: 324 parameters.
- Hardware status split:
  - `verified`: 5 write/save/read-back verified controls.
  - `read-verified`: 112 read-verified controls.
  - `fixture-only`: 207 secondary-source or not-yet-hardware-verified controls.
  - `unmapped`: kept in `UNMAPPED_PARAMETER_TODOS`, not exposed as working controls.
- Patch name is mapped at temporary patch address `18 00 00 01`, length 16 ASCII bytes.
- Patch name RQ1/DT1 helpers validate printable ASCII, encode padded bytes, decode read-back bytes, and are covered by tests.
- USER Patch Manager still lists all 297 USER slots and now tracks slot states: `unread`, `reading`, `loaded`, `dirty`, `saved`, `error`.
- Patch Manager search includes cached real names after they are read or imported.
- PCM1, PCM2, Modeling/COSM and Normal PU are no longer UI-only source stubs. They are normal registry modules and participate in read/write/export/dirty state.
- Save flow no longer marks data clean immediately after the save command. It writes staged changes to temporary memory, sends the GR-55 save command, then RQ1 reads back patch name and changed parameters before showing verified saved state.
- Import parses mapped DT1 messages into editor state, including patch name and mapped parameter values. The raw queue remains visible for inspection/send.
- Export mapped patch now writes readable SysEx text, binary mapped `.syx` and parsed mapped JSON. This is not a full raw bulk backup.
- Text/binary SysEx import autodetection handles readable hex text and binary SysEx payloads.
- The UI now has a simplified studio toolbar, Patch Manager, command palette, grouped module navigation, mapped String Matrix, Assigns Programmer and Pedal/GK panel.
- A local MCP stdio server exists in `scripts/gr55-mcp-server.mjs` with hardware mode through the native bridge and mock mode through `GR55_MCP_MOCK=1`.
- Raw unknown SysEx import queues are no longer allowed to use the normal temp-then-save flow. Normal save is mapped-preview-only and still requires the existing save/read-back workflow.

## Newly Mapped Source Controls

USER 73-3 hardware read verification passed for the mapped source set on 2026-06-20. Controls marked `read-verified` answered RQ1/readback but are not write/save/read-back verified. Controls marked `fixture-only` are secondary-source mappings or not-yet-tested fields and must not be called verified.

- PCM1 / PCM2: on/off, PCM tone number, level, octave shift, chromatic, nuance switch, pan, coarse tune, fine tune, portamento switch, release mode, string 1-6 levels, output select, filter type, cutoff offset, resonance offset, TVA attack offset, TVA release offset.
- Modeling/COSM: guitar-mode category, E.GTR model, acoustic model, E.BASS model, synth model, level, on/off, string 1-6 levels, pitch shift, fine shift.
- Normal PU: routing, on/off, level.

## Newly Mapped Pedal / Assign Controls

The registry now includes patch-level CTL, EXP pedal off/on, EXP switch, GK volume, GK S1, GK S2 and Assign 1-8 byte fields. These addresses came from the secondary `motiz88/gr55-remote` address map and are marked `fixture-only` unless this pass read-verified the exact address on USER 73-3.

USER 73-3 non-destructive RQ1 read verification passed for:

- `ctlFunction` `18:00:00:12`
- `expSwitchFunction` `18:00:00:4E`
- `gkS2Function` `18:00:00:7F`
- `assign1Switch` `18:00:01:0C`
- `assign1Target` `18:00:01:0D`
- `assign1Source` `18:00:01:16`
- `assign7TargetMax` `18:00:02:05`
- `assign8Source` `18:00:02:1B`

No pedal/assign DT1 write, USER save, or restore was performed in this pass.

## Still Unmapped / Not Claimed

- Full GR-55 single-patch bulk dump/restore.
- Full USER bank backup/restore.
- Real `.g5l` librarian semantics.
- SMF event parsing for `.mid` / `.midi`; current import scans raw SysEx byte ranges only.
- Full assign target/source coverage. A practical subset is mapped for staged Assign Programmer writes, but most target enum coverage and all pedal/assign write behavior still need hardware verification.
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

- `npm test -- --run`: 10 files, 75 tests passed after the desktop programming pass.
- `npm run build`: TypeScript and Vite production build passed after the desktop programming pass.
- `git diff --check`: passed.
- MCP stdio smoke:
  - `GR55_MCP_MOCK=1 node scripts/gr55-mcp-server.mjs` returns the expanded tool catalog.
  - Hardware-mode `gr55_connect` returned bridge `ready`.
  - Hardware-mode `gr55_get_patch_name` returned `GHOSTLY`.
- Browser checks on `http://127.0.0.1:5173/`:
  - Desktop `1440x950` loaded.
  - Narrow `390x844` loaded without document-level horizontal overflow; mobile UX was not a priority in this pass.
  - No visible `Not mapped yet`, `Unmapped source stub`, or design-stub text.
  - No detected document-level horizontal overflow in checked desktop or narrow viewports.
  - `Cmd/Ctrl+K` command palette opens with read/save/connect/reset/export/SysEx/identity commands.
  - String Matrix renders 6 string rows plus explicit developer mapping-needed notes for unavailable per-string pitch/routing fields.
  - Assigns Programmer renders 8 fixture-only mapped assign rows.
  - Pedal/GK panel renders direct CC controls where available and mapping-needed readouts for EXP switch/GK S1/GK S2 direct live send.
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
  - Additional representative control write/save/read-back/restore passed:
    - PCM1 String 1 Level `100 -> 99 -> 100`.
    - Modeling String 1 Level `100 -> 99 -> 100`.
    - Delay Level `73 -> 74 -> 73`.
    - EQ Low Gain `0 -> 1 -> 0`.
  - New backup before representative writes:
    - `hardware-backups/user-73-3-2026-06-20T15-46-18-592Z-codex-verification-mapped-backup.*`.
  - New report:
    - `hardware-backups/user-73-3-2026-06-20T15-46-18-592Z-codex-verification-report.json`.
  - Final read-back restored USER 73-3 to `GHOSTLY`, PCM1 Level `65`.

Still pending for full verification:
- Full write verification for every individual mapped source/effect control.
- Full raw GR-55 bulk patch backup/restore.
- Real `.g5l` parser and full Roland librarian-file semantics.

## External Blocker

The project still cannot satisfy "raw SysEx backup before write" as a full patch librarian because the full GR-55 bulk patch map/restore flow is not implemented or hardware-verified. The app now warns that mapped SysEx/JSON export is not a full raw bulk backup.
