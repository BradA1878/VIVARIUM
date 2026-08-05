import { describe, expect, it } from "vitest";
import { FLOOR_QUERY, consoleStatus, gateView, parseJoinCode } from "./fieldconsole";

describe("gateView — the spec §1 priority table", () => {
  it("hides above the floor regardless of session", () => {
    expect(gateView(false, "solo", "idle")).toBe("hidden");
    expect(gateView(false, "guest", "connected")).toBe("hidden");
    expect(gateView(false, "guest", "failed")).toBe("hidden");
  });
  it("lifts below the floor only while a guest session is connected", () => {
    expect(gateView(true, "guest", "connected")).toBe("hidden");
  });
  it("shows the console below the floor in every other state", () => {
    expect(gateView(true, "solo", "idle")).toBe("console");
    expect(gateView(true, "guest", "connecting")).toBe("console");
    expect(gateView(true, "guest", "failed")).toBe("console");
    expect(gateView(true, "guest", "host-left")).toBe("console");
    expect(gateView(true, "host", "connected")).toBe("console"); // hosting needs a wide console
  });
});

describe("parseJoinCode — ?join= prefill", () => {
  it("reads the join param", () => {
    expect(parseJoinCode("?join=marsbase")).toBe("marsbase");
  });
  it("trims and clamps to the Lobby's 24-char limit", () => {
    expect(parseJoinCode("?join=%20%20padded%20%20")).toBe("padded");
    expect(parseJoinCode(`?join=${"x".repeat(40)}`)).toBe("x".repeat(24));
  });
  it("returns empty for absent or malformed input", () => {
    expect(parseJoinCode("")).toBe("");
    expect(parseJoinCode("?other=1")).toBe("");
  });
});

describe("consoleStatus — the form's status line", () => {
  it("is null when idle or connected (the founding copy shows instead)", () => {
    expect(consoleStatus("idle")).toBeNull();
    expect(consoleStatus("connected")).toBeNull();
  });
  it("maps the three live states", () => {
    expect(consoleStatus("connecting")).toEqual({ text: "Connecting to the host…", warn: false });
    expect(consoleStatus("failed")).toEqual({ text: "No host answered — check the code and try again.", warn: true });
    expect(consoleStatus("host-left")).toEqual({ text: "Host disconnected. Rejoin with the same code.", warn: true });
  });
});

describe("FLOOR_QUERY", () => {
  it("is the gate's exact 560×440 floor", () => {
    expect(FLOOR_QUERY).toBe("(max-width: 559px), (max-height: 439px)");
  });
});
