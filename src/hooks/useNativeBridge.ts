import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseIncomingMidiMessage, type IncomingMidiEvent } from "../lib/midiMessages";
import { type MidiLogEntry } from "../lib/roland";

type BridgeStatus = "idle" | "pending" | "ready" | "error";

type BridgeDirection = "in" | "out" | "system";

export type BridgeUsbDeviceInfo = {
  vendorId: number;
  productId: number;
  manufacturerName?: string;
  productName?: string;
  label: string;
};

export type BridgeStatusPayload = {
  status?: BridgeStatus;
  usbDevices?: BridgeUsbDeviceInfo[];
  activeUsb?: {
    label: string;
    endpointLabel: string;
  } | null;
  message?: string;
};

type BridgeServerMessage =
  | ({ type: "hello" | "status" } & BridgeStatusPayload)
  | {
      type: "log";
      direction: BridgeDirection;
      label: string;
      bytes?: number[];
      sent?: boolean;
    }
  | {
      type: "midi-in";
      bytes: number[];
    }
  | {
      type: "error";
      message: string;
    };

export function useNativeBridge(options: { onIncoming?: (event: IncomingMidiEvent, bytes: number[]) => void } = {}) {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [status, setStatus] = useState<BridgeStatus>("idle");
  const [error, setError] = useState("");
  const [usbDevices, setUsbDevices] = useState<BridgeUsbDeviceInfo[]>([]);
  const [deviceLabel, setDeviceLabel] = useState("");
  const [endpointLabel, setEndpointLabel] = useState("");
  const [lastIn, setLastIn] = useState("");
  const [log, setLog] = useState<MidiLogEntry[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const isSocketOpen = socket?.readyState === WebSocket.OPEN;
  const discoverySummary = useMemo(() => {
    if (status === "ready") {
      return `Native bridge connected to ${deviceLabel || "GR-55"}. ${endpointLabel || "USB endpoint active."}`;
    }

    if (usbDevices.length) {
      return `Native bridge sees ${usbDevices.map((device) => device.label).join(", ")}. Press Connect GR-55 USB.`;
    }

    if (isSocketOpen) {
      return "Native bridge is running, but no Roland GR-55 USB device is visible yet.";
    }

    return "Native bridge is offline. Start it with npm run bridge, then connect from this panel.";
  }, [deviceLabel, endpointLabel, isSocketOpen, status, usbDevices]);

  const addLog = useCallback((entry: Omit<MidiLogEntry, "id" | "at">) => {
    setLog((current) => [
      {
        ...entry,
        id: crypto.randomUUID(),
        at: new Date().toLocaleTimeString(),
      },
      ...current.slice(0, 99),
    ]);
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const sendJson = useCallback((message: Record<string, unknown>) => {
    const activeSocket = socketRef.current;
    if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
      return false;
    }

    activeSocket.send(JSON.stringify(message));
    return true;
  }, []);

  const handleStatus = useCallback((payload: BridgeStatusPayload) => {
    if (payload.status) {
      setStatus(payload.status);
    }

    if (payload.usbDevices) {
      setUsbDevices(payload.usbDevices);
    }

    if (payload.activeUsb) {
      setDeviceLabel(payload.activeUsb.label);
      setEndpointLabel(payload.activeUsb.endpointLabel);
    } else if (payload.activeUsb === null) {
      setDeviceLabel("");
      setEndpointLabel("");
    }

    if (payload.message && payload.status === "error") {
      setError(payload.message);
    } else if (payload.message && payload.status !== "error") {
      setError("");
    }
  }, []);

  const handleMessage = useCallback(
    (raw: MessageEvent<string>) => {
      let message: BridgeServerMessage;
      try {
        message = JSON.parse(raw.data) as BridgeServerMessage;
      } catch {
        return;
      }

      if (message.type === "hello" || message.type === "status") {
        handleStatus(message);
        return;
      }

      if (message.type === "error") {
        setStatus("error");
        setError(message.message);
        addLog({ direction: "system", label: message.message, sent: false });
        return;
      }

      if (message.type === "log") {
        addLog({
          direction: message.direction,
          label: message.label,
          bytes: message.bytes,
          sent: message.sent ?? message.direction !== "out",
        });
        return;
      }

      if (message.type === "midi-in") {
        const bytes = message.bytes.filter((byte) => Number.isInteger(byte)).map((byte) => byte & 0xff);
        setLastIn(formatShortHex(bytes));
        options.onIncoming?.(parseIncomingMidiMessage(bytes), bytes);
      }
    },
    [addLog, handleStatus, options],
  );

  const connect = useCallback(() => {
    clearReconnectTimer();

    if (socketRef.current?.readyState === WebSocket.OPEN || socketRef.current?.readyState === WebSocket.CONNECTING) {
      sendJson({ type: "refresh" });
      return;
    }

    setStatus("pending");
    setError("");

    const nextSocket = new WebSocket("ws://127.0.0.1:5174");
    socketRef.current = nextSocket;
    setSocket(nextSocket);

    nextSocket.addEventListener("open", () => {
      setStatus((current) => (current === "ready" ? current : "idle"));
      setError("");
      addLog({ direction: "system", label: "Native bridge WebSocket connected", sent: true });
      nextSocket.send(JSON.stringify({ type: "refresh" }));
    });

    nextSocket.addEventListener("message", handleMessage);

    nextSocket.addEventListener("error", () => {
      setStatus("error");
      setError("Native bridge is not reachable on ws://127.0.0.1:5174. Start it with npm run bridge.");
    });

    nextSocket.addEventListener("close", () => {
      if (socketRef.current === nextSocket) {
        socketRef.current = null;
        setSocket(null);
      }

      setStatus((current) => (current === "ready" || current === "pending" ? "idle" : current));
    });
  }, [addLog, clearReconnectTimer, handleMessage, sendJson]);

  const refresh = useCallback(() => {
    if (!sendJson({ type: "refresh" })) {
      connect();
    }
  }, [connect, sendJson]);

  const connectUsb = useCallback(() => {
    if (!sendJson({ type: "connect-usb" })) {
      connect();
      window.setTimeout(() => sendJson({ type: "connect-usb" }), 250);
    }
  }, [connect, sendJson]);

  const disconnectUsb = useCallback(() => {
    sendJson({ type: "disconnect-usb" });
  }, [sendJson]);

  const resetUsb = useCallback(() => {
    if (!sendJson({ type: "reset-usb" })) {
      connect();
      window.setTimeout(() => sendJson({ type: "reset-usb" }), 250);
    }
  }, [connect, sendJson]);

  const send = useCallback(
    (bytes: readonly number[], label: string) => {
      const cleanBytes = bytes.filter((byte) => Number.isInteger(byte)).map((byte) => byte & 0xff);

      if (!sendJson({ type: "send", bytes: cleanBytes, label })) {
        addLog({ direction: "out", label: `${label} (native bridge offline)`, bytes: cleanBytes, sent: false });
        setStatus("error");
        setError("Native bridge is offline. Run npm run bridge and press Connect Bridge.");
        return false;
      }

      return true;
    },
    [addLog, sendJson],
  );

  useEffect(() => {
    connect();

    return () => {
      clearReconnectTimer();
      const activeSocket = socketRef.current;
      socketRef.current = null;
      activeSocket?.close();
    };
  }, [clearReconnectTimer, connect]);

  return {
    status,
    error,
    socketReady: isSocketOpen,
    usbDevices,
    deviceLabel,
    endpointLabel,
    lastIn,
    discoverySummary,
    connect,
    refresh,
    connectUsb,
    disconnectUsb,
    resetUsb,
    send,
    log,
    addLog,
  };
}

function formatShortHex(bytes: readonly number[]) {
  const text = bytes.map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ");
  return bytes.length <= 24 ? text : `${text.slice(0, 72)} ... (${bytes.length} bytes)`;
}
