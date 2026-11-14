import { describe, expect, it } from "vitest";
import { classifyPress, nextIsi, percentile, PVT_MODES, scorePvt, type PvtTrial } from "./pvt";

const resp = (rts: number[]): PvtTrial[] => rts.map((rt, i) => ({ kind: "response", t_ms: i * 1000, rt_ms: rt }));

describe("reaction-time scoring", () => {
  it("computes median, IQR and lapses (matches backend fixture)", () => {
    const s = scorePvt(resp([250, 260, 270, 280, 290, 300, 310, 320, 600, 700]), "demo");
    expect(s.status).toBe("valid");
    expect(s.median_rt_ms).toBe(295);
    expect(s.lapses).toBe(2);
    expect(s.rt_iqr_ms).toBeCloseTo(percentile([250, 260, 270, 280, 290, 300, 310, 320, 600, 700], 75)! - 272.5, 5);
  });

  it("treats responses under 100 ms as false starts, not reaction times", () => {
    const s = scorePvt([...resp(Array(10).fill(300)), { kind: "response", t_ms: 1, rt_ms: 50 }], "demo");
    expect(s.false_starts).toBe(1);
    expect(s.n_valid_responses).toBe(10);
  });

  it("invalidates interrupted sessions", () => {
    const s = scorePvt(resp(Array(20).fill(300)), "demo", true);
    expect(s.status).toBe("invalid");
  });

  it("marks incomplete runs", () => {
    expect(scorePvt(resp(Array(12).fill(300)), "demo", false, false).status).toBe("incomplete");
  });

  it("invalidates when too few valid responses", () => {
    expect(scorePvt(resp([300, 310]), "demo").status).toBe("invalid");
  });

  it("invalidates excessive premature responses", () => {
    const fs: PvtTrial[] = Array.from({ length: 6 }, (_, i) => ({ kind: "false_start", t_ms: i }));
    expect(scorePvt([...resp(Array(10).fill(300)), ...fs], "demo").status).toBe("invalid");
  });

  it("counts misses", () => {
    const m: PvtTrial[] = Array.from({ length: 2 }, (_, i) => ({ kind: "miss", t_ms: i }));
    const s = scorePvt([...resp(Array(10).fill(300)), ...m], "demo");
    expect(s.misses).toBe(2);
    expect(s.status).toBe("valid");
  });
});

describe("keypress gate", () => {
  it("ignores auto-repeat and held keys", () => {
    expect(classifyPress({ repeat: true, stimulusVisible: true, alreadyResponded: false, keyIsDown: false })).toBe("ignored");
    expect(classifyPress({ repeat: false, stimulusVisible: true, alreadyResponded: false, keyIsDown: true })).toBe("ignored");
  });
  it("counts only the first press per stimulus", () => {
    expect(classifyPress({ repeat: false, stimulusVisible: true, alreadyResponded: false, keyIsDown: false })).toBe("response");
    expect(classifyPress({ repeat: false, stimulusVisible: true, alreadyResponded: true, keyIsDown: false })).toBe("ignored");
  });
  it("flags presses with no stimulus as false starts", () => {
    expect(classifyPress({ repeat: false, stimulusVisible: false, alreadyResponded: false, keyIsDown: false })).toBe("false_start");
  });
});

describe("inter-stimulus interval", () => {
  it("stays inside the configured window", () => {
    for (const r of [0, 0.5, 0.999]) {
      const v = nextIsi("demo", () => r);
      expect(v).toBeGreaterThanOrEqual(PVT_MODES.demo.isiMin);
      expect(v).toBeLessThan(PVT_MODES.demo.isiMax);
    }
  });
});
