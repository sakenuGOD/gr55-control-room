import { useCallback, useEffect, useMemo, useState } from "react";
import {
  describeMidiPort,
  formatMidiAccessError,
  getMidiSupportIssue,
  selectBestMidiPort,
  summarizeMidiDiscovery,
} from "../lib/midiDiagnostics";
import { parseIncomingMidiMessage, type IncomingMidiEvent } from "../lib/midiMessages";
import { MidiLogEntry, toHex } from "../lib/roland";

type MidiStatus = "idle" | "unsupported" | "pending" | "ready" | "error";

export function useMidi(options: { onIncoming?: (event: IncomingMidiEvent, bytes: number[]) => void } = {}) {
  const [access, setAccess] = useState<MIDIAccess | null>(null);
  const [status, setStatus] = useState<MidiStatus>("idle");
  const [error, setError] = useState("");
  const [inputs, setInputs] = useState<MIDIInput[]>([]);
  const [outputs, setOutputs] = useState<MIDIOutput[]>([]);
  const [selectedInputId, setSelectedInputId] = useState("");
  const [selectedOutputId, setSelectedOutputId] = useState("");
  const [log, setLog] = useState<MidiLogEntry[]>([]);

  const selectedInput = useMemo(
    () => inputs.find((input) => input.id === selectedInputId) ?? null,
    [inputs, selectedInputId],
  );
  const selectedOutput = useMemo(
    () => outputs.find((output) => output.id === selectedOutputId) ?? null,
    [outputs, selectedOutputId],
  );
  const inputDescriptions = useMemo(() => inputs.map(describeMidiPort), [inputs]);
  const outputDescriptions = useMemo(() => outputs.map(describeMidiPort), [outputs]);
  const discoverySummary = useMemo(
    () => summarizeMidiDiscovery(inputs, outputs, selectedInputId, selectedOutputId),
    [inputs, outputs, selectedInputId, selectedOutputId],
  );

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

  const refreshPorts = useCallback((midiAccess: MIDIAccess) => {
    const nextInputs = Array.from(midiAccess.inputs.values());
    const nextOutputs = Array.from(midiAccess.outputs.values());

    setInputs(nextInputs);
    setOutputs(nextOutputs);

    setSelectedInputId((current) => {
      if (current && nextInputs.some((input) => input.id === current)) {
        return current;
      }
      return selectBestMidiPort(nextInputs)?.id ?? "";
    });

    setSelectedOutputId((current) => {
      if (current && nextOutputs.some((output) => output.id === current)) {
        return current;
      }
      return selectBestMidiPort(nextOutputs)?.id ?? "";
    });
  }, []);

  const connect = useCallback(async () => {
    const supportIssue = getMidiSupportIssue({
      isSecureContext: window.isSecureContext,
      hasRequestMIDIAccess: Boolean(navigator.requestMIDIAccess),
    });

    if (supportIssue) {
      setStatus("unsupported");
      setError(supportIssue);
      return;
    }

    setStatus("pending");
    setError("");

    try {
      const midiAccess = await navigator.requestMIDIAccess({ sysex: true });
      setAccess(midiAccess);
      refreshPorts(midiAccess);
      midiAccess.onstatechange = () => refreshPorts(midiAccess);
      setStatus("ready");
      addLog({
        direction: "system",
        label: midiAccess.sysexEnabled
          ? `MIDI ready with SysEx. ${summarizeMidiDiscovery(
              Array.from(midiAccess.inputs.values()),
              Array.from(midiAccess.outputs.values()),
            )}`
          : "MIDI ready, but SysEx is disabled. Reconnect and allow SysEx.",
        sent: true,
      });
    } catch (requestError) {
      setStatus("error");
      setError(formatMidiAccessError(requestError, true));
    }
  }, [addLog, refreshPorts]);

  const refresh = useCallback(() => {
    if (!access) {
      void connect();
      return;
    }

    refreshPorts(access);
    addLog({
      direction: "system",
      label: summarizeMidiDiscovery(Array.from(access.inputs.values()), Array.from(access.outputs.values())),
      sent: true,
    });
  }, [access, addLog, connect, refreshPorts]);

  const send = useCallback(
    (bytes: readonly number[], label: string) => {
      if (!selectedOutput) {
        addLog({ direction: "out", label: `${label} (demo)`, bytes: [...bytes], sent: false });
        return false;
      }

      selectedOutput.send([...bytes]);
      addLog({ direction: "out", label, bytes: [...bytes], sent: true });
      return true;
    },
    [addLog, selectedOutput],
  );

  useEffect(() => {
    if (!selectedInput) {
      return;
    }

    selectedInput.onmidimessage = (event) => {
      if (!event.data) {
        return;
      }

      const bytes = Array.from(event.data);
      const parsed = parseIncomingMidiMessage(event.data);

      options.onIncoming?.(parsed, bytes);

      addLog({
        direction: "in",
        label: formatIncomingLabel(parsed),
        bytes,
        sent: true,
      });
    };

    return () => {
      selectedInput.onmidimessage = null;
    };
  }, [addLog, options, selectedInput]);

  return {
    access,
    status,
    error,
    inputs,
    outputs,
    selectedInputId,
    selectedOutputId,
    selectedInput,
    selectedOutput,
    setSelectedInputId,
    setSelectedOutputId,
    connect,
    refresh,
    send,
    log,
    addLog,
    inputDescriptions,
    outputDescriptions,
    discoverySummary,
  };
}

function formatIncomingLabel(event: IncomingMidiEvent) {
  switch (event.type) {
    case "program-change":
      return `Program change Ch ${event.channel} PC ${event.program}`;
    case "bank-select":
      return `Bank select Ch ${event.channel} MSB ${event.bankMsb}`;
    case "control-change":
      return `CC Ch ${event.channel} #${event.controller} = ${event.value}`;
    case "roland-data":
      return `Roland data ${event.checksumValid ? "OK" : "bad checksum"} ${toHex(event.address)}`;
    case "identity-reply":
      return `Identity reply Roland model ${event.modelNumber.toString(16).toUpperCase()}`;
    default:
      return "MIDI in";
  }
}
