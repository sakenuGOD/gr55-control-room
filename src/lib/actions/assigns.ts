import {
  PARAMETERS,
  PARAMETERS_BY_ID,
  type ParameterDefinition,
} from "../../data/gr55Parameters";

export type AssignSourceId = "ctlPedal" | "expPedal" | "expSwitch" | "gkS1" | "gkS2" | "gkVolume";
export type AssignSourceKind = "switch" | "continuous";
export type AssignMode = "toggle" | "momentary";
export type AssignSlotNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type AssignWriteRole = "enabled" | "source" | "target" | "targetMin" | "targetMax" | "mode";

export type PhysicalAssignControl = {
  id: AssignSourceId;
  label: string;
  kind: AssignSourceKind;
  controller?: number;
  min: number;
  max: number;
  modes: AssignMode[];
  mappingStatus: "mapped-control" | "mapping-needed";
  detail: string;
};

export type AssignTargetOption = {
  id: string;
  label: string;
  displayName: string;
  moduleId: ParameterDefinition["moduleId"];
  section: ParameterDefinition["section"];
  kind: ParameterDefinition["kind"];
  min: number;
  max: number;
  step: number;
  unit?: string;
  verificationStatus: ParameterDefinition["hardwareVerificationStatus"];
  parameter: ParameterDefinition;
};

export type AssignSlotMapping = {
  slot: AssignSlotNumber;
  label: string;
  fields: Partial<Record<AssignWriteRole, string>>;
  sourceValues?: Partial<Record<AssignSourceId, number>>;
  targetValues?: Record<string, number>;
  modeValues?: Partial<Record<AssignMode, number>>;
  source?: string;
};

export type AssignStagedChange = {
  role: AssignWriteRole;
  param: ParameterDefinition;
  value: number;
};

export type AssignStageSuccess = {
  ok: true;
  status: "staged";
  slot: AssignSlotNumber;
  source: PhysicalAssignControl;
  target: AssignTargetOption;
  mode?: AssignMode;
  min: number;
  max: number;
  staged: AssignStagedChange[];
  missing: [];
};

export type AssignActionErrorCode =
  | "INVALID_SLOT"
  | "INVALID_SOURCE"
  | "UNMAPPED_TARGET"
  | "TARGET_NOT_WRITABLE"
  | "RANGE_OUT_OF_BOUNDS"
  | "MODE_UNAVAILABLE"
  | "MAPPING_NEEDED";

export type AssignStageFailure = {
  ok: false;
  status: "rejected" | "mapping-needed";
  code: AssignActionErrorCode;
  reason: string;
  slot?: number;
  staged: [];
  missing: string[];
};

export type AssignStageResult = AssignStageSuccess | AssignStageFailure;

export type StageAssignControlMappingRequest = {
  slot: number;
  sourceId: string;
  targetParameterId: string;
  min: number;
  max: number;
  mode?: AssignMode;
  slotMappings?: readonly AssignSlotMapping[];
  registryById?: ReadonlyMap<string, ParameterDefinition>;
};

export const ASSIGN_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

const SWITCH_MODES: AssignMode[] = ["toggle", "momentary"];

const PHYSICAL_ASSIGN_CONTROLS: readonly PhysicalAssignControl[] = [
  {
    id: "ctlPedal",
    label: "CTL pedal",
    kind: "switch",
    controller: 80,
    min: 0,
    max: 127,
    modes: SWITCH_MODES,
    mappingStatus: "mapped-control",
    detail: "Assign source enum CTL is mapped; performance CC 80 can still be sent live.",
  },
  {
    id: "expPedal",
    label: "EXP pedal",
    kind: "continuous",
    controller: 11,
    min: 0,
    max: 127,
    modes: [],
    mappingStatus: "mapped-control",
    detail: "Assign source enum EXP PEDAL ON is mapped; performance CC 11 can still be sent live.",
  },
  {
    id: "expSwitch",
    label: "EXP switch",
    kind: "switch",
    min: 0,
    max: 127,
    modes: SWITCH_MODES,
    mappingStatus: "mapped-control",
    detail: "Assign source enum EXP PEDAL SW is mapped. Direct live CC send is not available.",
  },
  {
    id: "gkS1",
    label: "GK S1",
    kind: "switch",
    min: 0,
    max: 127,
    modes: SWITCH_MODES,
    mappingStatus: "mapped-control",
    detail: "Assign source enum GK S1 is mapped. Direct live CC send is not available.",
  },
  {
    id: "gkS2",
    label: "GK S2",
    kind: "switch",
    min: 0,
    max: 127,
    modes: SWITCH_MODES,
    mappingStatus: "mapped-control",
    detail: "Assign source enum GK S2 is mapped. Direct live CC send is not available.",
  },
  {
    id: "gkVolume",
    label: "GK volume",
    kind: "continuous",
    controller: 7,
    min: 0,
    max: 127,
    modes: [],
    mappingStatus: "mapped-control",
    detail: "Assign source enum GK VOL is mapped; performance CC 7 can still be sent live.",
  },
];

export const ASSIGN_SOURCE_VALUES: Record<AssignSourceId, number> = {
  ctlPedal: 0,
  expPedal: 2,
  expSwitch: 3,
  gkS1: 6,
  gkS2: 7,
  gkVolume: 8,
};

export const ASSIGN_MODE_VALUES: Record<AssignMode, number> = {
  momentary: 0,
  toggle: 1,
};

export const ASSIGN_TARGET_VALUES_BY_PARAMETER_ID: Record<string, number> = {
  pcm1Switch: 0,
  pcm1ToneNumber: 1,
  pcm1Level: 2,
  pcm1OctaveShift: 3,
  pcm1Chromatic: 4,
  pcm1NuanceSwitch: 8,
  pcm1Pan: 9,
  pcm1String1Level: 10,
  pcm1String2Level: 11,
  pcm1String3Level: 12,
  pcm1String4Level: 13,
  pcm1String5Level: 14,
  pcm1String6Level: 15,
  pcm1CoarseTune: 16,
  pcm1FineTune: 17,
  pcm1PortamentoSwitch: 18,
  pcm1FilterType: 21,
  pcm1CutoffOffset: 22,
  pcm1ResonanceOffset: 23,
  pcm1AttackOffset: 35,
  pcm1ReleaseOffset: 38,
  pcm1ReleaseMode: 42,
  pcm1OutputSelect: 57,
  pcm2Switch: 59,
  pcm2ToneNumber: 60,
  pcm2Level: 61,
  pcm2OctaveShift: 62,
  pcm2Chromatic: 63,
  pcm2NuanceSwitch: 67,
  pcm2Pan: 68,
  pcm2String1Level: 69,
  pcm2String2Level: 70,
  pcm2String3Level: 71,
  pcm2String4Level: 72,
  pcm2String5Level: 73,
  pcm2String6Level: 74,
  pcm2CoarseTune: 75,
  pcm2FineTune: 76,
  pcm2PortamentoSwitch: 77,
  pcm2FilterType: 80,
  pcm2CutoffOffset: 81,
  pcm2ResonanceOffset: 82,
  pcm2AttackOffset: 94,
  pcm2ReleaseOffset: 97,
  pcm2ReleaseMode: 101,
  pcm2OutputSelect: 116,
  modelingSwitch: 118,
  modelingLevel: 119,
  modelingString1Level: 120,
  modelingString2Level: 121,
  modelingString3Level: 122,
  modelingString4Level: 123,
  modelingString5Level: 124,
  modelingString6Level: 125,
  modelingPitchShift: 126,
  modelingFineShift: 127,
  ampSwitch: 213,
  ampGain: 214,
  ampLevel: 215,
  ampBass: 219,
  ampMiddle: 220,
  ampTreble: 221,
  ampPresence: 222,
  modSwitch: 229,
  odDsDrive: 232,
  odDsTone: 233,
  odDsLevel: 234,
  nsSwitch: 295,
  nsThreshold: 296,
  nsRelease: 297,
  mfxSwitch: 298,
  delaySwitch: 491,
  delayType: 492,
  delayTime: 493,
  delayFeedback: 494,
  delayLevel: 495,
  reverbSwitch: 499,
  reverbType: 500,
  reverbTime: 501,
  reverbHighCut: 502,
  reverbLevel: 503,
  chorusSwitch: 507,
  chorusType: 508,
  chorusRate: 509,
  chorusDepth: 510,
  chorusLevel: 511,
  eqSwitch: 515,
  eqLowGain: 517,
  eqLowMidGain: 520,
  eqHighMidGain: 523,
  eqHighGain: 524,
  eqLevel: 526,
  normalPuLevel: 528,
  normalPuRouting: 529,
  patchTempo: 531,
  patchLevel: 533,
};

export const DEFAULT_ASSIGN_SLOT_MAPPINGS: readonly AssignSlotMapping[] = ASSIGN_SLOTS.map((slot) => ({
  slot,
  label: `Assign ${slot}`,
  fields: {
    enabled: `assign${slot}Switch`,
    source: `assign${slot}Source`,
    target: `assign${slot}Target`,
    targetMin: `assign${slot}TargetMin`,
    targetMax: `assign${slot}TargetMax`,
    mode: `assign${slot}SourceMode`,
  },
  sourceValues: ASSIGN_SOURCE_VALUES,
  targetValues: ASSIGN_TARGET_VALUES_BY_PARAMETER_ID,
  modeValues: ASSIGN_MODE_VALUES,
  source: "motiz88/gr55-remote RolandGR55AssignsMap.ts secondary; USER 73-3 write verification pending",
}));

export function listPhysicalAssignControls(): PhysicalAssignControl[] {
  return PHYSICAL_ASSIGN_CONTROLS.map((control) => ({
    ...control,
    modes: [...control.modes],
  }));
}

export function listAssignTargets(parameters: readonly ParameterDefinition[] = PARAMETERS): AssignTargetOption[] {
  return parameters.filter(isAssignableTarget).map(assignTargetOption);
}

export function getAssignTargetRange(param: ParameterDefinition) {
  if (param.kind === "toggle") {
    return { min: 0, max: 1, step: 1 };
  }

  if (param.kind === "select") {
    return { min: 0, max: Math.max(0, (param.options?.length ?? 1) - 1), step: 1 };
  }

  return {
    min: param.min ?? 0,
    max: param.max ?? 127,
    step: param.step ?? 1,
  };
}

export function findAssignSlotMapping(
  slot: number,
  slotMappings: readonly AssignSlotMapping[] = DEFAULT_ASSIGN_SLOT_MAPPINGS,
) {
  return slotMappings.find((mapping) => mapping.slot === slot) ?? null;
}

export function getAssignSlotMappingReadiness({
  mapping,
  sourceId,
  targetParameterId,
  mode,
  registryById = PARAMETERS_BY_ID,
}: {
  mapping: AssignSlotMapping | null | undefined;
  sourceId?: AssignSourceId;
  targetParameterId?: string;
  mode?: AssignMode;
  registryById?: ReadonlyMap<string, ParameterDefinition>;
}) {
  if (!mapping) {
    return {
      ready: false,
      missing: ["assign slot mapping"],
    };
  }

  const missing = missingMappingRequirements(mapping, registryById, sourceId, targetParameterId, mode);
  return {
    ready: missing.length === 0,
    missing,
  };
}

export function stageAssignControlMapping(request: StageAssignControlMappingRequest): AssignStageResult {
  const registryById = request.registryById ?? PARAMETERS_BY_ID;

  if (!isAssignSlotNumber(request.slot)) {
    return rejected("INVALID_SLOT", `Assign slot ${request.slot} is outside 1-8.`, request.slot);
  }

  const source = PHYSICAL_ASSIGN_CONTROLS.find((control) => control.id === request.sourceId);
  if (!source) {
    return rejected("INVALID_SOURCE", `Unknown assign source: ${request.sourceId}.`, request.slot);
  }

  const targetParam = registryById.get(request.targetParameterId);
  if (!targetParam || !isMappedRegistryTarget(targetParam)) {
    return rejected("UNMAPPED_TARGET", `Target parameter is not in the mapped writable registry: ${request.targetParameterId}.`, request.slot);
  }

  if (!hasWriteMapping(targetParam)) {
    return rejected("TARGET_NOT_WRITABLE", `Target parameter has no write mapping: ${request.targetParameterId}.`, request.slot);
  }

  const targetRange = getAssignTargetRange(targetParam);
  if (!rangeIsValid(request.min, request.max, targetRange.min, targetRange.max)) {
    return rejected(
      "RANGE_OUT_OF_BOUNDS",
      `${targetParam.displayName} assign range must stay between ${targetRange.min} and ${targetRange.max}.`,
      request.slot,
    );
  }

  if (request.mode && !source.modes.includes(request.mode)) {
    return rejected("MODE_UNAVAILABLE", `${source.label} does not expose ${request.mode} mode in the mapped control data.`, request.slot);
  }

  const mapping = findAssignSlotMapping(request.slot, request.slotMappings);
  const missing = missingMappingRequirements(
    mapping,
    registryById,
    source.id,
    targetParam.id,
    request.mode,
  );

  if (missing.length > 0 || !mapping) {
    return mappingNeeded(
      `Assign ${request.slot} cannot be staged until source, target and range write parameters are mapped.`,
      missing,
      request.slot,
    );
  }

  const sourceValue = mapping.sourceValues?.[source.id];
  const targetValue = mapping.targetValues?.[targetParam.id];
  const modeValue = request.mode ? mapping.modeValues?.[request.mode] : undefined;
  const enabledParam = mappedFieldParam(mapping, "enabled", registryById);
  const sourceParam = mappedFieldParam(mapping, "source", registryById);
  const targetWriteParam = mappedFieldParam(mapping, "target", registryById);
  const targetMinParam = mappedFieldParam(mapping, "targetMin", registryById);
  const targetMaxParam = mappedFieldParam(mapping, "targetMax", registryById);
  const modeParam = request.mode ? mappedFieldParam(mapping, "mode", registryById) : null;

  const staged: AssignStagedChange[] = [
    { role: "enabled", param: enabledParam!, value: 1 },
    { role: "source", param: sourceParam!, value: sourceValue! },
    { role: "target", param: targetWriteParam!, value: targetValue! },
    { role: "targetMin", param: targetMinParam!, value: request.min },
    { role: "targetMax", param: targetMaxParam!, value: request.max },
  ];

  if (request.mode && modeParam) {
    staged.push({ role: "mode", param: modeParam, value: modeValue! });
  }

  const badValue = staged.find((change) => !valueFitsParameter(change.param, change.value));
  if (badValue) {
    return mappingNeeded(
      `${badValue.param.displayName} cannot hold the ${badValue.role} value ${badValue.value}.`,
      [`${badValue.role} value ${badValue.value} outside ${badValue.param.id} range`],
      request.slot,
    );
  }

  return {
    ok: true,
    status: "staged",
    slot: request.slot,
    source: { ...source, modes: [...source.modes] },
    target: assignTargetOption(targetParam),
    mode: request.mode,
    min: request.min,
    max: request.max,
    staged,
    missing: [],
  };
}

function isAssignableTarget(param: ParameterDefinition) {
  return isMappedRegistryTarget(param) && hasWriteMapping(param) && ASSIGN_TARGET_VALUES_BY_PARAMETER_ID[param.id] !== undefined;
}

function isMappedRegistryTarget(param: ParameterDefinition) {
  return param.section !== "assigns" && param.hardwareVerificationStatus !== "unmapped";
}

function assignTargetOption(param: ParameterDefinition): AssignTargetOption {
  const range = getAssignTargetRange(param);
  return {
    id: param.id,
    label: param.label,
    displayName: param.displayName,
    moduleId: param.moduleId,
    section: param.section,
    kind: param.kind,
    min: range.min,
    max: range.max,
    step: range.step,
    unit: param.unit,
    verificationStatus: param.hardwareVerificationStatus,
    parameter: param,
  };
}

function hasWriteMapping(param: ParameterDefinition) {
  return Boolean(param.writeMapping?.address?.length && param.writeMapping?.size?.length);
}

function isAssignSlotNumber(slot: number): slot is AssignSlotNumber {
  return ASSIGN_SLOTS.includes(slot as AssignSlotNumber);
}

function requiredRoles(mode?: AssignMode): AssignWriteRole[] {
  return mode ? ["enabled", "source", "target", "targetMin", "targetMax", "mode"] : ["enabled", "source", "target", "targetMin", "targetMax"];
}

function missingMappingRequirements(
  mapping: AssignSlotMapping | null | undefined,
  registryById: ReadonlyMap<string, ParameterDefinition>,
  sourceId?: AssignSourceId,
  targetParameterId?: string,
  mode?: AssignMode,
) {
  if (!mapping) {
    return ["assign slot mapping"];
  }

  const missing: string[] = [];

  for (const role of requiredRoles(mode)) {
    const paramId = mapping.fields[role];
    if (!paramId) {
      missing.push(`${role} write parameter`);
      continue;
    }

    const param = registryById.get(paramId);
    if (!param) {
      missing.push(`${role} write parameter ${paramId}`);
      continue;
    }

    if (!hasWriteMapping(param)) {
      missing.push(`${role} write mapping for ${paramId}`);
    }
  }

  if (sourceId && mapping.sourceValues?.[sourceId] === undefined) {
    missing.push(`source value for ${sourceId}`);
  }

  if (targetParameterId && mapping.targetValues?.[targetParameterId] === undefined) {
    missing.push(`target value for ${targetParameterId}`);
  }

  if (mode && mapping.modeValues?.[mode] === undefined) {
    missing.push(`mode value for ${mode}`);
  }

  return missing;
}

function mappedFieldParam(
  mapping: AssignSlotMapping,
  role: AssignWriteRole,
  registryById: ReadonlyMap<string, ParameterDefinition>,
) {
  const paramId = mapping.fields[role];
  return paramId ? registryById.get(paramId) ?? null : null;
}

function rangeIsValid(min: number, max: number, targetMin: number, targetMax: number) {
  return Number.isFinite(min) && Number.isFinite(max) && min <= max && min >= targetMin && max <= targetMax;
}

function valueFitsParameter(param: ParameterDefinition, value: number) {
  const range = getAssignTargetRange(param);
  return rangeIsValid(value, value, range.min, range.max);
}

function rejected(code: Exclude<AssignActionErrorCode, "MAPPING_NEEDED">, reason: string, slot?: number): AssignStageFailure {
  return {
    ok: false,
    status: "rejected",
    code,
    reason,
    slot,
    staged: [],
    missing: [],
  };
}

function mappingNeeded(reason: string, missing: string[], slot?: number): AssignStageFailure {
  return {
    ok: false,
    status: "mapping-needed",
    code: "MAPPING_NEEDED",
    reason,
    slot,
    staged: [],
    missing,
  };
}
