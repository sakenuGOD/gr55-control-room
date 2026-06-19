import { describe, expect, it } from "vitest";
import {
  describeMidiPort,
  formatMidiAccessError,
  getMidiSupportIssue,
  selectBestMidiPort,
  summarizeMidiDiscovery,
} from "../src/lib/midiDiagnostics";

type TestPort = {
  id: string;
  manufacturer?: string;
  name?: string;
  type: "input" | "output";
  state?: MIDIPortDeviceState;
  connection?: MIDIPortConnectionState;
};

function port(overrides: TestPort): MIDIPort {
  return {
    manufacturer: "",
    name: "",
    state: "connected",
    connection: "closed",
    version: "",
    open: async () => port(overrides),
    close: async () => port(overrides),
    ...overrides,
  } as MIDIPort;
}

describe("MIDI diagnostics", () => {
  it("keeps a manually selected connected port during refresh", () => {
    const ports = [
      port({ id: "generic", name: "USB MIDI Interface", type: "output" }),
      port({ id: "manual", name: "Studio DIN Out", type: "output" }),
      port({ id: "roland", manufacturer: "Roland", name: "GR-55", type: "output" }),
    ];

    expect(selectBestMidiPort(ports, "manual")?.id).toBe("manual");
  });

  it("prefers usable DIN MIDI interfaces over disconnected Roland-named ports", () => {
    const ports = [
      port({ id: "stale-gr55", manufacturer: "Roland", name: "GR-55", type: "input", state: "disconnected" }),
      port({ id: "din", manufacturer: "iConnectivity", name: "mio DIN In", type: "input" }),
    ];

    expect(selectBestMidiPort(ports)?.id).toBe("din");
  });

  it("describes generic USB/DIN MIDI interfaces as usable ports", () => {
    const description = describeMidiPort(
      port({ id: "din", manufacturer: "Generic", name: "USB MIDI Interface", type: "output" }),
    );

    expect(description.label).toBe("Generic USB MIDI Interface");
    expect(description.isLikelyRoland).toBe(false);
    expect(description.isUsableMidiInterface).toBe(true);
    expect(description.reason).toContain("generic MIDI interface");
  });

  it("summarizes discovered inputs and outputs with selected labels", () => {
    const inputs = [port({ id: "in-1", manufacturer: "Generic", name: "USB MIDI In", type: "input" })];
    const outputs = [port({ id: "out-1", manufacturer: "Roland", name: "GR-55", type: "output" })];

    expect(summarizeMidiDiscovery(inputs, outputs, "in-1", "out-1")).toContain(
      "MIDI ports: 1 input, 1 output. Input: Generic USB MIDI In. Output: Roland GR-55.",
    );
  });

  it("reports insecure contexts before browser support checks", () => {
    expect(
      getMidiSupportIssue({
        isSecureContext: false,
        hasRequestMIDIAccess: true,
      }),
    ).toContain("HTTPS or localhost");
  });

  it("reports unsupported browsers when requestMIDIAccess is missing", () => {
    expect(
      getMidiSupportIssue({
        isSecureContext: true,
        hasRequestMIDIAccess: false,
      }),
    ).toContain("Web MIDI is unavailable");
  });

  it("formats denied SysEx permission errors with recovery guidance", () => {
    expect(formatMidiAccessError({ name: "NotAllowedError", message: "Permission denied" }, true)).toContain(
      "Allow MIDI and SysEx",
    );
  });
});
