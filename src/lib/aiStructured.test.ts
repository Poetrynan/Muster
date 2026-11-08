import { describe, it, expect } from "vitest";
import { extractMusterJson, extractMusterPayload, stripPartialAppendix } from "./aiStructured";

describe("extractMusterPayload", () => {
  it("returns custom raw guide cards with quoted delimiters and escaped quotes intact", () => {
    const payload = { schemaVersion: 1, cards: [{ kind: "plan", title: 'Review "-->" notation', sourceIds: ["resource:a"], factIds: [], suggestedMinutes: 15 }] };
    const text = `Prose<!--MUSTER_JSON {"weeklyFocus":"old"} -->\n<!--MUSTER_JSON ${JSON.stringify(payload)} -->`;
    expect(extractMusterPayload(text)).toEqual(payload);
    expect(extractMusterJson(text).json).toBeNull();
    expect(extractMusterJson(text).clean).toBe("Prose");
  });

  it("accepts fenced and unclosed but complete JSON without normalization", () => {
    expect(extractMusterPayload('<!--MUSTER_JSON\n```json\n{"custom":[0,false,null]}\n```\n-->')).toEqual({ custom: [0, false, null] });
    expect(extractMusterPayload('<!--MUSTER_JSON {"custom":"unfinished comment --> inside string"}')).toEqual({ custom: "unfinished comment --> inside string" });
    expect(extractMusterPayload('<!--MUSTER_JSON false -->')).toBe(false);
    expect(extractMusterPayload('<!--MUSTER_JSON [] -->')).toEqual([]);
  });

  it.each(["Plain prose", "<!--MUS", "<!--MUSTER_JSON", "<!--MUSTER_JSON broken -->", '<!--MUSTER_JSON {"old":true} --><!--MUSTER_JSON broken -->'])("returns null for absent or invalid last payload: %s", (text) => {
    expect(extractMusterPayload(text)).toBeNull();
  });
});

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
    expect(clean).toBe("A\n\nB");
  });

  it("parses string-contained delimiters without exposing appendix suffixes", () => {
    const payload = { weeklyFocus: 'Review "-->" and escaped slash \\ before class' };
    const text = `Earlier prose<!--MUSTER_JSON {"weeklyFocus":"old --> hidden"} -->\nMore prose<!--MUSTER_JSON ${JSON.stringify(payload)} -->`;
    const result = extractMusterJson(text);
    expect(result.clean).toBe("Earlier prose\nMore prose");
    expect(result.json?.weeklyFocus).toBe(payload.weeklyFocus);
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

  it("hides a fully closed appendix during streaming", () => {
    const s = 'Text\n<!--MUSTER_JSON {"actions":[]} -->';
    expect(stripPartialAppendix(s)).toBe("Text");
  });

  it("never exposes any split marker prefix or appendix content", () => {
    const response = 'Visible\n<!--MUSTER_JSON {"weeklyFocus":"secret"} -->';
    for (let end = "Visible\n".length + 1; end <= response.length; end++) {
      expect(stripPartialAppendix(response.slice(0, end))).toBe("Visible");
    }
  });

  it("hides repeated closed and open appendices while preserving intervening prose", () => {
    expect(stripPartialAppendix('A<!--MUSTER_JSON {} -->B<!--MUSTER_JSON {"secret":')).toBe("AB");
    expect(stripPartialAppendix('A<!--MUSTER_JSON {} -->B<!--MUS')).toBe("AB");
    expect(stripPartialAppendix("A<!-- ordinary comment -->B")).toBe("A<!-- ordinary comment -->B");
  });

  it("hides every streamed prefix when a JSON string contains --> and escaped quotes", () => {
    const response = `Visible\n<!--MUSTER_JSON ${JSON.stringify({ weeklyFocus: 'private \\" --> suffix " --> end' })} -->`;
    for (let end = "Visible\n".length + 1; end <= response.length; end++) {
      expect(stripPartialAppendix(response.slice(0, end))).toBe("Visible");
    }
  });
});

describe("structured output fallback", () => {
  it.each([
    '<!--MUSTER_JSON {"actions":[{"title":"Review the worksheet"}]} -->',
    '<!--MUSTER_JSON {"schemaVersion":1,"cards":[]} -->',
    '<!--MUSTER_JSON {broken -->',
    '<!--MUSTER_JSON {} -->',
    '<!--MUS',
  ])("provides readable text for JSON-only output: %s", (text) => {
    const { clean } = extractMusterJson(text);
    expect(clean.trim().length).toBeGreaterThan(10);
    expect(clean).not.toMatch(/MUSTER_JSON|<!--|\{"/);
    expect(clean).not.toMatch(/no tasks|nothing pending/i);
  });

  it("ignores malformed values without losing valid prose or entries", () => {
    const payload = {
      actions: [null, 7, [], false, { title: {} }, { title: "Keep me" }],
      priorities: [null, { item: "Review", level: 42, reason: [] }],
      days: [null, { day: "Today", tasks: [null, 1, { text: "Read" }] }],
      sources: [null, { title: ["bad"] }], weeklyFocus: {}, confidence: [],
    };
    const result = extractMusterJson(`Prose<!--MUSTER_JSON ${JSON.stringify(payload)} -->`);
    expect(result.clean).toBe("Prose");
    expect(result.json?.actions?.map((a) => a.title)).toEqual(["Keep me"]);
    expect(result.json?.days?.[0].tasks).toEqual([{ text: "Read", weekRef: undefined }]);
    expect(result.json?.priorities?.[0].level).toBe("normal");
  });

  it("does not fall back to an earlier payload when the last one is malformed", () => {
    const result = extractMusterJson('Body<!--MUSTER_JSON {"weeklyFocus":"old"} -->More<!--MUSTER_JSON broken');
    expect(result).toEqual({ json: null, clean: "BodyMore" });
  });
});

it('does not mistake an opening marker inside a JSON string for a new appendix',()=>{const raw={weeklyFocus:'Review <!--MUSTER_JSON notation'};const result=extractMusterJson('Body\n<!--MUSTER_JSON '+JSON.stringify(raw)+' -->');expect(result.json?.weeklyFocus).toBe(raw.weeklyFocus);expect(result.clean).toBe('Body');});
