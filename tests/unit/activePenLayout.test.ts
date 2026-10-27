import { describe, expect, it } from "vitest";
import type { CanvasLayout } from "../../src/types";
import { parseCanvasLayout, serializeCanvasLayout } from "../../src/types/layoutValidation";

const base: CanvasLayout = { tfVersion: 2, savedAt: "2026-10-28T00:00:00.000Z", imports: [], layerGroups: [{ id: "white", name: "White", color: "#ffffff", importIds: [] }] };

describe("active pen in saved layouts", () => {
  it("roundtrips the selected pen before any artwork is imported", () => {
    expect(parseCanvasLayout(serializeCanvasLayout({ ...base, activePenId: "white" })).activePenId).toBe("white");
  });
  it("preserves source colour mode and accepts older layouts without an active pen", () => {
    expect(parseCanvasLayout(serializeCanvasLayout({ ...base, activePenId: null })).activePenId).toBeNull();
    expect(parseCanvasLayout(JSON.stringify(base)).activePenId).toBeUndefined();
  });
  it.each(["missing", 42, {}, ""])("rejects an invalid or missing pen reference: %j", (activePenId) => {
    expect(() => parseCanvasLayout(JSON.stringify({ ...base, activePenId }))).toThrow();
  });
});
