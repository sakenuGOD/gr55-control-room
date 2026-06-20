import { describe, expect, it } from "vitest";
import {
  MAX_IMPORT_BYTES,
  classifyImportedSysExMessages,
  getImportedQueueNormalSaveEligibility,
  parseImportedSysEx,
  serializeMessagesAsHex,
  splitSysExMessages,
  validateImportFileMeta,
} from "../src/lib/sysexLibrary";
import { makeDataSetMessage } from "../src/lib/roland";
import { makePatchNameWriteMessage } from "../src/lib/patchName";
import { parseMappedPatchMessages } from "../src/lib/patchImport";

describe("SysEx import library", () => {
  it("splits binary SysEx dumps into individual messages", () => {
    expect(
      splitSysExMessages([
        0xf0,
        0x41,
        0x10,
        0xf7,
        0x00,
        0xf0,
        0x7e,
        0x7f,
        0x06,
        0x01,
        0xf7,
      ]),
    ).toEqual([
      [0xf0, 0x41, 0x10, 0xf7],
      [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7],
    ]);
  });

  it("parses pasted hex text with multiple SysEx messages", () => {
    const messages = parseImportedSysEx("F0 41 10 F7\nF0 7E 7F 06 01 F7");

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ label: "SysEx 1", bytes: [0xf0, 0x41, 0x10, 0xf7] });
  });

  it("rejects empty or unfinished SysEx content", () => {
    expect(() => parseImportedSysEx("hello")).toThrow("No SysEx");
    expect(() => splitSysExMessages([0xf0, 0x41, 0x10])).toThrow("Unterminated");
  });

  it("validates downloaded file metadata before reading", () => {
    expect(validateImportFileMeta({ name: "patch.syx", size: 512 })).toBe(true);
    expect(validateImportFileMeta({ name: "patch.exe", size: 512 })).toBe(false);
    expect(validateImportFileMeta({ name: "huge.syx", size: MAX_IMPORT_BYTES + 1 })).toBe(false);
  });

  it("serializes imported messages as readable hex blocks", () => {
    expect(
      serializeMessagesAsHex([
        { label: "A", bytes: [0xf0, 0x41, 0xf7] },
        { label: "B", bytes: [0xf0, 0x7e, 0xf7] },
      ]),
    ).toBe("F0 41 F7\n\nF0 7E F7");
  });

  it("classifies imported GR-55 mapped parameter queues", () => {
    const messages = [
      { label: "Patch level", bytes: makeDataSetMessage([0x18, 0x00, 0x02, 0x30], [0x06, 0x04]) },
      { label: "Delay switch", bytes: makeDataSetMessage([0x18, 0x00, 0x06, 0x05], [0x01]) },
    ];

    expect(
      classifyImportedSysExMessages(messages, {
        knownAddressKeys: new Set(["18:00:02:30", "18:00:06:05"]),
        mappedParameterCount: 2,
      }),
    ).toMatchObject({
      kind: "mapped-patch",
      label: "Mapped patch parameter set",
    });
  });

  it("classifies unknown SysEx queues without claiming restore support", () => {
    expect(classifyImportedSysExMessages([{ label: "Unknown", bytes: [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7] }])).toMatchObject({
      kind: "unknown",
      label: "Unknown SysEx queue",
    });
  });

  it("allows normal save only for fully mapped imported queues", () => {
    const mappedMessages = [
      { label: "Patch level", bytes: makeDataSetMessage([0x18, 0x00, 0x02, 0x30], [0x06, 0x04]) },
      { label: "Delay switch", bytes: makeDataSetMessage([0x18, 0x00, 0x06, 0x05], [0x01]) },
    ];
    const mappedClassification = classifyImportedSysExMessages(mappedMessages, {
      knownAddressKeys: new Set(["18:00:02:30", "18:00:06:05"]),
      mappedParameterCount: 4,
    });

    expect(mappedClassification.kind).toBe("mapped-parameters");
    expect(getImportedQueueNormalSaveEligibility(mappedClassification)).toMatchObject({
      canSave: true,
    });
  });

  it("rejects normal save for mixed mapped plus unknown queues", () => {
    const mixedClassification = classifyImportedSysExMessages(
      [
        { label: "Patch level", bytes: makeDataSetMessage([0x18, 0x00, 0x02, 0x30], [0x06, 0x04]) },
        { label: "Unknown GR-55", bytes: makeDataSetMessage([0x18, 0x00, 0x7e, 0x01], [0x01]) },
      ],
      {
        knownAddressKeys: new Set(["18:00:02:30"]),
        mappedParameterCount: 2,
      },
    );

    expect(mixedClassification).toMatchObject({
      kind: "mapped-parameters",
      mappedMessages: 1,
      unknownMessages: 1,
    });
    expect(getImportedQueueNormalSaveEligibility(mixedClassification)).toMatchObject({
      canSave: false,
      reason: expect.stringContaining("Unknown"),
    });
  });

  it("rejects normal save for unknown raw SysEx queues", () => {
    const unknownClassification = classifyImportedSysExMessages([
      { label: "Unknown", bytes: [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7] },
    ]);

    expect(getImportedQueueNormalSaveEligibility(unknownClassification)).toMatchObject({
      canSave: false,
      reason: expect.stringContaining("normal USER save/read-back"),
    });
  });

  it("parses imported patch name and mapped values from DT1 messages", () => {
    const parsed = parseMappedPatchMessages([
      { label: "Patch name", bytes: makePatchNameWriteMessage("USER 73-3", 0x10) },
      { label: "Patch level", bytes: makeDataSetMessage([0x18, 0x00, 0x02, 0x30], [0x06, 0x04]) },
      { label: "PCM1 off", bytes: makeDataSetMessage([0x18, 0x00, 0x20, 0x03], [0x01]) },
    ]);

    expect(parsed).toMatchObject({
      patchName: "USER 73-3",
      patchNameMessages: 1,
      mappedMessages: 2,
      checksumErrors: 0,
      values: {
        patchLevel: 100,
        pcm1Switch: 0,
      },
    });
  });
});
