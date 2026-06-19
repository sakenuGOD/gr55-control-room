import { parseHex, toHex } from "./roland";

export const MAX_IMPORT_BYTES = 1024 * 1024;
const ALLOWED_IMPORT_EXTENSIONS = new Set([".syx", ".hex", ".txt", ".g5l", ".mid", ".midi"]);

export type ImportedSysExMessage = {
  label: string;
  bytes: number[];
};

export type FileMeta = {
  name: string;
  size: number;
};

export function validateImportFileMeta(file: FileMeta) {
  if (file.size <= 0 || file.size > MAX_IMPORT_BYTES) {
    return false;
  }

  const extension = getExtension(file.name);
  return ALLOWED_IMPORT_EXTENSIONS.has(extension);
}

export function splitSysExMessages(bytes: readonly number[]) {
  const messages: number[][] = [];
  let current: number[] | null = null;

  bytes.forEach((byte, index) => {
    const safeByte = byte & 0xff;

    if (safeByte === 0xf0) {
      current = [safeByte];
      return;
    }

    if (!current) {
      return;
    }

    current.push(safeByte);

    if (safeByte === 0xf7) {
      messages.push(current);
      current = null;
    }

    if (current && index === bytes.length - 1) {
      throw new Error("Unterminated SysEx message.");
    }
  });

  if (!messages.length) {
    throw new Error("No SysEx messages found.");
  }

  return messages;
}

export function parseImportedSysEx(input: string | ArrayBuffer | Uint8Array) {
  const bytes =
    typeof input === "string"
      ? parseHex(input)
      : Array.from(input instanceof Uint8Array ? input : new Uint8Array(input));

  const messages = splitSysExMessages(bytes);

  return messages.map((message, index) => ({
    label: `SysEx ${index + 1}`,
    bytes: message,
  }));
}

export function serializeMessagesAsHex(messages: readonly ImportedSysExMessage[]) {
  return messages.map((message) => toHex(message.bytes)).join("\n\n");
}

export function makeDownloadBlobUrl(messages: readonly ImportedSysExMessage[]) {
  const payload = serializeMessagesAsHex(messages);
  const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
  return URL.createObjectURL(blob);
}

function getExtension(name: string) {
  const lastDot = name.lastIndexOf(".");
  if (lastDot === -1) {
    return "";
  }
  return name.slice(lastDot).toLowerCase();
}
