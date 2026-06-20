import {
  MODULES,
  PARAMETERS,
  PARAMETERS_BY_ADDRESS,
  PARAMETERS_BY_ID,
  UNMAPPED_PARAMETER_TODOS,
  createInitialParameterValues,
  decodeParameterValue,
  encodeParameterValue,
  makeMappedPatchReadMessages,
  makeParameterMessage,
  makeParameterReadMessage,
  type ParameterDefinition,
} from "../data/gr55Parameters";
import { USER_PATCHES, type UserPatch } from "../data/gr55PatchMap";
import { addressKey } from "../lib/midiMessages";
import { parseMappedPatchMessages, type ParsedMappedPatchMessages } from "../lib/patchImport";
import {
  makePatchNameReadMessage,
  makePatchNameWriteMessage,
  validatePatchName,
} from "../lib/patchName";
import {
  DEFAULT_DEVICE_ID,
  bankSelectMsb,
  identityRequest,
  makeSaveUserPatchMessage,
  programChange,
  toHex,
} from "../lib/roland";
import {
  classifyImportedSysExMessages,
  parseImportedSysEx,
  serializeMessagesAsHex,
  type ImportedSysExMessage,
} from "../lib/sysexLibrary";

type JsonObject = Record<string, unknown>;
type JsonSchema = {
  type: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: readonly unknown[];
  additionalProperties?: boolean | JsonSchema;
};

export type McpTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
};

export type BridgeStatus = {
  ok: boolean;
  connected: boolean;
  state: "idle" | "pending" | "ready" | "error";
  message?: string;
  sentCount?: number;
};

export type ReadbackExpectation = {
  patchName?: string;
  values?: Record<string, number>;
};

export type ReadbackMismatch = {
  field: string;
  expected: unknown;
  actual: unknown;
};

export type ReadbackResult = {
  ok: boolean;
  verified: boolean;
  mismatches: ReadbackMismatch[];
};

export type BridgeSendResult = {
  ok: boolean;
  label: string;
  bytes: number[];
};

export type Gr55Bridge = {
  status(): Promise<BridgeStatus>;
  connect(): Promise<BridgeStatus>;
  send(bytes: readonly number[], label: string): Promise<BridgeSendResult>;
  readPatchName(): Promise<string>;
  writePatchName(name: string): Promise<void>;
  readParameter(param: ParameterDefinition): Promise<number>;
  writeParameter(param: ParameterDefinition, value: number): Promise<void>;
  backupUserPatch(patch: UserPatch, messages: readonly ImportedSysExMessage[]): Promise<void>;
  saveUserPatch(patch: UserPatch): Promise<void>;
  verifyReadback(expected: ReadbackExpectation): Promise<ReadbackResult>;
  importSysEx(messages: readonly ImportedSysExMessage[]): Promise<ParsedMappedPatchMessages>;
};

export type MockBridgeOptions = {
  connected?: boolean;
  patchName?: string;
  values?: Record<string, number>;
};

export type MockBridge = Gr55Bridge & {
  sentLabels: string[];
  sentMessages: { label: string; bytes: number[] }[];
  values: Record<string, number>;
  savedSlots: Map<string, { patchName: string; values: Record<string, number> }>;
};

export type McpContext = {
  bridge: Gr55Bridge;
  deviceId: number;
  midiChannel: number;
  selectedPatch: UserPatch | null;
  patchLoaded: boolean;
  patchName: string;
  values: Record<string, number>;
  originalValues: Record<string, number>;
  stagedValues: Record<string, number>;
  stagedPatchName: string | null;
  backedUpSlots: Set<string>;
  backups: Map<string, { at: string; messages: ImportedSysExMessage[] }>;
  lastImportedMessages: ImportedSysExMessage[];
};

export type CreateMcpContextOptions = {
  bridge?: Gr55Bridge;
  deviceId?: number;
  midiChannel?: number;
};

const REQUIRED_TOOL_NAMES = [
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

type ToolName = (typeof REQUIRED_TOOL_NAMES)[number];
type ToolHandler = (context: McpContext, args: JsonObject) => Promise<unknown>;

const stringSchema = (description?: string): JsonSchema => ({ type: "string", description });
const numberSchema = (description?: string): JsonSchema => ({ type: "number", description });
const booleanSchema = (description?: string): JsonSchema => ({ type: "boolean", description });
const objectSchema = (
  properties: Record<string, JsonSchema> = {},
  required: string[] = [],
  additionalProperties: boolean | JsonSchema = false,
): JsonSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties,
});

const arraySchema = (items: JsonSchema, description?: string): JsonSchema => ({
  type: "array",
  description,
  items,
});

const slotInputSchema = objectSchema({
  bank: numberSchema("USER bank, 1 through 99."),
  slot: numberSchema("USER slot, 1 through 3."),
});

const parameterIdSchema = objectSchema({
  id: stringSchema("Mapped parameter id."),
});

const toolSchemas: Record<ToolName, Pick<McpTool, "description" | "inputSchema" | "outputSchema">> = {
  gr55_status: {
    description: "Return bridge, selection, staging and save-safety status.",
    inputSchema: objectSchema(),
    outputSchema: objectSchema({}, [], true),
  },
  gr55_connect: {
    description: "Connect the configured bridge transport.",
    inputSchema: objectSchema(),
    outputSchema: objectSchema({}, [], true),
  },
  gr55_identify: {
    description: "Send the GR-55 identity request SysEx message.",
    inputSchema: objectSchema(),
    outputSchema: objectSchema({}, [], true),
  },
  gr55_select_user_patch: {
    description: "Select a GR-55 USER patch by bank and slot.",
    inputSchema: slotInputSchema,
    outputSchema: objectSchema({}, [], true),
  },
  gr55_read_patch: {
    description: "Read the patch name and mapped temporary-patch parameters.",
    inputSchema: objectSchema({
      bank: numberSchema("Optional USER bank."),
      slot: numberSchema("Optional USER slot."),
    }),
    outputSchema: objectSchema({}, [], true),
  },
  gr55_read_mapped_parameters: {
    description: "Read all currently mapped parameters and patch name.",
    inputSchema: objectSchema({
      bank: numberSchema("Optional USER bank."),
      slot: numberSchema("Optional USER slot."),
    }),
    outputSchema: objectSchema({}, [], true),
  },
  gr55_get_patch_name: {
    description: "Read the temporary patch name.",
    inputSchema: objectSchema(),
    outputSchema: objectSchema({}, [], true),
  },
  gr55_set_patch_name: {
    description: "Stage or send a temporary patch-name write.",
    inputSchema: objectSchema({
      name: stringSchema("Printable ASCII patch name, 16 characters or fewer."),
      mode: { type: "string", enum: ["staged", "live"] },
    }, ["name"]),
    outputSchema: objectSchema({}, [], true),
  },
  gr55_get_parameter: {
    description: "Read one mapped parameter by id.",
    inputSchema: parameterIdSchema,
    outputSchema: objectSchema({}, [], true),
  },
  gr55_set_parameter: {
    description: "Stage or send one mapped parameter value.",
    inputSchema: objectSchema({
      id: stringSchema("Mapped parameter id."),
      value: numberSchema("Decoded parameter value."),
      mode: { type: "string", enum: ["staged", "live"] },
    }, ["id", "value"]),
    outputSchema: objectSchema({}, [], true),
  },
  gr55_send_staged: {
    description: "Send all staged temporary-memory patch edits.",
    inputSchema: objectSchema(),
    outputSchema: objectSchema({}, [], true),
  },
  gr55_save_user_patch: {
    description: "Save temporary memory to the selected USER slot after safety and backup checks.",
    inputSchema: objectSchema({
      bank: numberSchema("Must match the selected USER bank when provided."),
      slot: numberSchema("Must match the selected USER slot when provided."),
      safety: booleanSchema("Required true flag for destructive save."),
    }, ["safety"]),
    outputSchema: objectSchema({}, [], true),
  },
  gr55_export_mapped_patch: {
    description: "Export the mapped patch as JSON, readable SysEx text, or binary .syx base64.",
    inputSchema: objectSchema({
      bank: numberSchema("Optional USER bank metadata."),
      slot: numberSchema("Optional USER slot metadata."),
      format: { type: "string", enum: ["json", "txt", "syx"] },
    }, ["format"]),
    outputSchema: objectSchema({}, [], true),
  },
  gr55_import_sysex: {
    description: "Parse imported SysEx into mapped patch fields, optionally sending it to temporary memory.",
    inputSchema: objectSchema({
      content: stringSchema("Hex text or base64 SysEx payload."),
      encoding: { type: "string", enum: ["hex", "base64"] },
      send: booleanSchema("When true, sends messages to temporary memory."),
      safety: booleanSchema("Required when send is true."),
    }, ["content"]),
    outputSchema: objectSchema({}, [], true),
  },
  gr55_backup_user_73_3: {
    description: "Run the mapped backup workflow for USER 73-3 and mark that slot backed up.",
    inputSchema: objectSchema(),
    outputSchema: objectSchema({}, [], true),
  },
  gr55_verify_readback: {
    description: "Verify patch name and mapped values against bridge readback.",
    inputSchema: objectSchema({
      patchName: stringSchema("Expected patch name. Defaults to context value."),
      values: objectSchema({}, [], { type: "number" }),
    }),
    outputSchema: objectSchema({}, [], true),
  },
  gr55_list_parameters: {
    description: "List mapped GR-55 parameter metadata.",
    inputSchema: objectSchema(),
    outputSchema: objectSchema({
      parameters: arraySchema(objectSchema({}, [], true)),
    }, ["parameters"], true),
  },
  gr55_list_unmapped_todos: {
    description: "List known unmapped or intentionally excluded parameter work.",
    inputSchema: objectSchema(),
    outputSchema: objectSchema({
      todos: arraySchema(objectSchema({}, [], true)),
    }, ["todos"], true),
  },
  gr55_safety_report: {
    description: "Explain current backup and save eligibility.",
    inputSchema: objectSchema(),
    outputSchema: objectSchema({}, [], true),
  },
};

const TOOL_DEFINITIONS: McpTool[] = REQUIRED_TOOL_NAMES.map((name) => ({
  name,
  ...toolSchemas[name],
}));

const TOOL_HANDLERS: Record<ToolName, ToolHandler> = {
  gr55_status: async (context) => statusReport(context, await context.bridge.status()),
  gr55_connect: async (context) => {
    const status = await context.bridge.connect();
    return statusReport(context, status);
  },
  gr55_identify: async (context) => {
    await assertConnected(context);
    const bytes = identityRequest();
    const sent = await context.bridge.send(bytes, "Identity request");
    return { ok: sent.ok, label: sent.label, bytes: toHex(sent.bytes) };
  },
  gr55_select_user_patch: async (context, args) => {
    await assertConnected(context);
    const patch = requireUserPatch(requiredInteger(args, "bank"), requiredInteger(args, "slot"));
    await selectUserPatch(context, patch);
    return { ok: true, slot: slotTitle(patch), bankMsb: patch.bankMsb, program: patch.program };
  },
  gr55_read_patch: async (context, args) => {
    const result = await readMappedParameters(context, resolvePatchFromOptionalArgs(context, args));
    return { ...result, kind: "mapped-patch" };
  },
  gr55_read_mapped_parameters: async (context, args) => readMappedParameters(context, resolvePatchFromOptionalArgs(context, args)),
  gr55_get_patch_name: async (context) => {
    await assertConnected(context);
    const patchName = await context.bridge.readPatchName();
    context.patchName = patchName;
    return { ok: true, patchName };
  },
  gr55_set_patch_name: async (context, args) => {
    await assertConnected(context);
    const name = requiredString(args, "name");
    const validation = validatePatchName(name);
    if (!validation.valid) {
      throw new Error(validation.reason ?? "Invalid patch name.");
    }

    const mode = optionalString(args, "mode") ?? "staged";
    if (mode === "staged") {
      context.stagedPatchName = name;
      context.patchName = name;
      return { ok: true, staged: true, patchName: name };
    }

    if (mode !== "live") {
      throw new Error(`Unsupported patch name write mode: ${mode}`);
    }

    const sent = await context.bridge.send(makePatchNameWriteMessage(name, context.deviceId), `Patch name: ${name || "(blank)"}`);
    await context.bridge.writePatchName(name);
    context.patchName = name;
    context.stagedPatchName = null;
    return { ok: sent.ok, staged: false, patchName: name };
  },
  gr55_get_parameter: async (context, args) => {
    await assertConnected(context);
    const param = requireParameter(requiredString(args, "id"));
    const value = await context.bridge.readParameter(param);
    context.values[param.id] = value;
    return { ok: true, parameter: parameterMetadata(param), value };
  },
  gr55_set_parameter: async (context, args) => {
    await assertConnected(context);
    const param = requireParameter(requiredString(args, "id"));
    const value = normalizeParameterValue(param, requiredNumber(args, "value"));
    const mode = optionalString(args, "mode") ?? "staged";

    context.values[param.id] = value;

    if (mode === "staged") {
      context.stagedValues[param.id] = value;
      return { ok: true, id: param.id, value, staged: true };
    }

    if (mode !== "live") {
      throw new Error(`Unsupported parameter write mode: ${mode}`);
    }

    const sent = await context.bridge.send(parameterWriteMessage(context, param, value), parameterWriteLabel(param, value));
    await context.bridge.writeParameter(param, value);
    delete context.stagedValues[param.id];
    return { ok: sent.ok, id: param.id, value, staged: false };
  },
  gr55_send_staged: async (context) => sendStaged(context),
  gr55_save_user_patch: async (context, args) => saveUserPatch(context, args),
  gr55_export_mapped_patch: async (context, args) => exportMappedPatch(context, requiredString(args, "format")),
  gr55_import_sysex: async (context, args) => importSysEx(context, args),
  gr55_backup_user_73_3: async (context) => backupUser733(context),
  gr55_verify_readback: async (context, args) => {
    const expected = readbackExpectationFromArgs(context, args);
    return context.bridge.verifyReadback(expected);
  },
  gr55_list_parameters: async () => ({
    ok: true,
    count: PARAMETERS.length,
    parameters: PARAMETERS.map(parameterMetadata),
  }),
  gr55_list_unmapped_todos: async () => ({
    ok: true,
    count: UNMAPPED_PARAMETER_TODOS.length,
    todos: UNMAPPED_PARAMETER_TODOS,
  }),
  gr55_safety_report: async (context) => safetyReport(context),
};

export function createMockBridge(options: MockBridgeOptions = {}): MockBridge {
  let connected = options.connected ?? false;
  let patchName = options.patchName ?? "INIT PATCH";
  const values = { ...createInitialParameterValues(), ...(options.values ?? {}) };
  const sentLabels: string[] = [];
  const sentMessages: { label: string; bytes: number[] }[] = [];
  const savedSlots = new Map<string, { patchName: string; values: Record<string, number> }>();

  return {
    sentLabels,
    sentMessages,
    values,
    savedSlots,
    async status() {
      return {
        ok: true,
        connected,
        state: connected ? "ready" : "idle",
        sentCount: sentLabels.length,
      };
    },
    async connect() {
      connected = true;
      return {
        ok: true,
        connected,
        state: "ready",
        sentCount: sentLabels.length,
      };
    },
    async send(bytes, label) {
      const sent = Array.from(bytes);
      sentLabels.push(label);
      sentMessages.push({ label, bytes: sent });
      return { ok: true, label, bytes: sent };
    },
    async readPatchName() {
      return patchName;
    },
    async writePatchName(name) {
      patchName = name;
    },
    async readParameter(param) {
      return values[param.id] ?? param.defaultValue;
    },
    async writeParameter(param, value) {
      values[param.id] = normalizeParameterValue(param, value);
    },
    async backupUserPatch() {
      return;
    },
    async saveUserPatch(patch) {
      savedSlots.set(slotKey(patch), {
        patchName,
        values: cloneValues(values),
      });
    },
    async verifyReadback(expected) {
      const mismatches: ReadbackMismatch[] = [];

      if (expected.patchName !== undefined && expected.patchName !== patchName) {
        mismatches.push({ field: "patchName", expected: expected.patchName, actual: patchName });
      }

      for (const [id, expectedValue] of Object.entries(expected.values ?? {})) {
        const param = PARAMETERS_BY_ID.get(id);
        const actual = values[id] ?? param?.defaultValue;
        if (actual !== expectedValue) {
          mismatches.push({ field: id, expected: expectedValue, actual });
        }
      }

      return { ok: mismatches.length === 0, verified: mismatches.length === 0, mismatches };
    },
    async importSysEx(messages) {
      const parsed = parseMappedPatchMessages(messages);

      if (parsed.patchName !== undefined) {
        patchName = parsed.patchName;
      }

      for (const [id, value] of Object.entries(parsed.values)) {
        values[id] = value;
      }

      return parsed;
    },
  };
}

export function createMcpContext(options: CreateMcpContextOptions = {}): McpContext {
  return {
    bridge: options.bridge ?? createMockBridge(),
    deviceId: options.deviceId ?? DEFAULT_DEVICE_ID,
    midiChannel: options.midiChannel ?? 1,
    selectedPatch: null,
    patchLoaded: false,
    patchName: "",
    values: createInitialParameterValues(),
    originalValues: createInitialParameterValues(),
    stagedValues: {},
    stagedPatchName: null,
    backedUpSlots: new Set<string>(),
    backups: new Map<string, { at: string; messages: ImportedSysExMessage[] }>(),
    lastImportedMessages: [],
  };
}

export function listMcpTools(): McpTool[] {
  return TOOL_DEFINITIONS.map((tool) => ({
    ...tool,
    inputSchema: cloneSchema(tool.inputSchema),
    outputSchema: cloneSchema(tool.outputSchema),
  }));
}

export async function callMcpTool(context: McpContext, name: string, args: unknown): Promise<JsonObject> {
  if (!isToolName(name)) {
    throw new Error(`Unknown GR-55 MCP tool: ${name}`);
  }

  return (await TOOL_HANDLERS[name](context, asObject(args))) as JsonObject;
}

async function selectUserPatch(context: McpContext, patch: UserPatch) {
  await context.bridge.send(bankSelectMsb(context.midiChannel, patch.bankMsb), `Bank MSB ${patch.bankMsb}`);
  await context.bridge.send(programChange(context.midiChannel, patch.program), `Select USER ${patch.label}`);
  context.selectedPatch = patch;
  context.patchLoaded = false;
  context.patchName = "";
  context.values = createInitialParameterValues();
  context.originalValues = createInitialParameterValues();
  context.stagedValues = {};
  context.stagedPatchName = null;
}

async function readMappedParameters(context: McpContext, patch: UserPatch) {
  await assertConnected(context);
  if (context.selectedPatch?.userIndex !== patch.userIndex) {
    await selectUserPatch(context, patch);
  }

  await context.bridge.send(makePatchNameReadMessage(context.deviceId), "Read patch name");
  const patchName = await context.bridge.readPatchName();
  const nextValues: Record<string, number> = {};
  const messages = makeMappedPatchReadMessages(context.deviceId);

  for (const message of messages) {
    await context.bridge.send(message.bytes, message.label);
    nextValues[message.param.id] = await context.bridge.readParameter(message.param);
  }

  context.patchName = patchName;
  context.values = { ...createInitialParameterValues(), ...nextValues };
  context.originalValues = cloneValues(context.values);
  context.patchLoaded = true;
  context.stagedValues = {};
  context.stagedPatchName = null;

  return {
    ok: true,
    slot: slotTitle(patch),
    patchName,
    mappedCount: PARAMETERS.length,
    values: cloneValues(context.values),
  };
}

async function sendStaged(context: McpContext) {
  await assertConnected(context);
  let sentCount = 0;

  if (context.stagedPatchName !== null) {
    const name = context.stagedPatchName;
    const sent = await context.bridge.send(makePatchNameWriteMessage(name, context.deviceId), `Patch name: ${name || "(blank)"}`);
    if (sent.ok) {
      sentCount += 1;
    }
    await context.bridge.writePatchName(name);
    context.patchName = name;
    context.stagedPatchName = null;
  }

  for (const [id, value] of Object.entries(context.stagedValues)) {
    const param = requireParameter(id);
    const sent = await context.bridge.send(parameterWriteMessage(context, param, value), parameterWriteLabel(param, value));
    if (sent.ok) {
      sentCount += 1;
    }
    await context.bridge.writeParameter(param, value);
  }

  context.stagedValues = {};
  return { ok: true, sentCount };
}

async function saveUserPatch(context: McpContext, args: JsonObject) {
  await assertConnected(context);
  const selectedPatch = requireSelectedPatch(context);

  if (args.bank !== undefined || args.slot !== undefined) {
    const target = requireUserPatch(requiredInteger(args, "bank"), requiredInteger(args, "slot"));
    if (target.userIndex !== selectedPatch.userIndex) {
      throw new Error(`Save target ${slotTitle(target)} does not match selected ${slotTitle(selectedPatch)}.`);
    }
  }

  if (args.safety !== true) {
    throw new Error("Save requires an explicit safety flag.");
  }

  if (!context.backedUpSlots.has(slotKey(selectedPatch))) {
    throw new Error(`Save blocked: backup status is missing for ${slotTitle(selectedPatch)}.`);
  }

  await sendStaged(context);
  const sent = await context.bridge.send(
    makeSaveUserPatchMessage(selectedPatch.userIndex, context.deviceId),
    `Save temp to ${slotTitle(selectedPatch)}`,
  );
  await context.bridge.saveUserPatch(selectedPatch);
  const readback = await context.bridge.verifyReadback({
    patchName: context.patchName,
    values: cloneValues(context.values),
  });

  return {
    ok: sent.ok && readback.verified,
    slot: slotTitle(selectedPatch),
    verified: readback.verified,
    mismatches: readback.mismatches,
  };
}

function exportMappedPatch(context: McpContext, format: string) {
  if (!["json", "txt", "syx"].includes(format)) {
    throw new Error(`Unsupported export format: ${format}`);
  }

  const selectedPatch = requireSelectedPatch(context);
  if (!context.patchLoaded) {
    throw new Error("Read mapped parameters before exporting a mapped patch.");
  }

  const messages = makeMappedPatchMessages(context);

  if (format === "json") {
    return {
      ok: true,
      format,
      filename: `gr55-user-${selectedPatch.label}-mapped-patch.json`,
      content: {
        kind: "gr55-control-room.mapped-patch",
        slot: patchMetadata(selectedPatch),
        patchName: context.patchName,
        hardwareVerification: "mapped-export-only; full raw bulk backup is not implemented",
        parameters: PARAMETERS.map((param) => ({
          ...parameterMetadata(param),
          value: context.values[param.id] ?? param.defaultValue,
        })),
      },
    };
  }

  if (format === "txt") {
    return {
      ok: true,
      format,
      filename: `gr55-user-${selectedPatch.label}-mapped-patch.txt`,
      content: serializeMessagesAsHex(messages),
    };
  }

  return {
    ok: true,
    format,
    filename: `gr55-user-${selectedPatch.label}-mapped-patch.syx`,
    content: bytesToBase64(messages.flatMap((message) => message.bytes)),
  };
}

async function importSysEx(context: McpContext, args: JsonObject) {
  await assertConnected(context);
  const content = requiredString(args, "content");
  const encoding = optionalString(args, "encoding") ?? "hex";
  const messages =
    encoding === "base64"
      ? parseImportedSysEx(base64ToBytes(content))
      : encoding === "hex"
        ? parseImportedSysEx(content)
        : (() => {
            throw new Error(`Unsupported import encoding: ${encoding}`);
          })();

  if (args.send === true) {
    if (args.safety !== true) {
      throw new Error("Sending imported SysEx requires an explicit safety flag.");
    }

    for (const message of messages) {
      await context.bridge.send(message.bytes, message.label);
    }
  }

  const classification = classifyImportedSysExMessages(messages, {
    knownAddressKeys: new Set(PARAMETERS_BY_ADDRESS.keys()),
    mappedParameterCount: PARAMETERS.length,
  });
  const parsed = await context.bridge.importSysEx(messages);

  if (parsed.patchName !== undefined) {
    context.patchName = parsed.patchName;
  }

  context.values = { ...context.values, ...parsed.values };
  context.patchLoaded = parsed.mappedMessages > 0 || parsed.patchNameMessages > 0;
  context.lastImportedMessages = messages.map((message) => ({ label: message.label, bytes: [...message.bytes] }));

  return {
    ok: true,
    classification,
    parsed,
    messageCount: messages.length,
  };
}

async function backupUser733(context: McpContext) {
  await assertConnected(context);
  const patch = requireUserPatch(73, 3);
  await readMappedParameters(context, patch);
  const messages = makeMappedPatchMessages(context);

  await context.bridge.backupUserPatch(patch, messages);
  context.backedUpSlots.add(slotKey(patch));
  context.backups.set(slotKey(patch), {
    at: new Date().toISOString(),
    messages: messages.map((message) => ({ label: message.label, bytes: [...message.bytes] })),
  });

  return {
    ok: true,
    slot: slotTitle(patch),
    messageCount: messages.length,
    backupStatus: "complete",
  };
}

function statusReport(context: McpContext, bridgeStatus?: BridgeStatus) {
  const selectedPatch = context.selectedPatch;
  return {
    ok: true,
    bridge: bridgeStatus,
    selectedSlot: selectedPatch ? slotTitle(selectedPatch) : null,
    patchLoaded: context.patchLoaded,
    patchName: context.patchName,
    stagedCount: Object.keys(context.stagedValues).length + (context.stagedPatchName === null ? 0 : 1),
    backedUpSlots: [...context.backedUpSlots].map(slotKeyToTitle),
    canSave: selectedPatch ? context.backedUpSlots.has(slotKey(selectedPatch)) : false,
  };
}

function safetyReport(context: McpContext) {
  const selectedPatch = context.selectedPatch;
  const issues: string[] = [];

  if (!selectedPatch) {
    issues.push("No USER slot selected.");
  } else if (!context.backedUpSlots.has(slotKey(selectedPatch))) {
    issues.push(`No backup is recorded for ${slotTitle(selectedPatch)}.`);
  }

  if (Object.keys(context.stagedValues).length || context.stagedPatchName !== null) {
    issues.push("Staged edits have not been sent to temporary memory.");
  }

  return {
    ok: true,
    selectedSlot: selectedPatch ? slotTitle(selectedPatch) : null,
    backupRecorded: selectedPatch ? context.backedUpSlots.has(slotKey(selectedPatch)) : false,
    destructiveSaveRequiresSafetyFlag: true,
    canSaveWithSafetyFlag: issues.length === 0,
    issues,
  };
}

function makeMappedPatchMessages(context: McpContext): ImportedSysExMessage[] {
  return [
    {
      label: "Patch name",
      bytes: makePatchNameWriteMessage(context.patchName, context.deviceId),
    },
    ...MODULES.flatMap((module) =>
      module.parameters.map((param) => ({
        label: `${module.shortTitle} ${param.label}`,
        bytes: makeParameterMessage(param, context.values[param.id] ?? param.defaultValue, context.deviceId),
      })),
    ),
  ];
}

function readbackExpectationFromArgs(context: McpContext, args: JsonObject): ReadbackExpectation {
  return {
    patchName: optionalString(args, "patchName") ?? context.patchName,
    values: isRecordOfNumbers(args.values) ? args.values : cloneValues(context.values),
  };
}

async function assertConnected(context: McpContext) {
  const status = await context.bridge.status();
  if (!status.connected || status.state !== "ready") {
    throw new Error("GR-55 bridge is not connected.");
  }
}

function resolvePatchFromOptionalArgs(context: McpContext, args: JsonObject) {
  if (args.bank !== undefined || args.slot !== undefined) {
    return requireUserPatch(requiredInteger(args, "bank"), requiredInteger(args, "slot"));
  }

  return requireSelectedPatch(context);
}

function requireSelectedPatch(context: McpContext) {
  if (!context.selectedPatch) {
    throw new Error("Select a USER slot first.");
  }

  return context.selectedPatch;
}

function requireUserPatch(bank: number, slot: number) {
  const patch = USER_PATCHES.find((candidate) => candidate.bank === bank && candidate.slot === slot);
  if (!patch) {
    throw new Error("USER patch must use bank 1-99 and slot 1-3.");
  }

  return patch;
}

function requireParameter(id: string) {
  const param = PARAMETERS_BY_ID.get(id);
  if (!param) {
    throw new Error(`Unknown mapped parameter id: ${id}`);
  }

  return param;
}

function normalizeParameterValue(param: ParameterDefinition, value: number) {
  return decodeParameterValue(param, encodeParameterValue(param, value));
}

function parameterWriteMessage(context: McpContext, param: ParameterDefinition, value: number) {
  return makeParameterMessage(param, value, context.deviceId);
}

function parameterWriteLabel(param: ParameterDefinition, value: number) {
  return `${param.moduleId.toUpperCase()} ${param.label}: ${String(value)}`;
}

function parameterMetadata(param: ParameterDefinition) {
  return {
    id: param.id,
    moduleId: param.moduleId,
    section: param.section,
    displayName: param.displayName,
    label: param.label,
    kind: param.kind,
    type: param.type,
    min: param.min,
    max: param.max,
    step: param.step,
    unit: param.unit,
    defaultValue: param.defaultValue,
    options: param.options,
    address: toHex(param.address),
    addressKey: addressKey(param.address),
    parser: param.parser,
    serializer: param.serializer,
    uiGroup: param.uiGroup,
    dependencies: param.dependencies,
    hardwareVerificationStatus: param.hardwareVerificationStatus,
    source: param.source,
  };
}

function patchMetadata(patch: UserPatch) {
  return {
    label: slotTitle(patch),
    userIndex: patch.userIndex,
    bank: patch.bank,
    slot: patch.slot,
    bankMsb: patch.bankMsb,
    program: patch.program,
  };
}

function slotTitle(patch: UserPatch) {
  return `USER ${patch.label}`;
}

function slotKey(patch: UserPatch) {
  return `${patch.bank}-${patch.slot}`;
}

function slotKeyToTitle(key: string) {
  return `USER ${key}`;
}

function isToolName(name: string): name is ToolName {
  return REQUIRED_TOOL_NAMES.includes(name as ToolName);
}

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as JsonObject;
}

function requiredString(args: JsonObject, key: string) {
  const value = args[key];
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string.`);
  }

  return value;
}

function optionalString(args: JsonObject, key: string) {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${key} must be a string.`);
  }

  return value;
}

function requiredNumber(args: JsonObject, key: string) {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number.`);
  }

  return value;
}

function requiredInteger(args: JsonObject, key: string) {
  const value = requiredNumber(args, key);
  if (!Number.isInteger(value)) {
    throw new Error(`${key} must be an integer.`);
  }

  return value;
}

function isRecordOfNumbers(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((item) => typeof item === "number" && Number.isFinite(item));
}

function cloneValues(values: Record<string, number>) {
  return { ...values };
}

function cloneSchema(schema: JsonSchema): JsonSchema {
  return JSON.parse(JSON.stringify(schema)) as JsonSchema;
}

function bytesToBase64(bytes: readonly number[]) {
  let binary = "";

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(index, index + 0x8000));
  }

  return globalThis.btoa(binary);
}

function base64ToBytes(input: string) {
  const binary = globalThis.atob(input);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
