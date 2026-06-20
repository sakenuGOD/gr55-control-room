import {
  PARAMETERS_BY_ADDRESS,
  decodeParameterValue,
} from "../data/gr55Parameters";
import { PATCH_NAME_ADDRESS, decodePatchName } from "./patchName";
import { addressKey, parseIncomingMidiMessage } from "./midiMessages";
import type { ImportedSysExMessage } from "./sysexLibrary";

export type ParsedMappedPatchMessages = {
  patchName?: string;
  values: Record<string, number>;
  mappedMessages: number;
  patchNameMessages: number;
  checksumErrors: number;
  unmappedMessages: number;
};

export function parseMappedPatchMessages(messages: readonly ImportedSysExMessage[]): ParsedMappedPatchMessages {
  const parsed: ParsedMappedPatchMessages = {
    values: {},
    mappedMessages: 0,
    patchNameMessages: 0,
    checksumErrors: 0,
    unmappedMessages: 0,
  };
  const patchNameKey = addressKey(PATCH_NAME_ADDRESS);

  for (const message of messages) {
    const event = parseIncomingMidiMessage(message.bytes);
    if (event.type !== "roland-data") {
      parsed.unmappedMessages += 1;
      continue;
    }

    if (!event.checksumValid) {
      parsed.checksumErrors += 1;
      continue;
    }

    const key = addressKey(event.address);
    if (key === patchNameKey) {
      parsed.patchName = decodePatchName(event.valueBytes);
      parsed.patchNameMessages += 1;
      continue;
    }

    const param = PARAMETERS_BY_ADDRESS.get(key);
    if (!param) {
      parsed.unmappedMessages += 1;
      continue;
    }

    parsed.values[param.id] = decodeParameterValue(param, event.valueBytes);
    parsed.mappedMessages += 1;
  }

  return parsed;
}
