#!/usr/bin/env node
import { createRequire } from "node:module";
import WebSocket, { WebSocketServer } from "ws";

const require = createRequire(import.meta.url);
const { usb } = require("usb");

const HOST = "127.0.0.1";
const PORT = 5174;
const ROLAND_VENDOR_ID = 0x0582;
const GR55_PRODUCT_ID = 0x0127;
const CONFIGURATION_VALUE = 1;
const MIDI_INTERFACE = 2;
const TRANSFER_TIMEOUT_MS = 250;

const ENDPOINT_CANDIDATES = [
  { alternateSetting: 0, outEndpointNumber: 3, inEndpointNumber: 2 },
  { alternateSetting: 1, outEndpointNumber: 3, inEndpointNumber: 1 },
];

const USB_MIDI_LENGTH_BY_CIN = {
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

let currentDevice = null;
let currentEndpointSet = null;
let pollGeneration = 0;
let pollInFlight = null;
let sending = false;
let statusState = "idle";
let lastError = "";
const decoder = createUsbMidiDecoder();

const wss = new WebSocketServer({ host: HOST, port: PORT });

wss.on("listening", async () => {
  console.log(`[gr55-bridge] WebSocket listening on ws://${HOST}:${PORT}`);
  await broadcastStatus("startup");
});

wss.on("connection", async (socket) => {
  console.log("[gr55-bridge] client connected");
  socket.send(JSON.stringify(await makeStatusMessage("hello")));

  socket.on("message", (data) => {
    void handleClientMessage(socket, data);
  });

  socket.on("close", () => {
    console.log("[gr55-bridge] client disconnected");
  });
});

wss.on("error", (error) => {
  console.error(`[gr55-bridge] WebSocket server error: ${formatError(error)}`);
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

async function handleClientMessage(socket, data) {
  let message;

  try {
    message = JSON.parse(data.toString());
  } catch {
    sendJson(socket, { type: "error", message: "Invalid JSON message." });
    return;
  }

  try {
    if (message.type === "refresh") {
      await sendStatus(socket);
      return;
    }

    if (message.type === "connect-usb") {
      await connectUsb();
      await broadcastStatus("connect-usb");
      return;
    }

    if (message.type === "disconnect-usb") {
      await disconnectUsb("client request");
      await broadcastStatus("disconnect-usb");
      return;
    }

    if (message.type === "reset-usb") {
      await resetUsb();
      await broadcastStatus("reset-usb");
      return;
    }

    if (message.type === "send") {
      await sendMidiBytes(message.bytes, message.label);
      return;
    }

    sendJson(socket, { type: "error", message: `Unsupported message type: ${String(message.type)}` });
  } catch (error) {
    const text = formatError(error);
    lastError = text;
    console.error(`[gr55-bridge] ${text}`);
    sendJson(socket, { type: "error", message: text });
    await broadcastStatus("error");
  }
}

async function connectUsb() {
  if (currentDevice?.opened && currentEndpointSet) {
    console.log("[gr55-bridge] GR-55 USB already connected");
    return;
  }

  await disconnectUsb("reconnect");

  const devices = await usb.getDevices();
  const device = devices.find((candidate) => candidate.vendorId === ROLAND_VENDOR_ID && candidate.productId === GR55_PRODUCT_ID);

  if (!device) {
    throw new Error("Roland GR-55 USB device not found. Expected vendor 0x0582 product 0x0127.");
  }

  console.log(`[gr55-bridge] opening ${describeDevice(device)}`);
  statusState = "pending";
  currentDevice = device;

  try {
    await device.open();
    await device.selectConfiguration(CONFIGURATION_VALUE);

    const endpointSet = findGr55EndpointSet(device);
    if (!endpointSet) {
      throw new Error("GR-55 USB MIDI endpoints were not found on interface 2.");
    }

    await claimMidiInterface(device, endpointSet);
    currentEndpointSet = endpointSet;
    decoder.reset();
    statusState = "ready";
    lastError = "";

    console.log(`[gr55-bridge] connected ${endpointSet.label}`);
    broadcastLog({ direction: "system", label: `USB connected: ${endpointSet.label}` });
    broadcastLog({ direction: "system", label: "USB input is read after each command to avoid empty-read cancellation." });
  } catch (error) {
    statusState = "error";
    lastError = formatError(error);
    await closeDevice(device);
    currentDevice = null;
    currentEndpointSet = null;
    throw error;
  }
}

async function claimMidiInterface(device, endpointSet) {
  if (typeof device.detachKernelDriver === "function") {
    try {
      await device.detachKernelDriver(MIDI_INTERFACE);
    } catch (error) {
      if (!/not found|not active|unsupported|no such/i.test(formatError(error))) {
        console.log(`[gr55-bridge] detach kernel driver skipped: ${formatError(error)}`);
      }
    }
  }

  await device.claimInterface(MIDI_INTERFACE);

  await device.selectAlternateInterface(MIDI_INTERFACE, endpointSet.alternateSetting);
}

function startPolling(device, endpointSet) {
  const generation = ++pollGeneration;

  void (async () => {
    while (generation === pollGeneration && currentDevice === device && device.opened) {
      try {
        if (sending) {
          await sleep(10);
          continue;
        }

        pollInFlight = device.transferIn(
          endpointSet.inEndpoint.endpointNumber,
          endpointSet.inEndpoint.packetSize || 64,
          TRANSFER_TIMEOUT_MS,
        );
        const result = await pollInFlight;
        pollInFlight = null;
        const bytes = bytesFromUsbData(result?.data);

        if (!bytes.length) {
          continue;
        }

        handleIncomingUsbBytes(bytes);
      } catch (error) {
        pollInFlight = null;

        if (generation !== pollGeneration || currentDevice !== device || !device.opened) {
          break;
        }

        if (isTransientPollError(error)) {
          continue;
        }

        const text = formatError(error);
        console.error(`[gr55-bridge] USB poll error: ${text}`);
        lastError = text;
        statusState = "error";
        broadcastJson({ type: "error", message: text });
        await disconnectUsb("poll error");
        await broadcastStatus("poll error");
        break;
      }
    }
  })();
}

async function disconnectUsb(reason = "disconnect") {
  pollGeneration += 1;

  const device = currentDevice;
  const endpointSet = currentEndpointSet;
  currentDevice = null;
  currentEndpointSet = null;
  decoder.reset();

  if (!device) {
    statusState = statusState === "error" ? "error" : "idle";
    return;
  }

  console.log(`[gr55-bridge] disconnecting USB (${reason})`);

  if (endpointSet) {
    try {
      await device.releaseInterface(endpointSet.interfaceNumber);
    } catch (error) {
      console.log(`[gr55-bridge] release interface warning: ${formatError(error)}`);
    }
  }

  await closeDevice(device);
  statusState = "idle";
  broadcastLog({ direction: "system", label: "USB disconnected" });
}

async function resetUsb() {
  await disconnectUsb("reset");

  const devices = await usb.getDevices();
  const device = devices.find((candidate) => candidate.vendorId === ROLAND_VENDOR_ID && candidate.productId === GR55_PRODUCT_ID);

  if (!device) {
    throw new Error("Roland GR-55 USB device not found for reset.");
  }

  statusState = "pending";
  console.log(`[gr55-bridge] resetting ${describeDevice(device)}`);

  try {
    await device.open();
    await device.reset();
    lastError = "";
    statusState = "idle";
    broadcastLog({ direction: "system", label: "USB reset sent. Wait a moment, then connect GR-55 USB again." });
  } finally {
    await closeDevice(device);
  }
}

async function closeDevice(device) {
  try {
    if (device?.opened) {
      await device.close();
    }
  } catch (error) {
    console.log(`[gr55-bridge] close device warning: ${formatError(error)}`);
  }
}

async function sendMidiBytes(rawBytes, rawLabel) {
  if (!currentDevice?.opened || !currentEndpointSet) {
    throw new Error("USB is not connected.");
  }

  const bytes = validateByteArray(rawBytes);
  const label = typeof rawLabel === "string" && rawLabel.trim() ? rawLabel.trim() : "MIDI send";
  const packets = encodeUsbMidiPackets(bytes);

  if (!packets.length) {
    throw new Error("No MIDI bytes to send.");
  }

  sending = true;
  try {
    if (pollInFlight) {
      await pollInFlight.catch(() => null);
    }

    const result = await currentDevice.transferOut(currentEndpointSet.outEndpoint.endpointNumber, packets);
    const bytesWritten = result?.bytesWritten ?? packets.length;
    console.log(`[gr55-bridge] out ${label}: ${formatHex(bytes)} (${bytesWritten} USB bytes)`);
    broadcastLog({ direction: "out", label, bytes });
    await drainUsbInput(currentDevice, currentEndpointSet, 700);
  } finally {
    sending = false;
  }
}

async function drainUsbInput(device, endpointSet, durationMs) {
  const deadline = Date.now() + durationMs;
  let sawData = false;

  while (Date.now() < deadline && currentDevice === device && device.opened) {
    try {
      const result = await device.transferIn(
        endpointSet.inEndpoint.endpointNumber,
        endpointSet.inEndpoint.packetSize || 64,
        180,
      );
      const bytes = bytesFromUsbData(result?.data);

      if (bytes.length) {
        sawData = true;
        handleIncomingUsbBytes(bytes);
      }
    } catch (error) {
      if (isTransferTimeout(error)) {
        break;
      }

      if (/cancelled/i.test(formatError(error))) {
        continue;
      }

      throw error;
    }
  }
}

function handleIncomingUsbBytes(bytes) {
  const messages = decoder.decode(bytes);
  for (const midiBytes of messages) {
    broadcastLog({ direction: "in", label: "USB MIDI in", bytes: midiBytes });
    broadcastJson({ type: "midi-in", bytes: midiBytes });
  }
}

function findGr55EndpointSet(device) {
  const configuration = device.configuration;
  const usbInterface = configuration?.interfaces?.find((candidate) => candidate.interfaceNumber === MIDI_INTERFACE);

  if (!usbInterface) {
    return null;
  }

  for (const candidate of ENDPOINT_CANDIDATES) {
    const alternate = usbInterface.alternates?.find((item) => item.alternateSetting === candidate.alternateSetting);
    const endpoints =
      alternate?.endpoints?.filter((endpoint) => endpoint.type === "bulk" || endpoint.type === "interrupt") ?? [];
    const outEndpoint = endpoints.find(
      (endpoint) => endpoint.direction === "out" && endpoint.endpointNumber === candidate.outEndpointNumber,
    );
    const inEndpoint = endpoints.find(
      (endpoint) => endpoint.direction === "in" && endpoint.endpointNumber === candidate.inEndpointNumber,
    );

    if (outEndpoint && inEndpoint) {
      return {
        configurationValue: configuration.configurationValue,
        interfaceNumber: usbInterface.interfaceNumber,
        alternateSetting: alternate.alternateSetting,
        outEndpoint,
        inEndpoint,
        label: [
          `cfg ${configuration.configurationValue}`,
          `if ${usbInterface.interfaceNumber}`,
          `alt ${alternate.alternateSetting}`,
          `out ${outEndpoint.endpointNumber}`,
          `in ${inEndpoint.endpointNumber}`,
        ].join(" / "),
      };
    }
  }

  return null;
}

async function makeStatusMessage(type = "status") {
  const connected = Boolean(currentDevice?.opened && currentEndpointSet);

  return {
    type,
    status: statusState,
    activeUsb: connected
      ? {
          label: describeDevice(currentDevice),
          endpointLabel: currentEndpointSet.label,
        }
      : null,
    message: lastError,
    usbDevices: await listUsbDevices(),
    midiPorts: [],
  };
}

async function listUsbDevices() {
  const devices = await usb.getDevices();
  return devices
    .filter((device) => device.vendorId === ROLAND_VENDOR_ID && device.productId === GR55_PRODUCT_ID)
    .map((device) => ({
      vendorId: device.vendorId,
      productId: device.productId,
      manufacturerName: device.manufacturerName ?? "",
      productName: device.productName ?? "",
      serialNumber: device.serialNumber ?? "",
      bus: device.bus ?? "",
      address: device.address ?? null,
      label: describeDevice(device),
    }));
}

async function sendStatus(socket) {
  sendJson(socket, await makeStatusMessage("status"));
}

async function broadcastStatus(label) {
  const message = await makeStatusMessage("status");
  broadcastJson(message);
  console.log(`[gr55-bridge] status ${label}: ${message.status}; devices=${message.usbDevices.length}`);
}

function broadcastLog(entry) {
  broadcastJson({ type: "log", sent: true, ...entry });
}

function sendJson(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function broadcastJson(payload) {
  const text = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(text);
    }
  }
}

async function shutdown(signal) {
  console.log(`[gr55-bridge] shutting down (${signal})`);
  await disconnectUsb("shutdown");
  wss.close(() => {
    process.exit(0);
  });
}

function encodeUsbMidiPackets(bytes) {
  const packets = [];

  for (const message of splitMidiMessages(bytes)) {
    if (message[0] === 0xf0) {
      packets.push(...encodeSysExPackets(message));
      continue;
    }

    const cin = codeIndexForStatus(message[0]);
    packets.push(cin, message[0] ?? 0, message[1] ?? 0, message[2] ?? 0);
  }

  return new Uint8Array(packets);
}

function splitMidiMessages(bytes) {
  const messages = [];
  let index = 0;

  while (index < bytes.length) {
    const status = bytes[index];

    if (status === 0xf0) {
      const endIndex = bytes.indexOf(0xf7, index);
      const nextIndex = endIndex === -1 ? bytes.length : endIndex + 1;
      messages.push(bytes.slice(index, nextIndex));
      index = nextIndex;
      continue;
    }

    const length = midiMessageLength(status);
    messages.push(bytes.slice(index, index + length));
    index += length;
  }

  return messages;
}

function encodeSysExPackets(message) {
  const packets = [];
  let index = 0;

  while (index < message.length) {
    const remaining = message.length - index;
    const chunkLength = Math.min(3, remaining);
    const chunk = message.slice(index, index + chunkLength);
    const isFinal = chunk.includes(0xf7) || remaining <= 3;
    const cin = isFinal ? finalSysExCin(chunkLength) : 0x4;

    packets.push(cin, chunk[0] ?? 0, chunk[1] ?? 0, chunk[2] ?? 0);
    index += chunkLength;
  }

  return packets;
}

function createUsbMidiDecoder() {
  let sysex = null;

  return {
    reset() {
      sysex = null;
    },
    decode(data) {
      const bytes = bytesFromUsbData(data);
      const messages = [];

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

      return messages;
    },
  };
}

function bytesFromUsbData(data) {
  if (!data) {
    return [];
  }

  if (data instanceof DataView) {
    return Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }

  if (data instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(data));
  }

  return Array.from(data);
}

function validateByteArray(value) {
  if (!Array.isArray(value)) {
    throw new Error("send.bytes must be an array of numbers.");
  }

  return value.map((byte, index) => {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`send.bytes[${index}] must be an integer from 0 to 255.`);
    }

    return byte;
  });
}

function midiMessageLength(status) {
  if (status === 0xf2) {
    return 3;
  }

  if (status === 0xf1 || status === 0xf3) {
    return 2;
  }

  if (status >= 0xf4) {
    return 1;
  }

  const high = status & 0xf0;
  if (high === 0xc0 || high === 0xd0) {
    return 2;
  }

  return 3;
}

function codeIndexForStatus(status) {
  if (status === 0xf1 || status === 0xf3) {
    return 0x2;
  }

  if (status === 0xf2) {
    return 0x3;
  }

  if (status === 0xf6) {
    return 0x5;
  }

  const high = status & 0xf0;
  if (high >= 0x80 && high <= 0xe0) {
    return high >> 4;
  }

  return 0xf;
}

function finalSysExCin(length) {
  if (length === 1) {
    return 0x5;
  }

  if (length === 2) {
    return 0x6;
  }

  return 0x7;
}

function trimTrailingZeroesAfterSysExEnd(bytes) {
  const endIndex = bytes.indexOf(0xf7);
  return endIndex === -1 ? bytes : bytes.slice(0, endIndex + 1);
}

function describeDevice(device) {
  const name = [device.manufacturerName, device.productName].filter(Boolean).join(" ").trim();
  return `${name || "Roland GR-55"} (${hex4(device.vendorId)}:${hex4(device.productId)})`;
}

function hex4(value) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(4, "0")}`;
}

function formatHex(bytes) {
  return bytes.map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientPollError(error) {
  return isTransferTimeout(error) || /cancelled/i.test(formatError(error));
}

function isTransferTimeout(error) {
  return /timeout|timed.?out|LIBUSB_TRANSFER_TIMED_OUT/i.test(formatError(error));
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }

  return String(error);
}
