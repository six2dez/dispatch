import { describe, it, expect } from "vitest";
import { getErrorMessage } from "./errors";

describe("getErrorMessage", () => {
  const cases: [string, unknown, string][] = [
    ["Error with a message", new Error("boom"), "boom"],
    ["Error with an empty message", new Error(""), "Unexpected error"],
    ["Error with a whitespace-only message", new Error("   "), "Unexpected error"],
    ["non-empty string", "boom", "boom"],
    ["whitespace-only string", "   ", "Unexpected error"],
    ["empty string", "", "Unexpected error"],
    ["object with a string .message", { message: "x" }, "x"],
    ["object with a string .error", { error: "x" }, "x"],
    // Each candidate is gated on non-empty-after-trim, not merely on being a string.
    // An implementation that checked ordering alone would return "  " for this row.
    ["object with a whitespace-only .message and a string .error", { message: "  ", error: "x" }, "x"],
    ["object with a non-string .message", { message: 42 }, "Unexpected error"],
    ["empty object", {}, "Unexpected error"],
    ["null", null, "Unexpected error"],
    ["undefined", undefined, "Unexpected error"],
    ["number", 42, "Unexpected error"],
  ];

  for (const [label, input, expected] of cases) {
    it(`${label} -> ${expected}`, () => {
      expect(getErrorMessage(input)).toBe(expected);
    });
  }

  it("prefers a resolved candidate over an explicit fallback", () => {
    expect(getErrorMessage(new Error("boom"), "custom")).toBe("boom");
  });

  it("returns the explicit fallback when no candidate resolves", () => {
    expect(getErrorMessage(null, "custom")).toBe("custom");
  });
});
