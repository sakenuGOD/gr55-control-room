export type MidiSupportProbe = {
  isSecureContext: boolean;
  hasRequestMIDIAccess: boolean;
};

export type MidiPortDescription = {
  id: string;
  label: string;
  state: MIDIPortDeviceState;
  connection: MIDIPortConnectionState;
  isLikelyRoland: boolean;
  isUsableMidiInterface: boolean;
  reason: string;
};

const ROLAND_TERMS = ["roland", "boss", "gr-55", "gr55"];
const GENERIC_MIDI_TERMS = ["midi", "din", "interface", "um-one", "mio", "minifuse", "arturia", "usb"];

export function getMidiSupportIssue(probe: MidiSupportProbe) {
  if (!probe.isSecureContext) {
    return "Web MIDI needs HTTPS or localhost. Open this app from the local dev URL, not a random file path.";
  }

  if (!probe.hasRequestMIDIAccess) {
    return "Web MIDI is unavailable in this browser. Use Chrome or Edge for MIDI and SysEx access.";
  }

  return "";
}

export function formatMidiAccessError(error: unknown, sysexRequested: boolean) {
  const name = getErrorName(error);
  const message = getErrorMessage(error);

  if (name === "NotAllowedError" || /denied|permission/i.test(message)) {
    return sysexRequested
      ? "MIDI permission was denied. Allow MIDI and SysEx in the browser prompt, then press Refresh MIDI."
      : "MIDI permission was denied. Allow MIDI in the browser prompt, then press Refresh MIDI.";
  }

  if (name === "SecurityError") {
    return "The browser blocked MIDI for this page. Open the localhost URL in Chrome or Edge and allow MIDI access.";
  }

  return message || "MIDI permission failed.";
}

export function selectBestMidiPort<T extends MIDIPort>(ports: readonly T[], selectedId = "") {
  const connected = ports.filter((port) => port.state !== "disconnected");

  if (selectedId) {
    const selected = connected.find((port) => port.id === selectedId);
    if (selected) {
      return selected;
    }
  }

  return (
    connected.find((port) => describeMidiPort(port).isLikelyRoland) ??
    connected.find((port) => describeMidiPort(port).isUsableMidiInterface) ??
    connected[0] ??
    null
  );
}

export function describeMidiPort(port: MIDIPort): MidiPortDescription {
  const text = portText(port);
  const lower = text.toLowerCase();
  const isLikelyRoland = ROLAND_TERMS.some((term) => lower.includes(term));
  const isUsableMidiInterface =
    port.state !== "disconnected" && (isLikelyRoland || GENERIC_MIDI_TERMS.some((term) => lower.includes(term)));

  return {
    id: port.id,
    label: text || port.id,
    state: port.state,
    connection: port.connection,
    isLikelyRoland,
    isUsableMidiInterface,
    reason: isLikelyRoland
      ? "Looks like a Roland/BOSS GR-55 MIDI port."
      : isUsableMidiInterface
        ? "Looks like a generic MIDI interface. Use this when the GR-55 is connected with DIN MIDI cables."
        : port.state === "disconnected"
          ? "This MIDI port is disconnected."
          : "Available MIDI port.",
  };
}

export function summarizeMidiDiscovery(
  inputs: readonly MIDIPort[],
  outputs: readonly MIDIPort[],
  selectedInputId = "",
  selectedOutputId = "",
) {
  const selectedInput = inputs.find((port) => port.id === selectedInputId);
  const selectedOutput = outputs.find((port) => port.id === selectedOutputId);
  const inputLabel = selectedInput ? describeMidiPort(selectedInput).label : "none";
  const outputLabel = selectedOutput ? describeMidiPort(selectedOutput).label : "none";

  if (!inputs.length && !outputs.length) {
    return [
      "No CoreMIDI ports are visible to the browser.",
      "If USB shows GR-55 but MIDI is empty, install/allow the Roland GR-55 driver or use Direct USB below.",
      "If you use a 5-pin DIN cable, select the USB MIDI interface name, not Roland GR-55.",
    ].join(" ");
  }

  return `MIDI ports: ${inputs.length} input${inputs.length === 1 ? "" : "s"}, ${outputs.length} output${
    outputs.length === 1 ? "" : "s"
  }. Input: ${inputLabel}. Output: ${outputLabel}.`;
}

function portText(port: MIDIPort) {
  return [port.manufacturer, port.name].filter(Boolean).join(" ").trim();
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
