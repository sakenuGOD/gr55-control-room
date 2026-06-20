import { makeDataRequestMessage, makeDataSetMessage } from "./roland";

export const PATCH_NAME_ADDRESS = [0x18, 0x00, 0x00, 0x01] as const;
export const PATCH_NAME_LENGTH = 16;

export type PatchNameValidation = {
  valid: boolean;
  reason?: string;
};

export function validatePatchName(name: string): PatchNameValidation {
  if (name.length > PATCH_NAME_LENGTH) {
    return { valid: false, reason: `Patch name must be ${PATCH_NAME_LENGTH} characters or fewer.` };
  }

  for (const char of name) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code > 0x7e) {
      return { valid: false, reason: "Patch name can only use printable ASCII characters." };
    }
  }

  return { valid: true };
}

export function encodePatchName(name: string) {
  const validation = validatePatchName(name);
  if (!validation.valid) {
    throw new Error(validation.reason ?? "Invalid patch name.");
  }

  return Array.from({ length: PATCH_NAME_LENGTH }, (_, index) => {
    const code = name.charCodeAt(index);
    return Number.isFinite(code) && code > 0 ? code & 0x7f : 0x20;
  });
}

export function decodePatchName(bytes: readonly number[]) {
  return bytes
    .slice(0, PATCH_NAME_LENGTH)
    .map((byte) => {
      const code = byte & 0x7f;
      return code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : "?";
    })
    .join("")
    .trimEnd();
}

export function makePatchNameReadMessage(deviceId: number) {
  return makeDataRequestMessage(PATCH_NAME_ADDRESS, [0x00, 0x00, 0x00, PATCH_NAME_LENGTH], deviceId);
}

export function makePatchNameWriteMessage(name: string, deviceId: number) {
  return makeDataSetMessage(PATCH_NAME_ADDRESS, encodePatchName(name), deviceId);
}
