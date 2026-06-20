import { describe, expect, it } from "vitest";
import {
  applyMappedReadResponse,
  createMappedReadProgress,
  markMappedReadPartial,
} from "../src/lib/readProgress";

describe("mapped read progress", () => {
  it("tracks unique mapped parameter responses until the read is complete", () => {
    const progress = createMappedReadProgress(["18:00:02:30", "18:00:06:07"]);

    expect(progress).toMatchObject({ status: "reading", expected: 2, received: 0 });

    const afterFirst = applyMappedReadResponse(progress, "18:00:02:30");
    expect(afterFirst).toMatchObject({ status: "reading", expected: 2, received: 1 });

    const afterDuplicate = applyMappedReadResponse(afterFirst, "18:00:02:30");
    expect(afterDuplicate).toMatchObject({ status: "reading", expected: 2, received: 1 });

    const afterUnknown = applyMappedReadResponse(afterDuplicate, "18:00:07:00");
    expect(afterUnknown).toMatchObject({ status: "reading", expected: 2, received: 1 });

    const complete = applyMappedReadResponse(afterUnknown, "18:00:06:07");
    expect(complete).toMatchObject({ status: "complete", expected: 2, received: 2 });
  });

  it("can mark an unfinished mapped read as partial without claiming completion", () => {
    const progress = applyMappedReadResponse(createMappedReadProgress(["a", "b", "c"]), "b");

    expect(markMappedReadPartial(progress)).toMatchObject({
      status: "partial",
      expected: 3,
      received: 1,
    });
  });
});
