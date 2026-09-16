import { describe, it, expect } from "vitest";
import { extractMusterJson, stripPartialAppendix } from "./aiStructured";

describe("extractMusterJson", () => {
  it("extracts json and clean markdown when appendix is present", () => {
    const md = [
      "## Course Overview",
      "The exam weighs 50%.",
      '<!--MUSTER_JSON {"actions":[{"title":"Start HW1","dueAt":"2026-09-20","kind":"deadline"}],"priorities":[{"item":"HW1","level":"urgent","reason":"25% weight"}],"weeklyFocus":"Regression"} -->',
    ].join("\n");
    const { json, clean } = extractMusterJson(md);
    expect(json).not.toBeNull();
    expect(json!.actions).toHaveLength(1);
    expect(json!.actions![0].title).toBe("Start HW1");
    expect(json!.priorities![0].level).toBe("urgent");
    expect(json!.weeklyFocus).toBe("Regression");
    expect(clean).toBe("## Course Overview\nThe exam weighs 50%.");
  });

  it("parses appendix wrapped in a json code fence", () => {
    const md = [
      "Body text",
      "<!--MUSTER_JSON",
      "```json",
      '{"actions":[],"weeklyFocus":"Week 6"}',
      "```",
      "-->",
    ].join("\n");
    const { json, clean } = extractMusterJson(md);
    expect(json!.weeklyFocus).toBe("Week 6");
    expect(clean).toBe("Body text");
  });

  it("returns null json and original text when no marker", () => {
    const md = "## Just markdown\n- item";
    const { json, clean } = extractMusterJson(md);
    expect(json).toBeNull();
    expect(clean).toBe(md);
  });

  it("returns null json and strips only the appendix on invalid json", () => {
    const md = 'Body\n<!--MUSTER_JSON {"actions": [broken -->';
    const { json, clean } = extractMusterJson(md);
    expect(json).toBeNull();
    // Invalid payload still hides the broken appendix from the reader; body survives.
    expect(clean).toBe("Body");
  });

  it("returns null json on empty object appendix", () => {
    const md = "Body\n<!--MUSTER_JSON {} -->";
    const { json, clean } = extractMusterJson(md);
    // Empty object is valid but carries no payload; treat as no structured data.
    expect(json).toBeNull();
    expect(clean).toBe("Body");
  });

  it("normalizes level casing and drops invalid levels to normal", () => {
    const md =
      'Body\n<!--MUSTER_JSON {"priorities":[{"item":"A","level":"URGENT"},{"item":"B","level":"weird"},{"item":"C"}],"actions":[{"title":"keep"},{"noTitle":"drop"}]} -->';
    const { json } = extractMusterJson(md);
    expect(json!.priorities![0].level).toBe("urgent");
    expect(json!.priorities![1].level).toBe("normal");
    expect(json!.priorities![2].level).toBe("normal");
    expect(json!.actions).toHaveLength(1);
    expect(json!.actions![0].title).toBe("keep");
  });

  it("uses the last appendix when several appear", () => {
    const md =
      'A\n<!--MUSTER_JSON {"weeklyFocus":"old"} -->\nB\n<!--MUSTER_JSON {"weeklyFocus":"new"} -->';
    const { json, clean } = extractMusterJson(md);
    expect(json!.weeklyFocus).toBe("new");
    // Everything before the LAST marker is kept verbatim (including an earlier
    // appendix, which the model should never emit — but text context is
    // preserved rather than silently dropped).
    expect(clean).toBe('A\n<!--MUSTER_JSON {"weeklyFocus":"old"} -->\nB');
  });
});

describe("stripPartialAppendix", () => {
  it("removes an unclosed appendix while streaming", () => {
    const s = '## Overview\nSome text\n<!--MUSTER_JSON {"ac';
    expect(stripPartialAppendix(s)).toBe("## Overview\nSome text");
  });

  it("removes the marker line itself when it just started", () => {
    const s = "## Overview\nText\n<!--MUSTER_JSON";
    expect(stripPartialAppendix(s)).toBe("## Overview\nText");
  });

  it("keeps normal text untouched", () => {
    const s = "## Overview\nText without any marker";
    expect(stripPartialAppendix(s)).toBe(s);
  });

  it("keeps a fully closed appendix (extraction handles it at done-time)", () => {
    const s = 'Text\n<!--MUSTER_JSON {"actions":[]} -->';
    expect(stripPartialAppendix(s)).toBe(s);
  });
});
