# Hardware Test Log

## 2026-06-19 21:22 MSK

- OS: macOS Darwin 25.3.0 arm64.
- App route: Vite dev server at `http://127.0.0.1:5176/`.
- Connection route: Native Bridge over `ws://127.0.0.1:5174`.
- Existing bridge: PID 21328 was already listening on port 5174. Starting a second bridge failed with `EADDRINUSE`.
- GR-55 detected: yes. Native bridge reported `Roland GR-55 (0x0582:0x0127)`, `cfg 1 / if 2 / alt 0 / out 3 / in 2`.
- Safe USER slot for destructive testing: not provided.

### Actions Tested

- Confirmed Vite served the app with HTTP 200 on port 5176.
- Confirmed active Native Bridge WebSocket returned a `hello` status.
- First identity request failed with `transferOut error: endpoint not found`.
- Sent bridge `reset-usb`, then `connect-usb`. Bridge reconnected to the GR-55 on USB address 3.
- Sent MIDI Identity Request: `F0 7E 7F 06 01 F7`.
- Received identity reply from hardware: `F0 7E 10 06 02 41 53 02 00 00 00 00 00 00 F7`.
- Sent non-destructive RQ1 reads for mapped temporary-patch parameters:
  - Patch Level at `18 00 02 30`, received `06 04`.
  - Amp Switch at `18 00 07 00`, received `01`.
  - Delay Time at `18 00 06 07`, received `01 09 00`.
  - Reverb Level at `18 00 06 10`, received `2B`.
- Sent a temporary DT1 write for Patch Level 99 at `18 00 02 30`, read back `06 03`.
- Restored temporary Patch Level to 100, read back `06 04`.

### Pass / Fail Notes

- PASS: Native Bridge detects the Roland GR-55 over USB after reset/reconnect.
- PASS: Identity request returned a Roland response from the GR-55.
- PASS: Mapped RQ1 reads returned DT1 responses.
- PASS: Temporary DT1 write/readback worked for Patch Level and was restored.
- PARTIAL: Bridge intermittently reports `transferIn error: endpoint not found` during reads, but DT1 replies still arrived.
- BLOCKED: In-app browser was unavailable, and Playwright MCP browser was locked by another browser session. UI was not visually inspected in a browser during this run.

### Not Tested Intentionally

- Save to USER slot.
- Clear USER slot by muted overwrite.
- Import queue save to USER slot.
- Selecting several USER slots from the UI.
- Hardware A/B compare.
- Full all-parameter mapped read from the UI.
- Patch-name read/write.
- Full patch backup or restore.

## 2026-06-19 Later Session, Safe Slot USER 73-3

- Connection route: Native Bridge over `ws://127.0.0.1:5174`.
- GR-55 detected: yes, `Roland GR-55 (0x0582:0x0127)`.
- Endpoint set: `cfg 1 / if 2 / alt 0 / out 3 / in 2`.
- Safe USER slot provided by user: `USER 73-3`.
- USER index: `218`; Bank MSB `1`; Program `90` (`0x5A`).

### Actions Tested

- Restarted Native Bridge.
- Connected GR-55 USB.
- Sent Identity Request and received the same GR-55 identity reply:
  - `F0 7E 10 06 02 41 53 02 00 00 00 00 00 00 F7`.
- Sent USER 73-3 selection:
  - `B0 00 01`
  - `C0 5A`
- Sent RQ1 reads for all 45 currently mapped temporary-patch parameters.
- First full pass returned 38/45 mapped DT1 responses.
- Retried missing addresses more slowly; all 45 mapped addresses were eventually read.
- Sent temporary DT1 writes and restored them:
  - Patch Level `06 04 -> 06 03 -> 06 04`.
  - Amp Level `2D -> 2E -> 2D`.
  - Delay Level `49 -> 4A -> 49`.
- Sent save temporary patch to safe slot USER 73-3 after restoring test values:
  - `F0 41 10 00 00 53 11 0F 00 00 00 01 00 5A 7F 17 F7`.
- Observed two DT1 responses after save:
  - `F0 41 10 00 00 53 12 0F 00 00 01 00 00 00 01 00 5A 7F 16 F7`
  - `F0 41 10 00 00 53 12 0F 00 00 02 00 00 00 01 00 5A 7F 15 F7`

### Pass / Fail Notes

- PASS: USER 73-3 selection command sequence was sent.
- PASS: All 45 currently mapped parameters were read after retrying missing addresses.
- PASS: Temporary DT1 writes changed GR-55 temporary memory and read back correctly.
- PASS: Temporary DT1 restore writes read back correctly.
- PARTIAL: Save command produced observed DT1 responses, but their exact semantic meaning is not decoded yet.
- PARTIAL: Continuous USB input polling initially disconnected on `transferIn error: endpoint not found`; bridge was patched to treat this as transient.
- PARTIAL: Intermittent `transferIn error: endpoint not found` still appears and should be expected/retried around RQ1 batches.
- PASS: Post-build smoke test returned Identity Reply and Patch Level RQ1 response:
  - `F0 7E 10 06 02 41 53 02 00 00 00 00 00 00 F7`
  - `F0 41 10 00 00 53 12 18 00 02 30 06 04 2C F7`

### Artifacts

- Exact command formulas, mapped read table, temporary write tests, and save responses are captured in `GR55_INTERACTION_NOTES.md`.

### Not Tested

- Physical GR-55 knob/button interaction while watching app mirror incoming MIDI.
- Full patch backup/restore.
- Patch-name read/write.
- PCM/modeling/source/assign mappings.
- Clear USER slot by muted overwrite.

## 2026-06-19 22:22 MSK, UI + Hardware Round Trip

- OS: macOS Darwin 25.3.0 arm64.
- App route: Vite dev server at `http://127.0.0.1:5173/`.
- Connection route: Native Bridge over `ws://127.0.0.1:5174`.
- GR-55 detected: yes, `Roland GR-55 (0x0582:0x0127)`.
- Endpoint set: `cfg 1 / if 2 / alt 0 / out 3 / in 2`.
- Safe USER slot provided by user: `USER 73-3`.
- Destructive clear/delete test: intentionally not run, because full slot backup/restore is not implemented.

### Actions Tested

- Restarted the Native Bridge after adding a serialized outgoing MIDI queue.
- First identity request after reconnect did not return a reply, but repeated identity requests did:
  - `F0 7E 10 06 02 41 53 02 00 00 00 00 00 00 F7`
- Read Patch Level by RQ1:
  - request `F0 41 10 00 00 53 11 18 00 02 30 00 00 00 02 34 F7`
  - response `F0 41 10 00 00 53 12 18 00 02 30 06 04 2C F7`
- Selected slots from the UI and observed real outgoing MIDI:
  - `USER 73-2`: `B0 00 01`, `C0 59`, followed by mapped RQ1 reads.
  - `USER 73-3`: `B0 00 01`, `C0 5A`, followed by mapped RQ1 reads.
- Confirmed UI selection does not pretend contents are loaded: selected slot becomes unread until mapped DT1 responses arrive.
- Read all currently mapped parameters from the UI:
  - `Mapped read complete for USER 73-3: 45/45`.
- Tested Live Preview on mapped NS Release at `18 00 07 5C`:
  - UI changed Release `5 -> 6`; RQ1 returned `06`.
  - UI restored Release `6 -> 5`; RQ1 returned `05`.
- Tested Staged Preview on mapped NS Release:
  - UI changed Release `5 -> 6` with Staged selected.
  - RQ1 still returned `05`, confirming staged edits did not live-send.
  - UI value was restored to `5`.
- Tested UI save to safe slot `USER 73-3` after explicit confirmation:
  - `F0 41 10 00 00 53 11 0F 00 00 00 01 00 5A 7F 17 F7`.
- Restored NS Release to `5` after the save test and saved the restored temporary patch back to `USER 73-3`.
- Observed save-related incoming data:
  - `F0 41 10 00 00 53 12 0F 00 00 01 00 00 00 01 00 5A 7F 16 F7`
  - `F0 41 10 00 00 53 12 0F 00 00 02 00 00 00 01 00 5A 7F 15 F7`
  - `B0 00 01`, `B0 20 00`, `C0 5A`
- Exported current mapped patch from the UI:
  - filename `gr55-user-73-3-mapped-patch.txt`
  - size `1945` bytes
  - contents are readable text hex SysEx lines, not binary `.syx` and not a full backup.
- Imported the mapped export back as `.txt`:
  - queue count `45`
  - classification `Mapped patch parameter set`
  - detail `45 mapped temporary-patch parameter messages. This is still not a full GR-55 bulk patch dump.`
- Cleared the import queue without sending it to the GR-55.
- Monitored hardware-originated input for 30 seconds while the user was at the controller:
  - `midi-in=0`
- After adding the explicit slot-selection guard, reloaded the UI and confirmed cold start says no USER slot is selected.
- Selected `USER 73-3` from the UI again:
  - outgoing `B0 00 01`
  - outgoing `C0 5A`
  - first observed RQ1/DT1 pairs were Patch Level and Patch Tempo.
  - UI completed `Mapped read complete for USER 73-3: 45/45`.

### Pass / Fail Notes

- PASS: UI USER slot selection sends the expected Bank Select and Program Change bytes.
- PASS: Selecting a slot marks it unread until mapped RQ1/DT1 responses populate the editor.
- PASS: Full mapped read completed at 45/45 through the UI after bridge send serialization.
- PASS: Live Preview changed a real mapped GR-55 temporary parameter and RQ1 readback confirmed it.
- PASS: Staged Preview did not send temporary DT1 writes until an explicit send/save action.
- PASS: UI save command was sent only after confirmation and only to the safe test slot.
- PASS: Mapped patch export is valid readable SysEx text.
- PASS: Mapped export can be imported as `.txt` and is classified honestly as a mapped parameter set.
- PASS: Cold-start UI no longer claims a default USER slot is selected before Bank Select / Program Change leave the app.
- PASS: Explicit slot-selection guard did not break real `USER 73-3` selection or mapped read.
- PARTIAL: First identity request after bridge restart can still miss; retry works.
- PARTIAL: Hardware-originated panel/pedal events were not observed in this GR-55 MIDI/USB configuration.
- PARTIAL: Save response messages are observed but not semantically decoded as a guaranteed commit acknowledgement.

### Not Tested Intentionally

- Clear USER slot by muted overwrite, because there is no full bulk backup/restore to recover the whole slot afterward.
- Import queue send/save, because the tested queue was the app's mapped text export and sending it again would be redundant/destructive.
- Full patch backup/restore.
- Patch-name read/write.
- PCM/modeling/source/assign mappings.

## 2026-06-20 17:20 MSK, Expanded Registry + Patch Name Hardware Verification

- App route: Vite dev server at `http://127.0.0.1:5173/`.
- Connection route: Native Bridge over `ws://127.0.0.1:5174`.
- GR-55 detected: yes, `Roland GR-55 (0x0582:0x0127)`.
- Endpoint set: `cfg 1 / if 2 / alt 0 / out 3 / in 2`.
- Safe USER slot: `USER 73-3`.
- USER index: `218`; Bank MSB `1`; Program `90` (`0x5A`).

### Actions Tested

- Started the native bridge; startup status reported `devices=1`.
- Connected GR-55 USB through the bridge.
- Sent Identity Request and received:
  - `F0 7E 10 06 02 41 53 02 00 00 00 00 00 00 F7`.
- Selected `USER 73-3`:
  - `B0 00 01`
  - `C0 5A`
- Read patch name from temporary patch address `18 00 00 01`.
  - Response decoded to `GHOSTLY`.
- First expanded mapped read at the old fast request pacing returned `71/112`; checksum errors `0`.
- Retried representative missing addresses one-by-one:
  - Amp Level, Chorus Switch, Delay Time, EQ Switch and NS Switch responded.
  - PCM1 Portamento Time `18:00:20:0D` did not respond.
- Re-ran expanded mapped read with slower request pacing:
  - `110/112` responded.
  - Missing only PCM1/PCM2 Portamento Time at `18:00:20:0D` and `18:00:21:0D`.
- Removed PCM1/PCM2 Portamento Time from working controls and recorded them in `UNMAPPED_PARAMETER_TODOS`.
- Re-ran mapped backup/read after removing the nonresponding controls:
  - `109` mapped parameters plus patch name.
  - Expected `110`, received `110`.
  - Missing `0`, checksum errors `0`.
  - Backup artifacts:
    - `hardware-backups/user-73-3-2026-06-20T14-26-58-137Z-verified-mapped-backup.syx.txt`
    - `hardware-backups/user-73-3-2026-06-20T14-26-58-137Z-verified-mapped-backup.json`
- Performed reversible save/read-back verification:
  - Before: patch name `GHOSTLY`, PCM1 Level `65`.
  - Wrote temporary values: patch name `GHOSTLY TMP`, PCM1 Level `66`.
  - Saved temporary patch to `USER 73-3`.
  - Read back: patch name `GHOSTLY TMP`, PCM1 Level `66`.
  - Restored temporary values: patch name `GHOSTLY`, PCM1 Level `65`.
  - Saved temporary patch to `USER 73-3`.
  - Final read back: patch name `GHOSTLY`, PCM1 Level `65`.
  - Report artifact: `hardware-backups/user-73-3-2026-06-20T14-27-47-991Z-write-save-readback-report.json`.
- Verified UI with Native Bridge running:
  - Reloaded page.
  - Selected `USER 73-3` from Patch Manager.
  - UI completed `Mapped read complete for USER 73-3: 109/109`.
  - Patch Manager showed `USER 73-3 - GHOSTLY`.
  - Patch name input showed `GHOSTLY`.
  - Confirmed the previous unscoped-DT1 bug was fixed: after reload, `USER 71-3` did not keep the externally-read `GHOSTLY` name.

### Pass / Fail Notes

- PASS: Native Bridge sees and claims the real GR-55 USB endpoint.
- PASS: Identity request returns a GR-55 identity reply.
- PASS: Patch name read works on USER 73-3.
- PASS: Patch name write, save-to-USER, and read-back verification works.
- PASS: Expanded mapped read succeeds at 109/109 from the UI and 110/110 including patch name from the hardware harness.
- PASS: PCM1 Level write/save/read-back works and was restored.
- PASS: UI no longer applies unscoped external DT1 messages to an unselected/default USER slot.
- PASS: Two secondary Portamento Time addresses that did not answer hardware RQ1 are not shown as working controls.
- PARTIAL: Mapped backup is raw mapped DT1 SysEx plus JSON, not a full Roland bulk patch dump.
- PARTIAL: Only patch name and PCM1 Level were write/save/read-back verified in this expanded pass; the rest of the expanded controls have read verification but not individual write verification.

### Not Tested Intentionally

- Full raw GR-55 bulk patch backup/restore.
- Clear USER slot by muted overwrite.
- Import queue send/save.
- Individual write verification for every mapped PCM/modeling/source/effect control.

## 2026-06-20 18:46 MSK, Representative Control Write/Save/Restore Verification

- App route: Vite dev server at `http://127.0.0.1:5173/`.
- Connection route: Native Bridge over `ws://127.0.0.1:5174`.
- GR-55 detected: yes, bridge startup reported `devices=1`.
- Endpoint set: `cfg 1 / if 2 / alt 0 / out 3 / in 2`.
- Safe USER slot: `USER 73-3`.
- USER index: `218`; Bank MSB `1`; Program `90` (`0x5A`).
- Patch name before writes: `GHOSTLY`.

### Backup Before Writes

- Mapped read completed `109/109` mapped parameters plus patch name.
- Backup artifacts:
  - `hardware-backups/user-73-3-2026-06-20T15-46-18-592Z-codex-verification-mapped-backup.json`
  - `hardware-backups/user-73-3-2026-06-20T15-46-18-592Z-codex-verification-mapped-backup.syx.txt`
  - `hardware-backups/user-73-3-2026-06-20T15-46-18-592Z-codex-verification-mapped-backup.syx`

### Actions Tested

- Selected `USER 73-3`:
  - `B0 00 01`
  - `C0 5A`
- Staged/no-send behavior probe:
  - `pcm1Level` staged target `66`.
  - Hardware read before no-send: `65`.
  - Hardware read after no-send: `65`.
- Temporary write, save, read-back, restore, save, read-back verification:
  - `pcm1Level`: `65 -> 66 -> 65`.
  - `pcm1String1Level`: `100 -> 99 -> 100`.
  - `modelingString1Level`: `100 -> 99 -> 100`.
  - `delayLevel`: `73 -> 74 -> 73`.
  - `eqLowGain`: `0 -> 1 -> 0`.
- Save responses were observed after both changed save and restore save:
  - `0F 00 00 01`, data `00 00 00 01 00 5A 7F`.
  - `0F 00 00 02`, data `00 00 00 01 00 5A 7F`.

### Pass / Fail Notes

- PASS: Native Bridge connected to the real GR-55.
- PASS: Mapped backup was captured before writing.
- PASS: Staged mode did not alter hardware before explicit send.
- PASS: All five representative controls wrote to temporary memory and read back.
- PASS: Save to `USER 73-3` persisted the changed values and read-back matched.
- PASS: Restore writes and restore save returned `USER 73-3` to the original values above.
- PASS: Registry may mark only these representative parameter IDs as `verified`.
- PARTIAL: Save response addresses `0F 00 00 01` and `0F 00 00 02` are still observed-only; semantic decode remains TODO.
- PARTIAL: Backup is mapped temporary-patch data, not a full Roland bulk dump.

### Artifacts

- Full report:
  - `hardware-backups/user-73-3-2026-06-20T15-46-18-592Z-codex-verification-report.json`

### Not Tested Intentionally

- Full raw GR-55 bulk patch backup/restore.
- Clear USER slot by muted overwrite.
- Import queue send/save.
- Per-control write/save/read-back for every mapped parameter outside the five representative controls listed above.
