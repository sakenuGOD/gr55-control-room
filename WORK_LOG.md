# GR-55 Control Room Work Log

## 2026-06-20 Codex Long Pass

### Audit Findings

- `src/App.tsx` was still the main UI monolith and contained duplicated primary actions in the toolbar, Patch Manager and inspector.
- Raw SysEx, reset, identity, export and destructive actions were too close to primary patch-editing controls.
- The parameter registry defaulted omitted hardware status to `verified`, which could overstate unverified fixture/read-only mappings.
- Modeling category selectors were shown as peers even though only one model selector is relevant for the active category.
- Per-string controls existed in the registry but were not presented as a string matrix workflow.
- Assign/model/MFX/MOD type-specific gaps needed explicit unmapped TODOs rather than placeholder controls.
- Mapped export was still text/JSON only, import did not reliably autodetect text-vs-binary, and MCP control surface was missing.

### Changes Made

- Added registry metadata discipline: `source`, `uiGroup`, `dependencies`, explicit `hardwareVerificationStatus`, and unmapped TODOs for assign/model/MOD/MFX type-specific gaps.
- Changed the default hardware status for mapped parameters to `fixture-only`; only write/save/read-back verified IDs are marked `verified`.
- Split UI pieces out of `App.tsx`: `StudioToolbar`, `PatchManager`, `StringMatrix`.
- Replaced the overloaded toolbar with status, selected USER slot/name, `Read`, `Send Staged`, `Save`, mode toggle and command palette.
- Added keyboard command palette on `Cmd/Ctrl+K` with read/save/connect/reset/export/SysEx/identity commands.
- Added grouped navigation: Librarian, Sources, Effects, Assigns/Pedals, SysEx/MCP/Debug.
- Added a real String Matrix view for mapped PCM1, PCM2 and Modeling string levels, with dirty cells, row reset/mute/copy and batch normalize/restore.
- Gated Modeling model selectors by `modelingCategory` dependencies.
- Added binary mapped `.syx` export and text/binary import autodetect for SysEx files.
- Added local MCP server core and stdio wrapper with 19 GR-55 tools, schemas, mock tests and a real WebSocket bridge adapter.
- Moved destructive save/write MCP paths behind selected USER slot, backup status and explicit safety flags.
- Restyled the UI toward a light studio/tool editor, with compact toggles and less dark/glow-heavy styling.

### Hardware Verification

- USER 73-3 was available through Native Bridge.
- Mapped backup was written before any DT1 write:
  - `hardware-backups/user-73-3-2026-06-20T15-46-18-592Z-codex-verification-mapped-backup.json`
  - `hardware-backups/user-73-3-2026-06-20T15-46-18-592Z-codex-verification-mapped-backup.syx.txt`
  - `hardware-backups/user-73-3-2026-06-20T15-46-18-592Z-codex-verification-mapped-backup.syx`
- Safe delta write/save/read-back/restore/save/read-back passed for:
  - `pcm1Level`
  - `pcm1String1Level`
  - `modelingString1Level`
  - `delayLevel`
  - `eqLowGain`
- Report artifact:
  - `hardware-backups/user-73-3-2026-06-20T15-46-18-592Z-codex-verification-report.json`

### Remaining Backlog

- Full Roland single-patch bulk dump parsing and restore.
- Full USER bank backup/restore.
- Real `.g5l` librarian parser semantics.
- Standard MIDI File event parsing for `.mid` / `.midi`.
- Full MOD/MFX/model-specific parameter mapping and hardware verification.
- Assign target/source mapping.
- Save response semantic decoding for `0F 00 00 01` and `0F 00 00 02`.
- Full per-parameter write/save/read-back verification beyond the current verified whitelist.

## 2026-06-20 Codex Desktop Programming Pass

### Scope Shift

- Mobile UX was explicitly deprioritized. This pass focused on a dense desktop editor/control surface.
- Primary goal was real GR-55 programming coverage through UI and MCP, especially strings, source layers, pedals/GK controls, assigns and save/read-back safety.

### Changes Made

- Expanded `src/data/gr55Parameters.ts` from 109 working mapped controls to 324 mapped registry parameters:
  - 111 pedal/GK/CTL/EXP fields.
  - 104 Assign 1-8 fields.
  - Existing source/effect modules now distinguish `verified`, `read-verified`, `fixture-only` and `unmapped`.
- Added `read-verified` status. The `verified` whitelist remains limited to write/save/read-back verified controls:
  - `pcm1Level`
  - `pcm1String1Level`
  - `modelingString1Level`
  - `delayLevel`
  - `eqLowGain`
- Added `split12Offset1024` encoding for assign target min/max.
- Replaced the old CC-only Assigns/Pedal surface with:
  - `AssignsProgrammer`
  - `PedalControlPanel`
  - registry-backed `pedal` and `assigns` modules.
- Added pure action layers:
  - `src/lib/actions/stringMatrix.ts`
  - `src/lib/actions/assigns.ts`
- Upgraded String Matrix to a registry-derived model with mute, safe solo, restore, copy row to all, normalize and percent scaling.
- Expanded MCP tools beyond generic parameter set/get with string matrix, assign/control, save-with-readback and import-preview tools.
- Fixed raw import safety:
  - Unknown/unmapped raw SysEx queues can be sent to temporary memory only from the utility drawer.
  - Normal USER save is allowed only for mapped import previews and goes through mapped save/read-back.
  - The previous normal `Temp then save` raw queue path was removed.
- Inspector now always shows selected parameter/source address, data size, current/original value, dirty state, verification status, last sent and read-back context.
- Desktop CSS was tightened for denser studio/editor use: narrower sidebars, denser tabs, shorter module headers and more compact parameter rows.

### Hardware Verification

- Hardware was available through Native Bridge.
- Safe slot: `USER 73-3`, selected with Bank MSB `1`, Program `90`.
- Patch name read-back: `GHOSTLY`.
- Non-destructive RQ1 read verification passed for these new pedal/assign fields:
  - `ctlFunction` at `18:00:00:12`, data `06`.
  - `expSwitchFunction` at `18:00:00:4E`, data `00`.
  - `gkS2Function` at `18:00:00:7F`, data `00`.
  - `assign1Switch` at `18:00:01:0C`, data `00`.
  - `assign1Target` at `18:00:01:0D`, data `00 00 00`.
  - `assign1Source` at `18:00:01:16`, data `00`.
  - `assign7TargetMax` at `18:00:02:05`, data `04 00 01`.
  - `assign8Source` at `18:00:02:1B`, data `00`.
- No write/save/read-back was attempted for new pedal/assign fields in this pass.

### Verification

- `npm test -- --run`: 10 files, 75 tests passed.
- `npm run build`: TypeScript and Vite production build passed.
- Browser smoke:
  - Desktop `1440x950`: String Matrix, Assigns Programmer and Pedal/GK panel rendered with no document-level horizontal overflow.
  - Narrow `390x844`: app visible, no document-level horizontal overflow. Mobile UX was not optimized in this pass.
- Hardware bridge status: GR-55 USB ready at `cfg 1 / if 2 / alt 0 / out 3 / in 2`.

### Remaining Backlog

- Write/save/read-back verification for the new pedal/GK/assign bytes.
- More complete and hardware-verified assign target enum coverage.
- Full raw Roland bulk patch dump/restore and full USER bank backup/restore.
- MOD/MFX/model-specific deeper controls beyond current mapped surface.
- Save response semantic decoding for `0F 00 00 01` and `0F 00 00 02`.
