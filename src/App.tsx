import {
  ArrowCounterClockwise,
  CheckCircle,
  ClipboardText,
  DotsThree,
  FadersHorizontal,
  FileArrowUp,
  Keyboard,
  Pulse,
  Queue,
  Sliders,
  WarningCircle,
  UploadSimple,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MODULES,
  PARAMETERS_BY_ADDRESS,
  PARAMETERS_BY_ID,
  UNMAPPED_PARAMETER_TODOS,
  createInitialParameterValues,
  decodeParameterValue,
  makeMappedPatchReadMessages,
  makeParameterMessage,
  parameterDataSize,
  type ModuleDefinition,
  type ParameterDefinition,
  type ParameterModuleId,
} from "./data/gr55Parameters";
import { StringMatrix } from "./components/editor/StringMatrix";
import { PatchManager } from "./components/librarian/PatchManager";
import { StudioToolbar, type CommandPaletteCommand } from "./components/layout/StudioToolbar";
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
  PATCH_NAME_ADDRESS,
  decodePatchName,
  makePatchNameReadMessage,
  makePatchNameWriteMessage,
  validatePatchName,
} from "./lib/patchName";
import {
  makeDownloadBlobUrl,
  parseImportedSysEx,
  serializeMessagesAsHex,
  validateImportFileMeta,
  classifyImportedSysExMessages,
  type ImportedSysExMessage,
  type SysExQueueClassification,
} from "./lib/sysexLibrary";
import {
  applyMappedReadResponse,
  createIdleMappedReadProgress,
  createMappedReadProgress,
  markMappedReadPartial,
  type MappedReadProgress,
} from "./lib/readProgress";
import { parseMappedPatchMessages } from "./lib/patchImport";
import type { UsbPacketMode } from "./lib/usbMidi";

type ParameterValues = Record<string, number>;
type TransportMode = "bridge" | "midi" | "usb";
type OperationState = "idle" | "sending" | "saved" | "error";
type WorkflowState = "disconnected" | "select-slot" | "ready-to-read" | "ready-to-edit" | "dirty";
type PatchSlotState = "unread" | "reading" | "loaded" | "dirty" | "saved" | "error";
type EditorTabId = "overview" | "strings" | "tones" | "assigns" | "pedal" | "system" | "sysex" | ParameterModuleId;
type EditorTabGroupId = "librarian" | "sources" | "effects" | "assigns" | "debug";
type EditorTabDefinition = {
  id: EditorTabId;
  label: string;
  moduleId?: ParameterModuleId;
  group: EditorTabGroupId;
};
type SourceField =
  | "enabled"
  | "level"
  | "pan"
  | "tone"
  | "routing"
  | "octave"
  | "coarseTune"
  | "fineTune"
  | "cutoff"
  | "resonance"
  | "attack"
  | "release";
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

type HardwareActivity = {
  id: string;
  kind: "program" | "control" | "parameter" | "identity" | "system";
  label: string;
  detail: string;
  at: string;
};

type ParameterHistoryItem = {
  paramId: string;
  before: number;
  after: number;
};

type PatchSlotRecord = {
  status: PatchSlotState;
  name?: string;
  error?: string;
};

type SaveVerification = {
  slotLabel: string;
  expectedPatchName: string;
  expectedValues: Record<string, number>;
  pendingPatchName: boolean;
  pendingParameterIds: string[];
  mismatches: string[];
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
  role: "main" | "layer" | "texture" | "hidden";
  moduleId: ParameterModuleId;
  primaryField: SourceField;
  fields: Partial<Record<SourceField, string>>;
};

const PERFORMANCE_CONTROLS: PerformanceControlDefinition[] = [
  { id: "expression", label: "EXP pedal", controller: 11, kind: "knob", defaultValue: 0 },
  { id: "gkVolume", label: "GK volume", controller: 7, kind: "knob", defaultValue: 100 },
  { id: "modWheel", label: "MOD wheel", controller: 1, kind: "knob", defaultValue: 0 },
  { id: "hold", label: "Hold", controller: 64, kind: "toggle", defaultValue: 0 },
  { id: "ctl", label: "CTL pedal", controller: 80, kind: "toggle", defaultValue: 0 },
];

const SOURCE_DEFINITIONS: SourceDefinition[] = [
  {
    id: "pcm1",
    label: "PCM Tone 1",
    block: "PCM1",
    role: "main",
    moduleId: "pcm1",
    primaryField: "level",
    fields: {
      enabled: "pcm1Switch",
      tone: "pcm1ToneNumber",
      level: "pcm1Level",
      pan: "pcm1Pan",
      octave: "pcm1OctaveShift",
      coarseTune: "pcm1CoarseTune",
      fineTune: "pcm1FineTune",
      cutoff: "pcm1CutoffOffset",
      resonance: "pcm1ResonanceOffset",
      attack: "pcm1AttackOffset",
      release: "pcm1ReleaseOffset",
      routing: "pcm1OutputSelect",
    },
  },
  {
    id: "pcm2",
    label: "PCM Tone 2",
    block: "PCM2",
    role: "layer",
    moduleId: "pcm2",
    primaryField: "level",
    fields: {
      enabled: "pcm2Switch",
      tone: "pcm2ToneNumber",
      level: "pcm2Level",
      pan: "pcm2Pan",
      octave: "pcm2OctaveShift",
      coarseTune: "pcm2CoarseTune",
      fineTune: "pcm2FineTune",
      cutoff: "pcm2CutoffOffset",
      resonance: "pcm2ResonanceOffset",
      attack: "pcm2AttackOffset",
      release: "pcm2ReleaseOffset",
      routing: "pcm2OutputSelect",
    },
  },
  {
    id: "modeling",
    label: "Modeling tone",
    block: "Modeling",
    role: "main",
    moduleId: "modeling",
    primaryField: "level",
    fields: {
      enabled: "modelingSwitch",
      tone: "modelingCategory",
      level: "modelingLevel",
      coarseTune: "modelingPitchShift",
      fineTune: "modelingFineShift",
    },
  },
  {
    id: "normal",
    label: "Normal pickup",
    block: "Normal PU",
    role: "hidden",
    moduleId: "normal-pu",
    primaryField: "level",
    fields: {
      enabled: "normalPuSwitch",
      level: "normalPuLevel",
      routing: "normalPuRouting",
    },
  },
];

const PCM_TONE_CATEGORIES = [
  { name: "Ac.Piano", first: 1, last: 16 },
  { name: "Pop Piano", first: 17, last: 19 },
  { name: "E.Grand Piano", first: 20, last: 21 },
  { name: "E.Piano", first: 22, last: 59 },
  { name: "Organ/Keys", first: 60, last: 162 },
  { name: "Guitar", first: 163, last: 209 },
  { name: "Bass", first: 210, last: 314 },
  { name: "Plucked/Strings", first: 315, last: 363 },
  { name: "Orchestral/Brass/Wind", first: 364, last: 415 },
  { name: "Vox/Choir", first: 416, last: 445 },
  { name: "Synth Lead", first: 446, last: 568 },
  { name: "Synth Brass", first: 569, last: 608 },
  { name: "Synth Pad/Strings", first: 609, last: 692 },
  { name: "Synth Bellpad/PolyKey", first: 693, last: 754 },
  { name: "Synth FX/Seq", first: 755, last: 796 },
  { name: "Pulsating/Beat", first: 797, last: 839 },
  { name: "Hit/Sound FX", first: 840, last: 883 },
  { name: "Percussion", first: 884, last: 896 },
  { name: "Drums", first: 897, last: 910 },
] as const;

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

const EDITOR_TAB_GROUP_LABELS: Record<EditorTabGroupId, string> = {
  librarian: "Librarian",
  sources: "Sources",
  effects: "Effects",
  assigns: "Assigns / Pedals",
  debug: "SysEx / MCP / Debug",
};

const EDITOR_TAB_GROUP_ORDER: EditorTabGroupId[] = ["librarian", "sources", "effects", "assigns", "debug"];

const EDITOR_TABS: EditorTabDefinition[] = [
  { id: "overview", label: "Overview", group: "librarian" },
  { id: "common", label: "Patch", moduleId: "common", group: "librarian" },
  { id: "pcm1", label: "PCM1", moduleId: "pcm1", group: "sources" },
  { id: "pcm2", label: "PCM2", moduleId: "pcm2", group: "sources" },
  { id: "modeling", label: "Modeling/COSM", moduleId: "modeling", group: "sources" },
  { id: "normal-pu", label: "Normal PU", moduleId: "normal-pu", group: "sources" },
  { id: "strings", label: "String Matrix", group: "sources" },
  { id: "tones", label: "Tone List", group: "sources" },
  { id: "amp", label: "Amp", moduleId: "amp", group: "effects" },
  { id: "mod", label: "MOD", moduleId: "mod", group: "effects" },
  { id: "mfx", label: "MFX", moduleId: "mfx", group: "effects" },
  { id: "chorus", label: "Chorus", moduleId: "chorus", group: "effects" },
  { id: "delay", label: "Delay", moduleId: "delay", group: "effects" },
  { id: "reverb", label: "Reverb", moduleId: "reverb", group: "effects" },
  { id: "eq", label: "EQ/Output", moduleId: "eq", group: "effects" },
  { id: "noise", label: "Noise Suppressor", moduleId: "noise", group: "effects" },
  { id: "assigns", label: "Assigns", group: "assigns" },
  { id: "pedal", label: "Pedal/GK", group: "assigns" },
  { id: "sysex", label: "SysEx/MCP", group: "debug" },
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
const MAPPED_PARAMETER_ADDRESS_KEYS = new Set(PARAMETERS_BY_ADDRESS.keys());
const PATCH_NAME_ADDRESS_KEY = addressKey(PATCH_NAME_ADDRESS);
const KNOWN_IMPORT_ADDRESS_KEYS = new Set([...MAPPED_PARAMETER_ADDRESS_KEYS, PATCH_NAME_ADDRESS_KEY]);
const MAPPED_PARAMETER_COUNT = PARAMETERS_BY_ADDRESS.size;
const MAPPED_PARAMETER_KEYS = [...PARAMETERS_BY_ADDRESS.keys()];
const PATCH_NAME_READ_DELAY_MS = 100;
const MAPPED_READ_SEND_DELAY_MS = 110;
const MODULE_READ_SEND_DELAY_MS = 110;
const MAPPED_READ_RETRY_DELAY_MS = 800;
const MAPPED_READ_TIMEOUT_MS = 20000;
const SAVE_VERIFY_READ_DELAY_MS = 140;
const PARAMETER_WRITE_SEND_DELAY_MS = 70;
const PATCH_SELECT_SETTLE_MS = 420;

export function App() {
  const initialValues = useMemo(() => createInitialParameterValues(), []);
  const [selectedPatch, setSelectedPatch] = useState<UserPatch>(USER_PATCHES[212] ?? USER_PATCHES[0]);
  const [slotSelectionConfirmed, setSlotSelectionConfirmed] = useState(false);
  const [patchLoaded, setPatchLoaded] = useState(false);
  const [readStatus, setReadStatus] = useState("Select a USER slot so the app can choose it on the GR-55, then read mapped parameters.");
  const [patchName, setPatchName] = useState("");
  const [originalPatchName, setOriginalPatchName] = useState("");
  const [patchNameStatus, setPatchNameStatus] = useState<PatchSlotState>("unread");
  const [patchNameError, setPatchNameError] = useState("");
  const [patchSlots, setPatchSlots] = useState<Record<number, PatchSlotRecord>>({});
  const [incomingBankMsb, setIncomingBankMsb] = useState(0);
  const [activeModuleId, setActiveModuleId] = useState<ParameterModuleId>("mfx");
  const [activeTabId, setActiveTabId] = useState<EditorTabId>("overview");
  const [values, setValues] = useState<ParameterValues>(() => initialValues);
  const [originalValues, setOriginalValues] = useState<ParameterValues>(() => initialValues);
  const [performanceValues, setPerformanceValues] = useState<ParameterValues>(() =>
    Object.fromEntries(PERFORMANCE_CONTROLS.map((control) => [control.id, control.defaultValue])),
  );
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
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [previewedDirtyChanges, setPreviewedDirtyChanges] = useState(false);
  const [mappedReadProgress, setMappedReadProgressState] = useState<MappedReadProgress>(() =>
    createIdleMappedReadProgress(MAPPED_PARAMETER_COUNT),
  );
  const [saveVerification, setSaveVerification] = useState<SaveVerification | null>(null);
  const [autoReadPatch, setAutoReadPatch] = useState<UserPatch | null>(null);
  const [hardwareActivity, setHardwareActivity] = useState<HardwareActivity[]>([]);
  const patchSearchRef = useRef<HTMLInputElement | null>(null);
  const incomingBankMsbRef = useRef(0);
  const readTimeoutRef = useRef<number | null>(null);
  const mappedReadProgressRef = useRef(mappedReadProgress);
  const saveVerificationRef = useRef<SaveVerification | null>(null);
  const bridgeAutoUsbAttemptRef = useRef(false);
  const identityRequestKeyRef = useRef("");

  const setMappedReadProgress = useCallback((next: MappedReadProgress) => {
    mappedReadProgressRef.current = next;
    setMappedReadProgressState(next);
  }, []);

  const clearReadTimeout = useCallback(() => {
    if (readTimeoutRef.current !== null) {
      window.clearTimeout(readTimeoutRef.current);
      readTimeoutRef.current = null;
    }
  }, []);

  const pushHardwareActivity = useCallback((activity: Omit<HardwareActivity, "id" | "at">) => {
    setHardwareActivity((current) => [
      {
        ...activity,
        id: crypto.randomUUID(),
        at: new Date().toLocaleTimeString(),
      },
      ...current.slice(0, 7),
    ]);
  }, []);

  const setSaveVerificationState = useCallback((next: SaveVerification | null) => {
    saveVerificationRef.current = next;
    setSaveVerification(next);
  }, []);

  const updateSelectedSlotRecord = useCallback((patch: UserPatch, patchRecord: PatchSlotRecord) => {
    setPatchSlots((current) => ({
      ...current,
      [patch.userIndex]: {
        ...current[patch.userIndex],
        ...patchRecord,
      },
    }));
  }, []);

  const resetLoadedPatchState = useCallback(() => {
    setPatchLoaded(false);
    setPatchName("");
    setOriginalPatchName("");
    setPatchNameStatus("unread");
    setPatchNameError("");
    setSaveVerificationState(null);
    setMappedReadProgress(createIdleMappedReadProgress(MAPPED_PARAMETER_COUNT));
    setValues(createInitialParameterValues());
    setOriginalValues(createInitialParameterValues());
    setUndoStack([]);
    setRedoStack([]);
    setPreviewedDirtyChanges(false);
    setCompareActive(false);
  }, [setMappedReadProgress, setSaveVerificationState]);

  const handleIncoming = useCallback(
    (event: IncomingMidiEvent) => {
      if (event.type === "bank-select") {
        incomingBankMsbRef.current = event.bankMsb;
        setIncomingBankMsb(event.bankMsb);
        setMirrorStatus(`GR-55 bank MSB ${event.bankMsb}`);
        pushHardwareActivity({
          kind: "program",
          label: "Bank Select",
          detail: `MSB ${event.bankMsb}`,
        });
        return;
      }

      if (event.type === "program-change") {
        const patch = USER_PATCHES.find(
          (candidate) => candidate.bankMsb === incomingBankMsbRef.current && candidate.program === event.program,
        );

        if (patch) {
          setSelectedPatch(patch);
          setSlotSelectionConfirmed(true);
          resetLoadedPatchState();
          setMirrorStatus(`GR-55 selected USER ${patch.label}`);
          setReadStatus(`GR-55 switched to USER ${patch.label}. Auto-reading mapped parameters.`);
          updateSelectedSlotRecord(patch, { status: "reading" });
          setAutoReadPatch(patch);
          pushHardwareActivity({
            kind: "program",
            label: `USER ${patch.label}`,
            detail: `Incoming PC ${event.program}, bank ${incomingBankMsbRef.current}`,
          });
        } else {
          setMirrorStatus(`GR-55 PC ${event.program} on bank ${incomingBankMsbRef.current}`);
          pushHardwareActivity({
            kind: "program",
            label: "Program Change",
            detail: `PC ${event.program}, bank ${incomingBankMsbRef.current}`,
          });
        }
        return;
      }

      if (event.type === "control-change") {
        const control = PERFORMANCE_CONTROLS.find((item) => item.controller === event.controller);
        if (control) {
          setPerformanceValues((current) => ({ ...current, [control.id]: event.value }));
          setMirrorStatus(`GR-55 CC ${event.controller} = ${event.value}`);
          pushHardwareActivity({
            kind: "control",
            label: control.label,
            detail: `CC ${event.controller} = ${event.value}`,
          });
        } else {
          pushHardwareActivity({
            kind: "control",
            label: "Unmapped CC",
            detail: `CC ${event.controller} = ${event.value}`,
          });
        }
        return;
      }

      if (event.type === "roland-data") {
        const readAddressKey = addressKey(event.address);
        const activeRead = mappedReadProgressRef.current.status === "reading" || mappedReadProgressRef.current.status === "partial";
        if (!slotSelectionConfirmed && !activeRead && !saveVerificationRef.current) {
          setMirrorStatus(event.checksumValid ? `Ignored unscoped GR-55 data ${toHex(event.address)}` : "GR-55 data checksum failed");
          pushHardwareActivity({
            kind: "parameter",
            label: event.checksumValid ? "Ignored unscoped Roland data" : "Checksum failed",
            detail: `${toHex(event.address)} ${toHex(event.valueBytes)}`,
          });
          return;
        }

        if (readAddressKey === PATCH_NAME_ADDRESS_KEY && event.checksumValid) {
          const decodedName = decodePatchName(event.valueBytes);
          setPatchName(decodedName);
          setOriginalPatchName(decodedName);
          setPatchNameStatus("loaded");
          setPatchNameError("");
          setDeviceId(event.deviceId);
          setMirrorStatus(`GR-55 patch name = ${decodedName || "(blank)"}`);
          updateSelectedSlotRecord(selectedPatch, { status: "loaded", name: decodedName });
          pushHardwareActivity({
            kind: "parameter",
            label: "Patch name",
            detail: `${toHex(event.address)} = ${decodedName || "(blank)"}`,
          });

          const verification = saveVerificationRef.current;
          if (verification?.pendingPatchName) {
            const mismatches =
              decodedName === verification.expectedPatchName
                ? verification.mismatches
                : [...verification.mismatches, `Patch name expected "${verification.expectedPatchName}" but read "${decodedName}"`];
            const nextVerification = {
              ...verification,
              pendingPatchName: false,
              mismatches,
            };
            const complete = nextVerification.pendingParameterIds.length === 0;
            if (complete && mismatches.length === 0) {
              setSaveVerificationState(null);
              setOriginalPatchName(nextVerification.expectedPatchName);
              setOriginalValues((current) => ({ ...current, ...nextVerification.expectedValues }));
              setPreviewedDirtyChanges(false);
              setOperationState("saved");
              window.setTimeout(() => setOperationState("idle"), 1700);
              setReadStatus(`Save read-back verified for USER ${nextVerification.slotLabel}.`);
              updateSelectedSlotRecord(selectedPatch, { status: "saved", name: nextVerification.expectedPatchName });
            } else if (complete) {
              setSaveVerificationState(null);
              setOperationState("error");
              window.setTimeout(() => setOperationState("idle"), 1700);
              setReadStatus(`Save read-back mismatch for USER ${nextVerification.slotLabel}: ${mismatches.join("; ")}.`);
              updateSelectedSlotRecord(selectedPatch, { status: "error", name: decodedName, error: mismatches.join("; ") });
            } else {
              setSaveVerificationState(nextVerification);
              setReadStatus(`Save read-back verification pending for USER ${verification.slotLabel}: ${nextVerification.pendingParameterIds.length} parameter response${nextVerification.pendingParameterIds.length === 1 ? "" : "s"} remaining.`);
            }
          }
          return;
        }

        const param = PARAMETERS_BY_ADDRESS.get(readAddressKey);
        if (param && event.checksumValid) {
          const decoded = decodeParameterValue(param, event.valueBytes);
          const previousProgress = mappedReadProgressRef.current;
          const nextProgress =
            previousProgress.status === "reading" || previousProgress.status === "partial"
              ? applyMappedReadResponse(previousProgress, readAddressKey)
              : previousProgress;
          setValues((current) => ({ ...current, [param.id]: decoded }));
          setOriginalValues((current) => ({ ...current, [param.id]: decoded }));
          setDeviceId(event.deviceId);
          setMirrorStatus(`GR-55 ${param.label} = ${formatParameterValue(param, decoded)}`);
          setMappedReadProgress(nextProgress);
          pushHardwareActivity({
            kind: "parameter",
            label: readableParameterName(param),
            detail: `${toHex(event.address)} = ${toHex(event.valueBytes)}`,
          });

          if (nextProgress.status === "complete") {
            clearReadTimeout();
            setPatchLoaded(true);
            setReadStatus(`Mapped read complete for USER ${selectedPatch.label}: ${nextProgress.received}/${nextProgress.expected}.`);
            updateSelectedSlotRecord(selectedPatch, { status: "loaded" });
            if (selection.type === "patch") {
              setSelection({ type: "module", moduleId: param.moduleId });
              setActiveModuleId(param.moduleId);
              setActiveTabId(param.moduleId);
            }
          } else if (nextProgress.status === "reading") {
            setPatchLoaded(false);
            setReadStatus(`Reading mapped parameters: ${nextProgress.received}/${nextProgress.expected}. Last: ${readableParameterName(param)}.`);
          } else {
            setReadStatus(`Mapped read updated ${readableParameterName(param)}.`);
          }

          const verification = saveVerificationRef.current;
          if (verification?.pendingParameterIds.includes(param.id)) {
            const expected = verification.expectedValues[param.id];
            const pendingParameterIds = verification.pendingParameterIds.filter((id) => id !== param.id);
            const mismatches =
              decoded === expected
                ? verification.mismatches
                : [
                    ...verification.mismatches,
                    `${readableParameterName(param)} expected ${formatParameterValue(param, expected)} but read ${formatParameterValue(param, decoded)}`,
                  ];
            const nextVerification = {
              ...verification,
              pendingParameterIds,
              mismatches,
            };
            const complete = !nextVerification.pendingPatchName && pendingParameterIds.length === 0;
            if (complete && mismatches.length === 0) {
              setSaveVerificationState(null);
              setOriginalPatchName(nextVerification.expectedPatchName);
              setOriginalValues((current) => ({ ...current, ...nextVerification.expectedValues }));
              setPreviewedDirtyChanges(false);
              setOperationState("saved");
              window.setTimeout(() => setOperationState("idle"), 1700);
              setReadStatus(`Save read-back verified for USER ${nextVerification.slotLabel}.`);
              updateSelectedSlotRecord(selectedPatch, { status: "saved", name: nextVerification.expectedPatchName });
            } else if (complete) {
              setSaveVerificationState(null);
              setOperationState("error");
              window.setTimeout(() => setOperationState("idle"), 1700);
              setReadStatus(`Save read-back mismatch for USER ${nextVerification.slotLabel}: ${mismatches.join("; ")}.`);
              updateSelectedSlotRecord(selectedPatch, { status: "error", error: mismatches.join("; ") });
            } else {
              setSaveVerificationState(nextVerification);
              setReadStatus(`Save read-back verification pending for USER ${verification.slotLabel}: ${pendingParameterIds.length}${nextVerification.pendingPatchName ? " plus patch name" : ""} remaining.`);
            }
          }
        } else {
          setMirrorStatus(event.checksumValid ? `GR-55 data ${toHex(event.address)}` : "GR-55 data checksum failed");
          pushHardwareActivity({
            kind: "parameter",
            label: event.checksumValid ? "Unmapped Roland data" : "Checksum failed",
            detail: `${toHex(event.address)} ${toHex(event.valueBytes)}`,
          });
        }
        return;
      }

      if (event.type === "identity-reply") {
        setDeviceId(event.deviceId);
        setMirrorStatus(`Roland identity reply, device 0x${event.deviceId.toString(16).toUpperCase()}`);
        setReadStatus(`Identity confirmed device 0x${event.deviceId.toString(16).toUpperCase()}.`);
        pushHardwareActivity({
          kind: "identity",
          label: "Identity reply",
          detail: `Device 0x${event.deviceId.toString(16).toUpperCase()}, Roland 0x${event.manufacturerId.toString(16).toUpperCase()}`,
        });
      }
    },
    [clearReadTimeout, pushHardwareActivity, resetLoadedPatchState, selectedPatch, selection.type, setMappedReadProgress, setSaveVerificationState, slotSelectionConfirmed, updateSelectedSlotRecord],
  );

  const midiOptions = useMemo(() => ({ onIncoming: handleIncoming }), [handleIncoming]);
  const midi = useMidi(midiOptions);
  const usb = useDirectUsb(midiOptions);
  const bridge = useNativeBridge(midiOptions);

  const activeModule = useMemo(
    () => MODULES.find((module) => module.id === activeModuleId) ?? MODULES[0],
    [activeModuleId],
  );
  const sources = SOURCE_DEFINITIONS;
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
  const patchNameDirty = patchName !== originalPatchName;
  const dirtyCount = dirtyParameterIds.length + (patchNameDirty ? 1 : 0);
  const editorValues = compareActive ? originalValues : values;
  const activeStatus = transportMode === "bridge" ? bridge.status : transportMode === "usb" ? usb.status : midi.status;
  const workflowState = getWorkflowState(activeStatus === "ready", slotSelectionConfirmed, patchLoaded, dirtyCount);
  const activeConnectionLabel =
    transportMode === "bridge"
      ? bridge.deviceLabel || "Native bridge"
      : transportMode === "usb"
        ? usb.deviceLabel || "Direct USB"
        : midi.selectedOutput?.name ?? "";
  const combinedLog = useMemo(() => [...bridge.log, ...usb.log, ...midi.log].slice(0, 100), [bridge.log, midi.log, usb.log]);
  const lastLogEntry = combinedLog[0];
  const queueClassification = useMemo(
    () =>
      classifyImportedSysExMessages(importedMessages, {
        knownAddressKeys: KNOWN_IMPORT_ADDRESS_KEYS,
        mappedParameterCount: MAPPED_PARAMETER_COUNT,
      }),
    [importedMessages],
  );

  const setPatchNameDraft = useCallback((nextName: string) => {
    setPatchName(nextName);
    setPatchNameStatus(nextName === originalPatchName ? "loaded" : "dirty");
    if (slotSelectionConfirmed) {
      updateSelectedSlotRecord(selectedPatch, { status: nextName === originalPatchName ? "loaded" : "dirty", name: nextName });
    }
    const validation = validatePatchName(nextName);
    setPatchNameError(validation.valid ? "" : validation.reason ?? "Invalid patch name.");
  }, [originalPatchName, selectedPatch, slotSelectionConfirmed, updateSelectedSlotRecord]);

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

  const requireSelectedSlot = useCallback(
    (action: string) => {
      if (slotSelectionConfirmed) {
        return true;
      }

      const message = `Select a USER slot before ${action}. This prevents reading, exporting, or overwriting the wrong GR-55 patch.`;
      window.alert(message);
      setReadStatus(message);
      return false;
    },
    [slotSelectionConfirmed],
  );

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
      if (dirtyCount > 0 && patch.userIndex !== selectedPatch.userIndex) {
        const discard = window.confirm(
          `Switch to USER ${patch.label}? This discards ${dirtyCount} unsaved mapped ${dirtyCount === 1 ? "change" : "changes"} in the editor.`,
        );
        if (!discard) {
          return;
        }
      }

      setSelectedPatch(patch);
      setSlotSelectionConfirmed(false);
      resetLoadedPatchState();
      setSelection({ type: "patch" });
      const bankSent = sendToRoland(bankSelectMsb(midiChannel, patch.bankMsb), `Bank MSB ${patch.bankMsb}`);
      const programSent = sendToRoland(programChange(midiChannel, patch.program), `Select USER ${patch.label}`);
      const selectionSent = bankSent && programSent;
      setSlotSelectionConfirmed(selectionSent);
      setMirrorStatus(selectionSent ? `Selected USER ${patch.label}` : `USER ${patch.label} selected locally only`);
      setReadStatus(
        selectionSent
          ? `USER ${patch.label} selected. Auto-reading mapped parameters.`
          : `USER ${patch.label} was selected in the UI, but Bank Select / Program Change did not leave the app. Connect the GR-55 route and select it again.`,
      );
      if (selectionSent) {
        updateSelectedSlotRecord(patch, { status: "reading" });
        setAutoReadPatch(patch);
      }
      pushHardwareActivity({
        kind: "program",
        label: selectionSent ? `Select USER ${patch.label}` : `Local target USER ${patch.label}`,
        detail: `Bank MSB ${patch.bankMsb}, PC ${patch.program}`,
      });
    },
    [dirtyCount, midiChannel, pushHardwareActivity, resetLoadedPatchState, selectedPatch.userIndex, sendToRoland, updateSelectedSlotRecord],
  );

  const sendIdentity = useCallback(() => {
    sendToRoland(identityRequest(), "Identity request");
    window.setTimeout(() => {
      sendToRoland(identityRequest(), "Identity retry");
    }, 700);
  }, [sendToRoland]);

  const retryMissingMappedReads = useCallback(
    async (progress: MappedReadProgress) => {
      const missingKeys = progress.expectedKeys.filter((key) => !progress.receivedKeys.includes(key));
      if (!missingKeys.length) {
        return;
      }

      setReadStatus(`Retrying ${missingKeys.length} missing mapped reads for USER ${selectedPatch.label}.`);

      for (const key of missingKeys) {
        const param = PARAMETERS_BY_ADDRESS.get(key);
        if (!param) {
          continue;
        }

        sendToRoland(makeDataRequestMessage(param.address, parameterDataSize(param), deviceId), `Retry read ${param.label}`);
        await delay(MAPPED_READ_RETRY_DELAY_MS);
      }

      window.setTimeout(() => {
        const latest = mappedReadProgressRef.current;
        if (latest.status === "complete") {
          return;
        }

        const partial = markMappedReadPartial(latest);
        setMappedReadProgress(partial);
        setReadStatus(`Mapped read partial for USER ${selectedPatch.label}: ${partial.received}/${partial.expected}. Press Read Patch to retry.`);
      }, 1200);
    },
    [deviceId, selectedPatch.label, sendToRoland, setMappedReadProgress],
  );

  const requestMappedPatch = useCallback(async () => {
    clearReadTimeout();
    if (!requireSelectedSlot("reading mapped parameters")) {
      return;
    }

    showOperationPulse("sending");
    setPatchLoaded(false);
    setPatchName("");
    setOriginalPatchName("");
    setPatchNameStatus("reading");
    setPatchNameError("");
    setSaveVerificationState(null);
    setMappedReadProgress(createMappedReadProgress(MAPPED_PARAMETER_KEYS));
    setValues(createInitialParameterValues());
    setOriginalValues(createInitialParameterValues());
    setUndoStack([]);
    setRedoStack([]);
    setCompareActive(false);
    setPreviewedDirtyChanges(false);
    setSelection({ type: "patch" });
    updateSelectedSlotRecord(selectedPatch, { status: "reading" });
    const readMessages = makeMappedPatchReadMessages(deviceId);
    setReadStatus(`Requesting patch name and ${readMessages.length} mapped temporary-patch parameters from USER ${selectedPatch.label}.`);

    sendToRoland(makePatchNameReadMessage(deviceId), "Read patch name");
    await delay(PATCH_NAME_READ_DELAY_MS);

    for (const message of readMessages) {
      sendToRoland(message.bytes, message.label);
      await delay(MAPPED_READ_SEND_DELAY_MS);
    }

    if (mappedReadProgressRef.current.status === "complete") {
      setReadStatus(
        `Mapped read complete for USER ${selectedPatch.label}: ${mappedReadProgressRef.current.received}/${mappedReadProgressRef.current.expected}.`,
      );
    } else {
      setReadStatus(`Mapped read requests sent for USER ${selectedPatch.label}. Waiting for GR-55 DT1 responses.`);
    }
    readTimeoutRef.current = window.setTimeout(() => {
      const latest = mappedReadProgressRef.current;
      if (latest.status === "reading") {
        void retryMissingMappedReads(latest);
      }
    }, MAPPED_READ_TIMEOUT_MS);
  }, [clearReadTimeout, deviceId, requireSelectedSlot, retryMissingMappedReads, selectedPatch, sendToRoland, setMappedReadProgress, setSaveVerificationState, showOperationPulse, updateSelectedSlotRecord]);

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

      const canSendLive = shouldSend && patchLoaded && activeStatus === "ready";
      const sent = canSendLive
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
        behavior: sent ? "Live Send" : patchLoaded ? "Staged" : "Read first",
        status: sent ? "live" : "pending",
      });
    },
    [activeStatus, deviceId, patchLoaded, liveWrite, sendToRoland, values],
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
      if (!patchLoaded) {
        setReadStatus("Read mapped parameters before sending a module to the GR-55.");
        return;
      }

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
    [deviceId, patchLoaded, sendToRoland, showOperationPulse, values],
  );

  const sendParametersToTemporaryPatch = useCallback(
    async (parameterIds: readonly string[]) => {
      const uniqueIds = [...new Set(parameterIds)];
      if (!uniqueIds.length) {
        return true;
      }

      let allSent = true;
      for (const parameterId of uniqueIds) {
        const param = [...PARAMETERS_BY_ADDRESS.values()].find((candidate) => candidate.id === parameterId);
        if (!param) {
          allSent = false;
          continue;
        }

        const sent = sendToRoland(
          makeParameterMessage(param, values[param.id], deviceId),
          `${moduleShortTitle(param.moduleId)} ${param.label}: ${formatParameterValue(param, values[param.id])}`,
        );

        if (sent) {
          setLastSentByParameter((current) => ({ ...current, [param.id]: new Date().toLocaleTimeString() }));
        } else {
          allSent = false;
        }

        await delay(PARAMETER_WRITE_SEND_DELAY_MS);
      }

      return allSent;
    },
    [deviceId, sendToRoland, values],
  );

  const sendPatchNameToTemporaryPatch = useCallback(async () => {
    if (!patchNameDirty) {
      return true;
    }

    const validation = validatePatchName(patchName);
    if (!validation.valid) {
      setPatchNameError(validation.reason ?? "Invalid patch name.");
      setReadStatus(validation.reason ?? "Patch name is invalid.");
      return false;
    }

    const sent = sendToRoland(makePatchNameWriteMessage(patchName, deviceId), `Patch name: ${patchName || "(blank)"}`);
    await delay(PARAMETER_WRITE_SEND_DELAY_MS);
    return sent;
  }, [deviceId, patchName, patchNameDirty, sendToRoland]);

  const requestModule = useCallback(
    async (module: ModuleDefinition) => {
      showOperationPulse("sending");
      for (const param of module.parameters) {
        sendToRoland(makeDataRequestMessage(param.address, parameterDataSize(param), deviceId), `Read ${param.label}`);
        await delay(MODULE_READ_SEND_DELAY_MS);
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
      const param = sourceFieldParam(source, field);
      if (!param) {
        setReadStatus(`Mapping needed: ${source.label} ${sourceFieldLabel(field)} has no registry parameter.`);
        return;
      }

      const currentValue = values[param.id] ?? param.defaultValue;
      const nextValue = typeof value === "boolean" ? (value ? 1 : 0) : Number(value);
      setParameter(param, nextValue);
      setSelection({ type: "source", sourceId, field });
      setInteractionHud({
        key: `${sourceId}-${field}-${Date.now()}`,
        label: `${source.label} ${sourceFieldLabel(field)}`,
        target: source.block,
        before: formatParameterValue(param, currentValue),
        after: formatParameterValue(param, normalizeParameterValue(param, nextValue)),
        behavior: liveWrite ? "Live Preview" : "Staged",
        status: liveWrite ? "live" : "staged",
      });
    },
    [liveWrite, setParameter, sources, values],
  );

  const inspectSource = useCallback((sourceId: string, field: SourceField = "level") => {
    setSelection({ type: "source", sourceId, field });
  }, []);

  const revertSourceField = useCallback(
    (sourceId: string, field: SourceField) => {
      const source = sources.find((item) => item.id === sourceId);
      const param = source ? sourceFieldParam(source, field) : null;
      if (!source || !param) {
        return;
      }
      setParameter(param, originalValues[param.id] ?? param.defaultValue);
    },
    [originalValues, setParameter, sources],
  );

  const sendSaveToSelectedPatch = useCallback(async () => {
    if (!requireSelectedSlot("saving to a USER slot")) {
      return;
    }

    if (!patchLoaded) {
      window.alert("Read mapped parameters from the selected USER slot before saving. This avoids overwriting a slot from default UI values.");
      return;
    }

    const validation = validatePatchName(patchName);
    if (!validation.valid) {
      setPatchNameError(validation.reason ?? "Invalid patch name.");
      setReadStatus(validation.reason ?? "Patch name is invalid.");
      return;
    }

    if (
      !window.confirm(
        `Overwrite USER ${selectedPatch.label} on the GR-55 with the current temporary patch? This build can export mapped SysEx/JSON but does not implement a full raw GR-55 bulk backup yet.`,
      )
    ) {
      return;
    }

    showOperationPulse("sending");
    const nameFlushed = await sendPatchNameToTemporaryPatch();
    if (!nameFlushed) {
      showOperationPulse("error");
      setReadStatus("Save stopped because the patch name write did not leave the app.");
      return;
    }

    const flushed = await sendParametersToTemporaryPatch(dirtyParameterIds);
    if (!flushed) {
      showOperationPulse("error");
      setReadStatus("Save stopped because one or more mapped parameter writes did not leave the app.");
      return;
    }

    const expectedValues = Object.fromEntries(dirtyParameterIds.map((parameterId) => [parameterId, values[parameterId]]));
    const verification: SaveVerification = {
      slotLabel: selectedPatch.label,
      expectedPatchName: patchName,
      expectedValues,
      pendingPatchName: true,
      pendingParameterIds: [...dirtyParameterIds],
      mismatches: [],
    };

    await delay(dirtyParameterIds.length || patchNameDirty ? 140 : 0);
    const sent = sendToRoland(makeSaveUserPatchMessage(selectedPatch.userIndex, deviceId), `Save temp to USER ${selectedPatch.label}`);
    if (sent) {
      setSaveVerificationState(verification);
      setReadStatus(`Save command sent for USER ${selectedPatch.label}. Reading back patch name and ${dirtyParameterIds.length} changed parameter${dirtyParameterIds.length === 1 ? "" : "s"} for verification.`);
      await delay(420);
      sendToRoland(makePatchNameReadMessage(deviceId), "Verify patch name");
      await delay(SAVE_VERIFY_READ_DELAY_MS);
      for (const parameterId of dirtyParameterIds) {
        const param = PARAMETERS_BY_ID.get(parameterId);
        if (!param) {
          continue;
        }
        sendToRoland(makeDataRequestMessage(param.address, parameterDataSize(param), deviceId), `Verify ${param.label}`);
        await delay(SAVE_VERIFY_READ_DELAY_MS);
      }
      window.setTimeout(() => {
        const pending = saveVerificationRef.current;
        if (!pending || pending.slotLabel !== verification.slotLabel) {
          return;
        }
        const missing = [
          pending.pendingPatchName ? "patch name" : "",
          ...pending.pendingParameterIds,
        ].filter(Boolean);
        setSaveVerificationState(null);
        setOperationState("error");
        window.setTimeout(() => setOperationState("idle"), 1700);
        setReadStatus(`Save read-back timeout for USER ${verification.slotLabel}: no response for ${missing.join(", ")}.`);
        updateSelectedSlotRecord(selectedPatch, { status: "error", name: patchName, error: "read-back timeout" });
      }, 3500 + dirtyParameterIds.length * SAVE_VERIFY_READ_DELAY_MS);
    } else {
      setSaveVerificationState(null);
      showOperationPulse("error");
    }
  }, [deviceId, dirtyParameterIds, patchLoaded, patchName, patchNameDirty, requireSelectedSlot, selectedPatch, sendParametersToTemporaryPatch, sendPatchNameToTemporaryPatch, sendToRoland, setSaveVerificationState, showOperationPulse, updateSelectedSlotRecord, values]);

  const sendPreviewChanges = useCallback(async () => {
    if (!patchLoaded) {
      window.alert("Read mapped parameters from the selected USER slot before sending staged edits.");
      setReadStatus("Staged edits were not sent because the selected slot has not completed a mapped read.");
      return;
    }

    showOperationPulse("sending");
    const nameFlushed = await sendPatchNameToTemporaryPatch();
    if (!nameFlushed) {
      showOperationPulse("error");
      return;
    }

    const flushed = await sendParametersToTemporaryPatch(dirtyParameterIds);
    if (!flushed) {
      showOperationPulse("error");
      return;
    }
    if (dirtyCount > 0) {
      setPreviewedDirtyChanges(true);
      setReadStatus(`${dirtyCount} staged ${dirtyCount === 1 ? "change" : "changes"} sent to temporary memory for preview.`);
    }
  }, [dirtyCount, dirtyParameterIds, patchLoaded, sendParametersToTemporaryPatch, sendPatchNameToTemporaryPatch, showOperationPulse]);

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
    if (!requireSelectedSlot("clearing a USER slot")) {
      return;
    }

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
  }, [clearTemporaryPatch, deviceId, requireSelectedSlot, selectedPatch, sendToRoland, showOperationPulse]);

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

  const applyImportedMappedMessages = useCallback(
    (messages: ImportedSysExMessage[]) => {
      const parsed = parseMappedPatchMessages(messages);
      const mappedCount = parsed.mappedMessages + parsed.patchNameMessages;
      if (!mappedCount) {
        return;
      }

      if (Object.keys(parsed.values).length) {
        setValues((current) => ({ ...current, ...parsed.values }));
        setOriginalValues((current) => ({ ...current, ...parsed.values }));
        setPatchLoaded(true);
      }

      if (parsed.patchName !== undefined) {
        setPatchName(parsed.patchName);
        setOriginalPatchName(parsed.patchName);
        setPatchNameStatus("loaded");
        setPatchNameError("");
        if (slotSelectionConfirmed) {
          updateSelectedSlotRecord(selectedPatch, { status: "loaded", name: parsed.patchName });
        }
      }

      setPreviewedDirtyChanges(false);
      setCompareActive(false);
      setReadStatus(
        `Imported SysEx parsed ${parsed.mappedMessages} mapped parameter${parsed.mappedMessages === 1 ? "" : "s"}${
          parsed.patchName !== undefined ? ` and patch name "${parsed.patchName}"` : ""
        }. ${parsed.checksumErrors ? `${parsed.checksumErrors} checksum error${parsed.checksumErrors === 1 ? "" : "s"} ignored.` : ""}`,
      );
    },
    [selectedPatch, slotSelectionConfirmed, updateSelectedSlotRecord],
  );

  const importFromRawHex = useCallback(() => {
    try {
      const messages = parseImportedSysEx(rawHex).map((message, index) => ({
        ...message,
        label: `Paste ${index + 1}`,
      }));
      setImportedMessages((current) => [...messages, ...current]);
      applyImportedMappedMessages(messages);
      setRawError("");
      setLibraryError("");
    } catch (error) {
      setRawError(error instanceof Error ? error.message : "Invalid SysEx paste.");
    }
  }, [applyImportedMappedMessages, rawHex]);

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
    applyImportedMappedMessages(messages);
    setLibraryError("");
  }, [applyImportedMappedMessages]);

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
      await delay(PARAMETER_WRITE_SEND_DELAY_MS);
    }
  }, [importedMessages, sendToRoland]);

  const sendImportedQueueToSelectedPatch = useCallback(async () => {
    if (!requireSelectedSlot("saving an imported queue to a USER slot")) {
      return;
    }

    if (!importedMessages.length) {
      setLibraryError("Queue is empty.");
      return;
    }

    if (
      !window.confirm(
        `Send ${importedMessages.length} imported SysEx ${importedMessages.length === 1 ? "message" : "messages"} to temporary memory, then overwrite USER ${selectedPatch.label}?`,
      )
    ) {
      return;
    }

    showOperationPulse("sending");
    for (const message of importedMessages) {
      sendToRoland(message.bytes, message.label);
      await delay(PARAMETER_WRITE_SEND_DELAY_MS);
    }

    await delay(160);
    const sent = sendToRoland(makeSaveUserPatchMessage(selectedPatch.userIndex, deviceId), `Save imported queue to USER ${selectedPatch.label}`);
    showOperationPulse(sent ? "saved" : "error");
    setReadStatus(
      sent
        ? `Imported SysEx queue sent to temporary memory and save command sent for USER ${selectedPatch.label}.`
        : "Imported queue was not saved because the save command did not leave the app.",
    );
  }, [deviceId, importedMessages, requireSelectedSlot, selectedPatch, sendToRoland, showOperationPulse]);

  const exportImportedQueue = useCallback(() => {
    if (!importedMessages.length) {
      setLibraryError("Queue is empty.");
      return;
    }

    const url = makeDownloadBlobUrl(importedMessages);
    downloadUrl(url, "gr55-control-room-sysex.txt");
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [importedMessages]);

  const exportMappedPatch = useCallback(() => {
    if (!requireSelectedSlot("exporting a mapped patch")) {
      return;
    }

    if (!patchLoaded) {
      const message = "Read mapped parameters before exporting. Otherwise the file would contain default UI values, not the GR-55 patch.";
      window.alert(message);
      setReadStatus(message);
      return;
    }

    const messages = [
      {
        label: "Patch name",
        bytes: makePatchNameWriteMessage(patchName, deviceId),
      },
      ...MODULES.flatMap((module) =>
        module.parameters.map((param) => ({
          label: `${module.shortTitle} ${param.label}`,
          bytes: makeParameterMessage(param, values[param.id], deviceId),
        })),
      ),
    ];
    const url = makeDownloadBlobUrl(messages);
    downloadUrl(url, `gr55-user-${selectedPatch.label}-mapped-patch.txt`);
    const syxUrl = makeBinarySysExDownloadUrl(messages);
    downloadUrl(syxUrl, `gr55-user-${selectedPatch.label}-mapped-patch.syx`);
    const parsedUrl = makeJsonDownloadUrl({
      kind: "gr55-control-room.mapped-patch",
      exportedAt: new Date().toISOString(),
      slot: {
        label: selectedPatch.label,
        userIndex: selectedPatch.userIndex,
        bankMsb: selectedPatch.bankMsb,
        program: selectedPatch.program,
      },
      patchName,
      hardwareVerification: "mapped-export-only; full raw bulk backup is not implemented",
      parameters: MODULES.flatMap((module) =>
        module.parameters.map((param) => ({
          id: param.id,
          section: param.section,
          displayName: param.displayName,
          value: values[param.id],
          formattedValue: formatParameterValue(param, values[param.id]),
          address: toHex(param.address),
          parser: param.parser,
          serializer: param.serializer,
          hardwareVerificationStatus: param.hardwareVerificationStatus,
        })),
      ),
    });
    downloadUrl(parsedUrl, `gr55-user-${selectedPatch.label}-mapped-patch.json`);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    window.setTimeout(() => URL.revokeObjectURL(syxUrl), 1000);
    window.setTimeout(() => URL.revokeObjectURL(parsedUrl), 1000);
  }, [deviceId, patchLoaded, patchName, requireSelectedSlot, selectedPatch, values]);

  const exportCurrentModule = useCallback(() => {
    if (!patchLoaded) {
      const message = "Read mapped parameters before exporting a module. Otherwise the file would contain default UI values.";
      window.alert(message);
      setReadStatus(message);
      return;
    }

    const messages = activeModule.parameters.map((param) => ({
      label: `${activeModule.shortTitle} ${param.label}`,
      bytes: makeParameterMessage(param, values[param.id], deviceId),
    }));
    const url = makeDownloadBlobUrl(messages);
    downloadUrl(url, `gr55-${activeModule.shortTitle.toLowerCase()}-module.txt`);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [activeModule, deviceId, patchLoaded, values]);

  const copyCurrentModule = useCallback(() => {
    if (!patchLoaded) {
      const message = "Read mapped parameters before copying module SysEx. Otherwise the clipboard would contain default UI values.";
      window.alert(message);
      setReadStatus(message);
      return;
    }

    const messages = activeModule.parameters.map((param) => ({
      label: `${activeModule.shortTitle} ${param.label}`,
      bytes: makeParameterMessage(param, values[param.id], deviceId),
    }));

    void navigator.clipboard?.writeText(serializeMessagesAsHex(messages));
  }, [activeModule, deviceId, patchLoaded, values]);

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

      setReadStatus(`${source.label} has no macro action for "${intent}". Use the mapped GR-55 source controls instead.`);
    },
    [sources],
  );

  const applyModuleIntent = useCallback(
    (moduleId: ParameterModuleId, intent: ModuleIntent) => {
      if (intent !== "reset") {
        return;
      }

      const module = MODULES.find((item) => item.id === moduleId);
      if (!module) {
        return;
      }
      onRevertModule(module, originalValues, setParameter);
    },
    [originalValues, setParameter],
  );

  const commandPaletteCommands = useMemo<CommandPaletteCommand[]>(
    () => [
      {
        id: "read-selected",
        label: "Read selected",
        detail: slotSelectionConfirmed ? `Read mapped parameters from USER ${selectedPatch.label}` : "Select a USER slot first",
        shortcut: "Cmd/Ctrl+R",
        disabled: !slotSelectionConfirmed,
        onRun: () => void requestMappedPatch(),
      },
      {
        id: "send-staged",
        label: "Send Staged",
        detail: dirtyCount ? `Send ${dirtyCount} staged change${dirtyCount === 1 ? "" : "s"} to temporary memory` : "No staged changes",
        disabled: !patchLoaded || dirtyCount === 0,
        onRun: () => void sendPreviewChanges(),
      },
      {
        id: "save-selected",
        label: "Save selected",
        detail: slotSelectionConfirmed ? `Save to USER ${selectedPatch.label} with read-back verification` : "Select and read a USER slot first",
        shortcut: "Cmd/Ctrl+S",
        disabled: !slotSelectionConfirmed || !patchLoaded || dirtyCount === 0,
        onRun: () => void sendSaveToSelectedPatch(),
      },
      {
        id: "connect-bridge",
        label: "Connect bridge",
        detail: "Use the native USB bridge route",
        onRun: () => {
          setTransportMode("bridge");
          bridge.connect();
          bridge.connectUsb();
        },
      },
      {
        id: "reset-usb",
        label: "Reset USB",
        detail: "Ask the bridge to reset the GR-55 USB device",
        onRun: bridge.resetUsb,
      },
      {
        id: "export-mapped",
        label: "Export mapped patch",
        detail: patchLoaded ? "Write mapped .txt, .json and .syx files" : "Read mapped values before export",
        disabled: !slotSelectionConfirmed || !patchLoaded,
        onRun: exportMappedPatch,
      },
      {
        id: "open-sysex",
        label: "Open SysEx utility",
        detail: "Show raw SysEx and import queue tools",
        onRun: () => setUtilityDrawerOpen(true),
      },
      {
        id: "identify",
        label: "Identify GR-55",
        detail: "Send a Roland identity request",
        onRun: sendIdentity,
      },
    ],
    [
      bridge,
      dirtyCount,
      exportMappedPatch,
      patchLoaded,
      requestMappedPatch,
      selectedPatch.label,
      sendIdentity,
      sendPreviewChanges,
      sendSaveToSelectedPatch,
      slotSelectionConfirmed,
    ],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const modifier = event.metaKey || event.ctrlKey;

      if (modifier && key === "k") {
        event.preventDefault();
        setCommandPaletteOpen((current) => !current);
        return;
      }

      if (!modifier) {
        return;
      }

      if (key === "s") {
        event.preventDefault();
        sendSaveToSelectedPatch();
      }
      if (key === "r") {
        event.preventDefault();
        void requestMappedPatch();
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
  }, [redoParameterChange, requestMappedPatch, sendSaveToSelectedPatch, undoParameterChange]);

  useEffect(() => {
    if (dirtyCount === 0 && compareActive) {
      setCompareActive(false);
    }
  }, [compareActive, dirtyCount]);

  useEffect(() => {
    if (transportMode !== "bridge" || bridge.status === "ready" || bridge.status === "pending") {
      return;
    }

    if (!bridge.socketReady || bridge.usbDevices.length === 0 || bridgeAutoUsbAttemptRef.current) {
      return;
    }

    bridgeAutoUsbAttemptRef.current = true;
    bridge.connectUsb();
  }, [bridge, transportMode]);

  useEffect(() => {
    if (activeStatus !== "ready") {
      return;
    }

    const identityKey = `${transportMode}:${activeConnectionLabel || "unknown"}`;
    if (identityRequestKeyRef.current === identityKey) {
      return;
    }

    identityRequestKeyRef.current = identityKey;
    const timer = window.setTimeout(() => sendIdentity(), 180);
    return () => window.clearTimeout(timer);
  }, [activeConnectionLabel, activeStatus, sendIdentity, transportMode]);

  useEffect(() => {
    if (!autoReadPatch || activeStatus !== "ready" || autoReadPatch.userIndex !== selectedPatch.userIndex) {
      return;
    }

    const patch = autoReadPatch;
    const timer = window.setTimeout(() => {
      if (patch.userIndex === selectedPatch.userIndex) {
        setAutoReadPatch((current) => (current?.userIndex === patch.userIndex ? null : current));
        void requestMappedPatch();
      }
    }, PATCH_SELECT_SETTLE_MS);

    return () => window.clearTimeout(timer);
  }, [activeStatus, autoReadPatch, requestMappedPatch, selectedPatch.userIndex]);

  useEffect(() => clearReadTimeout, [clearReadTimeout]);

  return (
    <main className="mac-window" aria-label="Roland GR-55 patch editor">
      <StudioToolbar
        status={activeStatus}
        outputName={activeConnectionLabel}
        selectedPatch={selectedPatch}
        patchName={patchName}
        slotSelectionConfirmed={slotSelectionConfirmed}
        dirtyCount={dirtyCount}
        patchLoaded={patchLoaded}
        operationState={operationState}
        liveWrite={liveWrite}
        commandPaletteOpen={commandPaletteOpen}
        onCommandPaletteOpenChange={setCommandPaletteOpen}
        commands={commandPaletteCommands}
        onReadPatch={() => void requestMappedPatch()}
        onSendChanges={sendPreviewChanges}
        onSavePatch={sendSaveToSelectedPatch}
        onLiveWriteChange={setLiveWrite}
        onFocusSearch={() => patchSearchRef.current?.focus()}
      />

      <section className="workspace-grid" aria-label="GR-55 editor workspace">
        <aside className="sidebar-pane" aria-label="Device and patch library">
          <PatchManager
            searchRef={patchSearchRef}
            selectedPatch={selectedPatch}
            slotSelectionConfirmed={slotSelectionConfirmed}
            patchLoaded={patchLoaded}
            readStatus={readStatus}
            dirtyCount={dirtyCount}
            patchName={patchName}
            patchNameDirty={patchNameDirty}
            patchSlots={patchSlots}
            onSelectPatch={selectPatch}
            onReadPatch={() => void requestMappedPatch()}
            onSavePatch={() => void sendSaveToSelectedPatch()}
            onClearSelectedPatch={clearSelectedUserPatch}
            onExportMappedPatch={exportMappedPatch}
            onOpenImport={() => setUtilityDrawerOpen(true)}
          />

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

          <QuickMonitor
            mirrorStatus={mirrorStatus}
            lastLogEntry={lastLogEntry}
            bridgeStatus={bridge.status}
            usbStatus={usb.status}
            midiStatus={midi.status}
            hardwareActivity={hardwareActivity}
          />
        </aside>

        <section className="editor-pane" aria-label="Patch editor">
          <PatchIdentity
            selectedPatch={selectedPatch}
            slotSelectionConfirmed={slotSelectionConfirmed}
            dirtyCount={dirtyCount}
            operationState={operationState}
            patchLoaded={patchLoaded}
            readStatus={readStatus}
            patchName={patchName}
            patchNameDirty={patchNameDirty}
            patchNameStatus={patchNameStatus}
            patchNameError={patchNameError}
            onPatchNameChange={setPatchNameDraft}
          />

          <ModuleTabs tabs={EDITOR_TABS} activeTabId={activeTabId} values={editorValues} onSelect={handleTabChange} />

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
            values={editorValues}
            originalValues={originalValues}
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

          {activeTabId === "strings" ? (
            <StringMatrix
              values={editorValues}
              originalValues={originalValues}
              onChange={setParameter}
            />
          ) : activeTabId === "tones" || activeTabId === "pedal" || activeTabId === "assigns" || activeTabId === "sysex" || activeTabId === "system" ? (
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
        queueClassification={queueClassification}
        libraryError={libraryError}
        onLibraryError={setLibraryError}
        onAddMessages={addImportedMessages}
        onSendMessage={sendImportedMessage}
        onSendQueue={() => void sendImportedQueue()}
        onSendQueueToPatch={() => void sendImportedQueueToSelectedPatch()}
        onDeleteMessage={deleteImportedMessage}
        onClearQueue={clearImportedQueue}
        onExportQueue={exportImportedQueue}
      />
    </main>
  );
}

function SegmentedButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={active ? "is-active" : ""} onClick={onClick} aria-pressed={active}>
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

function QuickMonitor({
  mirrorStatus,
  lastLogEntry,
  bridgeStatus,
  usbStatus,
  midiStatus,
  hardwareActivity,
}: {
  mirrorStatus: string;
  lastLogEntry: ReturnType<typeof useMidi>["log"][number] | undefined;
  bridgeStatus: string;
  usbStatus: string;
  midiStatus: string;
  hardwareActivity: HardwareActivity[];
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
      <div className="hardware-activity-list" aria-label="Recent hardware activity">
        {hardwareActivity.length ? (
          hardwareActivity.slice(0, 4).map((activity) => (
            <div key={activity.id}>
              <span>{activity.at}</span>
              <strong>{activity.label}</strong>
              <small>{activity.detail}</small>
            </div>
          ))
        ) : (
          <p>No hardware input decoded yet.</p>
        )}
      </div>
    </details>
  );
}

function PatchIdentity({
  selectedPatch,
  slotSelectionConfirmed,
  dirtyCount,
  operationState,
  patchLoaded,
  readStatus,
  patchName,
  patchNameDirty,
  patchNameStatus,
  patchNameError,
  onPatchNameChange,
}: {
  selectedPatch: UserPatch;
  slotSelectionConfirmed: boolean;
  dirtyCount: number;
  operationState: OperationState;
  patchLoaded: boolean;
  readStatus: string;
  patchName: string;
  patchNameDirty: boolean;
  patchNameStatus: PatchSlotState;
  patchNameError: string;
  onPatchNameChange: (name: string) => void;
}) {
  return (
    <section className="patch-identity" aria-labelledby="patch-identity-title">
      <div className="patch-title-group">
        <span>{slotSelectionConfirmed ? (patchLoaded ? "Mapped values received" : "Selected slot") : "Select a USER slot"}</span>
        <h1 id="patch-identity-title">{slotSelectionConfirmed ? `USER ${selectedPatch.label}` : "No USER slot selected"}</h1>
        <p>{readStatus}</p>
      </div>
      <div className="patch-name-block">
        <label htmlFor="patch-name">Patch name</label>
        <input
          id="patch-name"
          value={patchName}
          maxLength={16}
          disabled={!slotSelectionConfirmed || !patchLoaded}
          aria-invalid={Boolean(patchNameError)}
          aria-describedby="patch-name-help"
          onChange={(event) => onPatchNameChange(event.target.value)}
        />
        <small id="patch-name-help">
          {patchNameError || (patchNameDirty ? "Staged rename. Use Preview to send temporary memory, Save to commit." : `Patch name ${patchNameStatus}.`)}
        </small>
      </div>
      <div className="patch-save-state">
        {patchLoaded && !dirtyCount ? <CheckCircle size={17} aria-hidden="true" /> : <WarningCircle size={17} aria-hidden="true" />}
        <span>{!patchLoaded ? "Read required" : dirtyCount ? `${dirtyCount} staged changes` : operationState === "saved" ? "Read-back verified" : "No staged changes"}</span>
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
          <p>Sources and effects shown here are backed by mapped temporary-patch parameters; fixture-only badges mean write behavior has not been individually hardware-verified.</p>
        </div>
        <span>{MODULES.flatMap((module) => module.parameters).length} mapped controls</span>
      </div>
      <div className="patch-map">
        <div className="patch-map-sources" aria-label="Sound sources">
          {sources.map((source) => {
            const selected = selection.type === "source" && selection.sourceId === source.id;
            const active = sourceIsOn(source, values);
            return (
              <button
                key={source.id}
                type="button"
                className={`patch-source-node ${active ? "is-active" : "is-muted"} ${selected ? "is-selected" : ""}`}
                onClick={() => onSelectSource(source.id)}
                aria-pressed={selected}
              >
                <span>{source.block}</span>
                <strong>{sourceSummary(source, values)}</strong>
                <small>{active ? "mapped source" : "off"}</small>
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
  values,
  originalValues,
  selection,
  hud,
  onChange,
  onInspect,
}: {
  sources: SourceDefinition[];
  values: ParameterValues;
  originalValues: ParameterValues;
  selection: Selection;
  hud: InteractionHud | null;
  onChange: (sourceId: string, field: SourceField, value: boolean | number | string) => void;
  onInspect: (sourceId: string, field?: SourceField) => void;
}) {
  return (
    <section className="source-mixer" aria-labelledby="source-mixer-title">
      <SectionHeader id="source-mixer-title" title="Sound sources" icon={<FadersHorizontal size={16} aria-hidden="true" />} />
      <p className="mapping-note">PCM, modeling and normal pickup controls below are wired to temporary-patch SysEx addresses. USER 73-3 read verification passed; fixture-only badges mark controls that still need individual write verification.</p>
      <div className="source-grid">
        {sources.map((source) => {
          const sourceSelected = selection.type === "source" && selection.sourceId === source.id;
          const enabled = sourceIsOn(source, values);
          const keyFields = sourceFields(source).filter(({ field }) => ["enabled", "tone", "routing", "level", "pan"].includes(field)).slice(0, 4);
          return (
            <article key={source.id} className={`source-strip ${enabled ? "is-enabled" : "is-disabled"} ${sourceSelected ? "is-selected" : ""}`}>
              <div className="source-strip-header">
                <div>
                  <strong>{source.label}</strong>
                  <span>{sourceSummary(source, values)}</span>
                </div>
                <button type="button" className="source-edit-button" onClick={() => onInspect(source.id, source.primaryField)}>
                  Edit
                </button>
              </div>
              <div className="source-role">
                <span>{source.role}</span>
                <small>{enabled ? "in patch" : "off"}</small>
              </div>
              <div className="source-param-stack">
                {keyFields.map(({ field, param }) => (
                  <SourceMappedControl
                    key={field}
                    source={source}
                    field={field}
                    param={param}
                    value={values[param.id] ?? param.defaultValue}
                    originalValue={originalValues[param.id] ?? param.defaultValue}
                    selected={selection.type === "source" && selection.sourceId === source.id && selection.field === field}
                    hud={hud}
                    onChange={onChange}
                    onInspect={onInspect}
                  />
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SourceMappedControl({
  source,
  field,
  param,
  value,
  originalValue,
  selected,
  hud,
  onChange,
  onInspect,
}: {
  source: SourceDefinition;
  field: SourceField;
  param: ParameterDefinition;
  value: number;
  originalValue: number;
  selected: boolean;
  hud: InteractionHud | null;
  onChange: (sourceId: string, field: SourceField, value: boolean | number | string) => void;
  onInspect: (sourceId: string, field?: SourceField) => void;
}) {
  const dirty = value !== originalValue;

  let control: React.ReactNode;
  if (param.kind === "toggle") {
    const checked = value > 0;
    control = (
      <button type="button" className={`toggle-button ${checked ? "is-on" : ""}`} onClick={() => onChange(source.id, field, checked ? 0 : 1)} aria-pressed={checked}>
        <span aria-hidden="true" />
        {checked ? "ON" : "OFF"}
      </button>
    );
  } else if (param.kind === "select") {
    control = (
      <select value={value} onChange={(event) => onChange(source.id, field, Number(event.target.value))} onFocus={() => onInspect(source.id, field)} aria-label={`${source.label} ${sourceFieldLabel(field)}`}>
        {param.options?.map((option, index) => (
          <option key={option} value={index}>{option}</option>
        ))}
      </select>
    );
  } else {
    control = (
      <div className="slider-row">
        <input
          type="range"
          min={param.min}
          max={param.max}
          step={param.step}
          value={value}
          aria-label={`${source.label} ${sourceFieldLabel(field)}`}
          onFocus={() => onInspect(source.id, field)}
          onChange={(event) => onChange(source.id, field, Number(event.target.value))}
        />
        <output>{formatParameterValue(param, value)}</output>
      </div>
    );
  }

  return (
    <div className={`compact-slider ${selected ? "is-selected" : ""} ${dirty ? "is-dirty" : ""}`}>
      <div className="slider-label-row">
        <span>{sourceFieldLabel(field)}</span>
        {dirty ? <em className="dirty-badge">Staged</em> : null}
      </div>
      {control}
      <small>{param.hardwareVerificationStatus === "verified" ? "verified" : "fixture-only"}</small>
      {selected && hud ? <ValueHud hud={hud} /> : null}
    </div>
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
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  selected: boolean;
  hud: InteractionHud | null;
  disabled?: boolean;
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
          disabled={disabled}
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
    const sourceModule = MODULES.find((module) => module.id === selectedSource.moduleId);
    if (sourceModule) {
      return (
        <FocusedModuleEditor
          module={sourceModule}
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
  const controls = moduleIntentControls(module, values);
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
  statusLabel,
}: {
  headingId: string;
  eyebrow: string;
  title: string;
  detail: string;
  enabled: boolean;
  statusLabel?: string;
}) {
  const label = statusLabel ?? (enabled ? "On" : "Off");
  return (
    <div className="focused-header">
      <div>
        <span>{eyebrow}</span>
        <h2 id={headingId}>{title}</h2>
        <p>{detail}</p>
      </div>
      <strong className={enabled ? "is-on" : "is-off"}>{label}</strong>
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
  tabs: EditorTabDefinition[];
  activeTabId: EditorTabId;
  values: ParameterValues;
  onSelect: (tabId: EditorTabId) => void;
}) {
  const groups = EDITOR_TAB_GROUP_ORDER.map((groupId) => ({
    id: groupId,
    label: EDITOR_TAB_GROUP_LABELS[groupId],
    tabs: tabs.filter((tab) => tab.group === groupId),
  })).filter((group) => group.tabs.length > 0);

  return (
    <nav className="module-tabs" aria-label="Patch modules">
      {groups.map((group) => (
        <div className="module-tab-group" key={group.id}>
          <span className="module-tab-group-label">{group.label}</span>
          <div className="module-tab-buttons">
            {group.tabs.map((tab) => {
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
          </div>
        </div>
      ))}
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
  const visibleParameters = module.parameters.filter((param) => dependenciesSatisfied(param, values));
  const switchParam = visibleParameters.find((param) => param.kind === "toggle");
  const typeParam = visibleParameters.find((param) => param.kind === "select");
  const mainParameters = visibleParameters.filter((param) => param !== switchParam && param !== typeParam);
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
            <span>{tabId === "pedal" ? "Mapped CC" : "Mapping needed"}</span>
            <h2 id="pedal-panel-title">Pedal, GK and assigns</h2>
          </div>
          <button type="button" onClick={onReadModule}>Read current module</button>
        </div>
        <PerformancePanel controls={controls} values={performanceValues} onChange={onPerformanceChange} />
        {tabId === "assigns" ? (
          <details className="mapping-needed" open>
            <summary>Developer mapping needed</summary>
            <ul>
              {UNMAPPED_PARAMETER_TODOS.filter((todo) => todo.section === "assigns").map((todo) => (
                <li key={todo.id}>{todo.displayName}: {todo.reason}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    );
  }

  if (tabId === "tones") {
    return (
      <section className="module-editor special-panel" aria-labelledby="tones-panel-title">
        <div className="module-header">
          <div>
            <span>Mapped source blocks</span>
            <h2 id="tones-panel-title">Tones and pickup sources</h2>
          </div>
        </div>
        <p className="mapping-note">This table is generated from the same parameter registry used for read/write/export. Fixture-only means the address is mapped from reference material but still needs USER 73-3 hardware verification.</p>
        <div className="source-summary-table">
          {sources.map((source) => {
            const levelParam = sourceFieldParam(source, "level");
            const panParam = sourceFieldParam(source, "pan");
            return (
              <div key={source.id}>
                <strong>{source.label}</strong>
                <span>{sourceIsOn(source, values) ? "On" : "Off"}</span>
                <span>{sourceSummary(source, values)}</span>
                <span>{levelParam ? formatParameterValue(levelParam, values[levelParam.id]) : "n/a"}</span>
                <span>{panParam ? formatParameterValue(panParam, values[panParam.id]) : "n/a"}</span>
              </div>
            );
          })}
        </div>
        <details className="mapping-needed">
          <summary>Developer mapping needed</summary>
          <p>Per-source fields that do not appear in this table are absent from the verified registry and have no SysEx controls in the UI.</p>
        </details>
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
        <OverviewTile label="Patch level" value={formatPlainValue(values.patchLevel, "%")} detail="Mapped temporary parameter" />
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

function InspectorIntentAction({
  title,
  detail,
  disabled,
  onClick,
}: {
  title: string;
  detail: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="inspector-intent-action" disabled={disabled} onClick={onClick}>
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
  const sourceParam = selectedSource && sourceField ? sourceFieldParam(selectedSource, sourceField) : null;
  const sourceCurrentValue = sourceParam ? values[sourceParam.id] ?? sourceParam.defaultValue : undefined;
  const sourceOriginalValue = sourceParam ? originalValues[sourceParam.id] ?? sourceParam.defaultValue : undefined;
  const sourceDirty = Boolean(sourceParam && sourceCurrentValue !== sourceOriginalValue);
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
            <InspectorRow label="Send behavior" value={liveWrite ? "Live Preview sends while editing" : "Staged until Send Staged"} />
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
            <p>{sourceParam ? parameterSoundImpact(sourceParam) : `Mapping needed: ${sourceFieldLabel(sourceField)} has no registry parameter for this source.`}</p>
            <p>{sourceParam ? parameterInspectorDetail(sourceParam, liveWrite) : "No MIDI/SysEx is sent for unmapped source fields."}</p>
            <button type="button" disabled={!sourceDirty || !sourceParam} onClick={() => onRevertSource(selectedSource.id, sourceField)}>
              <ArrowCounterClockwise size={15} aria-hidden="true" />
              Revert
            </button>
          </div>
          <dl className="inspector-dl">
            <InspectorRow label="Block" value={selectedSource.block} />
            <InspectorRow label="Field" value={sourceFieldLabel(sourceField)} />
            <InspectorRow label="Current value" value={sourceParam ? formatParameterValue(sourceParam, sourceCurrentValue ?? sourceParam.defaultValue) : "unmapped"} />
            <InspectorRow label="Before / after" value={sourceParam && sourceDirty ? `${formatParameterValue(sourceParam, sourceOriginalValue ?? sourceParam.defaultValue)} to ${formatParameterValue(sourceParam, sourceCurrentValue ?? sourceParam.defaultValue)}` : "Unchanged"} />
            <InspectorRow label="Range / unit" value={sourceParam ? formatParameterRange(sourceParam) : "unmapped"} />
            <InspectorRow label="Verification" value={sourceParam?.hardwareVerificationStatus ?? "unmapped"} />
            <InspectorRow label="Send behavior" value={sourceParam ? (liveWrite ? "Live Preview sends temporary DT1 while editing" : "Staged until Send Staged") : "Unmapped. No MIDI/SysEx is sent."} />
            <InspectorRow label="Save behavior" value={sourceParam ? `Included in save/read-back workflow for USER ${selectedPatch.label}.` : "Not saved. Requires a confirmed GR-55 source address map."} />
          </dl>
          {sourceParam ? (
            <details className="inspector-advanced">
              <summary>Advanced SysEx</summary>
              <dl className="inspector-dl">
                <InspectorRow label="Address" value={toHex(sourceParam.address)} code />
                <InspectorRow label="Data size" value={parameterDataSizeLabel(sourceParam)} />
                <InspectorRow label="Parser" value={sourceParam.parser} />
                <InspectorRow label="Source" value={sourceParam.source ?? "local registry"} />
              </dl>
            </details>
          ) : null}
        </>
      ) : selectedModule ? (
        <>
          <div className="inspector-explain">
            <strong>{selectedModule.title}</strong>
            <p>{moduleIntentSummary(selectedModule)}</p>
            <p>{liveWrite ? "Simple controls send mapped GR-55 parameters while you move them." : "Simple controls are staged until Send Staged."}</p>
            <button type="button" onClick={() => onModuleIntent(selectedModule.id, "reset")}>
              <ArrowCounterClockwise size={15} aria-hidden="true" />
              Revert block
            </button>
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
              <dd>{patchLoaded ? `USER ${selectedPatch.label} mapped values received` : "Not loaded"}</dd>
            </div>
            <div>
              <dt>Edit</dt>
              <dd>Click a sound source or effect block</dd>
            </div>
            <div>
              <dt>Preview</dt>
              <dd>{liveWrite ? "Live Preview is available" : "Staged edits use Send Staged"}</dd>
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
  queueClassification,
  libraryError,
  onLibraryError,
  onAddMessages,
  onSendMessage,
  onSendQueue,
  onSendQueueToPatch,
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
  queueClassification: SysExQueueClassification;
  libraryError: string;
  onLibraryError: (value: string) => void;
  onAddMessages: (messages: ImportedSysExMessage[]) => void;
  onSendMessage: (message: ImportedSysExMessage) => void;
  onSendQueue: () => void;
  onSendQueueToPatch: () => void;
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
          queueClassification={queueClassification}
          error={libraryError}
          onError={onLibraryError}
          onAddMessages={onAddMessages}
          onSendMessage={onSendMessage}
          onSendQueue={onSendQueue}
          onSendQueueToPatch={onSendQueueToPatch}
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
  queueClassification,
  error,
  onError,
  onAddMessages,
  onSendMessage,
  onSendQueue,
  onSendQueueToPatch,
  onDeleteMessage,
  onClearQueue,
  onExportQueue,
}: {
  messages: ImportedSysExMessage[];
  queueClassification: SysExQueueClassification;
  error: string;
  onError: (value: string) => void;
  onAddMessages: (messages: ImportedSysExMessage[]) => void;
  onSendMessage: (message: ImportedSysExMessage) => void;
  onSendQueue: () => void;
  onSendQueueToPatch: () => void;
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
        const bytes = new Uint8Array(await file.arrayBuffer());
        const input = isTextImport(file.name) || looksLikeTextSysEx(bytes)
          ? new TextDecoder().decode(bytes)
          : bytes;
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
      <SectionHeader id="sysex-library-title" title="Raw SysEx Import Queue" icon={<FileArrowUp size={16} aria-hidden="true" />} aside={`${messages.length}`} />
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
        <button type="button" onClick={onSendQueue} disabled={!messages.length}>Send to temp</button>
        <button type="button" onClick={onSendQueueToPatch} disabled={!messages.length}>Temp then save</button>
        <button type="button" onClick={onExportQueue} disabled={!messages.length}>Export raw queue</button>
        <button type="button" onClick={onClearQueue} disabled={!messages.length}>Clear</button>
      </div>
      <div className={`queue-classification queue-${queueClassification.kind}`}>
        <strong>{queueClassification.label}</strong>
        <span>{queueClassification.detail}</span>
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

  if (param.type === "toneNumber") {
    return formatPcmToneNumber(current);
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
  const previewMode = liveWrite ? "Live Preview sends the temporary patch value as you change it." : "Staged mode holds the value until Send Staged.";
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

function sourceFields(source: SourceDefinition) {
  return Object.entries(source.fields)
    .map(([field, parameterId]) => {
      const param = parameterId ? PARAMETERS_BY_ID.get(parameterId) ?? null : null;
      return param ? { field: field as SourceField, param } : null;
    })
    .filter((item): item is { field: SourceField; param: ParameterDefinition } => Boolean(item));
}

function sourceFieldParam(source: SourceDefinition, field: SourceField) {
  const parameterId = source.fields[field];
  return parameterId ? PARAMETERS_BY_ID.get(parameterId) ?? null : null;
}

function sourceIsOn(source: SourceDefinition, values: ParameterValues) {
  const param = sourceFieldParam(source, "enabled");
  return param ? (values[param.id] ?? param.defaultValue) > 0 : false;
}

function sourceSummary(source: SourceDefinition, values: ParameterValues) {
  const toneParam = sourceFieldParam(source, "tone");
  const routingParam = sourceFieldParam(source, "routing");
  const primaryParam = toneParam ?? routingParam ?? sourceFieldParam(source, source.primaryField);
  return primaryParam ? formatParameterValue(primaryParam, values[primaryParam.id] ?? primaryParam.defaultValue) : "unmapped";
}

function formatPcmToneNumber(value: number) {
  const toneNumber = clamp(Math.round(value), 1, 910);
  const category = PCM_TONE_CATEGORIES.find((item) => toneNumber >= item.first && toneNumber <= item.last);
  return category ? `Tone ${toneNumber} (${category.name})` : `Tone ${toneNumber}`;
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

function moduleIntentControls(module: ModuleDefinition, values?: ParameterValues) {
  const byId = new Map(module.parameters.map((param) => [param.id, param]));
  const modelingCategory = values?.modelingCategory ?? 0;
  const activeModelingTypeId =
    modelingCategory === 1
      ? "modelingAcousticType"
      : modelingCategory === 2
        ? "modelingBassType"
        : modelingCategory === 3
          ? "modelingSynthType"
          : "modelingElectricGuitarType";
  const pick = (id: string, label: string, hint: string) => {
    const param = byId.get(id);
    return param ? { param, label, hint } : null;
  };

  const controls =
    module.id === "modeling"
      ? [
          pick("modelingSwitch", "Modeling on/off", "Put the modeled tone in or out of the patch."),
          pick("modelingCategory", "Modeling category", "Choose E.GTR, acoustic, bass, or synth before selecting the model."),
          pick(activeModelingTypeId, "Active model", "Only the selector for the current modeling category is shown."),
          pick("modelingLevel", "Modeling level", "Balances the modeled tone against PCM and normal pickup sources."),
          pick("modelingPitchShift", "Pitch shift", "Moves the modeled tone in semitone steps."),
          pick("modelingFineShift", "Fine shift", "Fine tune the modeled tone in cents."),
        ]
      : module.id === "amp"
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
              pick("reverbHighCut", "High-cut frequency", "Selects the reverb tail low-pass cutoff."),
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
                    pick("eqLevel", "EQ level", "Trims the final EQ block output."),
                  ]
                : module.parameters.slice(0, 5).map((param) => ({
                    param,
                    label: param.label,
                    hint: parameterDescription(param),
                  }));

  return controls.filter((item): item is { param: ParameterDefinition; label: string; hint: string } => Boolean(item));
}

function modulePrimaryValue(module: ModuleDefinition, values: ParameterValues) {
  const controls = moduleIntentControls(module, values);
  const param = controls.find((item) => item.param.kind === "slider")?.param ?? controls[0]?.param;
  return param ? `${controls.find((item) => item.param === param)?.label ?? param.label}: ${formatParameterValue(param, values[param.id])}` : "No mapped control";
}

function dependenciesSatisfied(param: ParameterDefinition, values: ParameterValues) {
  return param.dependencies.every((dependency) => {
    const current = values[dependency.parameterId];
    return Array.isArray(dependency.equals)
      ? dependency.equals.includes(current)
      : current === dependency.equals;
  });
}

function moduleBeforeAfter(module: ModuleDefinition, values: ParameterValues, originalValues: ParameterValues) {
  const changed = module.parameters.find((param) => values[param.id] !== originalValues[param.id]);
  if (!changed) {
    return "Unchanged";
  }
  return `${readableParameterName(changed)}: ${formatParameterValue(changed, originalValues[changed.id])} to ${formatParameterValue(changed, values[changed.id])}`;
}

function getWorkflowState(isConnected: boolean, slotSelectionConfirmed: boolean, patchLoaded: boolean, dirtyCount: number): WorkflowState {
  if (!isConnected) {
    return "disconnected";
  }
  if (!slotSelectionConfirmed) {
    return "select-slot";
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
  if (workflowState === "select-slot") {
    return "Select a USER slot";
  }
  if (workflowState === "ready-to-read") {
    return "Read the current GR-55 patch";
  }
  if (workflowState === "dirty") {
    return "Save when ready";
  }
  if (operationState === "saved") {
    return "Save verified. Keep editing or choose another patch";
  }
  return "Choose what to edit";
}

function nextActionKicker(workflowState: WorkflowState, selectedPatch: UserPatch, patchLoaded: boolean) {
  if (workflowState === "disconnected") {
    return "GR-55 is not connected";
  }
  if (workflowState === "select-slot") {
    return "No USER slot selected";
  }
  if (!patchLoaded) {
    return "No temporary patch has been read";
  }
  return `Mapped values received for USER ${selectedPatch.label}`;
}

function nextActionBody(workflowState: WorkflowState, liveWrite: boolean, dirtyCount: number) {
  if (workflowState === "disconnected") {
    return "Connect the hardware from the toolbar. The editor will keep the patch view quiet until a route is ready.";
  }
  if (workflowState === "select-slot") {
    return "Choose a USER slot first. The app will send Bank Select and Program Change before any mapped read/export/save workflow.";
  }
  if (workflowState === "ready-to-read") {
    return "Read Patch pulls the current temporary patch into the editor before you make changes.";
  }
  if (workflowState === "dirty") {
    return `${dirtyCount} unsaved ${dirtyCount === 1 ? "change" : "changes"} can be previewed, compared, reverted, or saved to the selected USER slot.`;
  }
  return liveWrite
    ? "Click a source or effect block. Live Preview is on, so mapped changes are heard as you move them."
    : "Click a source or effect block. Changes are staged until you use Send Staged.";
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
    case "octave":
      return "Octave";
    case "routing":
      return "Routing";
    case "coarseTune":
      return "Coarse tune";
    case "fineTune":
      return "Fine tune";
    case "cutoff":
      return "Cutoff";
    case "resonance":
      return "Resonance";
    case "attack":
      return "Attack";
    case "release":
      return "Release";
  }
}

function formatSourceValue(field: SourceField, value: unknown) {
  if (field === "enabled") {
    return value ? "ON" : "OFF";
  }
  if (field === "level") {
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

function makeJsonDownloadUrl(data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  return URL.createObjectURL(blob);
}

function makeBinarySysExDownloadUrl(messages: readonly ImportedSysExMessage[]) {
  const bytes = Uint8Array.from(messages.flatMap((message) => message.bytes));
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  return URL.createObjectURL(blob);
}

function isTextImport(name: string) {
  const lower = name.toLowerCase();
  return lower.endsWith(".txt") || lower.endsWith(".hex");
}

function looksLikeTextSysEx(bytes: Uint8Array) {
  const sample = bytes.slice(0, Math.min(bytes.length, 512));
  if (!sample.length) {
    return false;
  }

  const textish = Array.from(sample).every((byte) => byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e));
  if (!textish) {
    return false;
  }

  const text = new TextDecoder().decode(sample).toUpperCase();
  return text.includes("F0") && text.includes("F7");
}
