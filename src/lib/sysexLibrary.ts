import { COMMAND_DT1, GR55_MODEL_ID, ROLAND_MANUFACTURER_ID, parseHex, toHex } from "./roland";

export const MAX_IMPORT_BYTES = 1024 * 1024;
const ALLOWED_IMPORT_EXTENSIONS = new Set([".syx", ".hex", ".txt", ".g5l", ".mid", ".midi"]);

export type ImportedSysExMessage = {
  label: string;
  bytes: number[];
};

export type SysExQueueClassification = {
  kind: "empty" | "mapped-patch" | "mapped-parameters" | "roland-gr55" | "unknown";
  label: string;
  detail: string;
  mappedMessages: number;
  unknownMessages: number;
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

export function classifyImportedSysExMessages(
  messages: readonly ImportedSysExMessage[],
  options: { knownAddressKeys?: ReadonlySet<string>; mappedParameterCount?: number } = {},
): SysExQueueClassification {
  if (!messages.length) {
    return {
      kind: "empty",
      label: "No SysEx queued",
      detail: "Load a .syx, .g5l, .mid, .midi, .hex or .txt file to inspect its raw messages.",
      mappedMessages: 0,
      unknownMessages: 0,
    };
  }

  const knownAddressKeys = options.knownAddressKeys ?? new Set<string>();
  const mappedParameterCount = options.mappedParameterCount ?? Number.POSITIVE_INFINITY;
  const addresses = messages.map((message) => extractRolandDataAddressKey(message.bytes));
  const mappedMessages = addresses.filter((key) => key && knownAddressKeys.has(key)).length;
  const rolandGr55Messages = addresses.filter(Boolean).length;
  const unknownMessages = messages.length - mappedMessages;

  if (mappedMessages > 0 && mappedMessages >= mappedParameterCount && unknownMessages === 0) {
    return {
      kind: "mapped-patch",
      label: "Mapped patch parameter set",
      detail: `${mappedMessages} mapped temporary-patch parameter messages. This is still not a full GR-55 bulk patch dump.`,
      mappedMessages,
      unknownMessages,
    };
  }

  if (mappedMessages > 0) {
    return {
      kind: "mapped-parameters",
      label: "Mapped parameter queue",
      detail: `${mappedMessages} known temporary-patch parameter message${mappedMessages === 1 ? "" : "s"} and ${unknownMessages} unmapped message${unknownMessages === 1 ? "" : "s"}.`,
      mappedMessages,
      unknownMessages,
    };
  }

  if (rolandGr55Messages > 0) {
    return {
      kind: "roland-gr55",
      label: "Unmapped GR-55 SysEx queue",
      detail: `${rolandGr55Messages} GR-55 DT1 message${rolandGr55Messages === 1 ? "" : "s"} found, but none match the current mapped editor controls.`,
      mappedMessages,
      unknownMessages: messages.length,
    };
  }

  return {
    kind: "unknown",
    label: "Unknown SysEx queue",
    detail: "Raw SysEx messages are queued. The app cannot claim this is a full patch or backup until the format is mapped and tested.",
    mappedMessages,
    unknownMessages: messages.length,
  };
}

export function makeDownloadBlobUrl(messages: readonly ImportedSysExMessage[]) {
  const payload = serializeMessagesAsHex(messages);
  const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
  return URL.createObjectURL(blob);
}

function extractRolandDataAddressKey(bytes: readonly number[]) {
  if (
    bytes.length < 13 ||
    bytes[0] !== 0xf0 ||
    bytes[1] !== ROLAND_MANUFACTURER_ID ||
    !GR55_MODEL_ID.every((byte, index) => bytes[3 + index] === byte) ||
    bytes[6] !== COMMAND_DT1 ||
    bytes[bytes.length - 1] !== 0xf7
  ) {
    return "";
  }

  return bytes
    .slice(7, 11)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(":");
}

function getExtension(name: string) {
  const lastDot = name.lastIndexOf(".");
  if (lastDot === -1) {
    return "";
  }
  return name.slice(lastDot).toLowerCase();
}
