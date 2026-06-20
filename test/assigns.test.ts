import { describe, expect, it } from "vitest";
import { PARAMETERS_BY_ID, type ParameterDefinition } from "../src/data/gr55Parameters";
import {
  listAssignTargets,
  listPhysicalAssignControls,
  stageAssignControlMapping,
  type AssignSlotMapping,
} from "../src/lib/actions/assigns";

describe("assign programmer actions", () => {
  it("lists the physical GR-55 controls and mapped registry targets", () => {
    const controls = listPhysicalAssignControls();

    expect(controls.map((control) => control.id)).toEqual([
      "ctlPedal",
      "expPedal",
      "expSwitch",
      "gkS1",
      "gkS2",
      "gkVolume",
    ]);
    expect(controls.find((control) => control.id === "ctlPedal")).toMatchObject({
      controller: 80,
      modes: ["toggle", "momentary"],
    });
    expect(controls.find((control) => control.id === "expSwitch")?.controller).toBeUndefined();
    expect(controls.find((control) => control.id === "gkS1")?.mappingStatus).toBe("mapped-control");

    const targets = listAssignTargets();
    const targetIds = targets.map((target) => target.id);

    expect(targetIds).toContain("delayLevel");
    expect(targetIds).toContain("pcm1Level");
    expect(targetIds).not.toContain("assignTargets");
    expect(targets.every((target) => Boolean(PARAMETERS_BY_ID.get(target.id)?.writeMapping))).toBe(true);
  });

  it("rejects unmapped targets, unwritable targets, bad ranges and unavailable modes", () => {
    expect(
      stageAssignControlMapping({
        slot: 1,
        sourceId: "ctlPedal",
        targetParameterId: "assignTargets",
        min: 0,
        max: 1,
        mode: "toggle",
      }),
    ).toMatchObject({ ok: false, code: "UNMAPPED_TARGET", staged: [] });

    const delayLevel = PARAMETERS_BY_ID.get("delayLevel");
    expect(delayLevel).toBeDefined();
    const registryById = new Map(PARAMETERS_BY_ID);
    registryById.set("delayLevel", { ...delayLevel, writeMapping: undefined } as unknown as ParameterDefinition);

    expect(
      stageAssignControlMapping({
        slot: 1,
        sourceId: "ctlPedal",
        targetParameterId: "delayLevel",
        min: 0,
        max: 120,
        mode: "toggle",
        registryById,
      }),
    ).toMatchObject({ ok: false, code: "TARGET_NOT_WRITABLE", staged: [] });

    expect(
      stageAssignControlMapping({
        slot: 1,
        sourceId: "ctlPedal",
        targetParameterId: "delayLevel",
        min: -1,
        max: 120,
        mode: "toggle",
      }),
    ).toMatchObject({ ok: false, code: "RANGE_OUT_OF_BOUNDS", staged: [] });

    expect(
      stageAssignControlMapping({
        slot: 1,
        sourceId: "expPedal",
        targetParameterId: "delayLevel",
        min: 0,
        max: 120,
        mode: "toggle",
      }),
    ).toMatchObject({ ok: false, code: "MODE_UNAVAILABLE", staged: [] });
  });

  it("stages mapped assign writes only when enough mapping exists", () => {
    const request = {
      slot: 1,
      sourceId: "ctlPedal" as const,
      targetParameterId: "delayLevel",
      min: 0,
      max: 120,
      mode: "toggle" as const,
    };

    expect(stageAssignControlMapping(request)).toMatchObject({
      ok: true,
      status: "staged",
    });
    const defaultStaged = stageAssignControlMapping(request);
    if (defaultStaged.ok) {
      expect(defaultStaged.staged.map((change) => [change.role, change.param.id, change.value])).toEqual([
        ["enabled", "assign1Switch", 1],
        ["source", "assign1Source", 0],
        ["target", "assign1Target", 495],
        ["targetMin", "assign1TargetMin", 0],
        ["targetMax", "assign1TargetMax", 120],
        ["mode", "assign1SourceMode", 1],
      ]);
      expect(defaultStaged.staged.map((change) => change.param.hardwareVerificationStatus)).toEqual([
        "read-verified",
        "read-verified",
        "read-verified",
        "fixture-only",
        "fixture-only",
        "fixture-only",
      ]);
    }

    const slotMappings: AssignSlotMapping[] = [
      {
        slot: 1,
        label: "Assign 1",
        fields: {
          enabled: "delaySwitch",
          source: "delayType",
          target: "delayFeedback",
          targetMin: "delayLevel",
          targetMax: "ampGain",
          mode: "chorusSwitch",
        },
        sourceValues: {
          ctlPedal: 1,
          expPedal: 2,
          expSwitch: 3,
          gkS1: 4,
          gkS2: 5,
          gkVolume: 6,
        },
        targetValues: {
          delayLevel: 64,
        },
        modeValues: {
          toggle: 1,
          momentary: 0,
        },
      },
    ];

    expect(
      stageAssignControlMapping({
        ...request,
        slotMappings: [{ ...slotMappings[0], fields: { enabled: "delaySwitch" } }],
      }),
    ).toMatchObject({ ok: false, code: "MAPPING_NEEDED", staged: [] });

    const staged = stageAssignControlMapping({ ...request, slotMappings });

    expect(staged.ok).toBe(true);
    if (staged.ok) {
      expect(staged.staged.map((change) => [change.role, change.param.id, change.value])).toEqual([
        ["enabled", "delaySwitch", 1],
        ["source", "delayType", 1],
        ["target", "delayFeedback", 64],
        ["targetMin", "delayLevel", 0],
        ["targetMax", "ampGain", 120],
        ["mode", "chorusSwitch", 1],
      ]);
    }
  });
});
