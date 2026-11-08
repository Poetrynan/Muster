import { expect, it } from "vitest";
import { buildAiUrl } from "./aiUrl";
it("appends the endpoint to a provider base", () => {
 expect(buildAiUrl("https://api.longcat.chat/openai/v1/", "openai")).toBe("https://api.longcat.chat/openai/v1/chat/completions");
});
it("does not append a second endpoint to a full URL", () => {
 expect(buildAiUrl("https://example.com/v1/chat/completions", "openai")).toBe("https://example.com/v1/chat/completions");
 expect(buildAiUrl("https://example.com/v1/messages/", "anthropic")).toBe("https://example.com/v1/messages");
});
it("preserves custom endpoints", () => {
 expect(buildAiUrl("https://example.com/my-endpoint", "custom")).toBe("https://example.com/my-endpoint");
});
