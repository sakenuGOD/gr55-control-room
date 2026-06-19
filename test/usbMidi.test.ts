import { describe, expect, it } from "vitest";
import {
  createUsbMidiDecodeState,
  decodeUsbMidiPackets,
  encodeUsbMidiPackets,
  findRolandUsbMidiEndpoints,
  formatUsbAccessError,
  getUsbSupportIssue,
} from "../src/lib/usbMidi";

describe("USB MIDI packet transport", () => {
  it("frames SysEx messages into USB-MIDI event packets", () => {
    expect(encodeUsbMidiPackets([0xf0, 0x41, 0x10, 0xf7])).toEqual(
      new Uint8Array([0x04, 0xf0, 0x41, 0x10, 0x05, 0xf7, 0x00, 0x00]),
    );
  });

  it("decodes USB-MIDI packets back into MIDI messages", () => {
    expect(decodeUsbMidiPackets(new Uint8Array([0x04, 0xf0, 0x41, 0x10, 0x05, 0xf7, 0x00, 0x00]))).toEqual([
      [0xf0, 0x41, 0x10, 0xf7],
    ]);
  });

  it("keeps SysEx state across separate USB reads", () => {
    const state = createUsbMidiDecodeState();

    expect(decodeUsbMidiPackets(new Uint8Array([0x04, 0xf0, 0x7e, 0x10]), state)).toEqual([]);
    expect(decodeUsbMidiPackets(new Uint8Array([0x04, 0x06, 0x02, 0x41]), state)).toEqual([]);
    expect(decodeUsbMidiPackets(new Uint8Array([0x04, 0x53, 0x02, 0x00]), state)).toEqual([]);
    expect(decodeUsbMidiPackets(new Uint8Array([0x04, 0x00, 0x00, 0x00]), state)).toEqual([]);
    expect(decodeUsbMidiPackets(new Uint8Array([0x07, 0x00, 0x00, 0xf7]), state)).toEqual([
      [0xf0, 0x7e, 0x10, 0x06, 0x02, 0x41, 0x53, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf7],
    ]);
    expect(state.sysex).toBeNull();
  });

  it("frames channel voice messages", () => {
    expect(encodeUsbMidiPackets([0xc0, 0x2a])).toEqual(new Uint8Array([0x0c, 0xc0, 0x2a, 0x00]));
    expect(encodeUsbMidiPackets([0xb0, 0x00, 0x02])).toEqual(new Uint8Array([0x0b, 0xb0, 0x00, 0x02]));
  });

  it("selects writable USB endpoints from a configuration", () => {
    const device = {
      configuration: {
        configurationValue: 1,
        interfaces: [
          {
            interfaceNumber: 2,
            alternates: [
              {
                alternateSetting: 0,
                endpoints: [
                  { endpointNumber: 1, direction: "out", type: "bulk", packetSize: 64 },
                  { endpointNumber: 2, direction: "in", type: "bulk", packetSize: 64 },
                ],
              },
            ],
          },
        ],
      },
      configurations: [],
    } as unknown as USBDevice;

    expect(findRolandUsbMidiEndpoints(device)).toMatchObject({
      configurationValue: 1,
      interfaceNumber: 2,
      alternateSetting: 0,
      outEndpoint: { endpointNumber: 1 },
      inEndpoint: { endpointNumber: 2 },
    });
  });

  it("reports WebUSB browser requirements", () => {
    expect(getUsbSupportIssue({ isSecureContext: false, hasUsb: true })).toContain("HTTPS or localhost");
    expect(getUsbSupportIssue({ isSecureContext: true, hasUsb: false })).toContain("WebUSB is unavailable");
  });

  it("formats interface claim errors with recovery guidance", () => {
    expect(formatUsbAccessError({ name: "NetworkError", message: "Unable to claim interface" })).toContain(
      "could not claim",
    );
  });
});
