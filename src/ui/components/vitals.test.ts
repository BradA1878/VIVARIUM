import { describe, expect, it } from "vitest";
import { trendOf, vitalText } from "./vitals";

describe("trendOf", () => {
  it("reads clear flows as up/down", () => {
    expect(trendOf(2.4)).toBe("up");
    expect(trendOf(-0.5)).toBe("down");
  });
  it("reads near-zero flow as flat (both signs)", () => {
    expect(trendOf(0)).toBe("flat");
    expect(trendOf(0.04)).toBe("flat");
    expect(trendOf(-0.04)).toBe("flat");
  });
});

describe("vitalText", () => {
  it("rounds the amount and shows the capacity", () => {
    expect(vitalText({ amount: 81.7, capacity: 200 })).toBe("82/200");
    expect(vitalText({ amount: 0, capacity: 60 })).toBe("0/60");
  });
});
