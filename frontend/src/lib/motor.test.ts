import { describe, expect, it } from "vitest";
import { isHit, normalize, previewMotor, throttlePush, type Layout, type Pt } from "./motor";

const layout: Layout = {
  variant: 0, aspect: 0.625, target_radius: 0.032, start: { x: 0.5, y: 0.5 },
  targets: [{ index: 0, x: 0.2, y: 0.2, r: 0.032 }, { index: 1, x: 0.8, y: 0.3, r: 0.032 }],
  index_of_difficulty_bits: [3, 3],
};

describe("normalized coordinates", () => {
  it("are identical for the same relative position at different sizes", () => {
    const a = normalize(100 + 160, 50 + 50, { left: 100, top: 50, width: 800, height: 500 });
    const b = normalize(320, 100, { left: 0, top: 0, width: 1600, height: 1000 });
    expect(a).toEqual({ x: 0.2, y: 0.1 });
    expect(b).toEqual({ x: 0.2, y: 0.1 });
  });
  it("hit test uses aspect-corrected distance", () => {
    const t = layout.targets[0];
    expect(isHit({ x: 0.2, y: 0.2 + 0.05 }, t, 0.625)).toBe(true); // 0.05*0.625 = 0.031 < 0.032
    expect(isHit({ x: 0.2 + 0.05, y: 0.2 }, t, 0.625)).toBe(false);
  });
});

describe("motor preview", () => {
  it("measures movement times and misses", () => {
    const clicks: Pt[] = [
      { t_ms: 300, x: 0.9, y: 0.9 },
      { t_ms: 500, x: 0.2, y: 0.2 },
      { t_ms: 1100, x: 0.8, y: 0.3 },
    ];
    const p = previewMotor(layout, clicks);
    expect(p.misses).toBe(1);
    expect(p.targetsHit).toBe(2);
    expect(p.movementTimes).toEqual([500, 600]);
    expect(p.medianMt).toBe(550);
    expect(p.completionMs).toBe(1100);
  });
  it("throttles pointer samples", () => {
    const buf: Pt[] = [];
    for (let t = 0; t < 100; t += 4) throttlePush(buf, { t_ms: t, x: 0, y: 0 }, 16);
    expect(buf.length).toBe(7);
  });
});
