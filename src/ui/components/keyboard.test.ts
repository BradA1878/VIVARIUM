import { describe, expect, it } from "vitest";
import { blocksGameplayKeys, isNativeActivationTarget } from "./keyboard";

describe("global shortcut target guard", () => {
  it("blocks text controls and editable regions", () => {
    expect(blocksGameplayKeys({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(blocksGameplayKeys({ tagName: "select" } as unknown as EventTarget)).toBe(true);
    expect(blocksGameplayKeys({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });

  it("blocks descendants of modal and shortcut-disabled UI", () => {
    const modalChild = { tagName: "SPAN", closest: () => ({}) } as unknown as EventTarget;
    expect(blocksGameplayKeys(modalChild)).toBe(true);
  });

  it("allows gameplay keys after focus returns to a HUD button", () => {
    const button = { tagName: "BUTTON", closest: () => null } as unknown as EventTarget;
    expect(blocksGameplayKeys(button)).toBe(false);
    expect(isNativeActivationTarget(button)).toBe(true);
  });

  it("allows a generic gameplay surface without reserving activation", () => {
    const canvas = { tagName: "CANVAS", closest: () => null } as unknown as EventTarget;
    expect(blocksGameplayKeys(canvas)).toBe(false);
    expect(isNativeActivationTarget(canvas)).toBe(false);
  });
});
