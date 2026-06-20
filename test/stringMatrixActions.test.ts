import { describe, expect, it } from "vitest";
import { createInitialParameterValues, PARAMETERS_BY_ID } from "../src/data/gr55Parameters";
import {
  buildStringMatrixModel,
  copyStringRowToAll,
  muteStringRow,
  normalizeAllStringLevels,
  restoreStringRow,
  scaleStringLevelsByPercent,
  soloStringRow,
} from "../src/lib/actions/stringMatrix";

describe("String Matrix pure actions", () => {
  it("mutes only mapped level params for the requested row", () => {
    const model = buildStringMatrixModel();
    const result = muteStringRow(model, 2);

    expect(result.safe).toBe(true);
    expect(changesById(result.changes)).toEqual({
      pcm1String2Level: 0,
      pcm2String2Level: 0,
      modelingString2Level: 0,
    });
  });

  it("solos a row only when all mapped level rows are present", () => {
    const fullModel = buildStringMatrixModel();
    const fullResult = soloStringRow(fullModel, 4);

    expect(fullResult.safe).toBe(true);
    expect(fullResult.changes).toHaveLength(15);
    expect(fullResult.changes.some((change) => change.param.id.includes("String4"))).toBe(false);
    expect(fullResult.changes.every((change) => change.value === 0)).toBe(true);

    const partialRegistry = new Map(PARAMETERS_BY_ID);
    partialRegistry.delete("pcm2String6Level");
    const partialModel = buildStringMatrixModel(partialRegistry);
    const partialResult = soloStringRow(partialModel, 4);

    expect(partialResult.safe).toBe(false);
    expect(partialResult.changes).toEqual([]);
    expect(partialResult.reason).toMatch(/all mapped level params/i);
  });

  it("restores a row from original values and falls back to defaults", () => {
    const model = buildStringMatrixModel();
    const originalValues = {
      pcm1String3Level: 12,
      modelingString3Level: 44,
    };

    const result = restoreStringRow(model, 3, originalValues);

    expect(result.safe).toBe(true);
    expect(changesById(result.changes)).toEqual({
      pcm1String3Level: 12,
      pcm2String3Level: 100,
      modelingString3Level: 44,
    });
  });

  it("copies one row to every mapped string row by source column", () => {
    const model = buildStringMatrixModel();
    const values = {
      ...createInitialParameterValues(),
      pcm1String2Level: 21,
      pcm2String2Level: 34,
      modelingString2Level: 55,
    };

    const result = copyStringRowToAll(model, 2, values);

    expect(result.safe).toBe(true);
    expect(result.changes).toHaveLength(18);
    expect(changesById(result.changes)).toMatchObject({
      pcm1String1Level: 21,
      pcm2String4Level: 34,
      modelingString6Level: 55,
    });
  });

  it("normalizes and scales mapped level params with clamping", () => {
    const model = buildStringMatrixModel();
    const values = {
      ...createInitialParameterValues(),
      pcm1String1Level: 33,
      pcm2String1Level: 80,
      modelingString1Level: 3,
      pcm1String2Level: 90,
    };

    expect(normalizeAllStringLevels(model).changes.every((change) => change.value === 100)).toBe(true);

    const halfResult = scaleStringLevelsByPercent(model, values, 50);
    expect(changesById(halfResult.changes)).toMatchObject({
      pcm1String1Level: 17,
      pcm2String1Level: 40,
      modelingString1Level: 2,
    });

    const boostedResult = scaleStringLevelsByPercent(model, values, 150);
    expect(changesById(boostedResult.changes)).toMatchObject({
      pcm1String2Level: 100,
    });
  });
});

function changesById(changes: readonly { param: { id: string }; value: number }[]) {
  return Object.fromEntries(changes.map((change) => [change.param.id, change.value]));
}
