import { addressKey } from "../lib/midiMessages";
import { clamp, encodeByte, encodeSplit12, encodeSplit8, makeDataRequestMessage, makeDataSetMessage } from "../lib/roland";

export type ParameterModuleId =
  | "pcm1"
  | "pcm2"
  | "modeling"
  | "normal-pu"
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
export type ParameterSection =
  | "pcm1"
  | "pcm2"
  | "modeling"
  | "normal-pu"
  | "amp"
  | "mod"
  | "mfx"
  | "chorus"
  | "delay"
  | "reverb"
  | "output"
  | "eq"
  | "assigns";
export type ParameterValueType =
  | "boolean"
  | "enum"
  | "number"
  | "bipolar"
  | "level"
  | "dB"
  | "ms"
  | "percent"
  | "toneNumber"
  | "category";
export type ParameterVerificationStatus = "verified" | "fixture-only" | "unmapped";
export type ParameterEncoder =
  | "boolean"
  | "invertedBoolean"
  | "byte"
  | "c127"
  | "c63"
  | "c64"
  | "offset24"
  | "offset50"
  | "offset64"
  | "split8"
  | "split12"
  | "toneNumber3"
  | "gain20"
  | "reverbTime"
  | "signedByteOffset3";

export type ParameterMapping = {
  scope: "temporary-patch";
  address: readonly [number, number, number, number];
  size: readonly [number, number, number, number];
};

export type ParameterDefinition = {
  id: string;
  moduleId: ParameterModuleId;
  section: ParameterSection;
  displayName: string;
  label: string;
  kind: ParameterKind;
  type: ParameterValueType;
  address: readonly [number, number, number, number];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  defaultValue: number;
  default: number;
  options?: readonly string[];
  allowedValues: readonly string[];
  readMapping: ParameterMapping;
  writeMapping: ParameterMapping;
  parser: ParameterEncoder;
  serializer: ParameterEncoder;
  uiControl: ParameterKind;
  hardwareVerificationStatus: ParameterVerificationStatus;
  source?: string;
  encoder: ParameterEncoder;
};

type RawParameterDefinition = Omit<
  ParameterDefinition,
  | "section"
  | "displayName"
  | "type"
  | "default"
  | "allowedValues"
  | "readMapping"
  | "writeMapping"
  | "parser"
  | "serializer"
  | "uiControl"
  | "hardwareVerificationStatus"
> & {
  section?: ParameterSection;
  displayName?: string;
  type?: ParameterValueType;
  allowedValues?: readonly string[];
  hardwareVerificationStatus?: ParameterVerificationStatus;
};

export type ModuleDefinition = {
  id: ParameterModuleId;
  title: string;
  shortTitle: string;
  tone: string;
  parameters: ParameterDefinition[];
};

type RawModuleDefinition = Omit<ModuleDefinition, "parameters"> & {
  parameters: RawParameterDefinition[];
};

export type ParameterReadMessage = {
  param: ParameterDefinition;
  label: string;
  bytes: number[];
};

const A = {
  common: (offset: number) => [0x18, 0x00, (offset >> 8) & 0x7f, offset & 0x7f] as const,
  sends: (offset: number) => [0x18, 0x00, 0x06, offset] as const,
  ampMod: (offset: number) => [0x18, 0x00, 0x07, offset] as const,
  mfx: (offset: number) => [0x18, 0x00, 0x03, offset] as const,
  pcm1: (offset: number) => [0x18, 0x00, 0x20, offset] as const,
  pcm2: (offset: number) => [0x18, 0x00, 0x21, offset] as const,
  pcm1Offset: (offset: number) => [0x18, 0x00, 0x30, offset] as const,
  pcm2Offset: (offset: number) => [0x18, 0x00, 0x31, offset] as const,
  modeling: (offset: number) => [0x18, 0x00, 0x10, offset] as const,
};

const boolOptions = ["OFF", "ON"] as const;
const routingOptions = ["BYPS", "AMP", "MFX"] as const;
const pcmFilterTypeOptions = ["OFF", "LPF", "BPF", "HPF", "PKG", "LPF2", "LPF3", "TONE"] as const;
const modelingGuitarCategories = ["E.GTR", "AC", "E.BASS", "SYNTH"] as const;
const modelingElectricGuitarTypes = ["CLA-ST", "MOD-ST", "H&H-ST", "TE", "LP", "P-90", "LIPS", "RICK", "335", "L4"] as const;
const modelingAcousticTypes = ["STEEL", "NYLON", "SITAR", "BANJO", "RESO"] as const;
const modelingBassTypes = ["JB", "PB"] as const;
const modelingSynthTypes = ["ANALOG GR", "WAVE SYNTH", "FILTER BASS", "CRYSTAL", "ORGAN", "BRASS"] as const;

function makePcmModule(index: 1 | 2): RawModuleDefinition {
  const id = `pcm${index}` as const;
  const address = index === 1 ? A.pcm1 : A.pcm2;
  const offsetAddress = index === 1 ? A.pcm1Offset : A.pcm2Offset;
  const title = `PCM Tone ${index}`;
  const shortTitle = `PCM${index}`;
  const source = "RolandGR55AddressMap PatchPCMToneStruct";

  return {
    id,
    title,
    shortTitle,
    tone: index === 1 ? "teal" : "indigo",
    parameters: [
      {
        id: `${id}Switch`,
        moduleId: id,
        label: "Tone Switch",
        kind: "toggle",
        address: address(0x03),
        options: boolOptions,
        defaultValue: 1,
        encoder: "invertedBoolean",
        hardwareVerificationStatus: "fixture-only",
        source,
      },
      {
        id: `${id}ToneNumber`,
        moduleId: id,
        label: "PCM Tone Number",
        kind: "slider",
        address: address(0x00),
        min: 1,
        max: 910,
        step: 1,
        defaultValue: 1,
        type: "toneNumber",
        encoder: "toneNumber3",
        hardwareVerificationStatus: "fixture-only",
        source,
      },
      {
        id: `${id}Level`,
        moduleId: id,
        label: "Part Level",
        kind: "slider",
        address: address(0x04),
        min: 0,
        max: 100,
        step: 1,
        unit: "%",
        defaultValue: 80,
        type: "level",
        encoder: "c127",
        hardwareVerificationStatus: "fixture-only",
        source,
      },
      {
        id: `${id}OctaveShift`,
        moduleId: id,
        label: "Octave Shift",
        kind: "slider",
        address: address(0x05),
        min: -3,
        max: 3,
        step: 1,
        unit: "oct",
        defaultValue: 0,
        type: "bipolar",
        encoder: "offset64",
        hardwareVerificationStatus: "fixture-only",
        source,
      },
      {
        id: `${id}Chromatic`,
        moduleId: id,
        label: "Chromatic",
        kind: "toggle",
        address: address(0x06),
        options: boolOptions,
        defaultValue: 0,
        encoder: "boolean",
        hardwareVerificationStatus: "fixture-only",
        source,
      },
      {
        id: `${id}NuanceSwitch`,
        moduleId: id,
        label: "Nuance Switch",
        kind: "toggle",
        address: address(0x08),
        options: boolOptions,
        defaultValue: 0,
        encoder: "boolean",
        hardwareVerificationStatus: "fixture-only",
        source,
      },
      {
        id: `${id}Pan`,
        moduleId: id,
        label: "Part Pan",
        kind: "slider",
        address: address(0x09),
        min: -50,
        max: 50,
        step: 1,
        defaultValue: 0,
        type: "bipolar",
        encoder: "c64",
        hardwareVerificationStatus: "fixture-only",
        source,
      },
      {
        id: `${id}CoarseTune`,
        moduleId: id,
        label: "Coarse Tune",
        kind: "slider",
        address: address(0x0a),
        min: -24,
        max: 24,
        step: 1,
        unit: "st",
        defaultValue: 0,
        type: "bipolar",
        encoder: "offset64",
        hardwareVerificationStatus: "fixture-only",
        source,
      },
      {
        id: `${id}FineTune`,
        moduleId: id,
        label: "Fine Tune",
        kind: "slider",
        address: address(0x0b),
        min: -50,
        max: 50,
        step: 1,
        unit: "cent",
        defaultValue: 0,
        type: "bipolar",
        encoder: "offset64",
        hardwareVerificationStatus: "fixture-only",
        source,
      },
      {
        id: `${id}PortamentoSwitch`,
        moduleId: id,
        label: "Portamento Switch",
        kind: "select",
        address: address(0x0c),
        options: ["OFF", "ON", "TONE"],
        defaultValue: 0,
        encoder: "byte",
        hardwareVerificationStatus: "fixture-only",
        source,
      },
      {
        id: `${id}ReleaseMode`,
        moduleId: id,
        label: "Release Mode",
        kind: "select",
        address: address(0x0f),
        options: ["1", "2"],
        defaultValue: 0,
        encoder: "byte",
        hardwareVerificationStatus: "fixture-only",
        source,
      },
      ...([1, 2, 3, 4, 5, 6] as const).map((stringNumber) => ({
        id: `${id}String${stringNumber}Level`,
        moduleId: id,
        label: `String ${stringNumber} Level`,
        kind: "slider" as const,
        address: address(0x0f + stringNumber),
        min: 0,
        max: 100,
        step: 1,
        unit: "%",
        defaultValue: 100,
        type: "level" as const,
        encoder: "c127" as const,
        hardwareVerificationStatus: "fixture-only" as const,
        source,
      })),
      {
        id: `${id}OutputSelect`,
        moduleId: id,
        label: "Output Select",
        kind: "select",
        address: address(0x16),
        options: routingOptions,
        defaultValue: 1,
        encoder: "byte",
        hardwareVerificationStatus: "fixture-only",
        source,
      },
      {
        id: `${id}FilterType`,
        moduleId: id,
        label: "TVF Filter Type",
        kind: "select",
        address: offsetAddress(0x00),
        options: pcmFilterTypeOptions,
        defaultValue: 7,
        encoder: "byte",
        hardwareVerificationStatus: "fixture-only",
        source: "RolandGR55AddressMap PatchPCMToneOffsetStruct",
      },
      {
        id: `${id}CutoffOffset`,
        moduleId: id,
        label: "TVF Cutoff Offset",
        kind: "slider",
        address: offsetAddress(0x01),
        min: -50,
        max: 50,
        step: 1,
        defaultValue: 0,
        type: "bipolar",
        encoder: "c63",
        hardwareVerificationStatus: "fixture-only",
        source: "RolandGR55AddressMap PatchPCMToneOffsetStruct",
      },
      {
        id: `${id}ResonanceOffset`,
        moduleId: id,
        label: "TVF Resonance Offset",
        kind: "slider",
        address: offsetAddress(0x02),
        min: -50,
        max: 50,
        step: 1,
        defaultValue: 0,
        type: "bipolar",
        encoder: "c64",
        hardwareVerificationStatus: "fixture-only",
        source: "RolandGR55AddressMap PatchPCMToneOffsetStruct",
      },
      {
        id: `${id}AttackOffset`,
        moduleId: id,
        label: "TVA Attack Offset",
        kind: "slider",
        address: offsetAddress(0x10),
        min: -50,
        max: 50,
        step: 1,
        defaultValue: 0,
        type: "bipolar",
        encoder: "c64",
        hardwareVerificationStatus: "fixture-only",
        source: "RolandGR55AddressMap PatchPCMToneOffsetStruct",
      },
      {
        id: `${id}ReleaseOffset`,
        moduleId: id,
        label: "TVA Release Offset",
        kind: "slider",
        address: offsetAddress(0x13),
        min: -50,
        max: 50,
        step: 1,
        defaultValue: 0,
        type: "bipolar",
        encoder: "c64",
        hardwareVerificationStatus: "fixture-only",
        source: "RolandGR55AddressMap PatchPCMToneOffsetStruct",
      },
    ],
  };
}

const RAW_MODULES: RawModuleDefinition[] = [
  makePcmModule(1),
  makePcmModule(2),
  {
    id: "modeling",
    title: "Modeling / COSM",
    shortTitle: "MODEL",
    tone: "orange",
    parameters: [
      {
        id: "modelingCategory",
        moduleId: "modeling",
        label: "Guitar Mode Category",
        kind: "select",
        address: A.modeling(0x00),
        options: modelingGuitarCategories,
        defaultValue: 0,
        type: "category",
        encoder: "byte",
        hardwareVerificationStatus: "fixture-only",
        source: "RolandGR55AddressMap PatchModelingToneStruct",
      },
      {
        id: "modelingElectricGuitarType",
        moduleId: "modeling",
        label: "E.GTR Model",
        kind: "select",
        address: A.modeling(0x01),
        options: modelingElectricGuitarTypes,
        defaultValue: 0,
        encoder: "byte",
        hardwareVerificationStatus: "fixture-only",
        source: "RolandGR55AddressMap PatchModelingToneStruct",
      },
      {
        id: "modelingAcousticType",
        moduleId: "modeling",
        label: "Acoustic Model",
        kind: "select",
        address: A.modeling(0x02),
        options: modelingAcousticTypes,
        defaultValue: 0,
        encoder: "byte",
        hardwareVerificationStatus: "fixture-only",
        source: "RolandGR55AddressMap PatchModelingToneStruct",
      },
      {
        id: "modelingBassType",
        moduleId: "modeling",
        label: "E.BASS Model",
        kind: "select",
        address: A.modeling(0x03),
        options: modelingBassTypes,
        defaultValue: 0,
        encoder: "byte",
        hardwareVerificationStatus: "fixture-only",
        source: "RolandGR55AddressMap PatchModelingToneStruct",
      },
      {
        id: "modelingSynthType",
        moduleId: "modeling",
        label: "Synth Model",
        kind: "select",
        address: A.modeling(0x04),
        options: modelingSynthTypes,
        defaultValue: 0,
        encoder: "byte",
        hardwareVerificationStatus: "fixture-only",
        source: "RolandGR55AddressMap PatchModelingToneStruct",
      },
      {
        id: "modelingLevel",
        moduleId: "modeling",
        label: "Level",
        kind: "slider",
        address: A.modeling(0x09),
        min: 0,
        max: 100,
        step: 1,
        unit: "%",
        defaultValue: 80,
        type: "level",
        encoder: "byte",
        hardwareVerificationStatus: "fixture-only",
        source: "RolandGR55AddressMap PatchModelingToneStruct",
      },
      {
        id: "modelingSwitch",
        moduleId: "modeling",
        label: "Tone Switch",
        kind: "toggle",
        address: A.modeling(0x0a),
        options: boolOptions,
        defaultValue: 1,
        encoder: "invertedBoolean",
        hardwareVerificationStatus: "fixture-only",
        source: "RolandGR55AddressMap PatchModelingToneStruct",
      },
      ...([1, 2, 3, 4, 5, 6] as const).map((stringNumber) => ({
        id: `modelingString${stringNumber}Level`,
        moduleId: "modeling" as const,
        label: `String ${stringNumber} Level`,
        kind: "slider" as const,
        address: A.modeling(0x0a + stringNumber),
        min: 0,
        max: 100,
        step: 1,
        unit: "%",
        defaultValue: 100,
        type: "level" as const,
        encoder: "byte" as const,
        hardwareVerificationStatus: "fixture-only" as const,
        source: "RolandGR55AddressMap PatchModelingToneStruct",
      })),
      {
        id: "modelingPitchShift",
        moduleId: "modeling",
        label: "Pitch Shift",
        kind: "slider",
        address: A.modeling(0x11),
        min: -24,
        max: 24,
        step: 1,
        unit: "st",
        defaultValue: 0,
        type: "bipolar",
        encoder: "offset24",
        hardwareVerificationStatus: "fixture-only",
        source: "RolandGR55AddressMap PatchModelingToneStruct",
      },
      {
        id: "modelingFineShift",
        moduleId: "modeling",
        label: "Fine Shift",
        kind: "slider",
        address: A.modeling(0x12),
        min: -50,
        max: 50,
        step: 1,
        unit: "cent",
        defaultValue: 0,
        type: "bipolar",
        encoder: "offset50",
        hardwareVerificationStatus: "fixture-only",
        source: "RolandGR55AddressMap PatchModelingToneStruct",
      },
    ],
  },
  {
    id: "normal-pu",
    title: "Normal Pickup",
    shortTitle: "NPU",
    tone: "brown",
    parameters: [
      {
        id: "normalPuRouting",
        moduleId: "normal-pu",
        label: "Line Select",
        kind: "select",
        address: A.common(0x022e),
        options: routingOptions,
        defaultValue: 1,
        encoder: "byte",
        hardwareVerificationStatus: "fixture-only",
        source: "RolandGR55AddressMap common.lineSelectNormalPU",
      },
      {
        id: "normalPuSwitch",
        moduleId: "normal-pu",
        label: "Pickup Switch",
        kind: "toggle",
        address: A.common(0x0232),
        options: boolOptions,
        defaultValue: 1,
        encoder: "invertedBoolean",
        hardwareVerificationStatus: "fixture-only",
        source: "RolandGR55AddressMap common.normalPuMute",
      },
      {
        id: "normalPuLevel",
        moduleId: "normal-pu",
        label: "Pickup Level",
        kind: "slider",
        address: A.common(0x0233),
        min: 0,
        max: 100,
        step: 1,
        unit: "%",
        defaultValue: 80,
        type: "level",
        encoder: "byte",
        hardwareVerificationStatus: "fixture-only",
        source: "RolandGR55AddressMap common.normalPuLevel",
      },
    ],
  },
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

export const MODULES: ModuleDefinition[] = RAW_MODULES.map((module) => ({
  ...module,
  parameters: module.parameters.map((param) => enrichParameter(module, param)),
}));

export const PARAMETERS = MODULES.flatMap((module) => module.parameters);
export const PARAMETERS_BY_ADDRESS = new Map(PARAMETERS.map((param) => [addressKey(param.address), param]));
export const PARAMETERS_BY_ID = new Map(PARAMETERS.map((param) => [param.id, param]));
export const UNMAPPED_PARAMETER_TODOS = [
  {
    id: "pcm1PortamentoTime",
    section: "pcm1",
    displayName: "PCM Tone 1 Portamento Time",
    reason: "Secondary address 18:00:20:0D did not respond to USER 73-3 single RQ1 hardware verification.",
  },
  {
    id: "pcm2PortamentoTime",
    section: "pcm2",
    displayName: "PCM Tone 2 Portamento Time",
    reason: "Secondary address 18:00:21:0D did not respond to USER 73-3 single RQ1 hardware verification.",
  },
] as const;

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
    case "invertedBoolean":
      return encodeByte(value > 0 ? 0 : 1, 0, 1);
    case "byte":
      return encodeByte(value, param.min ?? 0, param.max ?? 127);
    case "c127":
      return encodeByte(Math.round((127 * clamp(value, 0, 100)) / 100), 0, 127);
    case "c63":
      return encodeByte(Math.round(1 + (126 * (50 + clamp(value, -50, 50))) / 100), 1, 127);
    case "c64":
      return encodeByte(Math.round((127 * (50 + clamp(value, -50, 50))) / 100), 0, 127);
    case "offset24":
      return encodeByte(value, param.min ?? -24, param.max ?? 24, 24);
    case "offset50":
      return encodeByte(value, param.min ?? -50, param.max ?? 50, 50);
    case "offset64":
      return encodeByte(value, param.min ?? -64, param.max ?? 63, 64);
    case "toneNumber3":
      return encodePcmToneNumber(value);
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
    case "invertedBoolean":
      return bytes[0] ? 0 : 1;
    case "c127":
      return clamp(Math.round((100 * (bytes[0] ?? 0)) / 127), 0, 100);
    case "c63":
      return clamp(Math.round((100 * ((bytes[0] ?? 64) - 1)) / 126 - 50), -50, 50);
    case "c64":
      return clamp(Math.round((100 * (bytes[0] ?? 64)) / 127 - 50), -50, 50);
    case "offset24":
      return clamp((bytes[0] ?? 24) - 24, param.min ?? -24, param.max ?? 24);
    case "offset50":
      return clamp((bytes[0] ?? 50) - 50, param.min ?? -50, param.max ?? 50);
    case "offset64":
      return clamp((bytes[0] ?? 64) - 64, param.min ?? -64, param.max ?? 63);
    case "toneNumber3":
      return decodePcmToneNumber(bytes);
    case "gain20":
      return clamp((bytes[0] ?? 20) - 20, -20, 20);
    case "reverbTime":
      return Number(clamp(((bytes[0] ?? 23) + 1) * 0.1, 0.1, 10).toFixed(1));
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

export function makeParameterReadMessage(param: ParameterDefinition, deviceId: number) {
  return makeDataRequestMessage(param.address, parameterDataSize(param), deviceId);
}

export function makeMappedPatchReadMessages(deviceId: number, parameters: readonly ParameterDefinition[] = PARAMETERS): ParameterReadMessage[] {
  return parameters.map((param) => ({
    param,
    label: `Read ${param.label}`,
    bytes: makeParameterReadMessage(param, deviceId),
  }));
}

export function parameterDataSize(param: ParameterDefinition) {
  switch (param.encoder) {
    case "split8":
      return [0x00, 0x00, 0x00, 0x02];
    case "split12":
    case "toneNumber3":
      return [0x00, 0x00, 0x00, 0x03];
    case "boolean":
    case "invertedBoolean":
    case "byte":
    case "c127":
    case "c63":
    case "c64":
    case "offset24":
    case "offset50":
    case "offset64":
    case "gain20":
    case "reverbTime":
    case "signedByteOffset3":
    default:
      return [0x00, 0x00, 0x00, 0x01];
  }
}

function enrichParameter(module: RawModuleDefinition, param: RawParameterDefinition): ParameterDefinition {
  const type = param.type ?? inferParameterType(param);
  const size = parameterDataSizeForEncoder(param.encoder);

  return {
    ...param,
    section: param.section ?? sectionForModuleId(param.moduleId),
    displayName: param.displayName ?? param.label,
    type,
    default: param.defaultValue,
    allowedValues: param.allowedValues ?? param.options ?? [],
    readMapping: {
      scope: "temporary-patch",
      address: param.address,
      size,
    },
    writeMapping: {
      scope: "temporary-patch",
      address: param.address,
      size,
    },
    parser: param.encoder,
    serializer: param.encoder,
    uiControl: param.kind,
    hardwareVerificationStatus: param.hardwareVerificationStatus ?? "verified",
  };
}

function inferParameterType(param: RawParameterDefinition): ParameterValueType {
  if (param.kind === "toggle" || param.encoder === "boolean" || param.encoder === "invertedBoolean") {
    return "boolean";
  }
  if (param.kind === "select" || param.options?.length) {
    return "enum";
  }
  if (param.encoder === "toneNumber3") {
    return "toneNumber";
  }
  if (param.unit === "dB") {
    return "dB";
  }
  if (param.unit === "ms") {
    return "ms";
  }
  if (param.unit === "%" || param.label.toLowerCase().includes("level")) {
    return "level";
  }
  if (["c63", "c64", "offset24", "offset50", "offset64", "gain20", "signedByteOffset3"].includes(param.encoder)) {
    return "bipolar";
  }
  return "number";
}

function sectionForModuleId(moduleId: ParameterModuleId): ParameterSection {
  if (moduleId === "common" || moduleId === "noise") {
    return "output";
  }
  return moduleId;
}

function parameterDataSizeForEncoder(encoder: ParameterEncoder) {
  switch (encoder) {
    case "split8":
      return [0x00, 0x00, 0x00, 0x02] as const;
    case "split12":
    case "toneNumber3":
      return [0x00, 0x00, 0x00, 0x03] as const;
    default:
      return [0x00, 0x00, 0x00, 0x01] as const;
  }
}

function encodePcmToneNumber(value: number) {
  const safe = clamp(Math.round(value), 1, 910);
  if (safe >= 897) {
    const index = safe - 897;
    return [0x56, (index >> 7) & 0x7f, index & 0x7f];
  }

  const index = safe - 1;
  return [0x58, (index >> 7) & 0x7f, index & 0x7f];
}

function decodePcmToneNumber(bytes: readonly number[]) {
  const bankMsb = bytes[0] ?? 0x58;
  const index = (((bytes[1] ?? 0) & 0x7f) << 7) | ((bytes[2] ?? 0) & 0x7f);
  if (bankMsb === 0x56) {
    return clamp(897 + index, 897, 910);
  }
  return clamp(1 + index, 1, 896);
}
