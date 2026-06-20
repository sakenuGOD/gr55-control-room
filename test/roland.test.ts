import { describe, expect, it } from "vitest";
import { USER_PATCHES, getUserPatchMidiRange } from "../src/data/gr55PatchMap";
import {
  PARAMETERS,
  PARAMETERS_BY_ID,
  UNMAPPED_PARAMETER_TODOS,
  decodeParameterValue,
  encodeParameterValue,
  makeMappedPatchReadMessages,
  makeParameterMessage,
  makeParameterReadMessage,
} from "../src/data/gr55Parameters";
import {
  PATCH_NAME_ADDRESS,
  PATCH_NAME_LENGTH,
  decodePatchName,
  encodePatchName,
  makePatchNameReadMessage,
  makePatchNameWriteMessage,
  validatePatchName,
} from "../src/lib/patchName";
import { parseIncomingMidiMessage } from "../src/lib/midiMessages";
import { makeDataRequestMessage, makeDataSetMessage, makeSaveUserPatchMessage, rolandChecksum, toHex } from "../src/lib/roland";

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

  it("builds RQ1 read messages for individual mapped parameters", () => {
    const delayTime = PARAMETERS.find((param) => param.id === "delayTime");
    expect(delayTime).toBeDefined();
    expect(makeParameterReadMessage(delayTime!, 0x10)).toEqual(
      makeDataRequestMessage([0x18, 0x00, 0x06, 0x07], [0x00, 0x00, 0x00, 0x03], 0x10),
    );
  });

  it("builds a full mapped patch read request set", () => {
    const messages = makeMappedPatchReadMessages(0x10);

    expect(messages).toHaveLength(PARAMETERS.length);
    expect(messages[0].label).toContain(PARAMETERS[0].label);
    expect(messages[0].bytes).toEqual(makeParameterReadMessage(PARAMETERS[0], 0x10));
    expect(new Set(messages.map((message) => toHex(message.bytes)))).toHaveLength(PARAMETERS.length);
  });

  it("round-trips every mapped parameter default through its SysEx value bytes", () => {
    for (const param of PARAMETERS) {
      const encoded = encodeParameterValue(param, param.defaultValue);
      expect(decodeParameterValue(param, encoded), param.id).toBe(param.defaultValue);
    }
  });

  it("maps the core GR-55 sound source controls to real temporary-patch addresses", () => {
    expect(PARAMETERS_BY_ID.get("pcm1Switch")).toMatchObject({
      moduleId: "pcm1",
      address: [0x18, 0x00, 0x20, 0x03],
      hardwareVerificationStatus: "fixture-only",
    });
    expect(PARAMETERS_BY_ID.get("pcm2Switch")).toMatchObject({
      moduleId: "pcm2",
      address: [0x18, 0x00, 0x21, 0x03],
      hardwareVerificationStatus: "fixture-only",
    });
    expect(PARAMETERS_BY_ID.get("modelingSwitch")).toMatchObject({
      moduleId: "modeling",
      address: [0x18, 0x00, 0x10, 0x0a],
      hardwareVerificationStatus: "fixture-only",
    });
    expect(PARAMETERS_BY_ID.get("normalPuSwitch")).toMatchObject({
      moduleId: "normal-pu",
      address: [0x18, 0x00, 0x02, 0x32],
      hardwareVerificationStatus: "fixture-only",
    });
  });

  it("keeps nonresponding USER 73-3 hardware addresses out of the working mapped set", () => {
    expect(PARAMETERS_BY_ID.has("pcm1PortamentoTime")).toBe(false);
    expect(PARAMETERS_BY_ID.has("pcm2PortamentoTime")).toBe(false);
    expect(UNMAPPED_PARAMETER_TODOS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "pcm1PortamentoTime" }),
        expect.objectContaining({ id: "pcm2PortamentoTime" }),
      ]),
    );
  });

  it("encodes GR-55 inverted source mute switches as source on/off controls", () => {
    const pcm1Switch = PARAMETERS_BY_ID.get("pcm1Switch");
    expect(pcm1Switch).toBeDefined();
    expect(encodeParameterValue(pcm1Switch!, 1)).toEqual([0x00]);
    expect(encodeParameterValue(pcm1Switch!, 0)).toEqual([0x01]);
    expect(decodeParameterValue(pcm1Switch!, [0x00])).toBe(1);
    expect(decodeParameterValue(pcm1Switch!, [0x01])).toBe(0);
  });

  it("encodes PCM tone numbers using the Roland three-byte tone select field", () => {
    const pcm1Tone = PARAMETERS_BY_ID.get("pcm1ToneNumber");
    expect(pcm1Tone).toBeDefined();
    expect(encodeParameterValue(pcm1Tone!, 1)).toEqual([0x58, 0x00, 0x00]);
    expect(encodeParameterValue(pcm1Tone!, 2)).toEqual([0x58, 0x00, 0x01]);
    expect(encodeParameterValue(pcm1Tone!, 897)).toEqual([0x56, 0x00, 0x00]);
    expect(decodeParameterValue(pcm1Tone!, [0x58, 0x00, 0x04])).toBe(5);
    expect(decodeParameterValue(pcm1Tone!, [0x56, 0x00, 0x0d])).toBe(910);
  });
});

describe("GR-55 patch name mapping", () => {
  it("validates printable temporary patch names with the GR-55 fixed length", () => {
    expect(PATCH_NAME_LENGTH).toBe(16);
    expect(validatePatchName("USER 73-3")).toEqual({ valid: true });
    expect(validatePatchName("12345678901234567")).toMatchObject({ valid: false });
    expect(validatePatchName("Bad\nName")).toMatchObject({ valid: false });
  });

  it("encodes and decodes padded ASCII patch name bytes", () => {
    const encoded = encodePatchName("USER 73-3");

    expect(encoded).toHaveLength(PATCH_NAME_LENGTH);
    expect(encoded.slice(0, 9)).toEqual([0x55, 0x53, 0x45, 0x52, 0x20, 0x37, 0x33, 0x2d, 0x33]);
    expect(encoded.slice(9)).toEqual(Array(PATCH_NAME_LENGTH - 9).fill(0x20));
    expect(decodePatchName(encoded)).toBe("USER 73-3");
  });

  it("builds patch name RQ1 and DT1 messages at the mapped common address", () => {
    expect(PATCH_NAME_ADDRESS).toEqual([0x18, 0x00, 0x00, 0x01]);
    expect(makePatchNameReadMessage(0x10)).toEqual(
      makeDataRequestMessage(PATCH_NAME_ADDRESS, [0x00, 0x00, 0x00, PATCH_NAME_LENGTH], 0x10),
    );
    expect(makePatchNameWriteMessage("HELLO", 0x10)).toEqual(
      makeDataSetMessage(PATCH_NAME_ADDRESS, encodePatchName("HELLO"), 0x10),
    );
  });
});
