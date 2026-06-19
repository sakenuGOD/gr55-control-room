import { toHex } from "./roland";

export const ROLAND_VENDOR_ID = 0x0582;
export const GR55_PRODUCT_ID = 0x0127;

export type UsbMidiEndpointSet = {
  configurationValue: number;
  interfaceNumber: number;
  alternateSetting: number;
  inEndpoint?: USBEndpoint;
  outEndpoint: USBEndpoint;
  label: string;
};

export type UsbPacketMode = "usb-midi" | "raw";

export type UsbMidiDecodeState = {
  sysex: number[] | null;
};

const USB_MIDI_LENGTH_BY_CIN: Record<number, number> = {
  0x2: 2,
  0x3: 3,
  0x4: 3,
  0x5: 1,
  0x6: 2,
  0x7: 3,
  0x8: 3,
  0x9: 3,
  0xa: 3,
  0xb: 3,
  0xc: 2,
  0xd: 2,
  0xe: 3,
  0xf: 1,
};

export function getUsbSupportIssue(probe: { isSecureContext: boolean; hasUsb: boolean }) {
  if (!probe.isSecureContext) {
    return "Direct USB needs HTTPS or localhost. Open this app from the local dev URL.";
  }

  if (!probe.hasUsb) {
    return "WebUSB is unavailable in this browser. Use Chrome or Edge, or use Web MIDI.";
  }

  return "";
}

export function describeUsbDevice(device: USBDevice) {
  const vendor = hex4(device.vendorId);
  const product = hex4(device.productId);
  const name = [device.manufacturerName, device.productName].filter(Boolean).join(" ").trim();
  return `${name || "USB device"} (${vendor}:${product})`;
}

export function findRolandUsbMidiEndpoints(device: USBDevice): UsbMidiEndpointSet | null {
  const configurations = device.configuration ? [device.configuration] : device.configurations;

  for (const configuration of configurations) {
    for (const usbInterface of configuration.interfaces) {
      for (const alternate of usbInterface.alternates) {
        const endpoints = alternate.endpoints.filter((endpoint) => endpoint.type === "bulk" || endpoint.type === "interrupt");
        const outEndpoint = endpoints.find((endpoint) => endpoint.direction === "out");

        if (!outEndpoint) {
          continue;
        }

        return {
          configurationValue: configuration.configurationValue,
          interfaceNumber: usbInterface.interfaceNumber,
          alternateSetting: alternate.alternateSetting,
          inEndpoint: endpoints.find((endpoint) => endpoint.direction === "in"),
          outEndpoint,
          label: [
            `cfg ${configuration.configurationValue}`,
            `if ${usbInterface.interfaceNumber}`,
            `alt ${alternate.alternateSetting}`,
            `out ${outEndpoint.endpointNumber}`,
            endpoints.find((endpoint) => endpoint.direction === "in")
              ? `in ${endpoints.find((endpoint) => endpoint.direction === "in")?.endpointNumber}`
              : "no in",
          ].join(" / "),
        };
      }
    }
  }

  return null;
}

export function encodeUsbMidiPackets(message: readonly number[], cableNumber = 0) {
  if (message.length === 0) {
    return new Uint8Array();
  }

  if (message[0] === 0xf0) {
    return encodeSysExPackets(message, cableNumber);
  }

  const cin = codeIndexForStatus(message[0]);
  const length = Math.min(USB_MIDI_LENGTH_BY_CIN[cin] ?? message.length, message.length);
  return new Uint8Array([
    ((cableNumber & 0x0f) << 4) | cin,
    message[0] ?? 0,
    message[1] ?? 0,
    message[2] ?? 0,
  ].slice(0, 4)).map((byte, index) => (index <= length ? byte : 0));
}

export function createUsbMidiDecodeState(): UsbMidiDecodeState {
  return { sysex: null };
}

export function decodeUsbMidiPackets(data: ArrayBuffer | DataView | Uint8Array, state?: UsbMidiDecodeState) {
  const bytes = bytesFromUsbData(data);
  const messages: number[][] = [];
  let sysex: number[] | null = state?.sysex ?? null;

  for (let index = 0; index + 3 < bytes.length; index += 4) {
    const cin = bytes[index] & 0x0f;
    const payloadLength = USB_MIDI_LENGTH_BY_CIN[cin] ?? 0;
    const payload = bytes.slice(index + 1, index + 1 + payloadLength);

    if (!payloadLength || (!sysex && payload.every((byte) => byte === 0))) {
      continue;
    }

    if (cin === 0x4) {
      sysex = [...(sysex ?? []), ...payload];
      continue;
    }

    if (cin >= 0x5 && cin <= 0x7) {
      const complete = [...(sysex ?? []), ...payload];
      messages.push(trimTrailingZeroesAfterSysExEnd(complete));
      sysex = null;
      continue;
    }

    messages.push(payload);
  }

  if (state) {
    state.sysex = sysex;
  }

  return messages;
}

export function scanRawMidiMessages(data: ArrayBuffer | DataView | Uint8Array) {
  const bytes = bytesFromUsbData(data);
  const messages: number[][] = [];
  let sysex: number[] | null = null;

  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index] & 0xff;

    if (byte === 0xf0) {
      sysex = [byte];
      continue;
    }

    if (sysex) {
      sysex.push(byte);
      if (byte === 0xf7) {
        messages.push(sysex);
        sysex = null;
      }
      continue;
    }

    if ((byte & 0xf0) === 0xc0 || (byte & 0xf0) === 0xd0) {
      messages.push(bytes.slice(index, index + 2));
      index += 1;
      continue;
    }

    if ((byte & 0xf0) >= 0x80 && (byte & 0xf0) <= 0xe0) {
      messages.push(bytes.slice(index, index + 3));
      index += 2;
    }
  }

  return messages;
}

export function formatUsbAccessError(error: unknown) {
  const name = getErrorName(error);
  const message = getErrorMessage(error);

  if (name === "NotFoundError") {
    return "No GR-55 was selected. Connect the rear USB port, power the unit on, then choose Roland GR-55.";
  }

  if (name === "NotAllowedError" || /permission|denied/i.test(message)) {
    return "USB permission was denied. Allow the Roland GR-55 in the browser picker.";
  }

  if (name === "NetworkError" || /claim|protected|interface|access/i.test(message)) {
    return [
      "The browser could see the GR-55 but could not claim its USB interface.",
      "Close DAWs/Librarian apps, disconnect/reconnect the GR-55, then try Direct USB again.",
      "If macOS keeps the interface protected, install/allow the Roland driver or use a DIN MIDI interface.",
    ].join(" ");
  }

  return message || "Direct USB connection failed.";
}

export function serializeUsbEndpointSet(endpointSet: UsbMidiEndpointSet | null) {
  if (!endpointSet) {
    return "No writable USB endpoint selected.";
  }

  return `${endpointSet.label}; packet out ${endpointSet.outEndpoint.packetSize} bytes${
    endpointSet.inEndpoint ? `, packet in ${endpointSet.inEndpoint.packetSize} bytes` : ""
  }`;
}

export function summarizeUsbPayload(bytes: readonly number[]) {
  return bytes.length <= 24 ? toHex(bytes) : `${toHex(bytes.slice(0, 24))} ... (${bytes.length} bytes)`;
}

function encodeSysExPackets(message: readonly number[], cableNumber: number) {
  const packets: number[] = [];
  let index = 0;

  while (index < message.length) {
    const remaining = message.length - index;
    const chunkLength = Math.min(3, remaining);
    const chunk = message.slice(index, index + chunkLength);
    const isFinal = chunk.includes(0xf7) || remaining <= 3;
    const cin = isFinal ? finalSysExCin(chunkLength) : 0x4;

    packets.push(((cableNumber & 0x0f) << 4) | cin, chunk[0] ?? 0, chunk[1] ?? 0, chunk[2] ?? 0);
    index += chunkLength;
  }

  return new Uint8Array(packets);
}

function bytesFromUsbData(data: ArrayBuffer | DataView | Uint8Array) {
  if (data instanceof DataView) {
    return Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }

  if (data instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(data));
  }

  return Array.from(data);
}

function finalSysExCin(length: number) {
  if (length === 1) {
    return 0x5;
  }
  if (length === 2) {
    return 0x6;
  }
  return 0x7;
}

function codeIndexForStatus(status: number) {
  const high = status & 0xf0;

  if (high >= 0x80 && high <= 0xe0) {
    return high >> 4;
  }

  return 0xf;
}

function trimTrailingZeroesAfterSysExEnd(bytes: number[]) {
  const endIndex = bytes.indexOf(0xf7);
  return endIndex === -1 ? bytes : bytes.slice(0, endIndex + 1);
}

function hex4(value: number) {
  return `0x${value.toString(16).toUpperCase().padStart(4, "0")}`;
}

function getErrorName(error: unknown) {
  return typeof error === "object" && error && "name" in error ? String((error as { name: unknown }).name) : "";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
}
