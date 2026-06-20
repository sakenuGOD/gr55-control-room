# GR-55 Control Room

Local editor for Roland GR-55. It runs on localhost and can talk to the unit through a native Node USB bridge, Web MIDI, or the browser Direct USB fallback.

## Use

```bash
npm install
npm run bridge
npm run dev
```

Open `http://127.0.0.1:5173`.

You can also run both processes from one terminal:

```bash
npm run dev:full
```

### Option A: Native Bridge

Use this first on this Mac. It bypasses browser WebUSB and CoreMIDI driver visibility.

1. Connect the rear GR-55 USB port and power the unit on.
2. Start `npm run bridge`.
3. Start/open the UI and keep transport on `Native Bridge`.
4. Click `Connect GR-55 USB`, then `Identify GR-55`.
5. If USB reads start returning `Cancelled`, click `Reset USB`, wait a moment, then `Connect GR-55 USB` again.

The native bridge listens on `ws://127.0.0.1:5174`, claims GR-55 USB interface 2, uses bulk OUT endpoint 3 and bulk IN endpoint 2, and frames MIDI/SysEx as USB-MIDI event packets.

### Option B: Web MIDI

1. Connect GR-55 through the official Roland USB driver or through a DIN MIDI interface.
2. Click `Connect MIDI` and allow MIDI with SysEx access.
3. Select the input/output ports. With DIN cables the port usually shows the interface name, not `Roland GR-55`.
4. Click `Identify GR-55`. A Roland identity reply in the traffic log confirms two-way control.

### Option C: Direct USB

1. Connect the rear GR-55 USB port and power the unit on.
2. Switch transport to `Direct USB`.
3. Click `Connect USB` and choose `Roland GR-55` in the browser USB picker.
4. Keep `USB-MIDI packets` mode first. Try `Raw endpoint bytes` only if endpoint claim works but the GR-55 does not answer.

Direct USB exists for browsers that support WebUSB. If the browser says WebUSB is unavailable, use Native Bridge.

## Honest Status

This is a real GR-55 utility for the parts that are mapped, and it is explicit about the parts that are not mapped yet. Do not treat it as a full patch librarian until the missing items below are implemented and tested on hardware.

### What Works Now

- USER patch selection for all 297 USER slots, `USER 01-1` through `USER 99-3`.
- Program Change and Bank Select MSB for selecting USER slots.
- Incoming Program Change, Bank Select, CC and Roland DT1 messages mirror into the UI where the address/control is known.
- Mapped Roland GR-55 temporary-patch DT1 controls for patch level, tempo, amp, MOD, MFX, chorus, delay, reverb, EQ and noise suppressor.
- Full mapped-parameter read. `Read selected` sends RQ1 requests for every currently mapped parameter, not only patch level.
- Patch-name read/write helpers for the mapped temporary patch name field, with printable ASCII validation and save read-back verification.
- PCM1, PCM2, Modeling/COSM and Normal PU source controls wired through the parameter registry. USER 73-3 read verification passed for the mapped source set; individual controls still marked `fixture-only` need per-control write verification before being claimed as fully verified.
- Live Preview for mapped DT1 controls.
- Staged mode for mapped DT1 controls, with `Send Staged` flushing dirty mapped parameters to temporary memory before save.
- Visual `Show Original` mode for comparing values in the editor. This is not a hardware A/B audition.
- Performance CC controls for EXP, GK volume, modulation, Hold and CTL.
- Raw SysEx console.
- Raw SysEx import queue for `.syx`, `.g5l`, `.mid`, `.midi`, `.hex` and `.txt` files by scanning for `F0 ... F7` messages.
- Queue classification that labels mapped parameter sets separately from unknown raw SysEx queues.
- Send imported raw SysEx queue to temporary memory.
- Send imported raw SysEx queue to temporary memory, then save to the selected USER slot after confirmation.
- Export imported raw SysEx queue as readable hex text.
- Export the current mapped patch as mapped DT1 messages in readable `.txt` hex plus parsed mapped `.json`. This is not a full bulk patch dump.
- Web MIDI diagnostics for unsupported browser, permission, empty CoreMIDI port lists and generic DIN MIDI interfaces.
- Direct USB transport for Roland vendor `0x0582`, GR-55 product `0x0127`, with USB-MIDI packet framing and raw endpoint fallback.
- Native bridge transport for Roland vendor `0x0582`, GR-55 product `0x0127`, with USB reset recovery and command-response reading.
- Save temporary patch to the selected USER slot using the existing GR-55 save command, then read back patch name and changed mapped parameters before showing verified saved state.
- Clear a USER slot by muting the temporary patch and overwriting the selected USER slot. This is not a filesystem delete.
- Demo/no-output logging when no MIDI output is selected.

### What Is Still Missing For An Ideal GR-55 Librarian

- Full single-patch bulk dump parsing and restore.
- Full USER bank backup and restore.
- Real `.g5l` librarian-file semantics. The current import only scans for SysEx messages inside the file bytes.
- Real Standard MIDI File event parsing for `.mid` and `.midi`. The current import only scans for SysEx byte ranges.
- Full write verification for every individual PCM/modeling/source control. USER 73-3 read verification passed, and patch name plus PCM1 Level write/save/read-back passed.
- GR-55 assign target/source mappings.
- Semantic decode of GR-55 save acknowledgement messages. Current save safety uses explicit read-back verification instead.
- Hardware A/B compare that sends original/current values to the GR-55 for audition.
- Binary `.syx` export for mapped patch exports. Current export is readable hex text.
- Text/binary import auto-detection. A mapped export renamed to `.syx` is treated as binary data and will not parse; import the app's mapped exports as `.txt`.

### Cannot Be Claimed Until Tested On Real Hardware

- That every mapped address matches every GR-55 firmware/version and responds with the expected data size.
- That every source-control write behaves identically across all GR-55 firmware/settings. Patch name and PCM1 Level were write/save/read-back verified on USER 73-3; the broader source set has read verification.
- That the save-to-USER command succeeds on every selected slot.
- That muted-overwrite clear behavior is acceptable for every workflow.
- That imported third-party patch SysEx queues are safe to send and save.
- That USB bridge endpoint choices work on every macOS driver state.
- That Web MIDI through the official Roland driver mirrors all incoming patch changes consistently.
- That the GR-55 panel, CTL, EXP or GK volume transmit incoming MIDI in the current hardware settings. On 2026-06-19, a 30-second monitor saw no physical panel/pedal-originated MIDI events, although Identity/RQ1 responses and save-related Bank/Program bytes did arrive.

## Notes

- Web MIDI SysEx requires `navigator.requestMIDIAccess({ sysex: true })`.
- WebUSB requires Chrome/Edge on localhost/HTTPS and a user click in the USB picker.
- Native Bridge uses the local `usb` package and does not require browser WebUSB support.
- The SysEx format used here is `F0 41 <deviceId> 00 00 53 <command> <addr4> <data-or-size> <checksum> F7`.
- Parameter addresses are scoped to the GR-55 temporary patch area. Permanent USER writes go through the GR-55 command that stores the current temporary patch into a USER slot.
- A GR-55 user patch is cleared by overwriting it with a muted/initialized temporary patch. The hardware does not behave like a filesystem with arbitrary patch deletion.
- On this Mac, USB inspection showed `Roland GR-55` on USB, but no installed Roland/CoreMIDI driver package and no visible CoreMIDI ports. Native Bridge is the working path here; install/allow the Roland GR-55 driver only if you want Web MIDI/CoreMIDI ports.
