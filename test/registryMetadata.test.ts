import { describe, expect, it } from "vitest";
import {
  PARAMETERS,
  PARAMETERS_BY_ID,
  UNMAPPED_PARAMETER_TODOS,
  type ParameterDefinition,
} from "../src/data/gr55Parameters";

describe("GR-55 parameter registry metadata discipline", () => {
  it("does not silently mark parameters verified by omission", () => {
    const verified = PARAMETERS.filter((param) => param.hardwareVerificationStatus === "verified");

    expect(verified.map((param) => param.id).sort()).toEqual([
      "delayLevel",
      "eqLowGain",
      "modelingString1Level",
      "pcm1Level",
      "pcm1String1Level",
    ]);
  });

  it("requires source and grouping metadata for every mapped parameter", () => {
    const missing = PARAMETERS.filter((param) => !hasRegistryMetadata(param));

    expect(missing.map((param) => param.id)).toEqual([]);
  });

  it("marks inactive modeling model selectors with category dependencies", () => {
    expect(PARAMETERS_BY_ID.get("modelingElectricGuitarType")?.dependencies).toContainEqual({
      parameterId: "modelingCategory",
      equals: 0,
    });
    expect(PARAMETERS_BY_ID.get("modelingAcousticType")?.dependencies).toContainEqual({
      parameterId: "modelingCategory",
      equals: 1,
    });
    expect(PARAMETERS_BY_ID.get("modelingBassType")?.dependencies).toContainEqual({
      parameterId: "modelingCategory",
      equals: 2,
    });
    expect(PARAMETERS_BY_ID.get("modelingSynthType")?.dependencies).toContainEqual({
      parameterId: "modelingCategory",
      equals: 3,
    });
  });

  it("classifies per-string mapped controls separately from global controls", () => {
    for (let stringNumber = 1; stringNumber <= 6; stringNumber += 1) {
      expect(PARAMETERS_BY_ID.get(`pcm1String${stringNumber}Level`)?.uiGroup).toBe("string");
      expect(PARAMETERS_BY_ID.get(`pcm2String${stringNumber}Level`)?.uiGroup).toBe("string");
      expect(PARAMETERS_BY_ID.get(`modelingString${stringNumber}Level`)?.uiGroup).toBe("string");
    }
  });

  it("keeps assign and model-specific unknowns in explicit unmapped todos", () => {
    expect(UNMAPPED_PARAMETER_TODOS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "assignTargets" }),
        expect.objectContaining({ id: "modelingTypeSpecificControls" }),
        expect.objectContaining({ id: "mfxTypeSpecificControls" }),
        expect.objectContaining({ id: "modTypeSpecificControls" }),
      ]),
    );
  });
});

function hasRegistryMetadata(param: ParameterDefinition) {
  return Boolean(
    param.id &&
      param.section &&
      param.displayName &&
      param.type &&
      param.readMapping &&
      param.writeMapping &&
      param.parser &&
      param.serializer &&
      param.uiControl &&
      param.hardwareVerificationStatus &&
      param.source &&
      param.uiGroup,
  );
}
