import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseIncomingMidiMessage, type IncomingMidiEvent } from "../lib/midiMessages";
import { type MidiLogEntry } from "../lib/roland";
import {
  GR55_PRODUCT_ID,
  ROLAND_VENDOR_ID,
  createUsbMidiDecodeState,
  decodeUsbMidiPackets,
  describeUsbDevice,
  encodeUsbMidiPackets,
  findRolandUsbMidiEndpoints,
  formatUsbAccessError,
  getUsbSupportIssue,
  scanRawMidiMessages,
  serializeUsbEndpointSet,
  summarizeUsbPayload,
  type UsbMidiEndpointSet,
  type UsbPacketMode,
} from "../lib/usbMidi";

type UsbStatus = "idle" | "unsupported" | "pending" | "ready" | "error";

export function useDirectUsb(options: { onIncoming?: (event: IncomingMidiEvent, bytes: number[]) => void } = {}) {
  const [device, setDevice] = useState<USBDevice | null>(null);
  const [status, setStatus] = useState<UsbStatus>("idle");
  const [error, setError] = useState("");
  const [endpointSet, setEndpointSet] = useState<UsbMidiEndpointSet | null>(null);
  const [packetMode, setPacketMode] = useState<UsbPacketMode>("usb-midi");
  const [lastIn, setLastIn] = useState("");
  const [log, setLog] = useState<MidiLogEntry[]>([]);
  const pollAbortRef = useRef(false);
  const decodeStateRef = useRef(createUsbMidiDecodeState());

  const deviceLabel = useMemo(() => (device ? describeUsbDevice(device) : ""), [device]);
  const endpointLabel = useMemo(() => serializeUsbEndpointSet(endpointSet), [endpointSet]);

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

  const attachDevice = useCallback(
    async (nextDevice: USBDevice) => {
      await nextDevice.open();

      if (!nextDevice.configuration) {
        await nextDevice.selectConfiguration(nextDevice.configurations[0]?.configurationValue ?? 1);
      }

      const endpoints = findRolandUsbMidiEndpoints(nextDevice);
      if (!endpoints) {
        throw new Error("GR-55 USB device is visible, but no writable MIDI-style endpoint was found.");
      }

      if (nextDevice.configuration?.configurationValue !== endpoints.configurationValue) {
        await nextDevice.selectConfiguration(endpoints.configurationValue);
      }

      await nextDevice.claimInterface(endpoints.interfaceNumber);
      await nextDevice.selectAlternateInterface(endpoints.interfaceNumber, endpoints.alternateSetting);

      setDevice(nextDevice);
      setEndpointSet(endpoints);
      decodeStateRef.current = createUsbMidiDecodeState();
      setStatus("ready");
      setError("");
      addLog({
        direction: "system",
        label: `Direct USB ready: ${describeUsbDevice(nextDevice)} / ${endpoints.label}`,
        sent: true,
      });

      if (endpoints.inEndpoint) {
        pollAbortRef.current = false;
        void pollUsbInput(nextDevice, endpoints);
      }
    },
    [addLog],
  );

  const refresh = useCallback(async () => {
    const supportIssue = getUsbSupportIssue({
      isSecureContext: window.isSecureContext,
      hasUsb: Boolean(navigator.usb),
    });

    if (supportIssue) {
      setStatus("unsupported");
      setError(supportIssue);
      return;
    }

    const devices = await navigator.usb!.getDevices();
    const remembered = devices.find((item) => item.vendorId === ROLAND_VENDOR_ID && item.productId === GR55_PRODUCT_ID);

    if (!remembered) {
      setStatus((current) => (current === "ready" ? current : "idle"));
      setError("No previously allowed GR-55 USB device. Press Direct USB and choose Roland GR-55.");
      return;
    }

    setStatus("pending");
    setError("");

    try {
      await attachDevice(remembered);
    } catch (refreshError) {
      setStatus("error");
      setError(formatUsbAccessError(refreshError));
    }
  }, [attachDevice]);

  const connect = useCallback(async () => {
    const supportIssue = getUsbSupportIssue({
      isSecureContext: window.isSecureContext,
      hasUsb: Boolean(navigator.usb),
    });

    if (supportIssue) {
      setStatus("unsupported");
      setError(supportIssue);
      return;
    }

    setStatus("pending");
    setError("");

    try {
      const selected = await navigator.usb!.requestDevice({
        filters: [{ vendorId: ROLAND_VENDOR_ID, productId: GR55_PRODUCT_ID }],
      });
      await attachDevice(selected);
    } catch (connectError) {
      setStatus("error");
      setError(formatUsbAccessError(connectError));
    }
  }, [attachDevice]);

  const disconnect = useCallback(async () => {
    pollAbortRef.current = true;

    if (device && endpointSet) {
      try {
        await device.releaseInterface(endpointSet.interfaceNumber);
      } catch {
        // Already released or owned by the OS.
      }
    }

    if (device?.opened) {
      try {
        await device.close();
      } catch {
        // Closing is best effort; browser may already have detached the device.
      }
    }

    setStatus("idle");
    setEndpointSet(null);
    setDevice(null);
    addLog({ direction: "system", label: "Direct USB disconnected", sent: true });
  }, [addLog, device, endpointSet]);

  const send = useCallback(
    (bytes: readonly number[], label: string) => {
      if (!device || !endpointSet) {
        addLog({ direction: "out", label: `${label} (Direct USB offline)`, bytes: [...bytes], sent: false });
        return false;
      }

      const payload = packetMode === "usb-midi" ? encodeUsbMidiPackets(bytes) : new Uint8Array(bytes);

      void device.transferOut(endpointSet.outEndpoint.endpointNumber, payload).then(
        (result) => {
          addLog({
            direction: "out",
            label: `${label} via USB ${packetMode} (${result.bytesWritten} bytes)`,
            bytes: [...bytes],
            sent: result.status === "ok",
          });
        },
        (sendError) => {
          setError(formatUsbAccessError(sendError));
          setStatus("error");
          addLog({
            direction: "out",
            label: `${label} USB send failed`,
            bytes: [...bytes],
            sent: false,
          });
        },
      );

      return true;
    },
    [addLog, device, endpointSet, packetMode],
  );

  const pollUsbInput = useCallback(
    async (usbDevice: USBDevice, endpoints: UsbMidiEndpointSet) => {
      if (!endpoints.inEndpoint) {
        return;
      }

      while (!pollAbortRef.current && usbDevice.opened) {
        try {
          const result = await usbDevice.transferIn(endpoints.inEndpoint.endpointNumber, endpoints.inEndpoint.packetSize || 64);
          if (result.status !== "ok" || !result.data?.byteLength) {
            continue;
          }

          const usbMidiMessages = decodeUsbMidiPackets(result.data, decodeStateRef.current);
          const rawMessages = usbMidiMessages.length ? [] : scanRawMidiMessages(result.data);
          const messages = usbMidiMessages.length ? usbMidiMessages : rawMessages;
          const incomingBytes = Array.from(new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength));
          setLastIn(summarizeUsbPayload(incomingBytes));

          messages.forEach((bytes) => {
            const parsed = parseIncomingMidiMessage(bytes);
            options.onIncoming?.(parsed, bytes);
            addLog({
              direction: "in",
              label: formatUsbIncomingLabel(parsed),
              bytes,
              sent: true,
            });
          });
        } catch (pollError) {
          if (!pollAbortRef.current) {
            setError(formatUsbAccessError(pollError));
            setStatus("error");
          }
          return;
        }
      }
    },
    [addLog, options],
  );

  useEffect(() => {
    const handleDisconnect = (event: USBConnectionEvent) => {
      if (device && event.device === device) {
        pollAbortRef.current = true;
        setStatus("idle");
        setEndpointSet(null);
        setDevice(null);
        addLog({ direction: "system", label: "GR-55 USB detached", sent: true });
      }
    };

    navigator.usb?.addEventListener("disconnect", handleDisconnect as EventListener);
    return () => {
      navigator.usb?.removeEventListener("disconnect", handleDisconnect as EventListener);
      pollAbortRef.current = true;
    };
  }, [addLog, device]);

  return {
    status,
    error,
    device,
    deviceLabel,
    endpointSet,
    endpointLabel,
    packetMode,
    setPacketMode,
    lastIn,
    connect,
    refresh,
    disconnect,
    send,
    log,
    addLog,
  };
}

function formatUsbIncomingLabel(event: IncomingMidiEvent) {
  switch (event.type) {
    case "program-change":
      return `USB Program change Ch ${event.channel} PC ${event.program}`;
    case "bank-select":
      return `USB Bank select Ch ${event.channel} MSB ${event.bankMsb}`;
    case "control-change":
      return `USB CC Ch ${event.channel} #${event.controller} = ${event.value}`;
    case "roland-data":
      return `USB Roland data ${event.checksumValid ? "OK" : "bad checksum"}`;
    case "identity-reply":
      return `USB identity reply Roland model ${event.modelNumber.toString(16).toUpperCase()}`;
    default:
      return "USB MIDI in";
  }
}
