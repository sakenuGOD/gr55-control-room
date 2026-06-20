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
