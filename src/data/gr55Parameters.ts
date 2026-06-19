import { addressKey } from "../lib/midiMessages";
import { clamp, encodeByte, encodeSplit12, encodeSplit8, makeDataSetMessage } from "../lib/roland";

export type ParameterModuleId =
  | "common"
  | "mfx"
  | "chorus"
  | "delay"
  | "reverb"
  | "eq"
  | "amp"
  | "mod"
  | "noise";

export type ParameterKind = "toggle" | "slider" | "select";

export type ParameterDefinition = {
  id: string;
  moduleId: ParameterModuleId;
  label: string;
  kind: ParameterKind;
  address: readonly [number, number, number, number];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  defaultValue: number;
  options?: readonly string[];
  encoder:
    | "boolean"
    | "byte"
    | "split8"
    | "split12"
    | "gain20"
    | "reverbTime"
    | "signedByteOffset3";
};

export type ModuleDefinition = {
  id: ParameterModuleId;
  title: string;
  shortTitle: string;
  tone: string;
  parameters: ParameterDefinition[];
};

const A = {
  common: (offset: number) => [0x18, 0x00, (offset >> 8) & 0x7f, offset & 0x7f] as const,
  sends: (offset: number) => [0x18, 0x00, 0x06, offset] as const,
  ampMod: (offset: number) => [0x18, 0x00, 0x07, offset] as const,
  mfx: (offset: number) => [0x18, 0x00, 0x03, offset] as const,
};

const boolOptions = ["OFF", "ON"] as const;

export const MODULES: ModuleDefinition[] = [
  {
    id: "common",
    title: "Patch Core",
    shortTitle: "PATCH",
    tone: "steel",
    parameters: [
      {
        id: "patchLevel",
        moduleId: "common",
        label: "Patch Level",
        kind: "slider",
        address: A.common(0x0230),
        min: 0,
        max: 100,
        step: 1,
        unit: "%",
        defaultValue: 70,
        encoder: "split8",
      },
      {
        id: "patchTempo",
        moduleId: "common",
        label: "Patch Tempo",
        kind: "slider",
        address: A.common(0x023c),
        min: 20,
        max: 250,
        step: 1,
        unit: "BPM",
        defaultValue: 120,
        encoder: "split8",
      },
      {
        id: "effectStructure",
        moduleId: "common",
        label: "Effect Structure",
        kind: "select",
        address: A.common(0x022c),
        options: ["1", "2"],
        defaultValue: 0,
        encoder: "byte",
      },
    ],
  },
  {
    id: "amp",
    title: "Amp / Cabinet",
    shortTitle: "AMP",
    tone: "amber",
    parameters: [
      {
        id: "ampSwitch",
        moduleId: "amp",
        label: "Amp Switch",
        kind: "toggle",
        address: A.ampMod(0x00),
        options: boolOptions,
        defaultValue: 1,
        encoder: "boolean",
      },
      {
        id: "ampType",
        moduleId: "amp",
        label: "Amp Type",
        kind: "select",
        address: A.ampMod(0x01),
        options: [
          "BOSS CLEAN",
          "JC-120",
          "JAZZ COMBO",
          "FULL RANGE",
          "CLEAN TWIN",
          "PRO CRUNCH",
          "TWEED",
          "DELUX CRUNCH",
          "BOSS CRUNCH",
          "BLUES",
          "WILD CRUNCH",
          "STACK CRUNCH",
          "VO DRIVE",
          "VO LEAD",
          "VO CLEAN",
          "MATCH DRIVE",
          "FAT MATCH",
          "MATCH LEAD",
          "BG LEAD",
          "BG DRIVE",
          "BG RHYTHM",
          "MS 1959 I",
          "MS 1959 I+II",
          "MS HIGAIN",
          "MS SCOOP",
          "R-FIER VINTAGE",
          "R-FIER MODERN",
          "R-FIER CLEAN",
          "T-AMP LEAD",
          "T-AMP CRUNCH",
          "T-AMP CLEAN",
          "BOSS DRIVE",
          "SLDN",
          "LEAD STACK",
          "HEAVY LEAD",
          "BOSS METAL",
          "5150 DRIVE",
          "METAL LEAD",
          "EDGE LEAD",
          "BASS CLEAN",
          "BASS CRUNCH",
          "BASS HIGAIN",
        ],
        defaultValue: 1,
        encoder: "byte",
      },
      {
        id: "ampGain",
        moduleId: "amp",
        label: "Gain",
        kind: "slider",
        address: A.ampMod(0x02),
        min: 0,
        max: 120,
        step: 1,
        defaultValue: 65,
        encoder: "byte",
      },
      {
        id: "ampLevel",
        moduleId: "amp",
        label: "Level",
        kind: "slider",
        address: A.ampMod(0x03),
        min: 0,
        max: 100,
        step: 1,
        unit: "%",
        defaultValue: 80,
        encoder: "byte",
      },
      {
        id: "ampBass",
        moduleId: "amp",
        label: "Bass",
        kind: "slider",
        address: A.ampMod(0x07),
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 50,
        encoder: "byte",
      },
      {
        id: "ampMiddle",
        moduleId: "amp",
        label: "Middle",
        kind: "slider",
        address: A.ampMod(0x08),
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 50,
        encoder: "byte",
      },
      {
        id: "ampTreble",
        moduleId: "amp",
        label: "Treble",
        kind: "slider",
        address: A.ampMod(0x09),
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 50,
        encoder: "byte",
      },
      {
        id: "ampPresence",
        moduleId: "amp",
        label: "Presence",
        kind: "slider",
        address: A.ampMod(0x0a),
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 45,
        encoder: "byte",
      },
    ],
  },
  {
    id: "mod",
    title: "MOD",
    shortTitle: "MOD",
    tone: "green",
    parameters: [
      {
        id: "modSwitch",
        moduleId: "mod",
        label: "MOD Switch",
        kind: "toggle",
        address: A.ampMod(0x15),
        options: boolOptions,
        defaultValue: 0,
        encoder: "boolean",
      },
      {
        id: "modType",
        moduleId: "mod",
        label: "MOD Type",
        kind: "select",
        address: A.ampMod(0x16),
        options: [
          "OD/DS",
          "WAH",
          "COMP",
          "LIMITER",
          "OCTAVE",
          "PHASER",
          "FLANGER",
          "TREMOLO",
          "ROTARY",
          "UNI-V",
          "PAN",
          "DELAY",
          "CHORUS",
          "EQ",
        ],
        defaultValue: 0,
        encoder: "byte",
      },
      {
        id: "odDsDrive",
        moduleId: "mod",
        label: "OD/DS Drive",
        kind: "slider",
        address: A.ampMod(0x19),
        min: 0,
        max: 120,
        step: 1,
        defaultValue: 55,
        encoder: "byte",
      },
      {
        id: "odDsTone",
        moduleId: "mod",
        label: "OD/DS Tone",
        kind: "slider",
        address: A.ampMod(0x1a),
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 50,
        encoder: "byte",
      },
      {
        id: "odDsLevel",
        moduleId: "mod",
        label: "OD/DS Level",
        kind: "slider",
        address: A.ampMod(0x1b),
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 70,
        encoder: "byte",
      },
    ],
  },
  {
    id: "mfx",
    title: "MFX",
    shortTitle: "MFX",
    tone: "violet",
    parameters: [
      {
        id: "mfxSwitch",
        moduleId: "mfx",
        label: "MFX Switch",
        kind: "toggle",
        address: A.mfx(0x04),
        options: boolOptions,
        defaultValue: 0,
        encoder: "boolean",
      },
      {
        id: "mfxType",
        moduleId: "mfx",
        label: "MFX Type",
        kind: "select",
        address: A.mfx(0x05),
        options: [
          "EQ",
          "SUPER FILTER",
          "PHASER",
          "STEP PHASER",
          "RING MOD",
          "TREMOLO",
          "AUTO PAN",
          "SLICER",
          "VK ROTARY",
          "HEXA-CHORUS",
          "SPACE-D",
          "FLANGER",
          "STEP FLANGER",
          "GUITAR AMP SIM",
          "COMPRESSOR",
        ],
        defaultValue: 0,
        encoder: "byte",
      },
      {
        id: "mfxChorusSend",
        moduleId: "mfx",
        label: "Chorus Send",
        kind: "slider",
        address: A.mfx(0x00),
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 0,
        encoder: "byte",
      },
      {
        id: "mfxDelaySend",
        moduleId: "mfx",
        label: "Delay Send",
        kind: "slider",
        address: A.mfx(0x01),
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 30,
        encoder: "byte",
      },
      {
        id: "mfxReverbSend",
        moduleId: "mfx",
        label: "Reverb Send",
        kind: "slider",
        address: A.mfx(0x02),
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 20,
        encoder: "byte",
      },
    ],
  },
  {
    id: "chorus",
    title: "Chorus",
    shortTitle: "CHO",
    tone: "cyan",
    parameters: [
      {
        id: "chorusSwitch",
        moduleId: "chorus",
        label: "Chorus Switch",
        kind: "toggle",
        address: A.sends(0x00),
        options: boolOptions,
        defaultValue: 0,
        encoder: "boolean",
      },
      {
        id: "chorusType",
        moduleId: "chorus",
        label: "Type",
        kind: "select",
        address: A.sends(0x01),
        options: ["MONO", "STEREO", "MONO MILD", "STEREO MILD"],
        defaultValue: 1,
        encoder: "byte",
      },
      {
        id: "chorusRate",
        moduleId: "chorus",
        label: "Rate",
        kind: "slider",
        address: A.sends(0x02),
        min: 0,
        max: 113,
        step: 1,
        defaultValue: 40,
        encoder: "byte",
      },
      {
        id: "chorusDepth",
        moduleId: "chorus",
        label: "Depth",
        kind: "slider",
        address: A.sends(0x03),
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 35,
        encoder: "byte",
      },
      {
        id: "chorusLevel",
        moduleId: "chorus",
        label: "Effect Level",
        kind: "slider",
        address: A.sends(0x04),
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 35,
        encoder: "byte",
      },
    ],
  },
  {
    id: "delay",
    title: "Delay",
    shortTitle: "DLY",
    tone: "blue",
    parameters: [
      {
        id: "delaySwitch",
        moduleId: "delay",
        label: "Delay Switch",
        kind: "toggle",
        address: A.sends(0x05),
        options: boolOptions,
        defaultValue: 1,
        encoder: "boolean",
      },
      {
        id: "delayType",
        moduleId: "delay",
        label: "Type",
        kind: "select",
        address: A.sends(0x06),
        options: ["SINGLE", "PAN", "REVERSE", "ANALOG", "TAPE", "MODULATE", "HICUT"],
        defaultValue: 0,
        encoder: "byte",
      },
      {
        id: "delayTime",
        moduleId: "delay",
        label: "Time",
        kind: "slider",
        address: A.sends(0x07),
        min: 0,
        max: 3413,
        step: 5,
        unit: "ms",
        defaultValue: 420,
        encoder: "split12",
      },
      {
        id: "delayFeedback",
        moduleId: "delay",
        label: "Feedback",
        kind: "slider",
        address: A.sends(0x0a),
        min: 0,
        max: 100,
        step: 1,
        unit: "%",
        defaultValue: 28,
        encoder: "byte",
      },
      {
        id: "delayLevel",
        moduleId: "delay",
        label: "Effect Level",
        kind: "slider",
        address: A.sends(0x0b),
        min: 0,
        max: 120,
        step: 1,
        defaultValue: 45,
        encoder: "byte",
      },
    ],
  },
  {
    id: "reverb",
    title: "Reverb",
    shortTitle: "REV",
    tone: "pink",
    parameters: [
      {
        id: "reverbSwitch",
        moduleId: "reverb",
        label: "Reverb Switch",
        kind: "toggle",
        address: A.sends(0x0c),
        options: boolOptions,
        defaultValue: 1,
        encoder: "boolean",
      },
      {
        id: "reverbType",
        moduleId: "reverb",
        label: "Type",
        kind: "select",
        address: A.sends(0x0d),
        options: ["AMBIENCE", "ROOM", "HALL1", "HALL2", "PLATE"],
        defaultValue: 1,
        encoder: "byte",
      },
      {
        id: "reverbTime",
        moduleId: "reverb",
        label: "Time",
        kind: "slider",
        address: A.sends(0x0e),
        min: 0.1,
        max: 10,
        step: 0.1,
        unit: "s",
        defaultValue: 2.4,
        encoder: "reverbTime",
      },
      {
        id: "reverbHighCut",
        moduleId: "reverb",
        label: "High Cut",
        kind: "select",
        address: A.sends(0x0f),
        options: ["700", "1000", "1400", "2000", "3000", "4000", "6000", "8000", "11000", "FLAT"],
        defaultValue: 8,
        encoder: "byte",
      },
      {
        id: "reverbLevel",
        moduleId: "reverb",
        label: "Effect Level",
        kind: "slider",
        address: A.sends(0x10),
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 30,
        encoder: "byte",
      },
    ],
  },
  {
    id: "eq",
    title: "Master EQ",
    shortTitle: "EQ",
    tone: "red",
    parameters: [
      {
        id: "eqSwitch",
        moduleId: "eq",
        label: "EQ Switch",
        kind: "toggle",
        address: A.sends(0x11),
        options: boolOptions,
        defaultValue: 0,
        encoder: "boolean",
      },
      {
        id: "eqLowGain",
        moduleId: "eq",
        label: "Low Gain",
        kind: "slider",
        address: A.sends(0x13),
        min: -20,
        max: 20,
        step: 1,
        unit: "dB",
        defaultValue: 0,
        encoder: "gain20",
      },
      {
        id: "eqLowMidGain",
        moduleId: "eq",
        label: "Low Mid Gain",
        kind: "slider",
        address: A.sends(0x16),
        min: -20,
        max: 20,
        step: 1,
        unit: "dB",
        defaultValue: 0,
        encoder: "gain20",
      },
      {
        id: "eqHighMidGain",
        moduleId: "eq",
        label: "High Mid Gain",
        kind: "slider",
        address: A.sends(0x19),
        min: -20,
        max: 20,
        step: 1,
        unit: "dB",
        defaultValue: 0,
        encoder: "gain20",
      },
      {
        id: "eqHighGain",
        moduleId: "eq",
        label: "High Gain",
        kind: "slider",
        address: A.sends(0x1b),
        min: -20,
        max: 20,
        step: 1,
        unit: "dB",
        defaultValue: 0,
        encoder: "gain20",
      },
      {
        id: "eqLevel",
        moduleId: "eq",
        label: "Level",
        kind: "slider",
        address: A.sends(0x1c),
        min: -20,
        max: 20,
        step: 1,
        unit: "dB",
        defaultValue: 0,
        encoder: "gain20",
      },
    ],
  },
  {
    id: "noise",
    title: "Noise Suppressor",
    shortTitle: "NS",
    tone: "gray",
    parameters: [
      {
        id: "nsSwitch",
        moduleId: "noise",
        label: "NS Switch",
        kind: "toggle",
        address: A.ampMod(0x5a),
        options: boolOptions,
        defaultValue: 1,
        encoder: "boolean",
      },
      {
        id: "nsThreshold",
        moduleId: "noise",
        label: "Threshold",
        kind: "slider",
        address: A.ampMod(0x5b),
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 45,
        encoder: "byte",
      },
      {
        id: "nsRelease",
        moduleId: "noise",
        label: "Release",
        kind: "slider",
        address: A.ampMod(0x5c),
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 30,
        encoder: "byte",
      },
    ],
  },
];

export const PARAMETERS = MODULES.flatMap((module) => module.parameters);
export const PARAMETERS_BY_ADDRESS = new Map(PARAMETERS.map((param) => [addressKey(param.address), param]));

export function createInitialParameterValues() {
  return Object.fromEntries(PARAMETERS.map((param) => [param.id, param.defaultValue]));
}

export function encodeParameterValue(param: ParameterDefinition, value: number) {
  if (param.kind === "select") {
    return encodeByte(value, 0, (param.options?.length ?? 1) - 1);
  }

  switch (param.encoder) {
    case "boolean":
      return encodeByte(value > 0 ? 1 : 0, 0, 1);
    case "byte":
      return encodeByte(value, param.min ?? 0, param.max ?? 127);
    case "gain20":
      return encodeByte(value, -20, 20, 20);
    case "reverbTime":
      return encodeByte(Math.round(value / 0.1) - 1, 0, 99);
    case "signedByteOffset3":
      return encodeByte(value, -3, 3, 3);
    case "split8":
      return encodeSplit8(value, param.min ?? 0, param.max ?? 255);
    case "split12":
      return encodeSplit12(value, param.min ?? 0, param.max ?? 4095);
    default:
      return encodeByte(value, param.min ?? 0, param.max ?? 127);
  }
}

export function decodeParameterValue(param: ParameterDefinition, bytes: readonly number[]) {
  if (param.kind === "select") {
    return clamp(bytes[0] ?? param.defaultValue, 0, (param.options?.length ?? 1) - 1);
  }

  switch (param.encoder) {
    case "boolean":
      return bytes[0] ? 1 : 0;
    case "gain20":
      return clamp((bytes[0] ?? 20) - 20, -20, 20);
    case "reverbTime":
      return clamp(((bytes[0] ?? 23) + 1) * 0.1, 0.1, 10);
    case "signedByteOffset3":
      return clamp((bytes[0] ?? 3) - 3, -3, 3);
    case "split8":
      return clamp((((bytes[0] ?? 0) & 0x0f) << 4) | ((bytes[1] ?? 0) & 0x0f), param.min ?? 0, param.max ?? 255);
    case "split12":
      return clamp(
        (((bytes[0] ?? 0) & 0x0f) << 8) | (((bytes[1] ?? 0) & 0x0f) << 4) | ((bytes[2] ?? 0) & 0x0f),
        param.min ?? 0,
        param.max ?? 4095,
      );
    case "byte":
    default:
      return clamp(bytes[0] ?? param.defaultValue, param.min ?? 0, param.max ?? 127);
  }
}

export function makeParameterMessage(
  param: ParameterDefinition,
  value: number,
  deviceId: number,
) {
  return makeDataSetMessage(param.address, encodeParameterValue(param, value), deviceId);
}

export function parameterDataSize(param: ParameterDefinition) {
  switch (param.encoder) {
    case "split8":
      return [0x00, 0x00, 0x00, 0x02];
    case "split12":
      return [0x00, 0x00, 0x00, 0x03];
    case "boolean":
    case "byte":
    case "gain20":
    case "reverbTime":
    case "signedByteOffset3":
    default:
      return [0x00, 0x00, 0x00, 0x01];
  }
}
