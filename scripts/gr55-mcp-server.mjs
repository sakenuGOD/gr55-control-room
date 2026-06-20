#!/usr/bin/env node
import fs from "node:fs/promises";
import { registerTsExtensionLoader } from "./ts-extension-loader.mjs";
import WebSocket from "ws";

registerTsExtensionLoader();

const {
  callMcpTool,
  createMcpContext,
  createMockBridge,
  listMcpTools,
} = await import("../src/mcp/server.ts");
const {
  PARAMETERS_BY_ID,
  decodeParameterValue,
  makeParameterReadMessage,
  makeParameterMessage,
} = await import("../src/data/gr55Parameters.ts");
const { addressKey } = await import("../src/lib/midiMessages.ts");
const { parseMappedPatchMessages } = await import("../src/lib/patchImport.ts");
const {
  PATCH_NAME_ADDRESS,
  decodePatchName,
  makePatchNameReadMessage,
} = await import("../src/lib/patchName.ts");
const { serializeMessagesAsHex } = await import("../src/lib/sysexLibrary.ts");

const bridge = process.env.GR55_MCP_MOCK === "1" ? createMockBridge() : createBridgeClientBridge();
const context = createMcpContext({ bridge });
let inputBuffer = "";
let stdinEnded = false;
const pendingMessages = new Set();
let messageQueue = Promise.resolve();

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  drainInputBuffer();
});

process.stdin.on("end", () => {
  stdinEnded = true;
  maybeExit();
});

function drainInputBuffer() {
  while (inputBuffer.length) {
    const framed = readContentLengthFrame();
    if (framed === null) {
      const lineEnd = inputBuffer.indexOf("\n");
      if (lineEnd === -1) {
        return;
      }

      const line = inputBuffer.slice(0, lineEnd).trim();
      inputBuffer = inputBuffer.slice(lineEnd + 1);
      if (line) {
        queueJsonMessage(line);
      }
      continue;
    }

    if (framed === undefined) {
      return;
    }

    queueJsonMessage(framed);
  }
}

function queueJsonMessage(text) {
  const pending = messageQueue.then(() => handleJsonMessage(text)).finally(() => {
    pendingMessages.delete(pending);
    maybeExit();
  });
  messageQueue = pending.catch(() => undefined);
  pendingMessages.add(pending);
}

function maybeExit() {
  if (stdinEnded && pendingMessages.size === 0) {
    process.exit(0);
  }
}

function readContentLengthFrame() {
  if (!/^Content-Length:/i.test(inputBuffer)) {
    return null;
  }

  const headerEnd = inputBuffer.indexOf("\r\n\r\n");
  const fallbackHeaderEnd = inputBuffer.indexOf("\n\n");
  const endIndex = headerEnd === -1 ? fallbackHeaderEnd : headerEnd;
  const separatorLength = headerEnd === -1 ? 2 : 4;

  if (endIndex === -1) {
    return undefined;
  }

  const header = inputBuffer.slice(0, endIndex);
  const lengthMatch = /^Content-Length:\s*(\d+)/im.exec(header);
  if (!lengthMatch) {
    throw new Error("Missing Content-Length header.");
  }

  const contentLength = Number.parseInt(lengthMatch[1], 10);
  const bodyStart = endIndex + separatorLength;
  const bodyEnd = bodyStart + contentLength;

  if (inputBuffer.length < bodyEnd) {
    return undefined;
  }

  const body = inputBuffer.slice(bodyStart, bodyEnd);
  inputBuffer = inputBuffer.slice(bodyEnd);
  return body;
}

async function handleJsonMessage(text) {
  let message;

  try {
    message = JSON.parse(text);
  } catch (error) {
    writeResponse({
      jsonrpc: "2.0",
      id: null,
      error: jsonRpcError(-32700, formatError(error)),
    });
    return;
  }

  if (!message || typeof message !== "object") {
    return;
  }

  if (message.id === undefined) {
    return;
  }

  try {
    const result = await dispatch(message.method, message.params ?? {});
    writeResponse({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    writeResponse({
      jsonrpc: "2.0",
      id: message.id,
      error: jsonRpcError(-32000, formatError(error)),
    });
  }
}

async function dispatch(method, params) {
  if (method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "gr55-control-room",
        version: "0.1.0",
      },
    };
  }

  if (method === "ping") {
    return {};
  }

  if (method === "tools/list") {
    return { tools: listMcpTools() };
  }

  if (method === "tools/call") {
    const name = params?.name;
    if (typeof name !== "string") {
      throw new Error("tools/call params.name must be a string.");
    }

    const result = await callMcpTool(context, name, params.arguments ?? {});
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
      structuredContent: result,
      isError: false,
    };
  }

  throw new Error(`Unsupported JSON-RPC method: ${String(method)}`);
}

function writeResponse(payload) {
  const text = JSON.stringify(payload);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(text, "utf8")}\r\n\r\n${text}`);
}

function jsonRpcError(code, message) {
  return { code, message };
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }

  return String(error);
}

function createBridgeClientBridge() {
  const url = process.env.GR55_BRIDGE_WS || "ws://127.0.0.1:5174";
  const dt1Waiters = [];
  const statusWaiters = [];
  let ws = null;
  let lastStatus = {
    ok: true,
    connected: false,
    state: "idle",
    message: `Bridge WebSocket not connected. Start npm run bridge (${url}).`,
    sentCount: 0,
  };
  let sentCount = 0;

  return {
    async status() {
      if (ws?.readyState === WebSocket.OPEN) {
        sendJson({ type: "refresh" });
        await sleep(120);
      }
      return lastStatus;
    },
    async connect() {
      await ensureSocket();
      const pending = waitForReadyStatus(6000);
      sendJson({ type: "connect-usb" });
      return pending;
    },
    async send(bytes, label) {
      await ensureSocket();
      sendJson({ type: "send", label, bytes: Array.from(bytes) });
      sentCount += 1;
      return { ok: true, label, bytes: Array.from(bytes) };
    },
    async readPatchName() {
      return readPatchNameFromHardware();
    },
    async writePatchName() {
      return;
    },
    async readParameter(param) {
      return readParameterFromHardware(param);
    },
    async writeParameter() {
      return;
    },
    async backupUserPatch(patch, messages) {
      await fs.mkdir("hardware-backups", { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const base = `hardware-backups/user-${patch.label}-${timestamp}-mcp-mapped-backup`;
      await fs.writeFile(`${base}.syx.txt`, serializeMessagesAsHex(messages));
      await fs.writeFile(`${base}.syx`, Buffer.from(messages.flatMap((message) => message.bytes)));
    },
    async saveUserPatch() {
      return;
    },
    async verifyReadback(expected) {
      const mismatches = [];
      if (expected.patchName !== undefined) {
        const actual = await readPatchNameFromHardware();
        if (actual !== expected.patchName) {
          mismatches.push({ field: "patchName", expected: expected.patchName, actual });
        }
      }

      for (const [id, expectedValue] of Object.entries(expected.values ?? {})) {
        const param = contextParameterById(id);
        const actual = await readParameterFromHardware(param);
        if (actual !== expectedValue) {
          mismatches.push({ field: id, expected: expectedValue, actual });
        }
      }

      return { ok: mismatches.length === 0, verified: mismatches.length === 0, mismatches };
    },
    async importSysEx(messages) {
      return parseMappedPatchMessages(messages);
    },
  };

  async function ensureSocket() {
    if (ws?.readyState === WebSocket.OPEN) {
      return;
    }

    ws = new WebSocket(url);
    ws.on("message", handleBridgeMessage);
    ws.on("close", () => {
      lastStatus = {
        ...lastStatus,
        connected: false,
        state: "idle",
        message: `Bridge WebSocket closed (${url}).`,
      };
    });

    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
  }

  async function readPatchNameFromHardware() {
    const key = addressKey(PATCH_NAME_ADDRESS);
    const parsed = await waitForExistingOrRequest(makePatchNameReadMessage(context.deviceId), key, "MCP read patch name");
    return decodePatchName(parsed.data);
  }

  async function readParameterFromHardware(param) {
    const parsed = await waitForExistingOrRequest(
      makeParameterReadMessage(param, context.deviceId),
      addressKey(param.address),
      `MCP read ${param.id}`,
    );
    return decodeParameterValue(param, parsed.data);
  }

  function handleBridgeMessage(data) {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (message.type === "hello" || message.type === "status" || message.type === "connect-usb" || message.status) {
      updateStatus(message);
      return;
    }

    if (message.type === "error") {
      lastStatus = {
        ok: false,
        connected: false,
        state: "error",
        message: String(message.message || "Bridge error."),
        sentCount,
      };
      resolveStatusWaiters();
      return;
    }

    if (message.type !== "midi-in" || !Array.isArray(message.bytes)) {
      return;
    }

    const parsed = parseDt1(message.bytes);
    if (!parsed) {
      return;
    }

    for (const waiter of [...dt1Waiters]) {
      if (waiter.key === parsed.key) {
        waiter.resolve(parsed);
        dt1Waiters.splice(dt1Waiters.indexOf(waiter), 1);
      }
    }
  }

  function updateStatus(message) {
    const ready = message.status === "ready";
    lastStatus = {
      ok: message.status !== "error",
      connected: ready,
      state: ready ? "ready" : message.status === "pending" ? "pending" : message.status === "error" ? "error" : "idle",
      message: message.lastError || message.endpointLabel || message.deviceLabel || "",
      sentCount,
    };
    resolveStatusWaiters();
  }

  function resolveStatusWaiters() {
    for (const waiter of [...statusWaiters]) {
      if (lastStatus.state === "ready" || lastStatus.state === "error") {
        waiter.resolve(lastStatus);
        statusWaiters.splice(statusWaiters.indexOf(waiter), 1);
      }
    }
  }

  function waitForReadyStatus(timeoutMs) {
    return new Promise((resolve, reject) => {
      if (lastStatus.state === "ready") {
        resolve(lastStatus);
        return;
      }

      const waiter = { resolve };
      statusWaiters.push(waiter);
      setTimeout(() => {
        const index = statusWaiters.indexOf(waiter);
        if (index !== -1) {
          statusWaiters.splice(index, 1);
          reject(new Error(`Timed out waiting for GR-55 bridge ready at ${url}.`));
        }
      }, timeoutMs);
    });
  }

  async function requestDt1(bytes, key, label, retries = 3) {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const pending = waitForDt1(key, 3200);
      await thisSend(bytes, attempt === 1 ? label : `${label} retry ${attempt}`);
      try {
        return await pending;
      } catch (error) {
        lastError = error;
        await sleep(220);
      }
    }
    throw lastError;
  }

  async function waitForExistingOrRequest(bytes, key, label) {
    try {
      return await waitForDt1(key, 520);
    } catch {
      return requestDt1(bytes, key, label);
    }
  }

  async function thisSend(bytes, label) {
    await ensureSocket();
    sendJson({ type: "send", label, bytes: Array.from(bytes) });
    sentCount += 1;
  }

  function waitForDt1(key, timeoutMs) {
    return new Promise((resolve, reject) => {
      const waiter = { key, resolve };
      dt1Waiters.push(waiter);
      setTimeout(() => {
        const index = dt1Waiters.indexOf(waiter);
        if (index !== -1) {
          dt1Waiters.splice(index, 1);
          reject(new Error(`Timed out waiting for DT1 ${key}.`));
        }
      }, timeoutMs);
    });
  }

  function parseDt1(bytes) {
    if (!Array.isArray(bytes) || bytes.length < 13) {
      return null;
    }
    if (bytes[0] !== 0xf0 || bytes[1] !== 0x41 || bytes[6] !== 0x12 || bytes.at(-1) !== 0xf7) {
      return null;
    }
    const address = bytes.slice(7, 11);
    return {
      key: addressKey(address),
      address,
      data: bytes.slice(11, -2),
      bytes: [...bytes],
    };
  }

  function sendJson(message) {
    ws.send(JSON.stringify(message));
  }
}

function contextParameterById(id) {
  const param = PARAMETERS_BY_ID.get(id);
  if (!param) {
    throw new Error(`Unknown mapped parameter id: ${id}`);
  }
  return param;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
