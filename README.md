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

## What works

- USER patch selection for all 297 USER slots.
- Program Change and Bank Select MSB.
- Incoming Program Change, Bank Select, CC and Roland DT1 messages mirror back into the UI where the address/control is known.
- Roland GR-55 DT1 messages for patch level, tempo, amp, MOD, MFX, chorus, delay, reverb, EQ and noise suppressor.
- Read-back requests for the visible module.
- Performance CC controls for EXP, GK volume, modulation, Hold and CTL.
- Raw SysEx console.
- Import queue for `.syx`, `.g5l`, `.mid`, `.midi`, `.hex` and `.txt` dumps with send/delete/export actions.
- Web MIDI diagnostics for unsupported browser, permission, empty CoreMIDI port lists and generic DIN MIDI interfaces.
- Direct USB transport for Roland vendor `0x0582`, GR-55 product `0x0127`, with USB-MIDI packet framing and raw endpoint fallback.
- Native bridge transport for Roland vendor `0x0582`, GR-55 product `0x0127`, with USB reset recovery and command-response reading.
- Save temporary patch to the selected USER slot using the confirmed GR-55 command.
- Mute temporary patch and overwrite a USER slot with the muted patch when you need to clear a slot.
- Demo mode when no MIDI output is selected.

## Notes

- Web MIDI SysEx requires `navigator.requestMIDIAccess({ sysex: true })`.
- WebUSB requires Chrome/Edge on localhost/HTTPS and a user click in the USB picker.
- Native Bridge uses the local `usb` package and does not require browser WebUSB support.
- The SysEx format used here is `F0 41 <deviceId> 00 00 53 <command> <addr4> <data-or-size> <checksum> F7`.
- Parameter addresses are scoped to the GR-55 temporary patch area. Permanent USER writes go through the GR-55 command that stores the current temporary patch into a USER slot.
- A GR-55 user patch is cleared by overwriting it with a muted/initialized temporary patch. The hardware does not behave like a filesystem with arbitrary patch deletion.
- On this Mac, USB inspection showed `Roland GR-55` on USB, but no installed Roland/CoreMIDI driver package and no visible CoreMIDI ports. Native Bridge is the working path here; install/allow the Roland GR-55 driver only if you want Web MIDI/CoreMIDI ports.
