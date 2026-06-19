export const ROLAND_MANUFACTURER_ID = 0x41;
export const GR55_MODEL_ID = [0x00, 0x00, 0x53] as const;
export const DEFAULT_DEVICE_ID = 0x10;
export const COMMAND_DT1 = 0x12;
export const COMMAND_RQ1 = 0x11;
export const ALL_DEVICES = 0x7f;

export type MidiLogDirection = "out" | "in" | "system";

export type MidiLogEntry = {
  id: string;
  at: string;
  direction: MidiLogDirection;
  label: string;
  bytes?: number[];
  sent: boolean;
};

export function rolandChecksum(bytes: readonly number[]) {
  const sum = bytes.reduce((acc, byte) => acc + byte, 0);
  return (128 - (sum % 128)) & 0x7f;
}

export function makeDataSetMessage(
  address: readonly number[],
  valueBytes: readonly number[],
  deviceId = DEFAULT_DEVICE_ID,
) {
  const payload = [...address, ...valueBytes];
  return [
    0xf0,
    ROLAND_MANUFACTURER_ID,
    deviceId,
    ...GR55_MODEL_ID,
    COMMAND_DT1,
    ...payload,
    rolandChecksum(payload),
    0xf7,
  ];
}

export function makeDataRequestMessage(
  address: readonly number[],
  size: readonly number[],
  deviceId = DEFAULT_DEVICE_ID,
) {
  return makeRawDataRequestMessage(address, size, deviceId);
}

export function makeRawDataRequestMessage(
  address: readonly number[],
  rawArgs: readonly number[] = [],
  deviceId = DEFAULT_DEVICE_ID,
) {
  const payload = [...address, ...rawArgs];
  return [
    0xf0,
    ROLAND_MANUFACTURER_ID,
    deviceId,
    ...GR55_MODEL_ID,
    COMMAND_RQ1,
    ...payload,
    rolandChecksum(payload),
    0xf7,
  ];
}

export function makeSaveUserPatchMessage(userPatchIndex: number, deviceId = DEFAULT_DEVICE_ID) {
  const safeIndex = clamp(Math.round(userPatchIndex), 0, 296);
  const bankMsb = Math.floor(safeIndex / 128);
  const program = safeIndex % 128;

  return makeRawDataRequestMessage([0x0f, 0x00, 0x00, 0x00], [bankMsb, 0x00, program, 0x7f], deviceId);
}

export function identityRequest(deviceId = ALL_DEVICES) {
  return [0xf0, 0x7e, deviceId, 0x06, 0x01, 0xf7];
}

export function bankSelectMsb(channel: number, bankMsb: number) {
  return [0xb0 + zeroBasedChannel(channel), 0x00, clamp7(bankMsb)];
}

export function controlChange(channel: number, controller: number, value: number) {
  return [0xb0 + zeroBasedChannel(channel), clamp7(controller), clamp7(value)];
}

export function programChange(channel: number, program: number) {
  return [0xc0 + zeroBasedChannel(channel), clamp7(program)];
}

export function toHex(bytes: readonly number[] | Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).toUpperCase().padStart(2, "0"))
    .join(" ");
}

export function parseHex(input: string) {
  const cleaned = input
    .replace(/0x/gi, "")
    .replace(/[^0-9a-fA-F]+/g, " ")
    .trim();

  if (!cleaned) {
    return [];
  }

  return cleaned.split(/\s+/).map((part) => {
    const value = Number.parseInt(part, 16);
    if (Number.isNaN(value) || value < 0 || value > 255) {
      throw new Error(`Invalid hex byte: ${part}`);
    }
    return value;
  });
}

export function encodeByte(value: number, min = 0, max = 127, encodedOffset = 0) {
  return [clamp(Math.round(value + encodedOffset), min + encodedOffset, max + encodedOffset) & 0x7f];
}

export function encodeSplit8(value: number, min = 0, max = 255) {
  const safe = clamp(Math.round(value), min, max) & 0xff;
  return [(safe >> 4) & 0x0f, safe & 0x0f];
}

export function encodeSplit12(
  value: number,
  min: number,
  max: number,
  options: { decodedFactor?: number; encodedOffset?: number } = {},
) {
  const decodedFactor = options.decodedFactor ?? 1;
  const encodedOffset = options.encodedOffset ?? 0;
  const safe =
    Math.round(clamp(value, min, max) / decodedFactor + encodedOffset) & 0x0fff;

  return [(safe >> 8) & 0x0f, (safe >> 4) & 0x0f, safe & 0x0f];
}

export function clamp7(value: number) {
  return clamp(Math.round(value), 0, 127);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function zeroBasedChannel(channel: number) {
  return clamp(Math.round(channel), 1, 16) - 1;
}
