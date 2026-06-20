import { describe, expect, it } from "vitest";
import {
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
] as const;

describe("GR-55 MCP server tool contract", () => {
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
});
