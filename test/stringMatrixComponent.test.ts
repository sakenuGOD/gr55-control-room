import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StringMatrix } from "../src/components/editor/StringMatrix";
import { createInitialParameterValues } from "../src/data/gr55Parameters";

describe("StringMatrix component", () => {
  it("renders mapped level controls with inspector metadata and no unmapped fake sliders", () => {
    const values = {
      ...createInitialParameterValues(),
      pcm1String1Level: 70,
    };
    const originalValues = {
      ...createInitialParameterValues(),
      pcm1String1Level: 100,
    };

    const html = renderToStaticMarkup(
      createElement(StringMatrix, {
        values,
        originalValues,
        onChange: () => undefined,
      }),
    );

    expect(count(html, 'type="range"')).toBe(18);
    expect(html).toContain('data-string-number="1"');
    expect(html).toContain('data-string-number="6"');
    expect(html).toContain('data-param-id="pcm1String1Level"');
    expect(html).toContain('data-dirty="true"');
    expect(html).toContain('data-hardware-status="verified"');
    expect(html).toContain('data-address="18 00 20 10"');
    expect(html).toContain("Address 18 00 20 10");

    expect(html).not.toContain('data-param-id="normalPuString1Level"');
    expect(html).not.toContain('data-param-id="pcm1String1CoarseTune"');
    expect(html).not.toContain('data-param-id="pcm1String1FineTune"');
    expect(html).not.toContain('data-param-id="pcm1String1Routing"');
    expect(html).not.toContain('data-param-id="pcm1String1Switch"');

    expect(html).toContain("Developer mapping needed");
    expect(html).toContain("Normal PU");
    expect(html).toContain("routing");
    expect(html).toContain("pitch");
    expect(html).toContain("coarse");
    expect(html).toContain("fine");
    expect(html).toContain("source enable");
  });
});

function count(input: string, needle: string) {
  return input.split(needle).length - 1;
}
