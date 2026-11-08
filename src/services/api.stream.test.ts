import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SummaryStreamEvent } from "./api";

// Only the desktop bridge is replaced; the public stream adapter runs unchanged.
const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: bridge.listen }));

describe("generateSummaryStream lifecycle", () => {
  let emit: (payload: SummaryStreamEvent) => void;
  let active: boolean;
  let releases: number;
  let chunks: { text: string; thinking?: boolean }[];
  let outcomes: string[];
  const callbacks = {
    onChunk: (text: string, thinking?: boolean) => chunks.push({ text, thinking }),
    onDone: () => { outcomes.push("done"); },
    onError: (error: string) => { outcomes.push(`error:${error}`); },
  };
  function mockGeneration(implementation: (...args: unknown[]) => unknown) {
    bridge.invoke.mockImplementation((command, ...args) => {
      if (command === "register_summary_stream" || command === "cancel_summary_stream") return Promise.resolve();
      return implementation(command, ...args);
    });
  }
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    active = false; releases = 0; chunks = []; outcomes = [];
    bridge.invoke.mockReset(); bridge.listen.mockReset();
    bridge.listen.mockImplementation(async (_name, handler) => {
      emit = (payload) => handler({ payload });
      active = true;
      return () => { active = false; releases++; };
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  async function run() {
    const { generateSummaryStream } = await import("./api");
    await generateSummaryStream("fixture", "fake-key", "https://example.invalid", "fixture-model", "guide", callbacks);
  }

  it("separates thinking and delivers one completion, then releases the listener", async () => {
    mockGeneration(async () => {
      expect(active).toBe(true);
      emit({ type: "chunk", text: "Reason", thinking: true });
      emit({ type: "chunk", text: "Answer" });
      emit({ type: "done" }); emit({ type: "done" });
      emit({ type: "chunk", text: "late" });
    });
    await run();
    expect(chunks).toEqual([{ text: "Reason", thinking: true }, { text: "Answer", thinking: undefined }]);
    expect(outcomes).toEqual(["done"]);
    expect(active).toBe(false); expect(releases).toBe(1);
    emit({ type: "error", error: "late" });
    expect(outcomes).toEqual(["done"]);
  });

  it("reports an invoke rejection only once after an error event (429)", async () => {
    mockGeneration(async () => {
      emit({ type: "error", error: "429: retry later" });
      emit({ type: "done" });
      throw new Error("429: retry later");
    });
    await run();
    expect(outcomes).toEqual(["error:429: retry later"]);
    expect(active).toBe(false); expect(releases).toBe(1);
  });

  it.each(["empty", "thinking", "disconnected"])("fails safely when invoke resolves with %s output and no terminal event", async (kind) => {
    mockGeneration(async () => {
      if (kind !== "empty") emit({ type: "chunk", text: kind === "thinking" ? "Reason" : "Partial", thinking: kind === "thinking" });
    });
    await run();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatch(/^error:/);
    expect(active).toBe(false); expect(releases).toBe(1);
  });

  it.each([false, true])("does not accept empty or thinking-only done events (thinking=%s)", async (thinking) => {
    mockGeneration(async () => {
      if (thinking) emit({ type: "chunk", text: "Reason only", thinking: true });
      emit({ type: "done" });
    });
    await run();
    expect(outcomes).toHaveLength(1); expect(outcomes[0]).toMatch(/^error:/);
    expect(releases).toBe(1);
  });

  it("does not turn an invoke failure after done into success", async () => {
    mockGeneration(async () => {
      emit({ type: "chunk", text: "Partial" }); emit({ type: "done" });
      throw new Error("Connection lost");
    });
    await run();
    expect(outcomes).toEqual(["error:Connection lost"]);
    expect(releases).toBe(1);
  });

  it("lets an error arriving after done win before invoke confirms completion", async () => {
    mockGeneration(async () => {
      emit({ type: "chunk", text: "Partial" }); emit({ type: "done" });
      emit({ type: "error", error: "Provider failed" });
    });
    await run();
    expect(outcomes).toEqual(["error:Provider failed"]);
    expect(releases).toBe(1);
  });

  it("handles listener registration failure through onError", async () => {
    bridge.listen.mockRejectedValue(new Error("Cannot listen"));
    await run();
    expect(outcomes).toEqual(["error:Cannot listen"]);
    expect(active).toBe(false);
  });

  it("keeps raw JSON available to the completion parser", async () => {
    mockGeneration(async () => {
      emit({ type: "chunk", text: '<!--MUSTER_JSON {"actions":[{"title":"Review"}]} -->' });
      emit({ type: "done" });
    });
    await run();
    expect(outcomes).toEqual(["done"]);
    expect(chunks[0].text).toContain("MUSTER_JSON");
    expect(releases).toBe(1);
  });

  it("releases on abort before the backend finishes and ignores late events", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const invoking = new Promise<void>((resolve) => { started = resolve; });
    let finish!: () => void;
    mockGeneration(() => {
      started();
      return new Promise<void>((resolve) => { finish = resolve; });
    });
    const { generateSummaryStream } = await import("./api");
    const pending = generateSummaryStream("fixture", "key", "url", "model", "guide", { ...callbacks, signal: controller.signal });
    await invoking;
    controller.abort();
    await pending;
    const generation = bridge.invoke.mock.calls.find(([command]) => command === "generate_summary_stream");
    expect(generation).toBeDefined();
    expect(bridge.invoke).toHaveBeenCalledWith("cancel_summary_stream", { streamId: generation![1].streamId });
    expect(bridge.invoke.mock.calls.filter(([command]) => command === "cancel_summary_stream")).toHaveLength(1);
    expect(active).toBe(false); expect(releases).toBe(1);
    expect(outcomes).toHaveLength(1); expect(outcomes[0]).toMatch(/^error:.*cancel/i);
    emit({ type: "chunk", text: "Old scope" }); emit({ type: "done" }); finish();
    expect(chunks).toEqual([]); expect(outcomes).toHaveLength(1);
  });

  it("does not register or invoke an already aborted request", async () => {
    const controller = new AbortController(); controller.abort();
    const { generateSummaryStream } = await import("./api");
    await generateSummaryStream("fixture", "key", "url", "model", "guide", { ...callbacks, signal: controller.signal });
    expect(active).toBe(false); expect(releases).toBe(0);
    expect(bridge.invoke).not.toHaveBeenCalled();
    expect(outcomes).toHaveLength(1); expect(outcomes[0]).toMatch(/^error:.*cancel/i);
  });

  it("cancels a reservation that finishes after abort without starting generation", async () => {
    const controller = new AbortController();
    let registered!: () => void;
    const started = new Promise<void>((resolve) => { registered = resolve; });
    let finishRegistration!: () => void;
    bridge.invoke.mockImplementation((command) => {
      if (command === "register_summary_stream") {
        registered();
        return new Promise<void>((resolve) => { finishRegistration = resolve; });
      }
      return Promise.resolve();
    });
    const { generateSummaryStream } = await import("./api");
    const pending = generateSummaryStream("fixture", "key", "url", "model", "guide", { ...callbacks, signal: controller.signal });
    await Promise.race([started, pending]);
    controller.abort(); finishRegistration?.();
    await pending;
    expect(bridge.invoke.mock.calls.map(([command]) => command)).toEqual(["register_summary_stream", "cancel_summary_stream"]);
    expect(active).toBe(false); expect(releases).toBe(1);
    expect(outcomes).toHaveLength(1); expect(outcomes[0]).toMatch(/^error:.*cancel/i);
  });
});
