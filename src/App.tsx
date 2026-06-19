import {
  ArrowClockwise,
  ArrowCounterClockwise,
  CheckCircle,
  Circuitry,
  ClipboardText,
  Command,
  DownloadSimple,
  DotsThree,
  FadersHorizontal,
  FileArrowUp,
  FloppyDisk,
  Keyboard,
  ListMagnifyingGlass,
  MagnifyingGlass,
  Plugs,
  Power,
  Pulse,
  Queue,
  Sliders,
  Usb,
  WarningCircle,
  UploadSimple,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MODULES,
  PARAMETERS_BY_ADDRESS,
  createInitialParameterValues,
  decodeParameterValue,
  makeParameterMessage,
  parameterDataSize,
  type ModuleDefinition,
  type ParameterDefinition,
  type ParameterModuleId,
} from "./data/gr55Parameters";
import { USER_PATCHES, type UserPatch } from "./data/gr55PatchMap";
import { useDirectUsb } from "./hooks/useDirectUsb";
import { useMidi } from "./hooks/useMidi";
import { useNativeBridge, type BridgeUsbDeviceInfo } from "./hooks/useNativeBridge";
import { addressKey, type IncomingMidiEvent } from "./lib/midiMessages";
import {
  bankSelectMsb,
  clamp,
  controlChange,
  identityRequest,
  makeDataRequestMessage,
  makeSaveUserPatchMessage,
  parseHex,
  programChange,
  toHex,
} from "./lib/roland";
import {
  makeDownloadBlobUrl,
  parseImportedSysEx,
  serializeMessagesAsHex,
  validateImportFileMeta,
  type ImportedSysExMessage,
} from "./lib/sysexLibrary";
import type { UsbPacketMode } from "./lib/usbMidi";

type ParameterValues = Record<string, number>;
type TransportMode = "bridge" | "midi" | "usb";
type OperationState = "idle" | "sending" | "saved" | "error";
type WorkflowState = "disconnected" | "ready-to-read" | "ready-to-edit" | "dirty";
type EditorTabId = "overview" | "tones" | "assigns" | "pedal" | "system" | "sysex" | ParameterModuleId;
type SourceField = "enabled" | "level" | "pan" | "tone" | "muted" | "solo" | "attack" | "brightness" | "octave" | "fxSend";
type SourceIntent = "change-instrument" | "brighter" | "darker" | "softer-attack" | "sharper-attack" | "forward" | "back" | "more-space";
type ModuleIntent = "more" | "less" | "longer" | "shorter" | "brighter" | "darker" | "movement" | "reset";
type Selection =
  | { type: "patch" }
  | { type: "module"; moduleId: ParameterModuleId }
  | { type: "parameter"; paramId: string }
  | { type: "source"; sourceId: string; field: SourceField };

type InteractionHud = {
  key: string;
  label: string;
  target: string;
  before: string;
  after: string;
  behavior: string;
  status: "live" | "pending" | "staged";
};

type ParameterHistoryItem = {
  paramId: string;
  before: number;
  after: number;
};

type PerformanceControlDefinition = {
  id: string;
  label: string;
  controller: number;
  kind: "knob" | "toggle";
  defaultValue: number;
};

type SourceDefinition = {
  id: string;
  label: string;
  block: string;
  toneOptions: string[];
  role: "main" | "layer" | "texture" | "hidden";
  enabled: boolean;
  level: number;
  pan: number;
  tone: string;
  attack: number;
  brightness: number;
  octave: number;
  fxSend: number;
  muted: boolean;
  solo: boolean;
};

const PERFORMANCE_CONTROLS: PerformanceControlDefinition[] = [
  { id: "expression", label: "EXP pedal", controller: 11, kind: "knob", defaultValue: 0 },
  { id: "gkVolume", label: "GK volume", controller: 7, kind: "knob", defaultValue: 100 },
  { id: "modWheel", label: "MOD wheel", controller: 1, kind: "knob", defaultValue: 0 },
  { id: "hold", label: "Hold", controller: 64, kind: "toggle", defaultValue: 0 },
  { id: "ctl", label: "CTL pedal", controller: 80, kind: "toggle", defaultValue: 0 },
];

const SOURCE_DEFAULTS: SourceDefinition[] = [
  {
    id: "pcm1",
    label: "PCM Tone 1",
    block: "PCM1",
    toneOptions: ["Nylon guitar", "Synth lead", "Warm pad", "Bell mallet"],
    role: "main",
    enabled: true,
    level: 82,
    pan: 0,
    tone: "Warm pad",
    attack: 42,
    brightness: 54,
    octave: 0,
    fxSend: 42,
    muted: false,
    solo: false,
  },
  {
    id: "pcm2",
    label: "PCM Tone 2",
    block: "PCM2",
    toneOptions: ["JP strings", "Choir layer", "Square lead", "Analog brass"],
    role: "layer",
    enabled: true,
    level: 64,
    pan: -8,
    tone: "JP strings",
    attack: 55,
    brightness: 48,
    octave: 1,
    fxSend: 38,
    muted: false,
    solo: false,
  },
  {
    id: "modeling",
    label: "Modeling tone",
    block: "Modeling",
    toneOptions: ["E.GTR Strat", "LP humbucker", "Acoustic steel", "Bass model"],
    role: "main",
    enabled: true,
    level: 88,
    pan: 0,
    tone: "E.GTR Strat",
    attack: 28,
    brightness: 62,
    octave: 0,
    fxSend: 18,
    muted: false,
    solo: false,
  },
  {
    id: "normal",
    label: "Normal pickup",
    block: "Normal PU",
    toneOptions: ["Direct", "Through amp", "Blend clean", "Muted"],
    role: "hidden",
    enabled: false,
    level: 48,
    pan: 0,
    tone: "Direct",
    attack: 20,
    brightness: 50,
    octave: 0,
    fxSend: 12,
    muted: false,
    solo: false,
  },
];

const CLEAR_TEMP_PARAMETER_VALUES: Record<string, number> = {
  patchLevel: 0,
  ampSwitch: 0,
  modSwitch: 0,
  mfxSwitch: 0,
  chorusSwitch: 0,
  delaySwitch: 0,
  delayLevel: 0,
  reverbSwitch: 0,
  reverbLevel: 0,
  eqSwitch: 0,
  nsSwitch: 0,
};

const EDITOR_TABS: Array<{ id: EditorTabId; label: string; moduleId?: ParameterModuleId }> = [
  { id: "overview", label: "Overview" },
  { id: "tones", label: "Tones" },
  { id: "common", label: "Patch", moduleId: "common" },
  { id: "amp", label: "Amp", moduleId: "amp" },
  { id: "mod", label: "MOD", moduleId: "mod" },
  { id: "mfx", label: "MFX", moduleId: "mfx" },
  { id: "chorus", label: "Chorus", moduleId: "chorus" },
  { id: "delay", label: "Delay", moduleId: "delay" },
  { id: "reverb", label: "Reverb", moduleId: "reverb" },
  { id: "eq", label: "EQ", moduleId: "eq" },
  { id: "noise", label: "Output", moduleId: "noise" },
  { id: "assigns", label: "Assigns" },
  { id: "pedal", label: "Pedal/GK" },
  { id: "sysex", label: "SysEx" },
];

const MODULE_IDS = new Set<EditorTabId>(MODULES.map((module) => module.id));
const EFFECT_FLOW: Array<{ moduleId: ParameterModuleId; label: string; role: string }> = [
  { moduleId: "amp", label: "Amp", role: "Body and drive" },
  { moduleId: "mod", label: "MOD", role: "Movement or drive" },
  { moduleId: "mfx", label: "MFX", role: "Color effect" },
  { moduleId: "chorus", label: "Chorus", role: "Width" },
  { moduleId: "delay", label: "Delay", role: "Repeats" },
  { moduleId: "reverb", label: "Reverb", role: "Space" },
  { moduleId: "eq", label: "Output", role: "Final tone" },
];

export function App() {
  const initialValues = useMemo(() => createInitialParameterValues(), []);
  const [selectedPatch, setSelectedPatch] = useState<UserPatch>(USER_PATCHES[212] ?? USER_PATCHES[0]);
  const [patchLoaded, setPatchLoaded] = useState(true);
  const [incomingBankMsb, setIncomingBankMsb] = useState(0);
  const [activeModuleId, setActiveModuleId] = useState<ParameterModuleId>("mfx");
  const [activeTabId, setActiveTabId] = useState<EditorTabId>("mfx");
  const [values, setValues] = useState<ParameterValues>(() => initialValues);
  const [originalValues, setOriginalValues] = useState<ParameterValues>(() => initialValues);
  const [performanceValues, setPerformanceValues] = useState<ParameterValues>(() =>
    Object.fromEntries(PERFORMANCE_CONTROLS.map((control) => [control.id, control.defaultValue])),
  );
  const [sources, setSources] = useState<SourceDefinition[]>(() => SOURCE_DEFAULTS);
  const [midiChannel, setMidiChannel] = useState(1);
  const [deviceId, setDeviceId] = useState(0x10);
  const [liveWrite, setLiveWrite] = useState(true);
  const [rawHex, setRawHex] = useState("F0 41 10 00 00 53 12 18 00 06 05 01 5C F7");
  const [rawError, setRawError] = useState("");
  const [mirrorStatus, setMirrorStatus] = useState("Waiting for GR-55 traffic");
  const [importedMessages, setImportedMessages] = useState<ImportedSysExMessage[]>([]);
  const [libraryError, setLibraryError] = useState("");
  const [transportMode, setTransportMode] = useState<TransportMode>("bridge");
  const [selection, setSelection] = useState<Selection>({ type: "patch" });
  const [interactionHud, setInteractionHud] = useState<InteractionHud | null>(null);
  const [operationState, setOperationState] = useState<OperationState>("idle");
  const [lastSentByParameter, setLastSentByParameter] = useState<Record<string, string>>({});
  const [undoStack, setUndoStack] = useState<ParameterHistoryItem[]>([]);
  const [redoStack, setRedoStack] = useState<ParameterHistoryItem[]>([]);
  const [compareActive, setCompareActive] = useState(false);
  const [utilityDrawerOpen, setUtilityDrawerOpen] = useState(false);
  const [previewedDirtyChanges, setPreviewedDirtyChanges] = useState(false);
  const patchSearchRef = useRef<HTMLInputElement | null>(null);

  const handleIncoming = useCallback(
    (event: IncomingMidiEvent) => {
      if (event.type === "bank-select") {
        setIncomingBankMsb(event.bankMsb);
        setMirrorStatus(`GR-55 bank MSB ${event.bankMsb}`);
        return;
      }

      if (event.type === "program-change") {
        const patch = USER_PATCHES.find(
          (candidate) => candidate.bankMsb === incomingBankMsb && candidate.program === event.program,
        );

        if (patch) {
          setSelectedPatch(patch);
          setMirrorStatus(`GR-55 selected USER ${patch.label}`);
        } else {
          setMirrorStatus(`GR-55 PC ${event.program} on bank ${incomingBankMsb}`);
        }
        return;
      }

      if (event.type === "control-change") {
        const control = PERFORMANCE_CONTROLS.find((item) => item.controller === event.controller);
        if (control) {
          setPerformanceValues((current) => ({ ...current, [control.id]: event.value }));
          setMirrorStatus(`GR-55 CC ${event.controller} = ${event.value}`);
        }
        return;
      }

      if (event.type === "roland-data") {
        const param = PARAMETERS_BY_ADDRESS.get(addressKey(event.address));
        if (param && event.checksumValid) {
          const decoded = decodeParameterValue(param, event.valueBytes);
          setValues((current) => ({ ...current, [param.id]: decoded }));
          setOriginalValues((current) => ({ ...current, [param.id]: decoded }));
          setPatchLoaded(true);
          setSelection({ type: "parameter", paramId: param.id });
          setActiveModuleId(param.moduleId);
          setActiveTabId(param.moduleId);
          setDeviceId(event.deviceId);
          setMirrorStatus(`GR-55 ${param.label} = ${formatParameterValue(param, decoded)}`);
        } else {
          setMirrorStatus(event.checksumValid ? `GR-55 data ${toHex(event.address)}` : "GR-55 data checksum failed");
        }
        return;
      }

      if (event.type === "identity-reply") {
        setDeviceId(event.deviceId);
        setMirrorStatus(`Roland identity reply, device 0x${event.deviceId.toString(16).toUpperCase()}`);
      }
    },
    [incomingBankMsb],
  );

  const midiOptions = useMemo(() => ({ onIncoming: handleIncoming }), [handleIncoming]);
  const midi = useMidi(midiOptions);
  const usb = useDirectUsb(midiOptions);
  const bridge = useNativeBridge(midiOptions);

  const activeModule = useMemo(
    () => MODULES.find((module) => module.id === activeModuleId) ?? MODULES[0],
    [activeModuleId],
  );
  const selectedParameter = useMemo(() => {
    if (selection.type !== "parameter") {
      return null;
    }
    return MODULES.flatMap((module) => module.parameters).find((param) => param.id === selection.paramId) ?? null;
  }, [selection]);
  const selectedSource = useMemo(() => {
    if (selection.type !== "source") {
      return null;
    }
    return sources.find((source) => source.id === selection.sourceId) ?? null;
  }, [selection, sources]);
  const selectedModule = useMemo(() => {
    const moduleId =
      selection.type === "module" ? selection.moduleId : selectedParameter ? selectedParameter.moduleId : null;
    return moduleId ? MODULES.find((module) => module.id === moduleId) ?? null : null;
  }, [selectedParameter, selection]);
  const dirtyParameterIds = useMemo(
    () => Object.keys(values).filter((id) => values[id] !== originalValues[id]),
    [originalValues, values],
  );
  const dirtyCount = dirtyParameterIds.length;
  const editorValues = compareActive ? originalValues : values;
  const activeStatus = transportMode === "bridge" ? bridge.status : transportMode === "usb" ? usb.status : midi.status;
  const workflowState = getWorkflowState(activeStatus === "ready", patchLoaded, dirtyCount);
  const activeConnectionLabel =
    transportMode === "bridge"
      ? bridge.deviceLabel || "Native bridge"
      : transportMode === "usb"
        ? usb.deviceLabel || "Direct USB"
        : midi.selectedOutput?.name ?? "";
  const combinedLog = useMemo(() => [...bridge.log, ...usb.log, ...midi.log].slice(0, 100), [bridge.log, midi.log, usb.log]);
  const lastLogEntry = combinedLog[0];

  const sendToRoland = useCallback(
    (bytes: readonly number[], label: string) => {
      if (transportMode === "bridge") {
        return bridge.send(bytes, label);
      }

      return transportMode === "usb" ? usb.send(bytes, label) : midi.send(bytes, label);
    },
    [bridge, midi, transportMode, usb],
  );

  const showOperationPulse = useCallback((state: OperationState) => {
    setOperationState(state);
    if (state !== "idle") {
      window.setTimeout(() => setOperationState("idle"), state === "saved" ? 1700 : 1200);
    }
  }, []);

  const connectActiveTransport = useCallback(() => {
    if (transportMode === "bridge") {
      bridge.connectUsb();
      return;
    }

    if (transportMode === "usb") {
      usb.connect();
      return;
    }

    midi.connect();
  }, [bridge, midi, transportMode, usb]);

  const selectPatch = useCallback(
    (patch: UserPatch) => {
      setSelectedPatch(patch);
      setPatchLoaded(true);
      sendToRoland(bankSelectMsb(midiChannel, patch.bankMsb), `Bank MSB ${patch.bankMsb}`);
      sendToRoland(programChange(midiChannel, patch.program), `Select USER ${patch.label}`);
      setMirrorStatus(`Selected USER ${patch.label}`);
    },
    [midiChannel, sendToRoland],
  );

  const sendIdentity = useCallback(() => {
    sendToRoland(identityRequest(), "Identity request");
  }, [sendToRoland]);

  const requestPatchLevel = useCallback(() => {
    showOperationPulse("sending");
    setPatchLoaded(true);
    sendToRoland(
      makeDataRequestMessage([0x18, 0x00, 0x02, 0x30], [0x00, 0x00, 0x00, 0x02], deviceId),
      "Request temporary patch level",
    );
  }, [deviceId, sendToRoland, showOperationPulse]);

  const setParameter = useCallback(
    (param: ParameterDefinition, nextValue: number, shouldSend = liveWrite, trackHistory = true) => {
      setCompareActive(false);
      setPreviewedDirtyChanges(false);
      const currentValue = values[param.id] ?? param.defaultValue;
      const bounded = normalizeParameterValue(param, nextValue);
      if (bounded === currentValue) {
        setSelection({ type: "parameter", paramId: param.id });
        return;
      }

      if (trackHistory) {
        setUndoStack((current) => [...current.slice(-79), { paramId: param.id, before: currentValue, after: bounded }]);
        setRedoStack([]);
      }

      setValues((current) => ({ ...current, [param.id]: bounded }));
      setSelection({ type: "parameter", paramId: param.id });
      setActiveModuleId(param.moduleId);
      setActiveTabId(param.moduleId);

      const sent = shouldSend
        ? sendToRoland(
            makeParameterMessage(param, bounded, deviceId),
            `${moduleShortTitle(param.moduleId)} ${param.label}: ${formatParameterValue(param, bounded)}`,
          )
        : false;

      if (sent) {
        setLastSentByParameter((current) => ({ ...current, [param.id]: new Date().toLocaleTimeString() }));
      }

      setInteractionHud({
        key: `${param.id}-${Date.now()}`,
        label: readableParameterName(param),
        target: moduleShortTitle(param.moduleId),
        before: formatParameterValue(param, currentValue),
        after: formatParameterValue(param, bounded),
        behavior: sent ? "Live Send" : "Staged",
        status: sent ? "live" : "pending",
      });
    },
    [deviceId, liveWrite, sendToRoland, values],
  );

  const applyHistoryItem = useCallback(
    (item: ParameterHistoryItem, direction: "undo" | "redo") => {
      const param = MODULES.flatMap((module) => module.parameters).find((candidate) => candidate.id === item.paramId);
      if (!param) {
        return;
      }
      setParameter(param, direction === "undo" ? item.before : item.after, liveWrite, false);
    },
    [liveWrite, setParameter],
  );

  const undoParameterChange = useCallback(() => {
    setUndoStack((current) => {
      const item = current.at(-1);
      if (!item) {
        return current;
      }
      applyHistoryItem(item, "undo");
      setRedoStack((redo) => [...redo, item]);
      return current.slice(0, -1);
    });
  }, [applyHistoryItem]);

  const redoParameterChange = useCallback(() => {
    setRedoStack((current) => {
      const item = current.at(-1);
      if (!item) {
        return current;
      }
      applyHistoryItem(item, "redo");
      setUndoStack((undo) => [...undo, item]);
      return current.slice(0, -1);
    });
  }, [applyHistoryItem]);

  const revertParameter = useCallback(
    (param: ParameterDefinition) => {
      setParameter(param, originalValues[param.id] ?? param.defaultValue, liveWrite);
    },
    [liveWrite, originalValues, setParameter],
  );

  const sendModule = useCallback(
    (module: ModuleDefinition) => {
      showOperationPulse("sending");
      module.parameters.forEach((param) => {
        const sent = sendToRoland(
          makeParameterMessage(param, values[param.id], deviceId),
          `${module.shortTitle} ${param.label}: ${formatParameterValue(param, values[param.id])}`,
        );
        if (sent) {
          setLastSentByParameter((current) => ({ ...current, [param.id]: new Date().toLocaleTimeString() }));
        }
      });
    },
    [deviceId, sendToRoland, showOperationPulse, values],
  );

  const requestModule = useCallback(
    async (module: ModuleDefinition) => {
      showOperationPulse("sending");
      for (const param of module.parameters) {
        sendToRoland(makeDataRequestMessage(param.address, parameterDataSize(param), deviceId), `Read ${param.label}`);
        await delay(24);
      }
    },
    [deviceId, sendToRoland, showOperationPulse],
  );

  const sendPanic = useCallback(() => {
    showOperationPulse("sending");
    for (let controller = 120; controller <= 123; controller += 1) {
      sendToRoland(controlChange(midiChannel, controller, 0), `CC ${controller}`);
    }
  }, [midiChannel, sendToRoland, showOperationPulse]);

  const setPerformanceControl = useCallback(
    (control: PerformanceControlDefinition, nextValue: number) => {
      const value = control.kind === "toggle" ? (nextValue > 0 ? 127 : 0) : clamp(nextValue, 0, 127);
      const before = performanceValues[control.id] ?? control.defaultValue;
      setPerformanceValues((current) => ({ ...current, [control.id]: value }));
      const sent = sendToRoland(controlChange(midiChannel, control.controller, value), `${control.label} CC ${control.controller}: ${value}`);
      setInteractionHud({
        key: `${control.id}-${Date.now()}`,
        label: control.label,
        target: `CC ${control.controller}`,
        before: String(before),
        after: String(value),
        behavior: sent ? "Live Send" : "Demo",
        status: sent ? "live" : "pending",
      });
    },
    [midiChannel, performanceValues, sendToRoland],
  );

  const updateSource = useCallback(
    (sourceId: string, field: SourceField, value: boolean | number | string) => {
      const source = sources.find((item) => item.id === sourceId);
      if (!source) {
        return;
      }
      setPreviewedDirtyChanges(false);
      const before = source[field];
      setSources((current) =>
        current.map((item) => (item.id === sourceId ? { ...item, [field]: value } : item)),
      );
      setSelection({ type: "source", sourceId, field });
      setInteractionHud({
        key: `${sourceId}-${field}-${Date.now()}`,
        label: `${source.label} ${sourceFieldLabel(field)}`,
        target: source.block,
        before: formatSourceValue(field, before),
        after: formatSourceValue(field, value),
        behavior: "Staged",
        status: "staged",
      });
    },
    [sources],
  );

  const inspectSource = useCallback((sourceId: string, field: SourceField = "level") => {
    setSelection({ type: "source", sourceId, field });
  }, []);

  const revertSourceField = useCallback(
    (sourceId: string, field: SourceField) => {
      const originalSource = SOURCE_DEFAULTS.find((source) => source.id === sourceId);
      if (!originalSource) {
        return;
      }
      updateSource(sourceId, field, originalSource[field]);
    },
    [updateSource],
  );

  const sendSaveToSelectedPatch = useCallback(() => {
    if (!window.confirm(`Overwrite USER ${selectedPatch.label} on the GR-55 with the current temporary patch?`)) {
      return;
    }

    showOperationPulse("sending");
    const sent = sendToRoland(makeSaveUserPatchMessage(selectedPatch.userIndex, deviceId), `Save temp to USER ${selectedPatch.label}`);
    if (sent) {
      setOriginalValues(values);
      setPreviewedDirtyChanges(false);
      window.setTimeout(() => showOperationPulse("saved"), 240);
    } else {
      showOperationPulse("error");
    }
  }, [deviceId, selectedPatch, sendToRoland, showOperationPulse, values]);

  const sendPreviewChanges = useCallback(() => {
    sendModule(activeModule);
    if (dirtyCount > 0) {
      setPreviewedDirtyChanges(true);
    }
  }, [activeModule, dirtyCount, sendModule]);

  const clearTemporaryPatch = useCallback(() => {
    Object.entries(CLEAR_TEMP_PARAMETER_VALUES).forEach(([parameterId, nextValue]) => {
      const param = [...PARAMETERS_BY_ADDRESS.values()].find((candidate) => candidate.id === parameterId);
      if (!param) {
        return;
      }
      setParameter(param, nextValue, true);
    });
  }, [setParameter]);

  const clearSelectedUserPatch = useCallback(() => {
    if (
      !window.confirm(
        `Mute the temporary patch and overwrite USER ${selectedPatch.label}? This is the closest safe equivalent of deleting a GR-55 user patch.`,
      )
    ) {
      return;
    }

    clearTemporaryPatch();
    window.setTimeout(() => {
      showOperationPulse("sending");
      sendToRoland(makeSaveUserPatchMessage(selectedPatch.userIndex, deviceId), `Clear USER ${selectedPatch.label}`);
    }, 180);
  }, [clearTemporaryPatch, deviceId, selectedPatch, sendToRoland, showOperationPulse]);

  const sendRawSysEx = useCallback(() => {
    try {
      const bytes = parseHex(rawHex);
      if (bytes.length === 0) {
        setRawError("Enter SysEx hex bytes.");
        return;
      }
      setRawError("");
      const sent = sendToRoland(bytes, "Raw SysEx");
      showOperationPulse(sent ? "sending" : "error");
    } catch (error) {
      setRawError(error instanceof Error ? error.message : "Invalid hex input.");
    }
  }, [rawHex, sendToRoland, showOperationPulse]);

  const importFromRawHex = useCallback(() => {
    try {
      const messages = parseImportedSysEx(rawHex).map((message, index) => ({
        ...message,
        label: `Paste ${index + 1}`,
      }));
      setImportedMessages((current) => [...messages, ...current]);
      setRawError("");
      setLibraryError("");
    } catch (error) {
      setRawError(error instanceof Error ? error.message : "Invalid SysEx paste.");
    }
  }, [rawHex]);

  const pasteClipboardToRaw = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setRawHex(text);
      setRawError("");
      setLibraryError("");
    } catch (error) {
      setRawError(error instanceof Error ? error.message : "Clipboard read failed.");
    }
  }, []);

  const addImportedMessages = useCallback((messages: ImportedSysExMessage[]) => {
    setImportedMessages((current) => [...messages, ...current]);
    setLibraryError("");
  }, []);

  const deleteImportedMessage = useCallback((index: number) => {
    setImportedMessages((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }, []);

  const clearImportedQueue = useCallback(() => {
    setImportedMessages([]);
  }, []);

  const sendImportedMessage = useCallback(
    (message: ImportedSysExMessage) => {
      sendToRoland(message.bytes, message.label);
    },
    [sendToRoland],
  );

  const sendImportedQueue = useCallback(async () => {
    for (const message of importedMessages) {
      sendToRoland(message.bytes, message.label);
      await delay(24);
    }
  }, [importedMessages, sendToRoland]);

  const exportImportedQueue = useCallback(() => {
    if (!importedMessages.length) {
      setLibraryError("Queue is empty.");
      return;
    }

    const url = makeDownloadBlobUrl(importedMessages);
    downloadUrl(url, "gr55-control-room-sysex.txt");
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [importedMessages]);

  const exportCurrentModule = useCallback(() => {
    const messages = activeModule.parameters.map((param) => ({
      label: `${activeModule.shortTitle} ${param.label}`,
      bytes: makeParameterMessage(param, values[param.id], deviceId),
    }));
    const url = makeDownloadBlobUrl(messages);
    downloadUrl(url, `gr55-${activeModule.shortTitle.toLowerCase()}-module.txt`);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [activeModule, deviceId, values]);

  const copyCurrentModule = useCallback(() => {
    const messages = activeModule.parameters.map((param) => ({
      label: `${activeModule.shortTitle} ${param.label}`,
      bytes: makeParameterMessage(param, values[param.id], deviceId),
    }));

    void navigator.clipboard?.writeText(serializeMessagesAsHex(messages));
  }, [activeModule, deviceId, values]);

  const handleTabChange = useCallback((tabId: EditorTabId) => {
    setActiveTabId(tabId);
    if (MODULE_IDS.has(tabId)) {
      setActiveModuleId(tabId as ParameterModuleId);
      setSelection({ type: "module", moduleId: tabId as ParameterModuleId });
    }
  }, []);

  const selectModule = useCallback((moduleId: ParameterModuleId) => {
    setActiveModuleId(moduleId);
    setActiveTabId(moduleId);
    setSelection({ type: "module", moduleId });
  }, []);

  const applySourceIntent = useCallback(
    (sourceId: string, intent: SourceIntent) => {
      const source = sources.find((item) => item.id === sourceId);
      if (!source) {
        return;
      }

      if (intent === "change-instrument") {
        updateSource(sourceId, "tone", source.toneOptions[(source.toneOptions.indexOf(source.tone) + 1) % source.toneOptions.length]);
        return;
      }

      if (intent === "brighter") {
        updateSource(sourceId, "brightness", clamp(source.brightness + 10, 0, 100));
        return;
      }

      if (intent === "darker") {
        updateSource(sourceId, "brightness", clamp(source.brightness - 10, 0, 100));
        return;
      }

      if (intent === "softer-attack") {
        updateSource(sourceId, "attack", clamp(source.attack + 10, 0, 100));
        return;
      }

      if (intent === "sharper-attack") {
        updateSource(sourceId, "attack", clamp(source.attack - 10, 0, 100));
        return;
      }

      if (intent === "forward") {
        updateSource(sourceId, "level", clamp(source.level + 8, 0, 100));
        updateSource(sourceId, "fxSend", clamp(source.fxSend - 6, 0, 100));
        return;
      }

      if (intent === "back") {
        updateSource(sourceId, "level", clamp(source.level - 8, 0, 100));
        updateSource(sourceId, "fxSend", clamp(source.fxSend + 10, 0, 100));
        return;
      }

      updateSource(sourceId, "fxSend", clamp(source.fxSend + 10, 0, 100));
    },
    [sources, updateSource],
  );

  const applyModuleIntent = useCallback(
    (moduleId: ParameterModuleId, intent: ModuleIntent) => {
      const module = MODULES.find((item) => item.id === moduleId);
      if (!module) {
        return;
      }

      if (intent === "reset") {
        onRevertModule(module, originalValues, setParameter);
        return;
      }

      const target = moduleIntentTarget(module, intent);
      if (!target) {
        return;
      }

      const currentValue = values[target.param.id] ?? target.param.defaultValue;
      setParameter(target.param, currentValue + target.delta);
    },
    [originalValues, setParameter, values],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        sendSaveToSelectedPatch();
      }
      if (key === "f") {
        event.preventDefault();
        patchSearchRef.current?.focus();
      }
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redoParameterChange();
      } else if (key === "z") {
        event.preventDefault();
        undoParameterChange();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [redoParameterChange, sendSaveToSelectedPatch, undoParameterChange]);

  useEffect(() => {
    if (dirtyCount === 0 && compareActive) {
      setCompareActive(false);
    }
  }, [compareActive, dirtyCount]);

  return (
    <main className="mac-window" aria-label="Roland GR-55 patch editor">
      <TopToolbar
        status={activeStatus}
        outputName={activeConnectionLabel}
        transportMode={transportMode}
        selectedPatch={selectedPatch}
        dirtyCount={dirtyCount}
        patchLoaded={patchLoaded}
        workflowState={workflowState}
        operationState={operationState}
        liveWrite={liveWrite}
        compareActive={compareActive}
        previewedDirtyChanges={previewedDirtyChanges}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        canCompare={dirtyCount > 0}
        onTransportModeChange={setTransportMode}
        onConnect={connectActiveTransport}
        onIdentity={sendIdentity}
        onReadPatch={requestPatchLevel}
        onSendChanges={sendPreviewChanges}
        onSavePatch={sendSaveToSelectedPatch}
        onToggleCompare={() => setCompareActive((current) => !current)}
        onUndo={undoParameterChange}
        onRedo={redoParameterChange}
        onLiveWriteChange={setLiveWrite}
        onFocusSearch={() => patchSearchRef.current?.focus()}
        onOpenUtilityDrawer={() => setUtilityDrawerOpen(true)}
        onBridgeRefresh={bridge.refresh}
        onBridgeResetUsb={bridge.resetUsb}
        onMidiRefresh={midi.refresh}
        onUsbRefresh={usb.refresh}
        onCopyModule={copyCurrentModule}
        onExportModule={exportCurrentModule}
        onClearTemporaryPatch={clearTemporaryPatch}
        onClearSelectedUserPatch={clearSelectedUserPatch}
        onPanic={sendPanic}
      />

      <section className="workspace-grid" aria-label="GR-55 editor workspace">
        <aside className="sidebar-pane" aria-label="Device and patch library">
          <DeviceSidebar
            status={midi.status}
            error={midi.error}
            inputs={midi.inputs}
            outputs={midi.outputs}
            selectedInputId={midi.selectedInputId}
            selectedOutputId={midi.selectedOutputId}
            onInputChange={midi.setSelectedInputId}
            onOutputChange={midi.setSelectedOutputId}
            onMidiConnect={midi.connect}
            onMidiRefresh={midi.refresh}
            midiSummary={midi.discoverySummary}
            inputDescriptions={midi.inputDescriptions}
            outputDescriptions={midi.outputDescriptions}
            transportMode={transportMode}
            onTransportModeChange={setTransportMode}
            bridgeStatus={bridge.status}
            bridgeError={bridge.error}
            bridgeSocketReady={bridge.socketReady}
            bridgeUsbDevices={bridge.usbDevices}
            bridgeDeviceLabel={bridge.deviceLabel}
            bridgeEndpointLabel={bridge.endpointLabel}
            bridgeLastIn={bridge.lastIn}
            bridgeSummary={bridge.discoverySummary}
            onBridgeConnect={bridge.connect}
            onBridgeRefresh={bridge.refresh}
            onBridgeConnectUsb={bridge.connectUsb}
            onBridgeDisconnectUsb={bridge.disconnectUsb}
            onBridgeResetUsb={bridge.resetUsb}
            usbStatus={usb.status}
            usbError={usb.error}
            usbDeviceLabel={usb.deviceLabel}
            usbEndpointLabel={usb.endpointLabel}
            usbPacketMode={usb.packetMode}
            onUsbPacketModeChange={usb.setPacketMode}
            usbLastIn={usb.lastIn}
            onUsbConnect={usb.connect}
            onUsbRefresh={usb.refresh}
            onUsbDisconnect={() => void usb.disconnect()}
            midiChannel={midiChannel}
            onMidiChannelChange={setMidiChannel}
            deviceId={deviceId}
            onDeviceIdChange={setDeviceId}
            liveWrite={liveWrite}
            onLiveWriteChange={setLiveWrite}
          />

          <PatchLibrary
            searchRef={patchSearchRef}
            selectedPatch={selectedPatch}
            dirtyCount={dirtyCount}
            onSelectPatch={selectPatch}
          />

          <QuickMonitor
            mirrorStatus={mirrorStatus}
            lastLogEntry={lastLogEntry}
            bridgeStatus={bridge.status}
            usbStatus={usb.status}
            midiStatus={midi.status}
          />
        </aside>

        <section className="editor-pane" aria-label="Patch editor">
          <PatchIdentity
            selectedPatch={selectedPatch}
            dirtyCount={dirtyCount}
            operationState={operationState}
          />

          <IntentPatchMap
            sources={sources}
            values={editorValues}
            selection={selection}
            selectedModuleId={selectedModule?.id ?? null}
            onSelectSource={(sourceId) => inspectSource(sourceId, "level")}
            onSelectModule={selectModule}
          />

          <SourceMixer
            sources={sources}
            selection={selection}
            hud={interactionHud}
            onChange={updateSource}
            onInspect={inspectSource}
          />

          <FocusedSoundEditor
            selection={selection}
            selectedSource={selectedSource}
            selectedModule={selectedModule}
            values={editorValues}
            originalValues={originalValues}
            selectedParameterId={selection.type === "parameter" ? selection.paramId : ""}
            hud={interactionHud}
            liveWrite={liveWrite}
            lastSentByParameter={lastSentByParameter}
            onSourceChange={updateSource}
            onSourceIntent={applySourceIntent}
            onModuleChange={setParameter}
            onModuleIntent={applyModuleIntent}
            onRevertParameter={revertParameter}
            onSendModule={sendModule}
            onReadModule={(module) => void requestModule(module)}
            onCopyModule={copyCurrentModule}
            onExportModule={exportCurrentModule}
          />

          {activeTabId === "pedal" || activeTabId === "assigns" || activeTabId === "sysex" || activeTabId === "system" ? (
            <SpecialTabPanel
              tabId={activeTabId}
              selectedPatch={selectedPatch}
              sources={sources}
              values={editorValues}
              performanceValues={performanceValues}
              controls={PERFORMANCE_CONTROLS}
              onPerformanceChange={setPerformanceControl}
              onReadModule={() => void requestModule(activeModule)}
              onOpenSysEx={() => setActiveTabId("sysex")}
            />
          ) : null}
        </section>

        <aside className="inspector-pane" aria-label="Patch and parameter inspector">
          <SelectionInspector
            selectedPatch={selectedPatch}
            dirtyCount={dirtyCount}
            operationState={operationState}
            patchLoaded={patchLoaded}
            workflowState={workflowState}
            selection={selection}
            selectedParameter={selectedParameter}
            selectedSource={selectedSource}
            selectedModule={selectedModule}
            sourceField={selection.type === "source" ? selection.field : null}
            values={editorValues}
            originalValues={originalValues}
            liveWrite={liveWrite}
            lastSentByParameter={lastSentByParameter}
            onRevertParameter={revertParameter}
            onRevertSource={revertSourceField}
            onSourceIntent={applySourceIntent}
            onModuleIntent={applyModuleIntent}
          />
        </aside>
      </section>

      <UtilityDrawer
        isOpen={utilityDrawerOpen}
        onToggle={setUtilityDrawerOpen}
        log={combinedLog}
        rawHex={rawHex}
        rawError={rawError}
        onRawHexChange={setRawHex}
        onSendRaw={sendRawSysEx}
        onImportRaw={importFromRawHex}
        onPasteClipboard={() => void pasteClipboardToRaw()}
        messages={importedMessages}
        libraryError={libraryError}
        onLibraryError={setLibraryError}
        onAddMessages={addImportedMessages}
        onSendMessage={sendImportedMessage}
        onSendQueue={() => void sendImportedQueue()}
        onDeleteMessage={deleteImportedMessage}
        onClearQueue={clearImportedQueue}
        onExportQueue={exportImportedQueue}
      />
    </main>
  );
}

function TopToolbar({
  status,
  outputName,
  transportMode,
  selectedPatch,
  dirtyCount,
  patchLoaded,
  workflowState,
  operationState,
  liveWrite,
  compareActive,
  previewedDirtyChanges,
  canUndo,
  canRedo,
  canCompare,
  onTransportModeChange,
  onConnect,
  onIdentity,
  onReadPatch,
  onSendChanges,
  onSavePatch,
  onToggleCompare,
  onUndo,
  onRedo,
  onLiveWriteChange,
  onFocusSearch,
  onOpenUtilityDrawer,
  onBridgeRefresh,
  onBridgeResetUsb,
  onMidiRefresh,
  onUsbRefresh,
  onCopyModule,
  onExportModule,
  onClearTemporaryPatch,
  onClearSelectedUserPatch,
  onPanic,
}: {
  status: string;
  outputName: string;
  transportMode: TransportMode;
  selectedPatch: UserPatch;
  dirtyCount: number;
  patchLoaded: boolean;
  workflowState: WorkflowState;
  operationState: OperationState;
  liveWrite: boolean;
  compareActive: boolean;
  previewedDirtyChanges: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canCompare: boolean;
  onTransportModeChange: (mode: TransportMode) => void;
  onConnect: () => void;
  onIdentity: () => void;
  onReadPatch: () => void;
  onSendChanges: () => void;
  onSavePatch: () => void;
  onToggleCompare: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onLiveWriteChange: (value: boolean) => void;
  onFocusSearch: () => void;
  onOpenUtilityDrawer: () => void;
  onBridgeRefresh: () => void;
  onBridgeResetUsb: () => void;
  onMidiRefresh: () => void;
  onUsbRefresh: () => void;
  onCopyModule: () => void;
  onExportModule: () => void;
  onClearTemporaryPatch: () => void;
  onClearSelectedUserPatch: () => void;
  onPanic: () => void;
}) {
  const isReady = status === "ready";
  const confirmSafetyAction = (message: string, action: () => void) => {
    if (window.confirm(message)) {
      action();
    }
  };

  return (
    <header className="mac-toolbar">
      <div className="traffic-lights" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className="toolbar-status" role="status" aria-live="polite">
        <span className={`connection-dot status-${status}`} aria-hidden="true" />
        <strong>{isReady ? "GR-55 Connected" : "Disconnected"}</strong>
        <span>{outputName || "No route selected"}</span>
      </div>

      <button type="button" className="patch-select-button" onClick={onFocusSearch}>
        USER {selectedPatch.label}
        {dirtyCount ? <span>{dirtyCount} unsaved</span> : <span>clean</span>}
      </button>

      <div className="toolbar-group action-group" aria-label="Primary workflow actions">
        {workflowState === "disconnected" ? (
          <button type="button" className="toolbar-button primary" onClick={onConnect}>
            <Plugs size={17} aria-hidden="true" />
            Connect
          </button>
        ) : workflowState === "ready-to-read" ? (
          <button type="button" className="toolbar-button primary" onClick={onReadPatch}>
            <DownloadSimple size={17} aria-hidden="true" />
            Read Patch
          </button>
        ) : workflowState === "dirty" ? (
          <>
            <button type="button" className="toolbar-button secondary" onClick={onSendChanges}>
              <Power size={17} aria-hidden="true" />
              {previewedDirtyChanges ? "Preview Again" : "Send Preview"}
            </button>
            <button type="button" className={`toolbar-button secondary ${compareActive ? "is-selected" : ""}`} disabled={!canCompare} aria-pressed={compareActive} onClick={onToggleCompare}>
              <CheckCircle size={17} aria-hidden="true" />
              Compare
            </button>
            <button type="button" className="toolbar-button primary" onClick={onSavePatch}>
              <FloppyDisk size={17} aria-hidden="true" />
              Save to GR-55
            </button>
          </>
        ) : (
          <>
            <span className="workflow-guidance">{patchLoaded ? "Choose source or module" : "Patch not loaded"}</span>
            <button type="button" className="toolbar-button secondary" onClick={onReadPatch}>
              <DownloadSimple size={17} aria-hidden="true" />
              Read Patch
            </button>
          </>
        )}
      </div>

      <div className="toolbar-end">
        <div className="preview-mode" role="group" aria-label="Preview mode">
          <span>Preview</span>
          <button type="button" className={!liveWrite ? "is-active" : ""} aria-pressed={!liveWrite} onClick={() => onLiveWriteChange(false)}>
            Staged
          </button>
          <button type="button" className={liveWrite ? "is-active" : ""} aria-pressed={liveWrite} onClick={() => onLiveWriteChange(true)}>
            Live
          </button>
        </div>
        {operationState !== "idle" ? (
          <span className={`operation-chip state-${operationState}`}>
            {operationState === "sending" ? "Sending" : operationState === "saved" ? "Saved" : "Send failed"}
          </span>
        ) : null}
        <details className="toolbar-more">
          <summary aria-label="More actions" title="More actions">
            <DotsThree size={20} aria-hidden="true" />
          </summary>
          <div className="toolbar-menu">
            <div className="menu-section">
              <span>Connection route</span>
              <div className="toolbar-group route-group" role="group" aria-label="MIDI route selector">
                <SegmentedButton active={transportMode === "bridge"} onClick={() => onTransportModeChange("bridge")}>
                  Bridge
                </SegmentedButton>
                <SegmentedButton active={transportMode === "midi"} onClick={() => onTransportModeChange("midi")}>
                  MIDI
                </SegmentedButton>
                <SegmentedButton active={transportMode === "usb"} onClick={() => onTransportModeChange("usb")}>
                  USB
                </SegmentedButton>
              </div>
            </div>
            <div className="menu-section menu-grid">
              <button type="button" onClick={onIdentity}>
                <Usb size={15} aria-hidden="true" />
                Identify GR-55
              </button>
              <button type="button" onClick={onFocusSearch}>
                <Command size={15} aria-hidden="true" />
                Search patches
              </button>
              <button type="button" disabled={!canUndo} onClick={onUndo}>
                <ArrowCounterClockwise size={15} aria-hidden="true" />
                Undo
              </button>
              <button type="button" disabled={!canRedo} onClick={onRedo}>
                <ArrowClockwise size={15} aria-hidden="true" />
                Redo
              </button>
              <button type="button" disabled={!canCompare} aria-pressed={compareActive} onClick={onToggleCompare}>
                <CheckCircle size={15} aria-hidden="true" />
                Compare
              </button>
              <button type="button" onClick={onOpenUtilityDrawer}>
                <Queue size={15} aria-hidden="true" />
                Raw SysEx drawer
              </button>
            </div>
            <details className="menu-section nested-disclosure">
              <summary>Module and maintenance</summary>
              <button type="button" onClick={onCopyModule}>Copy module SysEx</button>
              <button type="button" onClick={onExportModule}>Export module</button>
              <button type="button" onClick={onBridgeRefresh}>Refresh bridge</button>
              <button type="button" onClick={onMidiRefresh}>Refresh MIDI</button>
              <button type="button" onClick={onUsbRefresh}>Refresh USB</button>
              <button type="button" onClick={onBridgeResetUsb}>Reset USB</button>
            </details>
            <details className="menu-section nested-disclosure safety-disclosure">
              <summary>Advanced / Safety</summary>
              <button type="button" onClick={() => confirmSafetyAction("Mute the temporary patch by turning off the main effect blocks?", onClearTemporaryPatch)}>Mute temporary patch</button>
              <button type="button" onClick={onClearSelectedUserPatch}>Clear USER {selectedPatch.label}</button>
              <button type="button" onClick={() => confirmSafetyAction("Send All Notes Off on the current MIDI channel?", onPanic)}>All notes off</button>
            </details>
          </div>
        </details>
      </div>
    </header>
  );
}

function SegmentedButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={active ? "is-active" : ""} onClick={onClick} aria-pressed={active}>
      {children}
    </button>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className="icon-button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function DeviceSidebar({
  status,
  error,
  inputs,
  outputs,
  selectedInputId,
  selectedOutputId,
  onInputChange,
  onOutputChange,
  onMidiConnect,
  onMidiRefresh,
  midiSummary,
  inputDescriptions,
  outputDescriptions,
  transportMode,
  onTransportModeChange,
  bridgeStatus,
  bridgeError,
  bridgeSocketReady,
  bridgeUsbDevices,
  bridgeDeviceLabel,
  bridgeEndpointLabel,
  bridgeLastIn,
  bridgeSummary,
  onBridgeConnect,
  onBridgeRefresh,
  onBridgeConnectUsb,
  onBridgeDisconnectUsb,
  onBridgeResetUsb,
  usbStatus,
  usbError,
  usbDeviceLabel,
  usbEndpointLabel,
  usbPacketMode,
  onUsbPacketModeChange,
  usbLastIn,
  onUsbConnect,
  onUsbRefresh,
  onUsbDisconnect,
  midiChannel,
  onMidiChannelChange,
  deviceId,
  onDeviceIdChange,
  liveWrite,
  onLiveWriteChange,
}: {
  status: string;
  error: string;
  inputs: MIDIInput[];
  outputs: MIDIOutput[];
  selectedInputId: string;
  selectedOutputId: string;
  onInputChange: (value: string) => void;
  onOutputChange: (value: string) => void;
  onMidiConnect: () => void;
  onMidiRefresh: () => void;
  midiSummary: string;
  inputDescriptions: Array<{ id: string; label: string; reason: string; isLikelyRoland: boolean }>;
  outputDescriptions: Array<{ id: string; label: string; reason: string; isLikelyRoland: boolean }>;
  transportMode: TransportMode;
  onTransportModeChange: (value: TransportMode) => void;
  bridgeStatus: string;
  bridgeError: string;
  bridgeSocketReady: boolean;
  bridgeUsbDevices: BridgeUsbDeviceInfo[];
  bridgeDeviceLabel: string;
  bridgeEndpointLabel: string;
  bridgeLastIn: string;
  bridgeSummary: string;
  onBridgeConnect: () => void;
  onBridgeRefresh: () => void;
  onBridgeConnectUsb: () => void;
  onBridgeDisconnectUsb: () => void;
  onBridgeResetUsb: () => void;
  usbStatus: string;
  usbError: string;
  usbDeviceLabel: string;
  usbEndpointLabel: string;
  usbPacketMode: UsbPacketMode;
  onUsbPacketModeChange: (value: UsbPacketMode) => void;
  usbLastIn: string;
  onUsbConnect: () => void;
  onUsbRefresh: () => void;
  onUsbDisconnect: () => void;
  midiChannel: number;
  onMidiChannelChange: (value: number) => void;
  deviceId: number;
  onDeviceIdChange: (value: number) => void;
  liveWrite: boolean;
  onLiveWriteChange: (value: boolean) => void;
}) {
  const selectedInput = inputs.find((input) => input.id === selectedInputId) ?? null;
  const selectedOutput = outputs.find((output) => output.id === selectedOutputId) ?? null;
  const activeError = transportMode === "bridge" ? bridgeError : transportMode === "usb" ? usbError : error;
  const routeLabel = transportMode === "bridge" ? "Native Bridge" : transportMode === "midi" ? "Web MIDI" : "Direct USB";
  const routeReady = transportMode === "bridge" ? bridgeStatus === "ready" : transportMode === "midi" ? status === "ready" : usbStatus === "ready";
  const portsReady =
    transportMode === "bridge"
      ? bridgeSocketReady && (bridgeUsbDevices.length > 0 || Boolean(bridgeDeviceLabel))
      : transportMode === "midi"
        ? Boolean(selectedInput && selectedOutput)
        : Boolean(usbDeviceLabel);
  const routePrimary =
    transportMode === "bridge"
      ? bridgeDeviceLabel || bridgeUsbDevices[0]?.label || "No GR-55 USB selected"
      : transportMode === "midi"
        ? selectedOutput
          ? formatPortName(selectedOutput)
          : "No MIDI output selected"
        : usbDeviceLabel || "No GR-55 USB permission yet";
  const routeSecondary =
    transportMode === "bridge"
      ? bridgeEndpointLabel || bridgeSummary
      : transportMode === "midi"
        ? selectedInput
          ? `Input ${formatPortState(selectedInput)}`
          : midiSummary
        : usbEndpointLabel;

  return (
    <section className="sidebar-section" aria-labelledby="device-title">
      <SectionHeader id="device-title" title="Device" icon={<Keyboard size={16} aria-hidden="true" />} />

      <div className="device-compact">
        <div className="device-headline">
          <span className={`status-dot status-${routeReady ? "ready" : "idle"}`} aria-hidden="true" />
          <strong>{routeReady ? "GR-55 Connected" : "GR-55 Disconnected"}</strong>
        </div>
        <dl className="device-summary">
          <div>
            <dt>Route</dt>
            <dd>{routeLabel}</dd>
          </div>
          <div>
            <dt>MIDI ports</dt>
            <dd>{portsReady ? "OK" : "Need setup"}</dd>
          </div>
        </dl>
      </div>

      <details className="sidebar-disclosure">
        <summary>Details</summary>
        <div className="segmented-control" role="group" aria-label="Connection method">
          <SegmentedButton active={transportMode === "bridge"} onClick={() => onTransportModeChange("bridge")}>
            Bridge
          </SegmentedButton>
          <SegmentedButton active={transportMode === "midi"} onClick={() => onTransportModeChange("midi")}>
            MIDI
          </SegmentedButton>
          <SegmentedButton active={transportMode === "usb"} onClick={() => onTransportModeChange("usb")}>
            USB
          </SegmentedButton>
        </div>

        {activeError ? <p className="inline-error" role="alert">{activeError}</p> : null}

        <ConnectionReadout
          title="Selected route"
          primary={routePrimary}
          secondary={routeSecondary}
          code={transportMode === "bridge" ? bridgeLastIn : transportMode === "usb" ? usbLastIn : undefined}
        />

        <dl className="status-grid">
          <StatusItem label="Bridge" value={formatMidiStatus(bridgeStatus)} state={bridgeStatus} />
          <StatusItem label="Socket" value={bridgeSocketReady ? "Online" : "Offline"} state={bridgeSocketReady ? "ready" : "idle"} />
          <StatusItem label="USB devices" value={String(bridgeUsbDevices.length)} state={bridgeUsbDevices.length ? "ready" : "idle"} />
        </dl>

        <div className="sidebar-actions">
          <button type="button" onClick={onBridgeConnect}>Connect bridge</button>
          <button type="button" onClick={onBridgeConnectUsb}>Connect GR-55 USB</button>
          <button type="button" onClick={onMidiConnect}>Connect MIDI</button>
          <button type="button" onClick={onUsbConnect}>Direct USB</button>
        </div>

        <dl className="status-grid secondary-status">
          <StatusItem label="Web MIDI" value={formatMidiStatus(status)} state={status} />
          <StatusItem label="Inputs" value={String(inputs.length)} state={inputs.length ? "ready" : "idle"} />
          <StatusItem label="Outputs" value={String(outputs.length)} state={outputs.length ? "ready" : "idle"} />
        </dl>

        <Field label="Input from GR-55 MIDI OUT" hint={inputDescriptions.find((item) => item.id === selectedInputId)?.reason ?? "Choose the port receiving GR-55 data."}>
          <select value={selectedInputId} onChange={(event) => onInputChange(event.target.value)}>
            <option value="">No input selected</option>
            {inputs.map((input) => (
              <option key={input.id} value={input.id}>
                {formatPortName(input)}{inputDescriptions.find((item) => item.id === input.id)?.isLikelyRoland ? " (Roland)" : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Output to GR-55 MIDI IN" hint={outputDescriptions.find((item) => item.id === selectedOutputId)?.reason ?? "Choose the port sending into GR-55 MIDI IN."}>
          <select value={selectedOutputId} onChange={(event) => onOutputChange(event.target.value)}>
            <option value="">No output selected</option>
            {outputs.map((output) => (
              <option key={output.id} value={output.id}>
                {formatPortName(output)}{outputDescriptions.find((item) => item.id === output.id)?.isLikelyRoland ? " (Roland)" : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label="USB packet mode">
          <select value={usbPacketMode} onChange={(event) => onUsbPacketModeChange(event.target.value as UsbPacketMode)}>
            <option value="usb-midi">USB-MIDI packets</option>
            <option value="raw">Raw endpoint bytes</option>
          </select>
        </Field>

        <div className="settings-row">
          <Field label="MIDI channel">
            <input
              type="number"
              min={1}
              max={16}
              value={midiChannel}
              onChange={(event) => onMidiChannelChange(Number(event.target.value))}
            />
          </Field>
          <Field label="Device ID">
            <input
              type="text"
              value={`0x${deviceId.toString(16).toUpperCase()}`}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value.replace(/^0x/i, ""), 16);
                if (!Number.isNaN(parsed)) {
                  onDeviceIdChange(Math.min(Math.max(parsed, 0), 0x7f));
                }
              }}
            />
          </Field>
        </div>

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={liveWrite}
            onChange={(event) => onLiveWriteChange(event.target.checked)}
          />
          <span>Live Preview</span>
          <small>DT1 as controls move</small>
        </label>

        <details className="nested-disclosure maintenance-disclosure">
          <summary>Maintenance</summary>
          <div className="sidebar-actions">
            <button type="button" onClick={onBridgeRefresh}>Refresh bridge</button>
            <button type="button" onClick={onMidiRefresh}>Refresh MIDI</button>
            <button type="button" onClick={onUsbRefresh}>Refresh USB</button>
            <button type="button" onClick={onUsbDisconnect}>Disconnect USB</button>
            <button type="button" onClick={onBridgeDisconnectUsb}>Disconnect bridge USB</button>
            <button type="button" onClick={onBridgeResetUsb}>Reset USB</button>
          </div>
        </details>
      </details>
    </section>
  );
}

function PatchLibrary({
  searchRef,
  selectedPatch,
  dirtyCount,
  onSelectPatch,
}: {
  searchRef: React.RefObject<HTMLInputElement | null>;
  selectedPatch: UserPatch;
  dirtyCount: number;
  onSelectPatch: (patch: UserPatch) => void;
}) {
  const [query, setQuery] = useState("");
  const [bankFilter, setBankFilter] = useState(Math.max(1, selectedPatch.bank - 2));
  const visible = USER_PATCHES.filter((patch) => {
    const inBankWindow = patch.bank >= bankFilter && patch.bank < bankFilter + 12;
    if (!query.trim()) {
      return inBankWindow;
    }
    return `USER ${patch.label}`.toLowerCase().includes(query.trim().toLowerCase());
  }).slice(0, 72);

  return (
    <section className="sidebar-section" aria-labelledby="patch-library-title">
      <SectionHeader id="patch-library-title" title="Patch Library" icon={<ListMagnifyingGlass size={16} aria-hidden="true" />} />

      <div className="search-field">
        <MagnifyingGlass size={15} aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search USER patches"
          aria-label="Search patches"
        />
      </div>

      <div className={`library-current ${dirtyCount ? "is-dirty" : ""}`}>
        <span>Current patch</span>
        <strong>
          USER {selectedPatch.label}
          {dirtyCount ? <em>{dirtyCount} unsaved</em> : null}
        </strong>
        <small>Bank MSB {selectedPatch.bankMsb}, PC {selectedPatch.program}</small>
      </div>

      <Field label={`Banks ${bankFilter}-${Math.min(bankFilter + 11, 99)}`}>
        <input
          type="range"
          min={1}
          max={88}
          step={1}
          value={bankFilter}
          onChange={(event) => setBankFilter(Number(event.target.value))}
        />
      </Field>

      <div className="patch-list" role="list" aria-label="Visible GR-55 USER patches">
        {visible.length === 0 ? (
          <p className="empty-state">No matching USER patches.</p>
        ) : (
          visible.map((patch) => (
            <button
              type="button"
              key={patch.userIndex}
              className={`${patch.userIndex === selectedPatch.userIndex ? "is-selected" : ""} ${patch.userIndex === selectedPatch.userIndex && dirtyCount ? "is-dirty" : ""}`}
              onClick={() => onSelectPatch(patch)}
              aria-pressed={patch.userIndex === selectedPatch.userIndex}
            >
              <span>
                USER {patch.label}
                {patch.userIndex === selectedPatch.userIndex && dirtyCount ? <em>Unsaved</em> : null}
              </span>
              <small>PC {patch.program}</small>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function QuickMonitor({
  mirrorStatus,
  lastLogEntry,
  bridgeStatus,
  usbStatus,
  midiStatus,
}: {
  mirrorStatus: string;
  lastLogEntry: ReturnType<typeof useMidi>["log"][number] | undefined;
  bridgeStatus: string;
  usbStatus: string;
  midiStatus: string;
}) {
  return (
    <details className="sidebar-section monitor-disclosure">
      <summary>
        <span>Quick Monitor</span>
        <Pulse size={16} aria-hidden="true" />
      </summary>
      <dl className="monitor-list">
        <StatusItem label="MIDI In" value={lastLogEntry?.direction === "in" ? "Active" : "Idle"} state={lastLogEntry?.direction === "in" ? "ready" : "idle"} />
        <StatusItem label="MIDI Out" value={lastLogEntry?.direction === "out" ? "Active" : "Idle"} state={lastLogEntry?.direction === "out" ? "ready" : "idle"} />
        <StatusItem label="Bridge" value={formatMidiStatus(bridgeStatus)} state={bridgeStatus} />
        <StatusItem label="USB" value={formatMidiStatus(usbStatus)} state={usbStatus} />
        <StatusItem label="Web" value={formatMidiStatus(midiStatus)} state={midiStatus} />
      </dl>
      <div className="monitor-readout" role="status" aria-live="polite">
        <span>Last received SysEx or MIDI event</span>
        <strong>{mirrorStatus}</strong>
      </div>
      <div className="monitor-readout">
        <span>Last sent command</span>
        <strong>{lastLogEntry?.direction === "out" ? lastLogEntry.label : "No outgoing MIDI yet"}</strong>
      </div>
    </details>
  );
}

function PatchIdentity({
  selectedPatch,
  dirtyCount,
  operationState,
}: {
  selectedPatch: UserPatch;
  dirtyCount: number;
  operationState: OperationState;
}) {
  return (
    <section className="patch-identity" aria-labelledby="patch-identity-title">
      <div className="patch-title-group">
        <span>Current patch</span>
        <h1 id="patch-identity-title">USER {selectedPatch.label}</h1>
        <p>Bank MSB {selectedPatch.bankMsb}, LSB 0, PC {selectedPatch.program}</p>
      </div>
      <div className="patch-name-block">
        <label htmlFor="patch-name">Patch name</label>
        <input id="patch-name" value="Controlled Feedback Lead" readOnly aria-readonly="true" />
      </div>
      <div className="patch-save-state">
        {dirtyCount ? <WarningCircle size={17} aria-hidden="true" /> : <CheckCircle size={17} aria-hidden="true" />}
        <span>{dirtyCount ? `${dirtyCount} unsaved changes` : operationState === "saved" ? "Saved to GR-55" : "No unsaved changes"}</span>
      </div>
    </section>
  );
}

function IntentPatchMap({
  sources,
  values,
  selection,
  selectedModuleId,
  onSelectSource,
  onSelectModule,
}: {
  sources: SourceDefinition[];
  values: ParameterValues;
  selection: Selection;
  selectedModuleId: ParameterModuleId | null;
  onSelectSource: (sourceId: string) => void;
  onSelectModule: (moduleId: ParameterModuleId) => void;
}) {
  return (
    <section className="patch-map-section" aria-labelledby="patch-map-title">
      <div className="patch-map-heading">
        <div>
          <h2 id="patch-map-title">Patch map</h2>
          <p>Click the part of the sound you want to change.</p>
        </div>
        <span>{sources.filter((source) => source.enabled).length} active sources</span>
      </div>
      <div className="patch-map">
        <div className="patch-map-sources" aria-label="Sound sources">
          {sources.map((source) => {
            const selected = selection.type === "source" && selection.sourceId === source.id;
            return (
              <button
                key={source.id}
                type="button"
                className={`patch-source-node ${source.enabled ? "is-active" : "is-muted"} ${selected ? "is-selected" : ""}`}
                onClick={() => onSelectSource(source.id)}
                aria-pressed={selected}
              >
                <span>{source.block}</span>
                <strong>{source.tone}</strong>
                <small>{sourceRoleLabel(source)}</small>
              </button>
            );
          })}
        </div>
        <div className="patch-flow-arrow" aria-hidden="true" />
        <div className="patch-map-effects" aria-label="Effect signal flow">
          {EFFECT_FLOW.map((block, index) => {
            const active = moduleIsOn(block.moduleId, values);
            const selected = selectedModuleId === block.moduleId;
            return (
              <button
                key={block.moduleId}
                type="button"
                className={`patch-effect-node ${active ? "is-active" : "is-muted"} ${selected ? "is-selected" : ""}`}
                onClick={() => onSelectModule(block.moduleId)}
                aria-pressed={selected}
              >
                <span>{block.label}</span>
                <small>{active ? block.role : "Off"}</small>
                {index < EFFECT_FLOW.length - 1 ? <i aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function SourceMixer({
  sources,
  selection,
  hud,
  onChange,
  onInspect,
}: {
  sources: SourceDefinition[];
  selection: Selection;
  hud: InteractionHud | null;
  onChange: (sourceId: string, field: SourceField, value: boolean | number | string) => void;
  onInspect: (sourceId: string, field?: SourceField) => void;
}) {
  return (
    <section className="source-mixer" aria-labelledby="source-mixer-title">
      <SectionHeader id="source-mixer-title" title="What is making sound" icon={<FadersHorizontal size={16} aria-hidden="true" />} />
      <div className="source-grid">
        {sources.map((source) => {
          const sourceSelected = selection.type === "source" && selection.sourceId === source.id;
          return (
          <article key={source.id} className={`source-strip ${source.enabled ? "is-enabled" : "is-disabled"} ${sourceSelected ? "is-selected" : ""}`}>
            <div className="source-enable">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={source.enabled}
                  onChange={(event) => onChange(source.id, "enabled", event.target.checked)}
                  aria-label={`${source.label} on or off`}
                />
                <span />
              </label>
            </div>

            <div className="source-strip-header">
              <div>
                <strong>{source.label}</strong>
                <span>{source.tone}</span>
              </div>
            </div>

            <div className="source-role">
              <span>{source.role}</span>
              <small>{source.enabled ? "in patch" : "hidden"}</small>
            </div>

            <SourceSlider
              label="Level"
              value={source.level}
              min={0}
              max={100}
              unit="%"
              selected={selection.type === "source" && selection.sourceId === source.id && selection.field === "level"}
              hud={hud}
              onChange={(value) => onChange(source.id, "level", value)}
            />

            <button type="button" className="source-edit-button" onClick={() => onInspect(source.id, "level")}>
              Edit
            </button>
          </article>
          );
        })}
      </div>
    </section>
  );
}

function SourceSlider({
  label,
  value,
  min,
  max,
  unit,
  selected,
  hud,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  selected: boolean;
  hud: InteractionHud | null;
  onChange: (value: number) => void;
}) {
  return (
    <div className={`compact-slider ${selected ? "is-selected" : ""}`}>
      <div className="slider-label-row">
        <span>{label}</span>
        <output>{value}{unit}</output>
      </div>
      <div className="slider-row">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          aria-label={`${label}, ${value}${unit}`}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
      {selected && hud ? <ValueHud hud={hud} /> : null}
    </div>
  );
}

function FocusedSoundEditor({
  selection,
  selectedSource,
  selectedModule,
  values,
  originalValues,
  selectedParameterId,
  hud,
  liveWrite,
  lastSentByParameter,
  onSourceChange,
  onSourceIntent,
  onModuleChange,
  onModuleIntent,
  onRevertParameter,
  onSendModule,
  onReadModule,
  onCopyModule,
  onExportModule,
}: {
  selection: Selection;
  selectedSource: SourceDefinition | null;
  selectedModule: ModuleDefinition | null;
  values: ParameterValues;
  originalValues: ParameterValues;
  selectedParameterId: string;
  hud: InteractionHud | null;
  liveWrite: boolean;
  lastSentByParameter: Record<string, string>;
  onSourceChange: (sourceId: string, field: SourceField, value: boolean | number | string) => void;
  onSourceIntent: (sourceId: string, intent: SourceIntent) => void;
  onModuleChange: (param: ParameterDefinition, value: number, shouldSend?: boolean) => void;
  onModuleIntent: (moduleId: ParameterModuleId, intent: ModuleIntent) => void;
  onRevertParameter: (param: ParameterDefinition) => void;
  onSendModule: (module: ModuleDefinition) => void;
  onReadModule: (module: ModuleDefinition) => void;
  onCopyModule: () => void;
  onExportModule: () => void;
}) {
  if (selectedSource) {
    return (
      <FocusedSourceEditor
        source={selectedSource}
        selection={selection}
        hud={hud}
        onChange={onSourceChange}
        onIntent={onSourceIntent}
      />
    );
  }

  if (selectedModule) {
    return (
      <FocusedModuleEditor
        module={selectedModule}
        values={values}
        originalValues={originalValues}
        selectedParameterId={selectedParameterId}
        hud={hud}
        liveWrite={liveWrite}
        lastSentByParameter={lastSentByParameter}
        onChange={onModuleChange}
        onIntent={onModuleIntent}
        onRevert={onRevertParameter}
        onSendModule={onSendModule}
        onReadModule={onReadModule}
        onCopyModule={onCopyModule}
        onExportModule={onExportModule}
      />
    );
  }

  return (
    <section className="focused-editor empty-focused-editor" aria-labelledby="focused-editor-title">
      <div>
        <span>Ready to edit</span>
        <h2 id="focused-editor-title">Click a source or effect block</h2>
        <p>Start with the part of the sound you can hear: the pad, modeled guitar, amp body, repeats, room, or final tone.</p>
      </div>
    </section>
  );
}

function FocusedSourceEditor({
  source,
  selection,
  hud,
  onChange,
  onIntent,
}: {
  source: SourceDefinition;
  selection: Selection;
  hud: InteractionHud | null;
  onChange: (sourceId: string, field: SourceField, value: boolean | number | string) => void;
  onIntent: (sourceId: string, intent: SourceIntent) => void;
}) {
  return (
    <section className="focused-editor" aria-labelledby="focused-source-title">
      <FocusedHeader
        headingId="focused-source-title"
        eyebrow={source.block}
        title={source.label}
        detail={`${source.tone} - ${sourceRoleLabel(source)}`}
        enabled={source.enabled}
      />
      <div className="simple-editor-grid">
        <Field label="Instrument">
          <select value={source.tone} onChange={(event) => onChange(source.id, "tone", event.target.value)}>
            {source.toneOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </Field>
        <SourceSlider
          label="Volume"
          value={source.level}
          min={0}
          max={100}
          unit="%"
          selected={selection.type === "source" && selection.sourceId === source.id && selection.field === "level"}
          hud={hud}
          onChange={(value) => onChange(source.id, "level", value)}
        />
        <SourceSlider
          label="Attack"
          value={source.attack}
          min={0}
          max={100}
          unit="%"
          selected={selection.type === "source" && selection.sourceId === source.id && selection.field === "attack"}
          hud={hud}
          onChange={(value) => onChange(source.id, "attack", value)}
        />
        <SourceSlider
          label="Brightness"
          value={source.brightness}
          min={0}
          max={100}
          unit="%"
          selected={selection.type === "source" && selection.sourceId === source.id && selection.field === "brightness"}
          hud={hud}
          onChange={(value) => onChange(source.id, "brightness", value)}
        />
        <SourceSlider
          label="Octave"
          value={source.octave}
          min={-2}
          max={2}
          unit=""
          selected={selection.type === "source" && selection.sourceId === source.id && selection.field === "octave"}
          hud={hud}
          onChange={(value) => onChange(source.id, "octave", value)}
        />
        <SourceSlider
          label="Send to effects"
          value={source.fxSend}
          min={0}
          max={100}
          unit="%"
          selected={selection.type === "source" && selection.sourceId === source.id && selection.field === "fxSend"}
          hud={hud}
          onChange={(value) => onChange(source.id, "fxSend", value)}
        />
      </div>
      <div className="intent-button-row" aria-label={`${source.label} quick edits`}>
        <button type="button" onClick={() => onIntent(source.id, "darker")}>Darker</button>
        <button type="button" onClick={() => onIntent(source.id, "brighter")}>Brighter</button>
        <button type="button" onClick={() => onIntent(source.id, "back")}>Move back</button>
        <button type="button" onClick={() => onIntent(source.id, "forward")}>Bring forward</button>
        <button type="button" onClick={() => onIntent(source.id, "more-space")}>Add space</button>
      </div>
      <details className="advanced-editor">
        <summary>Advanced source details</summary>
        <div className="simple-editor-grid">
          <SourceSlider
            label="Pan"
            value={source.pan}
            min={-50}
            max={50}
            unit=""
            selected={selection.type === "source" && selection.sourceId === source.id && selection.field === "pan"}
            hud={hud}
            onChange={(value) => onChange(source.id, "pan", value)}
          />
          <label className="toggle-row compact-toggle-row">
            <input type="checkbox" checked={source.muted} onChange={(event) => onChange(source.id, "muted", event.target.checked)} />
            <span>Mute this source</span>
            <small>Staged source state</small>
          </label>
          <label className="toggle-row compact-toggle-row">
            <input type="checkbox" checked={source.solo} onChange={(event) => onChange(source.id, "solo", event.target.checked)} />
            <span>Solo this source</span>
            <small>Staged source state</small>
          </label>
        </div>
      </details>
    </section>
  );
}

function FocusedModuleEditor({
  module,
  values,
  originalValues,
  selectedParameterId,
  hud,
  liveWrite,
  lastSentByParameter,
  onChange,
  onIntent,
  onRevert,
  onSendModule,
  onReadModule,
  onCopyModule,
  onExportModule,
}: {
  module: ModuleDefinition;
  values: ParameterValues;
  originalValues: ParameterValues;
  selectedParameterId: string;
  hud: InteractionHud | null;
  liveWrite: boolean;
  lastSentByParameter: Record<string, string>;
  onChange: (param: ParameterDefinition, value: number, shouldSend?: boolean) => void;
  onIntent: (moduleId: ParameterModuleId, intent: ModuleIntent) => void;
  onRevert: (param: ParameterDefinition) => void;
  onSendModule: (module: ModuleDefinition) => void;
  onReadModule: (module: ModuleDefinition) => void;
  onCopyModule: () => void;
  onExportModule: () => void;
}) {
  const controls = moduleIntentControls(module);
  const enabledParam = module.parameters.find((param) => param.kind === "toggle");
  const enabled = enabledParam ? values[enabledParam.id] > 0 : true;

  return (
    <section className="focused-editor" aria-labelledby="focused-module-title">
      <FocusedHeader
        headingId="focused-module-title"
        eyebrow={module.shortTitle}
        title={module.title}
        detail={moduleIntentSummary(module)}
        enabled={enabled}
      />
      <div className="simple-editor-grid">
        {controls.map((item) => (
          <IntentParameterControl
            key={item.param.id}
            label={item.label}
            hint={item.hint}
            param={item.param}
            value={values[item.param.id]}
            originalValue={originalValues[item.param.id]}
            onChange={(value) => onChange(item.param, value)}
            onRevert={() => onRevert(item.param)}
          />
        ))}
      </div>
      <div className="intent-button-row" aria-label={`${module.title} quick edits`}>
        {moduleIntentButtons(module).map((button) => (
          <button key={button.intent} type="button" onClick={() => onIntent(module.id, button.intent)}>
            {button.label}
          </button>
        ))}
      </div>
      <details className="advanced-editor">
        <summary>Advanced GR-55 parameters</summary>
        <ModuleEditor
          module={module}
          values={values}
          originalValues={originalValues}
          selectedParameterId={selectedParameterId}
          hud={hud}
          liveWrite={liveWrite}
          lastSentByParameter={lastSentByParameter}
          onChange={onChange}
          onRevert={onRevert}
          onSendModule={onSendModule}
          onReadModule={onReadModule}
          onCopyModule={onCopyModule}
          onExportModule={onExportModule}
        />
      </details>
    </section>
  );
}

function FocusedHeader({
  headingId,
  eyebrow,
  title,
  detail,
  enabled,
}: {
  headingId: string;
  eyebrow: string;
  title: string;
  detail: string;
  enabled: boolean;
}) {
  return (
    <div className="focused-header">
      <div>
        <span>{eyebrow}</span>
        <h2 id={headingId}>{title}</h2>
        <p>{detail}</p>
      </div>
      <strong className={enabled ? "is-on" : "is-off"}>{enabled ? "On" : "Off"}</strong>
    </div>
  );
}

function IntentParameterControl({
  label,
  hint,
  param,
  value,
  originalValue,
  onChange,
  onRevert,
}: {
  label: string;
  hint: string;
  param: ParameterDefinition;
  value: number;
  originalValue: number;
  onChange: (value: number) => void;
  onRevert: () => void;
}) {
  const current = value ?? param.defaultValue;
  const dirty = current !== originalValue;
  let control: React.ReactNode;

  if (param.kind === "toggle") {
    const checked = current > 0;
    control = (
      <button type="button" className={`toggle-button ${checked ? "is-on" : ""}`} onClick={() => onChange(checked ? 0 : 1)} aria-pressed={checked}>
        <span aria-hidden="true" />
        {checked ? "On" : "Off"}
      </button>
    );
  } else if (param.kind === "select") {
    control = (
      <select value={current} onChange={(event) => onChange(Number(event.target.value))} aria-label={label}>
        {param.options?.map((option, index) => (
          <option key={option} value={index}>{option}</option>
        ))}
      </select>
    );
  } else {
    control = (
      <div className="intent-slider-row">
        <input
          type="range"
          min={param.min}
          max={param.max}
          step={param.step}
          value={current}
          aria-label={label}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <output>{formatParameterValue(param, current)}</output>
      </div>
    );
  }

  return (
    <div className={`intent-control-row ${dirty ? "is-dirty" : ""}`}>
      <div>
        <span className="intent-control-label">{label}</span>
        <small>{hint}</small>
      </div>
      {control}
      <button type="button" className="revert-button" disabled={!dirty} onClick={onRevert} aria-label={`Revert ${label}`}>
        <ArrowCounterClockwise size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

function ModuleTabs({
  tabs,
  activeTabId,
  values,
  onSelect,
}: {
  tabs: Array<{ id: EditorTabId; label: string; moduleId?: ParameterModuleId }>;
  activeTabId: EditorTabId;
  values: ParameterValues;
  onSelect: (tabId: EditorTabId) => void;
}) {
  return (
    <nav className="module-tabs" aria-label="Patch modules">
      {tabs.map((tab) => {
        const module = tab.moduleId ? MODULES.find((item) => item.id === tab.moduleId) : null;
        const switchParam = module?.parameters.find((param) => param.kind === "toggle");
        const isModuleTab = Boolean(module);
        const isOn = switchParam ? values[switchParam.id] > 0 : false;
        return (
          <button
            key={tab.id}
            type="button"
            className={`${activeTabId === tab.id ? "is-active" : ""} ${isModuleTab ? (isOn ? "is-on" : "is-off") : "is-neutral"}`}
            onClick={() => onSelect(tab.id)}
            aria-current={activeTabId === tab.id ? "page" : undefined}
            aria-label={`${tab.label}${isModuleTab ? (isOn ? ", on" : ", off") : ""}`}
          >
            <span className={`module-status-dot ${isModuleTab ? "" : "is-hidden"}`} aria-hidden="true" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function ModuleEditor({
  module,
  values,
  originalValues,
  selectedParameterId,
  hud,
  liveWrite,
  lastSentByParameter,
  onChange,
  onRevert,
  onSendModule,
  onReadModule,
  onCopyModule,
  onExportModule,
}: {
  module: ModuleDefinition;
  values: ParameterValues;
  originalValues: ParameterValues;
  selectedParameterId: string;
  hud: InteractionHud | null;
  liveWrite: boolean;
  lastSentByParameter: Record<string, string>;
  onChange: (param: ParameterDefinition, value: number, shouldSend?: boolean) => void;
  onRevert: (param: ParameterDefinition) => void;
  onSendModule: (module: ModuleDefinition) => void;
  onReadModule: (module: ModuleDefinition) => void;
  onCopyModule: () => void;
  onExportModule: () => void;
}) {
  const switchParam = module.parameters.find((param) => param.kind === "toggle");
  const typeParam = module.parameters.find((param) => param.kind === "select");
  const mainParameters = module.parameters.filter((param) => param !== switchParam && param !== typeParam);
  const keyParameters = mainParameters.slice(0, 4);
  const additionalParameters = mainParameters.slice(4);

  return (
    <section className="module-editor" aria-labelledby="module-editor-title">
      <div className="module-header">
        <div>
          <span>{module.shortTitle}</span>
          <h2 id="module-editor-title">{module.title}</h2>
          <p>{moduleEditorHint(module)}</p>
        </div>
        <details className="module-more">
          <summary aria-label={`${module.title} actions`}>
            <DotsThree size={20} aria-hidden="true" />
          </summary>
          <div>
            <button type="button" onClick={() => onSendModule(module)}>Send this module</button>
            <button type="button" onClick={() => onReadModule(module)}>Read this module</button>
            <button type="button" onClick={() => onRevertModule(module, originalValues, onChange)}>Reset module</button>
            <button type="button" onClick={onCopyModule}>Copy module SysEx</button>
            <button type="button" onClick={onExportModule}>Export module</button>
          </div>
        </details>
      </div>

      {(switchParam || typeParam) ? (
        <div className="module-core-strip" aria-label={`${module.title} main controls`}>
          {switchParam ? (
            <ParameterControl
              param={switchParam}
              value={values[switchParam.id]}
              originalValue={originalValues[switchParam.id]}
              selected={selectedParameterId === switchParam.id}
              hud={hud}
              liveWrite={liveWrite}
              lastSent={lastSentByParameter[switchParam.id]}
              onChange={(value) => onChange(switchParam, value)}
              onRevert={() => onRevert(switchParam)}
            />
          ) : null}
          {typeParam ? (
            <ParameterControl
              param={typeParam}
              value={values[typeParam.id]}
              originalValue={originalValues[typeParam.id]}
              selected={selectedParameterId === typeParam.id}
              hud={hud}
              liveWrite={liveWrite}
              lastSent={lastSentByParameter[typeParam.id]}
              onChange={(value) => onChange(typeParam, value)}
              onRevert={() => onRevert(typeParam)}
            />
          ) : null}
        </div>
      ) : null}

      <div className="parameter-groups">
        <details className="parameter-group" open>
          <summary id={`${module.id}-main-group`}>Key controls</summary>
          <div className="parameter-grid">
            {keyParameters.map((param) => (
              <ParameterControl
                key={param.id}
                param={param}
                value={values[param.id]}
                originalValue={originalValues[param.id]}
                selected={selectedParameterId === param.id}
                hud={hud}
                liveWrite={liveWrite}
                lastSent={lastSentByParameter[param.id]}
                onChange={(value) => onChange(param, value)}
                onRevert={() => onRevert(param)}
              />
            ))}
          </div>
        </details>
        {additionalParameters.length ? (
          <details className="parameter-group">
            <summary id={`${module.id}-additional-group`}>Additional controls</summary>
            <div className="parameter-grid">
              {additionalParameters.map((param) => (
                <ParameterControl
                  key={param.id}
                  param={param}
                  value={values[param.id]}
                  originalValue={originalValues[param.id]}
                  selected={selectedParameterId === param.id}
                  hud={hud}
                  liveWrite={liveWrite}
                  lastSent={lastSentByParameter[param.id]}
                  onChange={(value) => onChange(param, value)}
                  onRevert={() => onRevert(param)}
                />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}

function ParameterControl({
  param,
  value,
  originalValue,
  selected,
  hud,
  liveWrite,
  lastSent,
  onChange,
  onRevert,
}: {
  param: ParameterDefinition;
  value: number;
  originalValue: number;
  selected: boolean;
  hud: InteractionHud | null;
  liveWrite: boolean;
  lastSent?: string;
  onChange: (value: number) => void;
  onRevert: () => void;
}) {
  const current = value ?? param.defaultValue;
  const dirty = current !== originalValue;
  const dirtyMeta = dirty ? (
    <div className="parameter-meta">
      <span className="dirty-badge">Unsaved</span>
    </div>
  ) : null;

  let control: React.ReactNode;
  if (param.kind === "toggle") {
    const checked = current > 0;
    control = (
      <button
        id={param.id}
        type="button"
        className={`toggle-button ${checked ? "is-on" : ""}`}
        onClick={() => onChange(checked ? 0 : 1)}
        aria-pressed={checked}
      >
        <span aria-hidden="true" />
        {checked ? "ON" : "OFF"}
      </button>
    );
  } else if (param.kind === "select") {
    control = (
      <select id={param.id} value={current} onChange={(event) => onChange(Number(event.target.value))} aria-label={readableParameterName(param)}>
        {param.options?.map((option, index) => (
          <option key={option} value={index}>
            {option}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <div className="slider-control">
        <input
          id={param.id}
          type="range"
          min={param.min}
          max={param.max}
          step={param.step}
          value={current}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-describedby={`${param.id}-range`}
        />
        <input
          className="value-input"
          type="number"
          min={param.min}
          max={param.max}
          step={param.step}
          value={current}
          aria-label={`${readableParameterName(param)} exact value`}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="unit">{param.unit ?? ""}</span>
      </div>
    );
  }

  return (
    <article className={`parameter-control ${selected ? "is-selected" : ""} ${dirty ? "is-dirty" : ""}`}>
      <ParameterHeader param={param} current={current} dirty={dirty} onRevert={onRevert} />
      <div className="parameter-input-cell">{control}</div>
      <div className="parameter-context-cell">
        {dirtyMeta}
        <small id={`${param.id}-range`} className="parameter-note">{parameterDescription(param)}</small>
      </div>
      <ParameterFooter param={param} current={current} originalValue={originalValue} liveWrite={liveWrite} />
      <details className="parameter-advanced">
        <summary>Advanced SysEx</summary>
        <dl>
          <div>
            <dt>Scope</dt>
            <dd>Temporary patch</dd>
          </div>
          <div>
            <dt>Address</dt>
            <dd>{toHex(param.address)}</dd>
          </div>
          <div>
            <dt>Data size</dt>
            <dd>{parameterDataSizeLabel(param)}</dd>
          </div>
          <div>
            <dt>Last sent</dt>
            <dd>{lastSent ?? "Not sent"}</dd>
          </div>
        </dl>
      </details>
      {selected && hud ? <ValueHud hud={hud} /> : null}
    </article>
  );
}

function ParameterHeader({
  param,
  current,
  dirty,
  onRevert,
}: {
  param: ParameterDefinition;
  current: number;
  dirty: boolean;
  onRevert: () => void;
}) {
  return (
    <div className="parameter-header">
      <div>
        <label htmlFor={param.id}>{readableParameterName(param)}</label>
        <output>{formatParameterValue(param, current)}</output>
      </div>
      <button type="button" className="revert-button" disabled={!dirty} onClick={onRevert} aria-label={`Revert ${readableParameterName(param)}`}>
        <ArrowCounterClockwise size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

function ParameterFooter({
  param,
  current,
  originalValue,
  liveWrite,
}: {
  param: ParameterDefinition;
  current: number;
  originalValue: number;
  liveWrite: boolean;
}) {
  const dirty = current !== originalValue;
  return (
    <dl className="parameter-footer">
      <div>
        <dt>Range</dt>
        <dd>{formatParameterRange(param)}</dd>
      </div>
      <div>
        <dt>Change</dt>
        <dd>{dirty ? `${formatParameterValue(param, originalValue)} to ${formatParameterValue(param, current)}` : "Unchanged"}</dd>
      </div>
      <div>
        <dt>Mode</dt>
        <dd>{liveWrite ? "Live Preview" : "Staged"}</dd>
      </div>
    </dl>
  );
}

function ValueHud({ hud }: { hud: InteractionHud }) {
  return (
    <div className={`value-hud hud-${hud.status}`} role="status" aria-live="polite">
      <strong>{hud.label}</strong>
      <span>{hud.before} to {hud.after}</span>
      <small>{hud.target} - {hud.behavior}</small>
    </div>
  );
}

function SpecialTabPanel({
  tabId,
  selectedPatch,
  sources,
  values,
  performanceValues,
  controls,
  onPerformanceChange,
  onReadModule,
  onOpenSysEx,
}: {
  tabId: EditorTabId;
  selectedPatch: UserPatch;
  sources: SourceDefinition[];
  values: ParameterValues;
  performanceValues: ParameterValues;
  controls: PerformanceControlDefinition[];
  onPerformanceChange: (control: PerformanceControlDefinition, value: number) => void;
  onReadModule: () => void;
  onOpenSysEx: () => void;
}) {
  if (tabId === "pedal" || tabId === "assigns") {
    return (
      <section className="module-editor special-panel" aria-labelledby="pedal-panel-title">
        <div className="module-header">
          <div>
            <span>Performance</span>
            <h2 id="pedal-panel-title">Pedal, GK and assigns</h2>
          </div>
          <button type="button" onClick={onReadModule}>Read current module</button>
        </div>
        <PerformancePanel controls={controls} values={performanceValues} onChange={onPerformanceChange} />
        <div className="assignment-table">
          {["GK S1", "GK S2", "EXP switch", "CTL pedal", "Assign 1-8"].map((label) => (
            <div key={label}>
              <strong>{label}</strong>
              <span>Target mapping appears here when the GR-55 assign block is read.</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (tabId === "tones") {
    return (
      <section className="module-editor special-panel" aria-labelledby="tones-panel-title">
        <div className="module-header">
          <div>
            <span>Sources</span>
            <h2 id="tones-panel-title">Tones and pickup sources</h2>
          </div>
        </div>
        <div className="source-summary-table">
          {sources.map((source) => (
            <div key={source.id}>
              <strong>{source.label}</strong>
              <span>{source.enabled ? "On" : "Off"}</span>
              <span>{source.tone}</span>
              <span>{source.level}%</span>
              <span>{source.pan}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (tabId === "sysex") {
    return (
      <section className="module-editor special-panel" aria-labelledby="sysex-panel-title">
        <div className="module-header">
          <div>
            <span>Advanced</span>
            <h2 id="sysex-panel-title">SysEx tools</h2>
          </div>
          <button type="button" onClick={onOpenSysEx}>Open inspector SysEx</button>
        </div>
        <p className="system-note">Raw hex, import queue and MIDI traffic are kept in the right inspector so debug data never overwhelms patch editing.</p>
      </section>
    );
  }

  return (
    <section className="module-editor special-panel" aria-labelledby="overview-panel-title">
      <div className="module-header">
        <div>
          <span>Patch</span>
          <h2 id="overview-panel-title">{tabId === "system" ? "System and output" : "Overview"}</h2>
        </div>
      </div>
      <div className="overview-grid">
        <OverviewTile label="Patch" value={`USER ${selectedPatch.label}`} detail={`MSB ${selectedPatch.bankMsb}, PC ${selectedPatch.program}`} />
        <OverviewTile label="Patch level" value={formatPlainValue(values.patchLevel, "%")} detail="Temporary patch level" />
        <OverviewTile label="AMP" value={values.ampSwitch ? "On" : "Off"} detail="Modeled amp block" />
        <OverviewTile label="MFX" value={values.mfxSwitch ? "On" : "Off"} detail="Multi effect block" />
        <OverviewTile label="Delay" value={values.delaySwitch ? "On" : "Off"} detail="Delay send block" />
        <OverviewTile label="Reverb" value={values.reverbSwitch ? "On" : "Off"} detail="Reverb send block" />
      </div>
    </section>
  );
}

function PerformancePanel({
  controls,
  values,
  onChange,
}: {
  controls: PerformanceControlDefinition[];
  values: ParameterValues;
  onChange: (control: PerformanceControlDefinition, value: number) => void;
}) {
  return (
    <div className="performance-panel">
      {controls.map((control) => (
        <PerformanceControl
          key={control.id}
          control={control}
          value={values[control.id] ?? control.defaultValue}
          onChange={(value) => onChange(control, value)}
        />
      ))}
    </div>
  );
}

function PerformanceControl({
  control,
  value,
  onChange,
}: {
  control: PerformanceControlDefinition;
  value: number;
  onChange: (value: number) => void;
}) {
  if (control.kind === "toggle") {
    const checked = value > 0;
    return (
      <button type="button" className={`performance-toggle ${checked ? "is-on" : ""}`} onClick={() => onChange(checked ? 0 : 127)} aria-pressed={checked}>
        <span>{control.label}</span>
        <strong>{checked ? "ON" : "OFF"}</strong>
        <small>CC {control.controller}</small>
      </button>
    );
  }

  return (
    <div className="performance-slider">
      <label htmlFor={control.id}>{control.label}</label>
      <input id={control.id} type="range" min={0} max={127} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <input type="number" min={0} max={127} value={value} aria-label={`${control.label} value`} onChange={(event) => onChange(Number(event.target.value))} />
      <small>CC {control.controller}</small>
    </div>
  );
}

function HardwareActions({
  onPanic,
  onSendModule,
  onRequestPatch,
  onSaveToSlot,
  onClearTemporaryPatch,
  onClearSelectedUserPatch,
  selectedModule,
  selectedPatch,
  dirtyCount,
  operationState,
}: {
  onPanic: () => void;
  onSendModule: () => void;
  onRequestPatch: () => void;
  onSaveToSlot: () => void;
  onClearTemporaryPatch: () => void;
  onClearSelectedUserPatch: () => void;
  selectedModule: ModuleDefinition;
  selectedPatch: UserPatch;
  dirtyCount: number;
  operationState: OperationState;
}) {
  return (
    <section className="inspector-section" aria-labelledby="hardware-actions-title">
      <SectionHeader id="hardware-actions-title" title="Hardware Actions" icon={<Circuitry size={16} aria-hidden="true" />} />
      <div className="action-list">
        <InspectorAction title="Read temporary patch" detail="Request temporary patch level block" onClick={onRequestPatch} />
        <InspectorAction title="Send visible parameters" detail={`Push ${selectedModule.shortTitle} to temporary memory`} onClick={onSendModule} />
        <InspectorAction title={`Save to USER ${selectedPatch.label}`} detail={`Overwrite target slot with ${dirtyCount} pending changes`} onClick={onSaveToSlot} primary />
        <InspectorAction title="Mute temporary patch" detail="Turn off main effect blocks in temp memory" onClick={onClearTemporaryPatch} />
        <InspectorAction title={`Clear USER ${selectedPatch.label}`} detail="Overwrite slot with muted temporary patch" onClick={onClearSelectedUserPatch} danger />
        <InspectorAction title="All notes off" detail="Send CC 120-123 on current channel" onClick={onPanic} danger />
      </div>
      <div className={`save-target state-${operationState}`}>
        <span>Selected target</span>
        <strong>USER {selectedPatch.label}</strong>
        <small>Bank MSB {selectedPatch.bankMsb}, PC {selectedPatch.program}</small>
      </div>
    </section>
  );
}

function InspectorAction({
  title,
  detail,
  primary,
  danger,
  onClick,
}: {
  title: string;
  detail: string;
  primary?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`inspector-action ${primary ? "primary" : ""} ${danger ? "danger" : ""}`} onClick={onClick}>
      <strong>{title}</strong>
      <span>{detail}</span>
    </button>
  );
}

function InspectorIntentAction({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" className="inspector-intent-action" onClick={onClick}>
      <strong>{title}</strong>
      <span>{detail}</span>
    </button>
  );
}

function SelectionInspector({
  selectedPatch,
  dirtyCount,
  operationState,
  patchLoaded,
  workflowState,
  selection,
  selectedParameter,
  selectedSource,
  selectedModule,
  sourceField,
  values,
  originalValues,
  liveWrite,
  lastSentByParameter,
  onRevertParameter,
  onRevertSource,
  onSourceIntent,
  onModuleIntent,
}: {
  selectedPatch: UserPatch;
  dirtyCount: number;
  operationState: OperationState;
  patchLoaded: boolean;
  workflowState: WorkflowState;
  selection: Selection;
  selectedParameter: ParameterDefinition | null;
  selectedSource: SourceDefinition | null;
  selectedModule: ModuleDefinition | null;
  sourceField: SourceField | null;
  values: ParameterValues;
  originalValues: ParameterValues;
  liveWrite: boolean;
  lastSentByParameter: Record<string, string>;
  onRevertParameter: (param: ParameterDefinition) => void;
  onRevertSource: (sourceId: string, field: SourceField) => void;
  onSourceIntent: (sourceId: string, intent: SourceIntent) => void;
  onModuleIntent: (moduleId: ParameterModuleId, intent: ModuleIntent) => void;
}) {
  const parameterDirty = selectedParameter ? values[selectedParameter.id] !== originalValues[selectedParameter.id] : false;
  const sourceOriginalValue =
    selectedSource && sourceField ? SOURCE_DEFAULTS.find((source) => source.id === selectedSource.id)?.[sourceField] : undefined;
  const sourceDirty = Boolean(selectedSource && sourceField && selectedSource[sourceField] !== sourceOriginalValue);
  return (
    <section className="inspector-section" aria-labelledby="selection-inspector-title">
      <SectionHeader id="selection-inspector-title" title={selection.type === "patch" ? "Next Action" : "Selection Inspector"} icon={<Sliders size={16} aria-hidden="true" />} />
      {selection.type === "parameter" && selectedParameter ? (
        <>
          <div className="inspector-explain">
            <strong>{readableParameterName(selectedParameter)}</strong>
            <p>{parameterSoundImpact(selectedParameter)}</p>
            <p>{parameterInspectorDetail(selectedParameter, liveWrite)}</p>
            <button type="button" disabled={!parameterDirty} onClick={() => onRevertParameter(selectedParameter)}>
              <ArrowCounterClockwise size={15} aria-hidden="true" />
              Revert
            </button>
          </div>
          <dl className="inspector-dl">
            <InspectorRow label="Module" value={moduleTitle(selectedParameter.moduleId)} />
            <InspectorRow label="Current value" value={formatParameterValue(selectedParameter, values[selectedParameter.id])} />
            <InspectorRow label="Before / after" value={parameterDirty ? `${formatParameterValue(selectedParameter, originalValues[selectedParameter.id])} to ${formatParameterValue(selectedParameter, values[selectedParameter.id])}` : "Unchanged"} />
            <InspectorRow label="Range / unit" value={formatParameterRange(selectedParameter)} />
            <InspectorRow label="Send behavior" value={liveWrite ? "Live Preview sends while editing" : "Staged until Send Preview"} />
            <InspectorRow label="Save behavior" value={`Save writes USER ${selectedPatch.label}.`} />
          </dl>
          <details className="inspector-advanced">
            <summary>Advanced SysEx</summary>
            <dl className="inspector-dl">
              <InspectorRow label="Address" value={toHex(selectedParameter.address)} code />
              <InspectorRow label="Data size" value={parameterDataSizeLabel(selectedParameter)} />
              <InspectorRow label="Last sent" value={lastSentByParameter[selectedParameter.id] ?? "Not sent this session"} />
            </dl>
          </details>
        </>
      ) : selectedSource && sourceField ? (
        <>
          <div className="inspector-explain">
            <strong>{selectedSource.label}</strong>
            <p>{sourceInspectorDetail(selectedSource, sourceField)}</p>
            <p>{liveWrite ? "Live Preview is on where this source control is mapped." : "This source edit is staged until Send Preview."}</p>
            <button type="button" disabled={!sourceDirty} onClick={() => onRevertSource(selectedSource.id, sourceField)}>
              <ArrowCounterClockwise size={15} aria-hidden="true" />
              Revert
            </button>
          </div>
          <div className="intent-action-list" aria-label={`${selectedSource.label} intent actions`}>
            <InspectorIntentAction title="Change instrument" detail="Cycle to the next tone/model option" onClick={() => onSourceIntent(selectedSource.id, "change-instrument")} />
            <InspectorIntentAction title="Make it darker" detail="Lower brightness/filter amount" onClick={() => onSourceIntent(selectedSource.id, "darker")} />
            <InspectorIntentAction title="Make it brighter" detail="Raise brightness/filter amount" onClick={() => onSourceIntent(selectedSource.id, "brighter")} />
            <InspectorIntentAction title="Move it back" detail="Lower level and add more effects send" onClick={() => onSourceIntent(selectedSource.id, "back")} />
            <InspectorIntentAction title="Add space" detail="Send more of this source into effects" onClick={() => onSourceIntent(selectedSource.id, "more-space")} />
          </div>
          <dl className="inspector-dl">
            <InspectorRow label="Block" value={selectedSource.block} />
            <InspectorRow label="Current value" value={formatSourceValue(sourceField, selectedSource[sourceField])} />
            <InspectorRow label="Before / after" value={sourceDirty ? `${formatSourceValue(sourceField, sourceOriginalValue ?? "")} to ${formatSourceValue(sourceField, selectedSource[sourceField])}` : "Unchanged"} />
            <InspectorRow label="Range / unit" value={sourceFieldRange(sourceField)} />
            <InspectorRow label="Send behavior" value={liveWrite ? "Live Preview where source address is mapped" : "Staged until Send Preview"} />
            <InspectorRow label="Save behavior" value="Requires GR-55 source address map before write" />
          </dl>
        </>
      ) : selectedModule ? (
        <>
          <div className="inspector-explain">
            <strong>{selectedModule.title}</strong>
            <p>{moduleIntentSummary(selectedModule)}</p>
            <p>{liveWrite ? "Simple controls send mapped GR-55 parameters while you move them." : "Simple controls are staged until Send Preview."}</p>
            <button type="button" onClick={() => onModuleIntent(selectedModule.id, "reset")}>
              <ArrowCounterClockwise size={15} aria-hidden="true" />
              Revert block
            </button>
          </div>
          <div className="intent-action-list" aria-label={`${selectedModule.title} intent actions`}>
            {moduleIntentButtons(selectedModule).map((button) => (
              <InspectorIntentAction
                key={button.intent}
                title={button.label}
                detail={button.detail}
                onClick={() => onModuleIntent(selectedModule.id, button.intent)}
              />
            ))}
          </div>
          <dl className="inspector-dl">
            <InspectorRow label="Block" value={selectedModule.shortTitle} />
            <InspectorRow label="Current target" value={modulePrimaryValue(selectedModule, values)} />
            <InspectorRow label="Before / after" value={moduleBeforeAfter(selectedModule, values, originalValues)} />
            <InspectorRow label="Mode" value={liveWrite ? "Live Preview" : "Staged"} />
            <InspectorRow label="Advanced" value="Open Advanced GR-55 parameters in the center editor." />
          </dl>
        </>
      ) : (
        <div className={`next-action-card workflow-${workflowState}`}>
          <span>{nextActionKicker(workflowState, selectedPatch, patchLoaded)}</span>
          <strong>{nextStepTitle(workflowState, operationState)}</strong>
          <p>{nextActionBody(workflowState, liveWrite, dirtyCount)}</p>
          <dl>
            <div>
              <dt>Patch</dt>
              <dd>{patchLoaded ? `USER ${selectedPatch.label} loaded` : "Not loaded"}</dd>
            </div>
            <div>
              <dt>Edit</dt>
              <dd>Click a sound source or effect block</dd>
            </div>
            <div>
              <dt>Preview</dt>
              <dd>{liveWrite ? "Live Preview is available" : "Staged edits use Send Preview"}</dd>
            </div>
            <div>
              <dt>Save</dt>
              <dd>{dirtyCount ? "Save to GR-55 is available" : "Appears after changes"}</dd>
            </div>
          </dl>
          {dirtyCount ? <p className="next-step-note">{dirtyCount} unsaved changes. Save is now the primary toolbar action.</p> : null}
        </div>
      )}
    </section>
  );
}

function UtilityDrawer({
  isOpen,
  onToggle,
  log,
  rawHex,
  rawError,
  onRawHexChange,
  onSendRaw,
  onImportRaw,
  onPasteClipboard,
  messages,
  libraryError,
  onLibraryError,
  onAddMessages,
  onSendMessage,
  onSendQueue,
  onDeleteMessage,
  onClearQueue,
  onExportQueue,
}: {
  isOpen: boolean;
  onToggle: (value: boolean) => void;
  log: ReturnType<typeof useMidi>["log"];
  rawHex: string;
  rawError: string;
  onRawHexChange: (value: string) => void;
  onSendRaw: () => void;
  onImportRaw: () => void;
  onPasteClipboard: () => void;
  messages: ImportedSysExMessage[];
  libraryError: string;
  onLibraryError: (value: string) => void;
  onAddMessages: (messages: ImportedSysExMessage[]) => void;
  onSendMessage: (message: ImportedSysExMessage) => void;
  onSendQueue: () => void;
  onDeleteMessage: (index: number) => void;
  onClearQueue: () => void;
  onExportQueue: () => void;
}) {
  return (
    <details className="utility-drawer" open={isOpen} onToggle={(event) => onToggle(event.currentTarget.open)}>
      <summary>
        <span>MIDI and SysEx utility drawer</span>
        <small>{log.length} events, {messages.length} queued</small>
      </summary>
      <div className="utility-grid">
        <SysExConsole
          rawHex={rawHex}
          rawError={rawError}
          onRawHexChange={onRawHexChange}
          onSendRaw={onSendRaw}
          onImportRaw={onImportRaw}
          onPasteClipboard={onPasteClipboard}
        />
        <SysExLibrary
          messages={messages}
          error={libraryError}
          onError={onLibraryError}
          onAddMessages={onAddMessages}
          onSendMessage={onSendMessage}
          onSendQueue={onSendQueue}
          onDeleteMessage={onDeleteMessage}
          onClearQueue={onClearQueue}
          onExportQueue={onExportQueue}
        />
        <MidiLog log={log} />
      </div>
    </details>
  );
}

function SysExConsole({
  rawHex,
  rawError,
  onRawHexChange,
  onSendRaw,
  onImportRaw,
  onPasteClipboard,
}: {
  rawHex: string;
  rawError: string;
  onRawHexChange: (value: string) => void;
  onSendRaw: () => void;
  onImportRaw: () => void;
  onPasteClipboard: () => void;
}) {
  return (
    <details className="inspector-section disclosure">
      <summary>
        <span>Raw SysEx</span>
        <small>Advanced/debug</small>
      </summary>
      <Field label="Raw hex">
        <textarea value={rawHex} onChange={(event) => onRawHexChange(event.target.value)} spellCheck={false} rows={6} />
      </Field>
      {rawError ? <p className="inline-error" role="alert">{rawError}</p> : null}
      <div className="button-cluster two">
        <button type="button" onClick={onSendRaw}>Send raw</button>
        <button type="button" onClick={onPasteClipboard}>
          <ClipboardText size={16} aria-hidden="true" />
          Paste
        </button>
        <button type="button" onClick={onImportRaw}>
          <Queue size={16} aria-hidden="true" />
          Queue
        </button>
      </div>
      <p className="system-note">DT1 starts with {toHex([0xf0, 0x41, 0x10, 0x00, 0x00, 0x53, 0x12])}, then address, data and checksum.</p>
    </details>
  );
}

function SysExLibrary({
  messages,
  error,
  onError,
  onAddMessages,
  onSendMessage,
  onSendQueue,
  onDeleteMessage,
  onClearQueue,
  onExportQueue,
}: {
  messages: ImportedSysExMessage[];
  error: string;
  onError: (value: string) => void;
  onAddMessages: (messages: ImportedSysExMessage[]) => void;
  onSendMessage: (message: ImportedSysExMessage) => void;
  onSendQueue: () => void;
  onDeleteMessage: (index: number) => void;
  onClearQueue: () => void;
  onExportQueue: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    const loaded: ImportedSysExMessage[] = [];

    for (const file of Array.from(files)) {
      if (!validateImportFileMeta(file)) {
        onError(`${file.name}: unsupported type or file is too large.`);
        continue;
      }

      try {
        const input = isTextImport(file.name) ? await file.text() : await file.arrayBuffer();
        const messagesFromFile = parseImportedSysEx(input).map((message, index) => ({
          ...message,
          label: `${file.name} #${index + 1}`,
        }));
        loaded.push(...messagesFromFile);
      } catch (readError) {
        onError(readError instanceof Error ? `${file.name}: ${readError.message}` : `${file.name}: import failed.`);
      }
    }

    if (loaded.length) {
      onAddMessages(loaded);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <section className="inspector-section compact-section" aria-labelledby="sysex-library-title">
      <SectionHeader id="sysex-library-title" title="SysEx Import Queue" icon={<FileArrowUp size={16} aria-hidden="true" />} aside={`${messages.length}`} />
      <input
        ref={fileInputRef}
        className="hidden-file-input"
        type="file"
        accept=".syx,.hex,.txt,.g5l,.mid,.midi"
        multiple
        onChange={(event) => void handleFiles(event.target.files)}
      />
      <div className="button-cluster two">
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          <UploadSimple size={16} aria-hidden="true" />
          Load file
        </button>
        <button type="button" onClick={onSendQueue} disabled={!messages.length}>Send all</button>
        <button type="button" onClick={onExportQueue} disabled={!messages.length}>Export</button>
        <button type="button" onClick={onClearQueue} disabled={!messages.length}>Clear</button>
      </div>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <div className="library-list">
        {messages.length === 0 ? (
          <p className="empty-state">No imported SysEx messages.</p>
        ) : (
          messages.map((message, index) => (
            <article className="library-row" key={`${message.label}-${index}`}>
              <div>
                <strong>{message.label}</strong>
                <span>{message.bytes.length} bytes</span>
              </div>
              <code>{toHex(message.bytes).slice(0, 96)}{message.bytes.length > 32 ? " ..." : ""}</code>
              <div className="row-actions">
                <button type="button" onClick={() => onSendMessage(message)}>Send</button>
                <button type="button" onClick={() => onDeleteMessage(index)}>Delete</button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function MidiLog({ log }: { log: ReturnType<typeof useMidi>["log"] }) {
  return (
    <section className="inspector-section compact-section" aria-labelledby="midi-log-title">
      <SectionHeader id="midi-log-title" title="MIDI/SysEx Activity" icon={<Pulse size={16} aria-hidden="true" />} aside={`${log.length}`} />
      <div className="log-list" role="log" aria-live="polite" aria-relevant="additions">
        {log.length === 0 ? (
          <p className="empty-state">No MIDI traffic yet.</p>
        ) : (
          log.map((entry) => (
            <article key={entry.id} className={`log-row direction-${entry.direction}`}>
              <div>
                <span>{entry.at}</span>
                <strong>{entry.label}</strong>
              </div>
              {entry.bytes ? <code>{toHex(entry.bytes)}</code> : null}
              {!entry.sent ? <small>demo</small> : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function SectionHeader({
  id,
  title,
  icon,
  aside,
}: {
  id: string;
  title: string;
  icon?: React.ReactNode;
  aside?: string;
}) {
  return (
    <div className="section-header">
      <h2 id={id}>{title}</h2>
      <span className="section-header-aside">{aside ?? icon}</span>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function StatusItem({ label, value, state }: { label: string; value: string; state?: string }) {
  return (
    <div className="status-item">
      <dt>
        <span className={`status-dot status-${state ?? "idle"}`} aria-hidden="true" />
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

function ConnectionReadout({
  title,
  primary,
  secondary,
  code,
}: {
  title: string;
  primary: string;
  secondary?: string;
  code?: string;
}) {
  return (
    <div className="connection-readout">
      <span>{title}</span>
      <strong>{primary}</strong>
      {secondary ? <small>{secondary}</small> : null}
      {code ? <code>{code}</code> : null}
    </div>
  );
}

function InspectorRow({ label, value, code }: { label: string; value: string; code?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{code ? <code>{value}</code> : value}</dd>
    </div>
  );
}

function OverviewTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="overview-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function onRevertModule(
  module: ModuleDefinition,
  originalValues: ParameterValues,
  onChange: (param: ParameterDefinition, value: number, shouldSend?: boolean) => void,
) {
  module.parameters.forEach((param) => onChange(param, originalValues[param.id] ?? param.defaultValue, true));
}

function normalizeParameterValue(param: ParameterDefinition, value: number) {
  if (param.kind === "toggle") {
    return value > 0 ? 1 : 0;
  }

  if (param.kind === "select") {
    return clamp(Math.round(value), 0, (param.options?.length ?? 1) - 1);
  }

  const step = param.step ?? 1;
  const min = param.min ?? 0;
  const max = param.max ?? 127;
  const stepped = Math.round(value / step) * step;
  return clamp(Number(stepped.toFixed(3)), min, max);
}

function formatParameterValue(param: ParameterDefinition, value: number) {
  const current = value ?? param.defaultValue;
  if (param.options) {
    return param.options[current] ?? String(current);
  }

  if (param.unit === "dB") {
    return `${current > 0 ? "+" : ""}${current} dB`;
  }

  return `${current}${param.unit ? ` ${param.unit}` : ""}`;
}

function formatParameterRange(param: ParameterDefinition) {
  if (param.kind === "toggle") {
    return "OFF to ON";
  }
  if (param.kind === "select") {
    return `0 to ${(param.options?.length ?? 1) - 1}`;
  }

  const min = param.min ?? 0;
  const max = param.max ?? 127;
  if (param.unit === "dB") {
    return `${min} dB to +${max} dB`;
  }
  return `${min}${param.unit ? ` ${param.unit}` : ""} to ${max}${param.unit ? ` ${param.unit}` : ""}`;
}

function formatPlainValue(value: number, unit: string) {
  return `${value ?? 0}${unit}`;
}

function readableParameterName(param: ParameterDefinition) {
  const shortTitle = moduleShortTitle(param.moduleId);
  return param.label.toLowerCase().startsWith(shortTitle.toLowerCase()) ? param.label : `${shortTitle} ${param.label}`;
}

function parameterDescription(param: ParameterDefinition) {
  if (param.label.toLowerCase().includes("high gain")) {
    return "Controls the gain of the selected high band.";
  }
  if (param.label.toLowerCase().includes("send")) {
    return `Sets how much ${moduleTitle(param.moduleId)} feeds the named effect return.`;
  }
  if (param.kind === "select") {
    return `Chooses the active type inside ${moduleTitle(param.moduleId)}.`;
  }
  if (param.kind === "toggle") {
    return `Turns ${moduleTitle(param.moduleId)} on or off in temporary patch memory.`;
  }
  return `Controls ${param.label.toLowerCase()} for ${moduleTitle(param.moduleId)}.`;
}

function parameterSoundImpact(param: ParameterDefinition) {
  const label = param.label.toLowerCase();
  if (param.moduleId === "mfx" && label.includes("type")) {
    return "Chooses the multi-effect algorithm. This can change the character of the sound and which downstream controls matter.";
  }
  if (param.moduleId === "mfx" && label.includes("chorus send")) {
    return "Changes how much of the MFX return feeds the chorus block, adding width or movement after the effect.";
  }
  if (param.moduleId === "mfx" && label.includes("delay send")) {
    return "Changes how much of the MFX return feeds delay, affecting repeats without changing the dry source balance.";
  }
  if (label.includes("high gain")) {
    return "Raises or cuts the high band, making the effect brighter, sharper, or more restrained.";
  }
  if (param.kind === "toggle") {
    return `Turns the ${moduleTitle(param.moduleId)} block in or out of the patch signal path.`;
  }
  if (param.kind === "select") {
    return `Selects the active ${moduleTitle(param.moduleId)} mode or type before the detailed controls are edited.`;
  }
  return parameterDescription(param);
}

function parameterInspectorDetail(param: ParameterDefinition, liveWrite: boolean) {
  const previewMode = liveWrite ? "Live Preview sends the temporary patch value as you change it." : "Staged mode holds the value until Send Preview.";
  if (param.kind === "toggle") {
    return `${previewMode} This switch changes whether the ${moduleTitle(param.moduleId)} block contributes to the patch sound.`;
  }
  if (param.kind === "select") {
    return `${previewMode} Changing this selector may alter which following controls matter for the selected effect type.`;
  }
  return `${previewMode} Move in small steps, then compare against the original value before saving.`;
}

function parameterDataSizeLabel(param: ParameterDefinition) {
  const bytes = parameterDataSize(param);
  const scalarSize = bytes[bytes.length - 1] ?? 1;
  return `${scalarSize} byte${scalarSize === 1 ? "" : "s"}`;
}

function sourceInspectorDetail(source: SourceDefinition, field: SourceField) {
  if (field === "level") {
    return `Balances ${source.label} against the other GR-55 sound sources before the effect chain.`;
  }
  if (field === "brightness") {
    return `Makes ${source.label} darker or brighter before it feeds the shared effects.`;
  }
  if (field === "attack") {
    return `Changes how quickly ${source.label} speaks at the front of the note.`;
  }
  if (field === "fxSend") {
    return `Moves ${source.label} into chorus, delay and reverb without changing the dry level.`;
  }
  if (field === "octave") {
    return `Moves ${source.label} up or down by octaves while keeping the role in the patch.`;
  }
  if (field === "pan") {
    return `Places ${source.label} in the stereo field while leaving the other sources unchanged.`;
  }
  if (field === "tone") {
    return `Chooses the tone or model feeding the ${source.block} source slot.`;
  }
  return `Controls whether ${source.label} participates in the temporary patch blend.`;
}

function sourceFieldRange(field: SourceField) {
  if (field === "level" || field === "attack" || field === "brightness" || field === "fxSend") {
    return "0% to 100%";
  }
  if (field === "pan") {
    return "-50 to +50";
  }
  if (field === "octave") {
    return "-2 to +2 oct";
  }
  if (field === "tone") {
    return "tone option";
  }
  return "off to on";
}

function sourceRoleLabel(source: SourceDefinition) {
  if (!source.enabled) {
    return "hidden";
  }
  return source.role;
}

function moduleIsOn(moduleId: ParameterModuleId, values: ParameterValues) {
  const module = MODULES.find((item) => item.id === moduleId);
  const switchParam = module?.parameters.find((param) => param.kind === "toggle");
  return switchParam ? values[switchParam.id] > 0 : true;
}

function moduleIntentSummary(module: ModuleDefinition) {
  switch (module.id) {
    case "amp":
      return "Shapes the modeled guitar body, drive and front-of-chain level.";
    case "mod":
      return "Adds movement, drive, wah, compression or other pre-effect color.";
    case "mfx":
      return "Adds the main multi-effect color and decides how much of it feeds space and repeats.";
    case "chorus":
      return "Adds width and slow motion around the selected sound.";
    case "delay":
      return "Controls echoes, repeat length and how present the repeats feel.";
    case "reverb":
      return "Places the patch in a room, hall or plate space.";
    case "eq":
      return "Shapes the final tonal balance before the patch leaves the GR-55.";
    case "noise":
      return "Controls the gate that keeps quiet passages clean.";
    default:
      return `Edits the ${module.shortTitle} block in the temporary patch.`;
  }
}

function moduleIntentControls(module: ModuleDefinition) {
  const byId = new Map(module.parameters.map((param) => [param.id, param]));
  const pick = (id: string, label: string, hint: string) => {
    const param = byId.get(id);
    return param ? { param, label, hint } : null;
  };

  const controls =
    module.id === "amp"
      ? [
          pick("ampSwitch", "Amp on/off", "Put the modeled amp in or out of the signal path."),
          pick("ampType", "Amp character", "Choose the broad amp voice before fine tuning."),
          pick("ampGain", "Drive", "More drive thickens the modeled guitar."),
          pick("ampLevel", "Amp level", "Balances the amp block against the rest of the patch."),
          pick("ampTreble", "Brightness", "Raises or softens the top end."),
        ]
      : module.id === "delay"
        ? [
            pick("delaySwitch", "Delay on/off", "Put repeats in or out of the patch."),
            pick("delayLevel", "Wet/dry amount", "How much delay is heard."),
            pick("delayTime", "Repeat spacing", "Shorter or longer distance between repeats."),
            pick("delayFeedback", "Repeat count", "How long the echoes keep going."),
            pick("delayType", "Delay feel", "Single, pan, analog, tape or modulation character."),
          ]
        : module.id === "reverb"
          ? [
              pick("reverbSwitch", "Reverb on/off", "Put room sound in or out of the patch."),
              pick("reverbLevel", "Reverb level", "How much room is mixed in."),
              pick("reverbTime", "Room size", "Longer time makes the space bigger."),
              pick("reverbType", "Room character", "Ambience, room, hall or plate."),
              pick("reverbHighCut", "Reverb brightness", "Darker or brighter reverb tail."),
            ]
          : module.id === "mfx"
            ? [
                pick("mfxSwitch", "MFX on/off", "Put the multi-effect in or out of the patch."),
                pick("mfxType", "MFX character", "Choose the multi-effect algorithm."),
                pick("mfxDelaySend", "Send to delay", "How much of the effect feeds repeats."),
                pick("mfxReverbSend", "Send to reverb", "How much of the effect feeds space."),
                pick("mfxChorusSend", "Send to chorus", "How much of the effect feeds width."),
              ]
            : module.id === "chorus"
              ? [
                  pick("chorusSwitch", "Chorus on/off", "Put width in or out of the patch."),
                  pick("chorusLevel", "Chorus level", "How much width is mixed in."),
                  pick("chorusRate", "Movement speed", "How fast the modulation moves."),
                  pick("chorusDepth", "Movement depth", "How wide the modulation feels."),
                  pick("chorusType", "Chorus character", "Mono or stereo chorus style."),
                ]
              : module.id === "eq"
                ? [
                    pick("eqSwitch", "EQ on/off", "Put final EQ in or out of the patch."),
                    pick("eqLowGain", "Low body", "Adds or cuts weight."),
                    pick("eqLowMidGain", "Low-mid warmth", "Changes thickness and boxiness."),
                    pick("eqHighMidGain", "Presence", "Changes pick attack and edge."),
                    pick("eqHighGain", "Air", "Adds or cuts top end."),
                  ]
                : module.parameters.slice(0, 5).map((param) => ({
                    param,
                    label: param.label,
                    hint: parameterDescription(param),
                  }));

  return controls.filter((item): item is { param: ParameterDefinition; label: string; hint: string } => Boolean(item));
}

function moduleIntentButtons(module: ModuleDefinition): Array<{ intent: ModuleIntent; label: string; detail: string }> {
  if (module.id === "delay") {
    return [
      { intent: "more", label: "More delay", detail: "Raise the wet/dry amount." },
      { intent: "less", label: "Less delay", detail: "Lower the wet/dry amount." },
      { intent: "longer", label: "Longer repeats", detail: "Increase repeat spacing." },
      { intent: "shorter", label: "Shorter repeats", detail: "Tighten the repeat spacing." },
      { intent: "darker", label: "Darker repeats", detail: "Use a darker delay feel where available." },
    ];
  }

  if (module.id === "reverb") {
    return [
      { intent: "more", label: "More reverb", detail: "Raise the reverb level." },
      { intent: "less", label: "Less wash", detail: "Lower the reverb level." },
      { intent: "longer", label: "Bigger room", detail: "Increase reverb time." },
      { intent: "shorter", label: "Smaller room", detail: "Shorten reverb time." },
      { intent: "brighter", label: "More shimmer", detail: "Open the reverb high cut." },
    ];
  }

  if (module.id === "amp") {
    return [
      { intent: "more", label: "More drive", detail: "Increase amp gain." },
      { intent: "less", label: "Cleaner", detail: "Reduce amp gain." },
      { intent: "brighter", label: "Brighter amp", detail: "Raise treble or presence." },
      { intent: "darker", label: "Darker amp", detail: "Lower treble or presence." },
    ];
  }

  if (module.id === "chorus" || module.id === "mod" || module.id === "mfx") {
    return [
      { intent: "more", label: "More effect", detail: "Raise the main effect amount." },
      { intent: "less", label: "Less effect", detail: "Lower the main effect amount." },
      { intent: "movement", label: "More movement", detail: "Increase rate or depth where available." },
      { intent: "darker", label: "Darker color", detail: "Reduce brightness or send where available." },
    ];
  }

  return [
    { intent: "more", label: "More", detail: "Increase the primary amount." },
    { intent: "less", label: "Less", detail: "Decrease the primary amount." },
    { intent: "brighter", label: "Brighter", detail: "Raise high-frequency controls." },
    { intent: "darker", label: "Darker", detail: "Lower high-frequency controls." },
  ];
}

function moduleIntentTarget(module: ModuleDefinition, intent: ModuleIntent) {
  const byId = new Map(module.parameters.map((param) => [param.id, param]));
  const target = (id: string, delta: number) => {
    const param = byId.get(id);
    return param ? { param, delta } : null;
  };

  if (module.id === "delay") {
    if (intent === "more") return target("delayLevel", 8);
    if (intent === "less") return target("delayLevel", -8);
    if (intent === "longer") return target("delayTime", 80);
    if (intent === "shorter") return target("delayTime", -80);
    return target("delayFeedback", intent === "darker" ? -6 : 6);
  }

  if (module.id === "reverb") {
    if (intent === "more") return target("reverbLevel", 8);
    if (intent === "less") return target("reverbLevel", -8);
    if (intent === "longer") return target("reverbTime", 0.4);
    if (intent === "shorter") return target("reverbTime", -0.4);
    return target("reverbHighCut", intent === "brighter" ? 1 : -1);
  }

  if (module.id === "amp") {
    if (intent === "more") return target("ampGain", 8);
    if (intent === "less") return target("ampGain", -8);
    if (intent === "brighter") return target("ampTreble", 6);
    return target("ampTreble", -6);
  }

  if (module.id === "chorus") {
    if (intent === "more") return target("chorusLevel", 8);
    if (intent === "less") return target("chorusLevel", -8);
    return target("chorusDepth", intent === "movement" ? 8 : -6);
  }

  if (module.id === "mfx") {
    if (intent === "more") return target("mfxReverbSend", 8);
    if (intent === "less") return target("mfxReverbSend", -8);
    return target("mfxChorusSend", intent === "movement" ? 8 : -6);
  }

  if (module.id === "mod") {
    if (intent === "more") return target("odDsLevel", 8);
    if (intent === "less") return target("odDsLevel", -8);
    if (intent === "movement") return target("odDsDrive", 8);
    return target("odDsTone", intent === "brighter" ? 6 : -6);
  }

  if (module.id === "eq") {
    if (intent === "more" || intent === "brighter") return target("eqHighGain", 2);
    if (intent === "less" || intent === "darker") return target("eqHighGain", -2);
    return target("eqLevel", 2);
  }

  const firstSlider = module.parameters.find((param) => param.kind === "slider");
  return firstSlider ? { param: firstSlider, delta: intent === "less" || intent === "darker" ? -5 : 5 } : null;
}

function modulePrimaryValue(module: ModuleDefinition, values: ParameterValues) {
  const controls = moduleIntentControls(module);
  const param = controls.find((item) => item.param.kind === "slider")?.param ?? controls[0]?.param;
  return param ? `${controls.find((item) => item.param === param)?.label ?? param.label}: ${formatParameterValue(param, values[param.id])}` : "No mapped control";
}

function moduleBeforeAfter(module: ModuleDefinition, values: ParameterValues, originalValues: ParameterValues) {
  const changed = module.parameters.find((param) => values[param.id] !== originalValues[param.id]);
  if (!changed) {
    return "Unchanged";
  }
  return `${readableParameterName(changed)}: ${formatParameterValue(changed, originalValues[changed.id])} to ${formatParameterValue(changed, values[changed.id])}`;
}

function getWorkflowState(isConnected: boolean, patchLoaded: boolean, dirtyCount: number): WorkflowState {
  if (!isConnected) {
    return "disconnected";
  }
  if (!patchLoaded) {
    return "ready-to-read";
  }
  return dirtyCount > 0 ? "dirty" : "ready-to-edit";
}

function nextStepTitle(workflowState: WorkflowState, operationState: OperationState) {
  if (workflowState === "disconnected") {
    return "Connect first";
  }
  if (workflowState === "ready-to-read") {
    return "Read the current GR-55 patch";
  }
  if (workflowState === "dirty") {
    return "Save when ready";
  }
  if (operationState === "saved") {
    return "Saved. Keep editing or choose another patch";
  }
  return "Choose what to edit";
}

function nextActionKicker(workflowState: WorkflowState, selectedPatch: UserPatch, patchLoaded: boolean) {
  if (workflowState === "disconnected") {
    return "GR-55 is not connected";
  }
  if (!patchLoaded) {
    return "No temporary patch has been read";
  }
  return `Patch USER ${selectedPatch.label} loaded`;
}

function nextActionBody(workflowState: WorkflowState, liveWrite: boolean, dirtyCount: number) {
  if (workflowState === "disconnected") {
    return "Connect the hardware from the toolbar. The editor will keep the patch view quiet until a route is ready.";
  }
  if (workflowState === "ready-to-read") {
    return "Read Patch pulls the current temporary patch into the editor before you make changes.";
  }
  if (workflowState === "dirty") {
    return `${dirtyCount} unsaved ${dirtyCount === 1 ? "change" : "changes"} can be previewed, compared, reverted, or saved to the selected USER slot.`;
  }
  return liveWrite
    ? "Click a source or effect block. Live Preview is on, so mapped changes are heard as you move them."
    : "Click a source or effect block. Changes are staged until you use Send Preview.";
}

function moduleEditorHint(module: ModuleDefinition) {
  if (module.id === "mfx") {
    return "Choose the multi-effect type, then adjust the controls that shape the return.";
  }
  if (module.id === "amp") {
    return "Set the amp model first, then balance gain, level and tone.";
  }
  if (module.id === "mod") {
    return "Select the modulation type, then tune the movement and blend.";
  }
  if (module.id === "eq") {
    return "Shape the patch after effects with small gain moves.";
  }
  return `Edit the ${module.shortTitle} block in temporary patch memory.`;
}

function moduleShortTitle(moduleId: ParameterModuleId) {
  return MODULES.find((module) => module.id === moduleId)?.shortTitle ?? moduleId.toUpperCase();
}

function moduleTitle(moduleId: ParameterModuleId) {
  return MODULES.find((module) => module.id === moduleId)?.title ?? moduleId.toUpperCase();
}

function sourceFieldLabel(field: SourceField) {
  switch (field) {
    case "enabled":
      return "Switch";
    case "level":
      return "Level";
    case "pan":
      return "Pan";
    case "tone":
      return "Tone";
    case "attack":
      return "Attack";
    case "brightness":
      return "Brightness";
    case "octave":
      return "Octave";
    case "fxSend":
      return "Effects send";
    case "muted":
      return "Mute";
    case "solo":
      return "Solo";
  }
}

function formatSourceValue(field: SourceField, value: unknown) {
  if (field === "enabled" || field === "muted" || field === "solo") {
    return value ? "ON" : "OFF";
  }
  if (field === "level" || field === "attack" || field === "brightness" || field === "fxSend") {
    return `${value}%`;
  }
  if (field === "octave") {
    return `${Number(value) > 0 ? "+" : ""}${value} oct`;
  }
  return String(value);
}

function formatMidiStatus(status: string) {
  switch (status) {
    case "ready":
      return "Ready";
    case "pending":
      return "Connecting";
    case "unsupported":
      return "Unavailable";
    case "error":
      return "Failed";
    default:
      return "Disconnected";
  }
}

function formatPortName(port: MIDIPort) {
  const parts = [port.manufacturer, port.name].filter(Boolean);
  return parts.length ? parts.join(" ") : port.id;
}

function formatPortState(port: MIDIPort) {
  return `${port.state}, ${port.connection}`;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function downloadUrl(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

function isTextImport(name: string) {
  const lower = name.toLowerCase();
  return lower.endsWith(".txt") || lower.endsWith(".hex");
}
