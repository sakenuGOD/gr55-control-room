import { describe, expect, it } from "vitest";
import {
  MAX_IMPORT_BYTES,
  parseImportedSysEx,
  serializeMessagesAsHex,
  splitSysExMessages,
  validateImportFileMeta,
} from "../src/lib/sysexLibrary";

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
});
