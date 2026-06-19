import { describe, expect, it } from "vitest";
import { USER_PATCHES, getUserPatchMidiRange } from "../src/data/gr55PatchMap";
import { PARAMETERS, encodeParameterValue, makeParameterMessage } from "../src/data/gr55Parameters";
import { parseIncomingMidiMessage } from "../src/lib/midiMessages";
import { makeDataSetMessage, makeSaveUserPatchMessage, rolandChecksum, toHex } from "../src/lib/roland";

describe("Roland GR-55 SysEx helpers", () => {
  it("calculates the Roland checksum", () => {
    expect(rolandChecksum([0x18, 0x00, 0x06, 0x05, 0x01])).toBe(0x5c);
  });

  it("builds DT1 messages for temporary patch writes", () => {
    expect(makeDataSetMessage([0x18, 0x00, 0x06, 0x05], [0x01])).toEqual([
      0xf0,
      0x41,
      0x10,
      0x00,
      0x00,
      0x53,
      0x12,
      0x18,
      0x00,
      0x06,
      0x05,
      0x01,
      0x5c,
      0xf7,
    ]);
  });

  it("renders hex bytes for console output", () => {
    expect(toHex([0xf0, 0x41, 0x10, 0xf7])).toBe("F0 41 10 F7");
  });

  it("builds GR-55 save temporary patch to USER slot command", () => {
    expect(makeSaveUserPatchMessage(128)).toEqual([
      0xf0,
      0x41,
      0x10,
      0x00,
      0x00,
      0x53,
      0x11,
      0x0f,
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x00,
      0x7f,
      0x71,
      0xf7,
    ]);
  });
});

describe("incoming MIDI parsing", () => {
  it("parses program changes and bank select messages", () => {
    expect(parseIncomingMidiMessage([0xc0, 0x2a])).toEqual({
      type: "program-change",
      channel: 1,
      program: 42,
    });
    expect(parseIncomingMidiMessage([0xb0, 0x00, 0x02])).toEqual({
      type: "bank-select",
      channel: 1,
      bankMsb: 2,
    });
  });

  it("parses Roland GR-55 data responses", () => {
    expect(parseIncomingMidiMessage(makeDataSetMessage([0x18, 0x00, 0x06, 0x05], [0x01]))).toEqual({
      type: "roland-data",
      deviceId: 0x10,
      address: [0x18, 0x00, 0x06, 0x05],
      valueBytes: [0x01],
      checksumValid: true,
    });
  });

  it("parses the GR-55 identity reply returned by native USB", () => {
    expect(parseIncomingMidiMessage([0xf0, 0x7e, 0x10, 0x06, 0x02, 0x41, 0x53, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf7])).toEqual({
      type: "identity-reply",
      manufacturerId: 0x41,
      deviceId: 0x10,
      familyCode: 0x5302,
      modelNumber: 0,
      revision: [0, 0, 0, 0],
    });
  });
});

describe("GR-55 user patch map", () => {
  it("maps all 297 editable USER slots", () => {
    expect(USER_PATCHES).toHaveLength(297);
    expect(USER_PATCHES[0]).toMatchObject({ label: "01-1", bankMsb: 0, program: 0 });
    expect(USER_PATCHES[127]).toMatchObject({ label: "43-2", bankMsb: 0, program: 127 });
    expect(USER_PATCHES[128]).toMatchObject({ label: "43-3", bankMsb: 1, program: 0 });
    expect(USER_PATCHES[296]).toMatchObject({ label: "99-3", bankMsb: 2, program: 40 });
  });

  it("guards patch index range", () => {
    expect(() => getUserPatchMidiRange(-1)).toThrow(RangeError);
    expect(() => getUserPatchMidiRange(297)).toThrow(RangeError);
  });
});

describe("GR-55 parameter encoding", () => {
  it("encodes split 8 patch level values", () => {
    const patchLevel = PARAMETERS.find((param) => param.id === "patchLevel");
    expect(patchLevel).toBeDefined();
    expect(encodeParameterValue(patchLevel!, 100)).toEqual([0x06, 0x04]);
  });

  it("encodes signed EQ gain with Roland offset", () => {
    const eqLowGain = PARAMETERS.find((param) => param.id === "eqLowGain");
    expect(eqLowGain).toBeDefined();
    expect(encodeParameterValue(eqLowGain!, -6)).toEqual([14]);
  });

  it("builds parameter messages with the right address", () => {
    const delaySwitch = PARAMETERS.find((param) => param.id === "delaySwitch");
    expect(delaySwitch).toBeDefined();
    expect(makeParameterMessage(delaySwitch!, 1, 0x10)).toEqual(
      makeDataSetMessage([0x18, 0x00, 0x06, 0x05], [0x01], 0x10),
    );
  });
});
