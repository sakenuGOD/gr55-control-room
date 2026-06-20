# GR-55 Interaction Notes

Date: 2026-06-19, macOS Darwin 25.3.0 arm64.

These notes are hardware observations from the local Roland GR-55 over the app's Native Bridge. Treat the GR-55 as source of truth. Do not promote unmapped UI controls to real controls until they are tested here.

## Connection Route

- Native Bridge WebSocket: `ws://127.0.0.1:5174`.
- USB device detected: `Roland GR-55 (0x0582:0x0127)`.
- Working endpoint set: `cfg 1 / if 2 / alt 0 / out 3 / in 2`.
- Bridge command shape: JSON `{ "type": "send", "label": "...", "bytes": [...] }`.
- Bridge emits outgoing logs as `{ type: "log", direction: "out", bytes }`.
- Bridge emits hardware input as `{ type: "midi-in", bytes }`.
- Intermittent bridge errors are normal on this setup:
  - `transferIn error: endpoint not found`
  - sometimes `transferOut error: endpoint not found`
- Important bridge fix: continuous USB polling must not disconnect on `endpoint not found`; treat it as transient and retry after a short sleep.
- Important bridge fix from the UI round-trip test: outgoing MIDI/SysEx sends must be serialized through a queue. Parallel `transferOut` calls can trigger endpoint errors and can race Bank Select, Program Change, and RQ1 traffic.

## Identity

Send:

```text
F0 7E 7F 06 01 F7
```

Observed reply:

```text
F0 7E 10 06 02 41 53 02 00 00 00 00 00 00 F7
```

Interpretation used by the app:

- Device ID: `0x10`.
- Manufacturer: Roland `0x41`.
- Family bytes in this reply: `53 02`.
- Revision bytes observed: `00 00 00 00`.

## USER Slot Selection

The tested safe destructive slot is:

- USER slot: `USER 73-3`.
- Zero-based USER index: `218`.
- Bank MSB: `1`.
- Program: `90` decimal, `0x5A`.

Formula used by the current app:

```text
userIndex = (bankNumber - 1) * 3 + (slotNumber - 1)
bankMsb = floor(userIndex / 128)
program = userIndex % 128
```

For `USER 73-3`, send:

```text
B0 00 01
C0 5A
```

Observation: selecting a USER slot by outgoing Bank Select + Program Change does not itself produce a patch dump response. After selecting, issue mapped RQ1 reads.

UI-observed selection traffic:

```text
USER 73-2:
B0 00 01
C0 59

USER 73-3:
B0 00 01
C0 5A
```

The app must mark the selected slot as unread after selection. It can only mark the mapped editor as loaded after DT1 responses arrive for the mapped RQ1 requests.

## SysEx Formats

Roland checksum:

```text
checksum = (128 - (sum(payload) % 128)) & 0x7F
```

DT1 temporary parameter write:

```text
F0 41 <deviceId> 00 00 53 12 <addr4> <data...> <checksum> F7
```

RQ1 temporary parameter read:

```text
F0 41 <deviceId> 00 00 53 11 <addr4> <size4> <checksum> F7
```

Observed DT1 response format:

```text
F0 41 10 00 00 53 12 <addr4> <data...> <checksum> F7
```

## Save Temporary Patch To USER

The app's save command is an RQ1-style command to `0F 00 00 00` with target USER bank/program bytes.

For safe slot `USER 73-3`:

```text
F0 41 10 00 00 53 11 0F 00 00 00 01 00 5A 7F 17 F7
```

Observed after sending save command:

```text
F0 41 10 00 00 53 12 0F 00 00 01 00 00 00 01 00 5A 7F 16 F7
F0 41 10 00 00 53 12 0F 00 00 02 00 00 00 01 00 5A 7F 15 F7
```

Do not yet label this as a fully decoded success acknowledgement. It is an observed hardware response to the save command. The semantic meaning of addresses `0F 00 00 01` and `0F 00 00 02` still needs confirmation.

## Mapped Read Capture: USER 73-3

Full mapped read was done by selecting USER 73-3, then issuing RQ1 for the 45 currently mapped addresses. First pass returned 38/45 due intermittent USB endpoint errors. A retry pass returned the remaining 7 values.

| module | id | label | address | encoder | response bytes | decoded |
|---|---|---|---|---|---|---:|
| common | patchLevel | Patch Level | 18 00 02 30 | split8 | 06 04 | 100 |
| common | patchTempo | Patch Tempo | 18 00 02 3C | split8 | 07 08 | 120 |
| common | effectStructure | Effect Structure | 18 00 02 2C | byte | 00 | 0 |
| amp | ampSwitch | Amp Switch | 18 00 07 00 | boolean | 01 | 1 |
| amp | ampType | Amp Type | 18 00 07 01 | byte | 22 | 34 |
| amp | ampGain | Gain | 18 00 07 02 | byte | 78 | 120 |
| amp | ampLevel | Level | 18 00 07 03 | byte | 2D | 45 |
| amp | ampBass | Bass | 18 00 07 07 | byte | 3B | 59 |
| amp | ampMiddle | Middle | 18 00 07 08 | byte | 42 | 66 |
| amp | ampTreble | Treble | 18 00 07 09 | byte | 33 | 51 |
| amp | ampPresence | Presence | 18 00 07 0A | byte | 00 | 0 |
| mod | modSwitch | MOD Switch | 18 00 07 15 | boolean | 01 | 1 |
| mod | modType | MOD Type | 18 00 07 16 | byte | 00 | 0 |
| mod | odDsDrive | OD/DS Drive | 18 00 07 19 | byte | 46 | 70 |
| mod | odDsTone | OD/DS Tone | 18 00 07 1A | byte | 32 | 50 |
| mod | odDsLevel | OD/DS Level | 18 00 07 1B | byte | 32 | 50 |
| mfx | mfxSwitch | MFX Switch | 18 00 03 04 | boolean | 00 | 0 |
| mfx | mfxType | MFX Type | 18 00 03 05 | byte | 07 | 7 |
| mfx | mfxChorusSend | Chorus Send | 18 00 03 00 | byte | 64 | 100 |
| mfx | mfxDelaySend | Delay Send | 18 00 03 01 | byte | 64 | 100 |
| mfx | mfxReverbSend | Reverb Send | 18 00 03 02 | byte | 64 | 100 |
| chorus | chorusSwitch | Chorus Switch | 18 00 06 00 | boolean | 01 | 1 |
| chorus | chorusType | Type | 18 00 06 01 | byte | 00 | 0 |
| chorus | chorusRate | Rate | 18 00 06 02 | byte | 28 | 40 |
| chorus | chorusDepth | Depth | 18 00 06 03 | byte | 32 | 50 |
| chorus | chorusLevel | Effect Level | 18 00 06 04 | byte | 00 | 0 |
| delay | delaySwitch | Delay Switch | 18 00 06 05 | boolean | 01 | 1 |
| delay | delayType | Type | 18 00 06 06 | byte | 04 | 4 |
| delay | delayTime | Time | 18 00 06 07 | split12 | 01 0A 0A | 426 |
| delay | delayFeedback | Feedback | 18 00 06 0A | byte | 24 | 36 |
| delay | delayLevel | Effect Level | 18 00 06 0B | byte | 49 | 73 |
| reverb | reverbSwitch | Reverb Switch | 18 00 06 0C | boolean | 00 | 0 |
| reverb | reverbType | Type | 18 00 06 0D | byte | 04 | 4 |
| reverb | reverbTime | Time | 18 00 06 0E | reverbTime | 1D | 3.0 |
| reverb | reverbHighCut | High Cut | 18 00 06 0F | byte | 06 | 6 |
| reverb | reverbLevel | Effect Level | 18 00 06 10 | byte | 00 | 0 |
| eq | eqSwitch | EQ Switch | 18 00 06 11 | boolean | 00 | 0 |
| eq | eqLowGain | Low Gain | 18 00 06 13 | gain20 | 14 | 0 |
| eq | eqLowMidGain | Low Mid Gain | 18 00 06 16 | gain20 | 14 | 0 |
| eq | eqHighMidGain | High Mid Gain | 18 00 06 19 | gain20 | 14 | 0 |
| eq | eqHighGain | High Gain | 18 00 06 1B | gain20 | 14 | 0 |
| eq | eqLevel | Level | 18 00 06 1C | gain20 | 14 | 0 |
| noise | nsSwitch | NS Switch | 18 00 07 5A | boolean | 01 | 1 |
| noise | nsThreshold | Threshold | 18 00 07 5B | byte | 1E | 30 |
| noise | nsRelease | Release | 18 00 07 5C | byte | 05 | 5 |

## Temporary DT1 Write Tests

These were sent to temporary patch memory only. Values were restored before the save command.

| step | parameter | sent bytes | readback | result |
|---|---|---|---|---|
| test write | Patch Level | 06 03 | 06 03 | PASS |
| restore | Patch Level | 06 04 | 06 04 | PASS |
| test write | Amp Level | 2E | 2E | PASS |
| restore | Amp Level | 2D | 2D | PASS |
| test write | Delay Level | 4A | 4A | PASS |
| restore | Delay Level | 49 | 49 | PASS |

Conclusion: mapped DT1 writes immediately change temporary memory and are readable back with RQ1. Live Preview should send DT1 for mapped controls only, never for source/PCM/modeling stubs.

Additional UI live/staged test on NS Release:

```text
address: 18 00 07 5C

Live Preview write 5 -> 6:
F0 41 10 00 00 53 12 18 00 07 5C 06 7F F7
RQ1 response:
F0 41 10 00 00 53 12 18 00 07 5C 06 7F F7

Live Preview restore 6 -> 5:
F0 41 10 00 00 53 12 18 00 07 5C 05 00 F7
RQ1 response:
F0 41 10 00 00 53 12 18 00 07 5C 05 00 F7
```

Staged mode test:

- UI value was changed from `5` to `6` while Staged was selected.
- RQ1 still returned `05`.
- This confirms staged edits do not write temporary GR-55 memory until preview/send/save.

## Mapped Export / Import Queue

The app's mapped patch export is readable text hex, not binary `.syx` and not a full GR-55 patch backup.

Observed export:

```text
filename: gr55-user-73-3-mapped-patch.txt
messages: 45
format: one DT1 SysEx message per mapped temporary-patch parameter
```

Import behavior observed with the same export:

- Importing the temp downloaded file with no extension was rejected by file-type validation.
- Copying the text hex export to `.syx` failed because `.syx` is parsed as raw binary bytes.
- Copying the same text hex export to `.txt` succeeded.
- Classification was `Mapped patch parameter set`.
- The queue detail correctly said it is still not a full GR-55 bulk patch dump.

Do not label mapped text exports as backups. They only cover addresses present in `src/data/gr55Parameters.ts`.

## Hardware-Originated MIDI

Observed during save/recall response traffic:

```text
B0 00 01
B0 20 00
C0 5A
```

These incoming Bank Select / Program Change bytes can mirror into the UI.

A separate 30-second monitor while the user was at the controller saw:

```text
midi-in=0
```

So physical panel/pedal-originated MIDI was not observed in the current GR-55 USB/MIDI settings. This may require GR-55 transmit/settings changes before the app can reliably mirror manual hardware patch changes, CTL, EXP, or GK volume.

## Read Retry Guidance

The bridge can miss some RQ1 responses when reading many parameters quickly. The reliable workflow is:

1. Select USER slot with Bank Select + Program Change.
2. Wait about 400 to 1200 ms for patch change settle.
3. Send identity if device ID is unknown.
4. Send mapped RQ1 requests with at least 55 to 80 ms between messages.
5. Track expected address keys and received address keys.
6. If some addresses are missing, retry only missing addresses with about 400 ms between attempts.
7. Do not mark the patch fully ready until all mapped address keys have answered, or explicitly mark it as partial.

## What Is Still Not Known

- Full patch dump request and restore are not implemented.
- Patch-name byte addresses are not mapped.
- PCM tone, modeling tone, normal pickup, GK assign targets and detailed pedal assign bytes are not mapped.
- Physical panel/pedal-originated MIDI was monitored but not observed in the current GR-55 USB/MIDI settings.
- The save response at `0F 00 00 01/02` is observed but not semantically decoded.
- Clear/delete is not a GR-55 delete command. The current app's clear behavior is a muted temporary patch overwrite and then save.
