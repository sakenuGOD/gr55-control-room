export type MappedReadStatus = "idle" | "reading" | "partial" | "complete";

export type MappedReadProgress = {
  status: MappedReadStatus;
  expected: number;
  received: number;
  expectedKeys: string[];
  receivedKeys: string[];
};

export function createIdleMappedReadProgress(expected = 0): MappedReadProgress {
  return {
    status: "idle",
    expected,
    received: 0,
    expectedKeys: [],
    receivedKeys: [],
  };
}

export function createMappedReadProgress(expectedKeys: readonly string[]): MappedReadProgress {
  const uniqueKeys = [...new Set(expectedKeys)];
  return {
    status: uniqueKeys.length ? "reading" : "complete",
    expected: uniqueKeys.length,
    received: 0,
    expectedKeys: uniqueKeys,
    receivedKeys: [],
  };
}

export function applyMappedReadResponse(progress: MappedReadProgress, addressKey: string): MappedReadProgress {
  if (!progress.expectedKeys.includes(addressKey) || progress.receivedKeys.includes(addressKey)) {
    return progress;
  }

  const receivedKeys = [...progress.receivedKeys, addressKey];
  return {
    ...progress,
    status: receivedKeys.length >= progress.expectedKeys.length ? "complete" : "reading",
    received: receivedKeys.length,
    receivedKeys,
  };
}

export function markMappedReadPartial(progress: MappedReadProgress): MappedReadProgress {
  if (progress.status === "complete" || progress.status === "idle") {
    return progress;
  }

  return {
    ...progress,
    status: "partial",
  };
}
