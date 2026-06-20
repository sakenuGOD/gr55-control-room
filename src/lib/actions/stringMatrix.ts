import { PARAMETERS_BY_ID, type ParameterDefinition } from "../../data/gr55Parameters";

export type ParameterValues = Record<string, number>;
export type StringNumber = 1 | 2 | 3 | 4 | 5 | 6;
export type StringMatrixColumnRole =
  | "level"
  | "normal-pu"
  | "routing"
  | "pitch"
  | "coarse"
  | "fine"
  | "source-enable";

export type StringMatrixCell = {
  stringNumber: StringNumber;
  expectedParamId: string;
  param: ParameterDefinition | null;
};

export type StringMatrixColumn = {
  key: string;
  label: string;
  role: StringMatrixColumnRole;
  levelActionEligible: boolean;
  cells: readonly StringMatrixCell[];
  mappedCount: number;
};

export type StringMatrixMappingNeeded = {
  key: string;
  label: string;
  reason: string;
  missingParamIds: readonly string[];
};

export type StringMatrixModel = {
  columns: readonly StringMatrixColumn[];
  levelColumns: readonly StringMatrixColumn[];
  mappingNeeded: readonly StringMatrixMappingNeeded[];
  canSoloRows: boolean;
};

export type StringMatrixChange = {
  param: ParameterDefinition;
  value: number;
};

export type StringMatrixActionResult = {
  safe: boolean;
  changes: readonly StringMatrixChange[];
  reason?: string;
};

type ColumnDefinition = {
  key: string;
  label: string;
  role: StringMatrixColumnRole;
  levelActionEligible?: boolean;
  paramId: (stringNumber: StringNumber) => string;
  reason?: string;
};

export const STRING_NUMBERS = [1, 2, 3, 4, 5, 6] as const satisfies readonly StringNumber[];

const LEVEL_COLUMN_DEFINITIONS: readonly ColumnDefinition[] = [
  {
    key: "pcm1-level",
    label: "PCM1 Level",
    role: "level",
    levelActionEligible: true,
    paramId: (stringNumber) => `pcm1String${stringNumber}Level`,
  },
  {
    key: "pcm2-level",
    label: "PCM2 Level",
    role: "level",
    levelActionEligible: true,
    paramId: (stringNumber) => `pcm2String${stringNumber}Level`,
  },
  {
    key: "modeling-level",
    label: "Modeling Level",
    role: "level",
    levelActionEligible: true,
    paramId: (stringNumber) => `modelingString${stringNumber}Level`,
  },
];

const OPTIONAL_COLUMN_DEFINITIONS: readonly ColumnDefinition[] = [
  {
    key: "normal-pu-level",
    label: "Normal PU",
    role: "normal-pu",
    paramId: (stringNumber) => `normalPuString${stringNumber}Level`,
    reason: "Normal PU per-string level cells need mapped temporary-patch params before they can be edited here.",
  },
  {
    key: "normal-pu-enable",
    label: "NPU Enable",
    role: "source-enable",
    paramId: (stringNumber) => `normalPuString${stringNumber}Switch`,
    reason: "Normal PU source enable cells need mapped per-string switch params. The global pickup switch is not a string-row control.",
  },
  {
    key: "pcm1-enable",
    label: "PCM1 Enable",
    role: "source-enable",
    paramId: (stringNumber) => `pcm1String${stringNumber}Switch`,
    reason: "PCM1 source enable cells need mapped per-string switch params. The global PCM1 switch is not a string-row control.",
  },
  {
    key: "pcm2-enable",
    label: "PCM2 Enable",
    role: "source-enable",
    paramId: (stringNumber) => `pcm2String${stringNumber}Switch`,
    reason: "PCM2 source enable cells need mapped per-string switch params. The global PCM2 switch is not a string-row control.",
  },
  {
    key: "modeling-enable",
    label: "Modeling Enable",
    role: "source-enable",
    paramId: (stringNumber) => `modelingString${stringNumber}Switch`,
    reason: "Modeling source enable cells need mapped per-string switch params. The global Modeling switch is not a string-row control.",
  },
  {
    key: "pcm1-routing",
    label: "PCM1 Routing",
    role: "routing",
    paramId: (stringNumber) => `pcm1String${stringNumber}Routing`,
    reason: "PCM1 routing cells need mapped per-string routing params. Global output select is intentionally not duplicated by row.",
  },
  {
    key: "pcm2-routing",
    label: "PCM2 Routing",
    role: "routing",
    paramId: (stringNumber) => `pcm2String${stringNumber}Routing`,
    reason: "PCM2 routing cells need mapped per-string routing params. Global output select is intentionally not duplicated by row.",
  },
  {
    key: "modeling-routing",
    label: "Modeling Routing",
    role: "routing",
    paramId: (stringNumber) => `modelingString${stringNumber}Routing`,
    reason: "Modeling routing cells need mapped per-string routing params before they can be edited here.",
  },
  {
    key: "pcm1-pitch",
    label: "PCM1 Pitch",
    role: "pitch",
    paramId: (stringNumber) => `pcm1String${stringNumber}PitchShift`,
    reason: "PCM1 pitch cells need mapped per-string pitch params. The global coarse/fine tune fields are not string-row controls.",
  },
  {
    key: "pcm1-coarse",
    label: "PCM1 Coarse",
    role: "coarse",
    paramId: (stringNumber) => `pcm1String${stringNumber}CoarseTune`,
    reason: "PCM1 coarse cells need mapped per-string coarse tune params. The global coarse tune field is not duplicated by row.",
  },
  {
    key: "pcm1-fine",
    label: "PCM1 Fine",
    role: "fine",
    paramId: (stringNumber) => `pcm1String${stringNumber}FineTune`,
    reason: "PCM1 fine cells need mapped per-string fine tune params. The global fine tune field is not duplicated by row.",
  },
  {
    key: "pcm2-pitch",
    label: "PCM2 Pitch",
    role: "pitch",
    paramId: (stringNumber) => `pcm2String${stringNumber}PitchShift`,
    reason: "PCM2 pitch cells need mapped per-string pitch params. The global coarse/fine tune fields are not string-row controls.",
  },
  {
    key: "pcm2-coarse",
    label: "PCM2 Coarse",
    role: "coarse",
    paramId: (stringNumber) => `pcm2String${stringNumber}CoarseTune`,
    reason: "PCM2 coarse cells need mapped per-string coarse tune params. The global coarse tune field is not duplicated by row.",
  },
  {
    key: "pcm2-fine",
    label: "PCM2 Fine",
    role: "fine",
    paramId: (stringNumber) => `pcm2String${stringNumber}FineTune`,
    reason: "PCM2 fine cells need mapped per-string fine tune params. The global fine tune field is not duplicated by row.",
  },
  {
    key: "modeling-pitch",
    label: "Modeling Pitch",
    role: "pitch",
    paramId: (stringNumber) => `modelingString${stringNumber}PitchShift`,
    reason: "Modeling pitch cells need mapped per-string pitch params. The global Modeling pitch shift is not a string-row control.",
  },
  {
    key: "modeling-fine",
    label: "Modeling Fine",
    role: "fine",
    paramId: (stringNumber) => `modelingString${stringNumber}FineShift`,
    reason: "Modeling fine cells need mapped per-string fine params. The global Modeling fine shift is not a string-row control.",
  },
];

export function buildStringMatrixModel(
  registry: ReadonlyMap<string, ParameterDefinition> = PARAMETERS_BY_ID,
): StringMatrixModel {
  const levelColumns = LEVEL_COLUMN_DEFINITIONS.map((definition) => buildColumn(definition, registry)).filter(
    (column) => column.mappedCount > 0,
  );
  const optionalColumns = OPTIONAL_COLUMN_DEFINITIONS.map((definition) => buildColumn(definition, registry));
  const mappedOptionalColumns = optionalColumns.filter((column) => column.mappedCount > 0);
  const mappingNeeded = OPTIONAL_COLUMN_DEFINITIONS.map((definition) => mappingNeededFor(definition, registry)).filter(
    (item): item is StringMatrixMappingNeeded => Boolean(item),
  );

  return {
    columns: [...levelColumns, ...mappedOptionalColumns],
    levelColumns,
    mappingNeeded,
    canSoloRows: levelColumns.length === LEVEL_COLUMN_DEFINITIONS.length && levelColumns.every(isFullyMapped),
  };
}

export function muteStringRow(model: StringMatrixModel, stringNumber: StringNumber): StringMatrixActionResult {
  return actionResult(mappedLevelParamsForString(model, stringNumber).map((param) => changeFor(param, 0)));
}

export function soloStringRow(model: StringMatrixModel, stringNumber: StringNumber): StringMatrixActionResult {
  if (!model.canSoloRows) {
    return {
      safe: false,
      changes: [],
      reason: "Solo row requires all mapped level params for strings 1-6.",
    };
  }

  const changes = STRING_NUMBERS.filter((targetString) => targetString !== stringNumber).flatMap((targetString) =>
    mappedLevelParamsForString(model, targetString).map((param) => changeFor(param, 0)),
  );

  return actionResult(changes);
}

export function restoreStringRow(
  model: StringMatrixModel,
  stringNumber: StringNumber,
  originalValues: ParameterValues,
): StringMatrixActionResult {
  return actionResult(
    mappedLevelParamsForString(model, stringNumber).map((param) => changeFor(param, originalValues[param.id] ?? param.defaultValue)),
  );
}

export function copyStringRowToAll(
  model: StringMatrixModel,
  sourceStringNumber: StringNumber,
  values: ParameterValues,
): StringMatrixActionResult {
  const changes = STRING_NUMBERS.flatMap((targetStringNumber) =>
    model.levelColumns.flatMap((column) => {
      const sourceParam = cellForString(column, sourceStringNumber)?.param;
      const targetParam = cellForString(column, targetStringNumber)?.param;

      if (!sourceParam || !targetParam) {
        return [];
      }

      return [changeFor(targetParam, values[sourceParam.id] ?? sourceParam.defaultValue)];
    }),
  );

  return actionResult(changes);
}

export function normalizeAllStringLevels(model: StringMatrixModel): StringMatrixActionResult {
  return actionResult(mappedLevelParams(model).map((param) => changeFor(param, 100)));
}

export function scaleStringLevelsByPercent(
  model: StringMatrixModel,
  values: ParameterValues,
  percent: number,
): StringMatrixActionResult {
  const factor = Math.max(0, percent) / 100;
  return actionResult(
    mappedLevelParams(model).map((param) => changeFor(param, (values[param.id] ?? param.defaultValue) * factor)),
  );
}

export function cellForString(column: StringMatrixColumn, stringNumber: StringNumber) {
  return column.cells.find((cell) => cell.stringNumber === stringNumber) ?? null;
}

function buildColumn(definition: ColumnDefinition, registry: ReadonlyMap<string, ParameterDefinition>): StringMatrixColumn {
  const cells = STRING_NUMBERS.map((stringNumber) => {
    const expectedParamId = definition.paramId(stringNumber);
    return {
      stringNumber,
      expectedParamId,
      param: registry.get(expectedParamId) ?? null,
    };
  });

  return {
    key: definition.key,
    label: definition.label,
    role: definition.role,
    levelActionEligible: Boolean(definition.levelActionEligible),
    cells,
    mappedCount: cells.filter((cell) => cell.param).length,
  };
}

function mappingNeededFor(
  definition: ColumnDefinition,
  registry: ReadonlyMap<string, ParameterDefinition>,
): StringMatrixMappingNeeded | null {
  const missingParamIds = STRING_NUMBERS.map(definition.paramId).filter((paramId) => !registry.has(paramId));

  if (!missingParamIds.length) {
    return null;
  }

  return {
    key: definition.key,
    label: definition.label,
    reason: definition.reason ?? `${definition.label} needs mapped per-string temporary-patch params before it can be edited here.`,
    missingParamIds,
  };
}

function mappedLevelParams(model: StringMatrixModel) {
  return STRING_NUMBERS.flatMap((stringNumber) => mappedLevelParamsForString(model, stringNumber));
}

function mappedLevelParamsForString(model: StringMatrixModel, stringNumber: StringNumber) {
  return model.levelColumns
    .map((column) => cellForString(column, stringNumber)?.param ?? null)
    .filter((param): param is ParameterDefinition => Boolean(param));
}

function isFullyMapped(column: StringMatrixColumn) {
  return column.mappedCount === STRING_NUMBERS.length;
}

function actionResult(changes: readonly StringMatrixChange[]): StringMatrixActionResult {
  return {
    safe: true,
    changes,
  };
}

function changeFor(param: ParameterDefinition, value: number): StringMatrixChange {
  return {
    param,
    value: normalizeParameterValue(param, value),
  };
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
