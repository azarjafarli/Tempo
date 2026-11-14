import { describe, expect, it } from "vitest";
import { CATEGORY_STYLE, fmt, hhmm, missionTime, PROVENANCE_STYLE, signed } from "./format";

describe("formatting", () => {
  it("formats times and signs", () => {
    expect(hhmm(9.5)).toBe("09:30");
    expect(signed(12.3, 1)).toBe("+12.3");
    expect(signed(-4)).toBe("−4");
    expect(fmt(null)).toBe("—");
    expect(missionTime(3.25)).toBe("Day 3 · 06:00");
    expect(missionTime(-6.4)).toContain("Pre-mission");
  });
  it("uses the documented category labels", () => {
    expect(CATEGORY_STYLE.change_worth_reviewing.label).toBe("Functional change worth reviewing");
    expect(CATEGORY_STYLE.within_baseline.label).toBe("Within observed baseline variation");
    expect(CATEGORY_STYLE.invalid_measurement.label).toBe("Invalid or incomplete measurement");
    expect(CATEGORY_STYLE.insufficient_data.label).toBe("Insufficient data");
  });
  it("labels every provenance category, distinguishing real from synthetic", () => {
    expect(Object.keys(PROVENANCE_STYLE).sort()).toEqual(
      ["hypothetical_scenario", "local_measurement", "nasa_public_data", "published_reference", "synthetic"]);
    expect(PROVENANCE_STYLE.synthetic.label).toMatch(/Synthetic/);
    expect(PROVENANCE_STYLE.local_measurement.label).toMatch(/Real/);
  });
});
