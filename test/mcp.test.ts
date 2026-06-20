import { afterEach, describe, expect, it, vi } from "vitest";
import { PARAMETERS_BY_ID, makeParameterMessage } from "../src/data/gr55Parameters";
import {
  type Gr55Bridge,
  createMockBridge,
  createMcpContext,
  listMcpTools,
  callMcpTool,
} from "../src/mcp/server";

const REQUIRED_TOOLS = [
  "gr55_status",
  "gr55_connect",
  "gr55_identify",
  "gr55_select_user_patch",
  "gr55_read_patch",
  "gr55_read_mapped_parameters",
  "gr55_get_patch_name",
  "gr55_set_patch_name",
  "gr55_get_parameter",
  "gr55_set_parameter",
  "gr55_send_staged",
  "gr55_save_user_patch",
  "gr55_export_mapped_patch",
  "gr55_import_sysex",
  "gr55_backup_user_73_3",
  "gr55_verify_readback",
  "gr55_list_parameters",
  "gr55_list_unmapped_todos",
  "gr55_safety_report",
  "gr55_list_controls",
  "gr55_list_strings",
  "gr55_get_string_matrix",
  "gr55_set_string_level",
  "gr55_mute_string",
  "gr55_restore_string",
  "gr55_normalize_strings",
  "gr55_list_assigns",
  "gr55_get_assign",
  "gr55_stage_assign",
  "gr55_list_physical_controls",
  "gr55_list_assign_targets",
  "gr55_stage_control_mapping",
  "gr55_save_with_readback",
  "gr55_import_preview",
] as const;

describe("GR-55 MCP server tool contract", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes the required MCP tool catalog with schemas", () => {
    const tools = listMcpTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([...REQUIRED_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(tool.outputSchema).toMatchObject({ type: "object" });
    }
  });

  it("blocks destructive save without explicit safety flag and backup state", async () => {
    const bridge = createMockBridge();
    const context = createMcpContext({ bridge });

    await callMcpTool(context, "gr55_connect", {});
    await callMcpTool(context, "gr55_select_user_patch", { bank: 73, slot: 3 });

    await expect(callMcpTool(context, "gr55_save_user_patch", { bank: 73, slot: 3 })).rejects.toThrow(
      /safety flag/i,
    );
    await expect(
      callMcpTool(context, "gr55_save_user_patch", { bank: 73, slot: 3, safety: true }),
    ).rejects.toThrow(/backup/i);
  });

  it("runs USER 73-3 safe backup, staged write, save and readback verify through the mock bridge", async () => {
    const bridge = createMockBridge({
      patchName: "GHOSTLY",
      values: {
        pcm1Level: 65,
      },
    });
    const context = createMcpContext({ bridge });

    await callMcpTool(context, "gr55_connect", {});
    await callMcpTool(context, "gr55_select_user_patch", { bank: 73, slot: 3 });
    const backup = await callMcpTool(context, "gr55_backup_user_73_3", {});
    expect(backup).toMatchObject({ ok: true, slot: "USER 73-3" });

    await callMcpTool(context, "gr55_set_parameter", {
      id: "pcm1Level",
      value: 66,
      mode: "staged",
    });
    await callMcpTool(context, "gr55_send_staged", {});
    const saved = await callMcpTool(context, "gr55_save_user_patch", {
      bank: 73,
      slot: 3,
      safety: true,
    });

    expect(saved).toMatchObject({
      ok: true,
      slot: "USER 73-3",
      verified: true,
    });
    expect(bridge.sentLabels.some((label) => label.includes("Save temp to USER 73-3"))).toBe(true);
  });

  it("exports mapped patches as JSON, readable text and binary syx", async () => {
    const bridge = createMockBridge({ patchName: "GHOSTLY", values: { pcm1Level: 65 } });
    const context = createMcpContext({ bridge });

    await callMcpTool(context, "gr55_connect", {});
    await callMcpTool(context, "gr55_select_user_patch", { bank: 73, slot: 3 });
    await callMcpTool(context, "gr55_read_mapped_parameters", { bank: 73, slot: 3 });

    const json = await callMcpTool(context, "gr55_export_mapped_patch", {
      bank: 73,
      slot: 3,
      format: "json",
    });
    const txt = await callMcpTool(context, "gr55_export_mapped_patch", {
      bank: 73,
      slot: 3,
      format: "txt",
    });
    const syx = await callMcpTool(context, "gr55_export_mapped_patch", {
      bank: 73,
      slot: 3,
      format: "syx",
    });

    expect(json).toMatchObject({ format: "json" });
    expect(String(txt.content)).toContain("F0 41");
    expect(syx).toMatchObject({ format: "syx" });
    expect(String(syx.content)).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("exposes and programs the mapped string level matrix through the mock bridge", async () => {
    const bridge = createMockBridge({
      connected: true,
      values: {
        pcm1String1Level: 34,
        pcm2String1Level: 56,
        modelingString1Level: 78,
      },
    });
    const context = createMcpContext({ bridge });

    const strings = await callMcpTool(context, "gr55_list_strings", {});
    expect(strings).toMatchObject({ ok: true, count: 6 });

    const matrix = await callMcpTool(context, "gr55_get_string_matrix", {});
    expect(matrix).toMatchObject({ ok: true });
    expect(matrix.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          string: 1,
          values: {
            pcm1: 34,
            pcm2: 56,
            modeling: 78,
          },
        }),
      ]),
    );

    const staged = await callMcpTool(context, "gr55_set_string_level", {
      string: 1,
      source: "pcm1",
      value: 120,
    });
    expect(staged).toMatchObject({
      ok: true,
      staged: true,
      changed: [{ id: "pcm1String1Level", value: 100 }],
    });
    expect(context.stagedValues.pcm1String1Level).toBe(100);

    const muted = await callMcpTool(context, "gr55_mute_string", { string: 1, mode: "live" });
    expect(muted).toMatchObject({ ok: true, staged: false });
    expect(bridge.values.pcm1String1Level).toBe(0);
    expect(bridge.values.pcm2String1Level).toBe(0);
    expect(bridge.values.modelingString1Level).toBe(0);

    const restored = await callMcpTool(context, "gr55_restore_string", { string: 1 });
    expect(restored).toMatchObject({
      ok: true,
      staged: true,
      changed: expect.arrayContaining([
        expect.objectContaining({ id: "pcm1String1Level", value: 34 }),
        expect.objectContaining({ id: "pcm2String1Level", value: 56 }),
        expect.objectContaining({ id: "modelingString1Level", value: 78 }),
      ]),
    });

    const normalized = await callMcpTool(context, "gr55_normalize_strings", {});
    expect(normalized).toMatchObject({ ok: true, staged: true, changedCount: 18 });
    expect(context.stagedValues.modelingString6Level).toBe(100);
  });

  it("lists controls and rejects assign/control mapping for unmapped targets", async () => {
    const context = createMcpContext({ bridge: createMockBridge({ connected: true }) });

    await expect(callMcpTool(context, "gr55_list_controls", {})).resolves.toMatchObject({
      ok: true,
      count: expect.any(Number),
      controls: expect.arrayContaining([expect.objectContaining({ id: "pcm1Level" })]),
    });
    await expect(callMcpTool(context, "gr55_list_assigns", {})).resolves.toMatchObject({
      ok: true,
      count: 0,
      assignMappingsAvailable: false,
    });
    await expect(callMcpTool(context, "gr55_list_physical_controls", {})).resolves.toMatchObject({
      ok: true,
      controls: expect.arrayContaining([expect.objectContaining({ id: "ctl", controller: 80 })]),
    });
    await expect(callMcpTool(context, "gr55_list_assign_targets", {})).resolves.toMatchObject({
      ok: true,
      targets: expect.arrayContaining([expect.objectContaining({ id: "pcm1Level" })]),
    });
    await expect(callMcpTool(context, "gr55_get_assign", { assign: 1 })).rejects.toThrow(/assign.*unmapped/i);
    await expect(
      callMcpTool(context, "gr55_stage_assign", { assign: 1, targetId: "rawAssignableTarget", value: 64 }),
    ).rejects.toThrow(/unknown mapped parameter/i);
    await expect(
      callMcpTool(context, "gr55_stage_control_mapping", { controlId: "ctl", targetId: "rawAssignableTarget" }),
    ).rejects.toThrow(/unknown mapped parameter/i);
    await expect(
      callMcpTool(context, "gr55_stage_control_mapping", { controlId: "ctl", targetId: "pcm1Level" }),
    ).rejects.toThrow(/assign.*unmapped/i);
  });

  it("reports save-with-readback mismatches instead of claiming success", async () => {
    const baseBridge = createMockBridge({ connected: true, patchName: "GHOSTLY", values: { pcm1Level: 65 } });
    const bridge: Gr55Bridge = {
      ...baseBridge,
      async verifyReadback() {
        return {
          ok: false,
          verified: false,
          mismatches: [{ field: "pcm1Level", expected: 66, actual: 65 }],
        };
      },
    };
    const context = createMcpContext({ bridge });

    await callMcpTool(context, "gr55_select_user_patch", { bank: 73, slot: 3 });
    await callMcpTool(context, "gr55_backup_user_73_3", {});
    await callMcpTool(context, "gr55_set_parameter", { id: "pcm1Level", value: 66 });
    const saved = await callMcpTool(context, "gr55_save_with_readback", {
      bank: 73,
      slot: 3,
      safety: true,
    });

    expect(saved).toMatchObject({
      ok: false,
      verified: false,
      mismatches: [{ field: "pcm1Level", expected: 66, actual: 65 }],
    });
  });

  it("previews imports without sending SysEx or mutating current values", async () => {
    const bridge = createMockBridge({ connected: true, values: { pcm1Level: 65 } });
    const context = createMcpContext({ bridge });
    const pcm1Level = PARAMETERS_BY_ID.get("pcm1Level");
    expect(pcm1Level).toBeDefined();
    const content = bytesToHex(makeParameterMessage(pcm1Level!, 66, 0x10));

    const preview = await callMcpTool(context, "gr55_import_preview", { content });

    expect(preview).toMatchObject({
      ok: true,
      messageCount: 1,
      parsed: {
        values: { pcm1Level: 66 },
        mappedMessages: 1,
      },
      wouldSend: false,
    });
    expect(bridge.sentLabels).toEqual([]);
    expect(context.values.pcm1Level).toBe(80);
  });

  it("surfaces bridge send failures and times out stalled bridge calls", async () => {
    const failingBridge: Gr55Bridge = {
      ...createMockBridge({ connected: true }),
      async send() {
        throw new Error("bridge send failed");
      },
    };
    await expect(
      callMcpTool(createMcpContext({ bridge: failingBridge }), "gr55_set_string_level", {
        string: 1,
        source: "pcm1",
        value: 60,
        mode: "live",
      }),
    ).rejects.toThrow(/bridge send failed/i);

    vi.useFakeTimers();
    const stalledBridge: Gr55Bridge = {
      ...createMockBridge(),
      async status() {
        return new Promise(() => undefined);
      },
    };
    const pending = callMcpTool(createMcpContext({ bridge: stalledBridge }), "gr55_get_string_matrix", {});
    const timeoutExpectation = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(30_001);
    await timeoutExpectation;
  });
});

function bytesToHex(bytes: readonly number[]) {
  return bytes.map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}
