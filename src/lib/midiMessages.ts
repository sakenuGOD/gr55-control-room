import {
  COMMAND_DT1,
  GR55_MODEL_ID,
  ROLAND_MANUFACTURER_ID,
  rolandChecksum,
} from "./roland";

export type IncomingMidiEvent =
  | {
      type: "program-change";
      channel: number;
      program: number;
    }
  | {
      type: "control-change";
      channel: number;
      controller: number;
      value: number;
    }
  | {
      type: "bank-select";
      channel: number;
      bankMsb: number;
    }
  | {
      type: "roland-data";
      deviceId: number;
      address: number[];
      valueBytes: number[];
      checksumValid: boolean;
    }
  | {
      type: "identity-reply";
      manufacturerId: number;
      deviceId: number;
      familyCode: number;
      modelNumber: number;
      revision: number[];
    }
  | {
      type: "other";
      bytes: number[];
    };

export function parseIncomingMidiMessage(data: Uint8Array | readonly number[]): IncomingMidiEvent {
  const bytes = Array.from(data);
  const status = bytes[0] ?? 0;
  const channel = (status & 0x0f) + 1;

  if ((status & 0xf0) === 0xc0 && bytes.length >= 2) {
    return {
      type: "program-change",
      channel,
      program: bytes[1] & 0x7f,
    };
  }

  if ((status & 0xf0) === 0xb0 && bytes.length >= 3) {
    const controller = bytes[1] & 0x7f;
    const value = bytes[2] & 0x7f;

    if (controller === 0) {
      return {
        type: "bank-select",
        channel,
        bankMsb: value,
      };
    }

    return {
      type: "control-change",
      channel,
      controller,
      value,
    };
  }

  if (isRolandGR55DataSet(bytes)) {
    const address = bytes.slice(7, 11);
    const valueBytes = bytes.slice(11, -2);
    const checksum = bytes[bytes.length - 2];

    return {
      type: "roland-data",
      deviceId: bytes[2],
      address,
      valueBytes,
      checksumValid: rolandChecksum([...address, ...valueBytes, checksum]) === 0,
    };
  }

  if (isIdentityReply(bytes)) {
    return {
      type: "identity-reply",
      deviceId: bytes[2],
      manufacturerId: bytes[5],
      familyCode: (bytes[6] << 8) + bytes[7],
      modelNumber: (bytes[8] << 8) + bytes[9],
      revision: bytes.slice(10, 14),
    };
  }

  return {
    type: "other",
    bytes,
  };
}

export function addressKey(address: readonly number[]) {
  return address.map((byte) => byte.toString(16).padStart(2, "0")).join(":");
}

function isRolandGR55DataSet(bytes: readonly number[]) {
  return (
    bytes.length >= 13 &&
    bytes[0] === 0xf0 &&
    bytes[1] === ROLAND_MANUFACTURER_ID &&
    GR55_MODEL_ID.every((byte, index) => bytes[3 + index] === byte) &&
    bytes[6] === COMMAND_DT1 &&
    bytes[bytes.length - 1] === 0xf7
  );
}

function isIdentityReply(bytes: readonly number[]) {
  return (
    bytes.length >= 14 &&
    bytes[0] === 0xf0 &&
    bytes[1] === 0x7e &&
    bytes[3] === 0x06 &&
    bytes[4] === 0x02 &&
    bytes[bytes.length - 1] === 0xf7
  );
}
