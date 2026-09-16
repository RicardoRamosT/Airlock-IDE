import { describe, expect, it } from "vitest";
import {
  ATLAS_BRIEF_FLOOR,
  ATLAS_STANDING_DEFAULT,
  ATLAS_STANDING_MIN,
  availableFor,
  resizeStanding,
} from "./atlasStandingResize";

// The handle is the section's TOP edge, so a NEGATIVE deltaY (dragging up)
// grows it. Roomy bounds unless a case is about a bound.
const ROOMY = { rowHeight: 25, contentHeight: 2000, available: 2000 };

describe("resizeStanding", () => {
  it("drag UP makes the section taller", () => {
    expect(resizeStanding(200, -60, ROOMY)).toBe(260);
  });

  it("drag DOWN makes the section shorter", () => {
    expect(resizeStanding(200, 60, ROOMY)).toBe(140);
  });

  it("never shrinks below one whole concern row", () => {
    // The user's floor: "minimum I should be able to fit 1 task". A row that
    // wrapped to two lines is 44px, so 22px of it is not one task.
    expect(resizeStanding(200, 500, { ...ROOMY, rowHeight: 44 })).toBe(44);
  });

  it("uses the constant floor when the row measures smaller than it", () => {
    // A 6px "row" is a measurement failure, not a real row.
    expect(resizeStanding(200, 500, { ...ROOMY, rowHeight: 6 })).toBe(
      ATLAS_STANDING_MIN,
    );
  });

  it("falls back to the constant floor when the row cannot be measured", () => {
    // getBoundingClientRect() returns 0 in jsdom and for a display:none row.
    expect(resizeStanding(200, 500, { ...ROOMY, rowHeight: 0 })).toBe(
      ATLAS_STANDING_MIN,
    );
  });

  it("never grows past the list's own content", () => {
    // Dragging past the last row would only add dead space below it.
    expect(resizeStanding(200, -900, { ...ROOMY, contentHeight: 310 })).toBe(
      310,
    );
  });

  it("never grows past the space the panel can spare", () => {
    // The debrief is what the panel is FOR; the concern list may not bury it.
    expect(resizeStanding(200, -900, { ...ROOMY, available: 260 })).toBe(260);
  });

  it("keeps one row visible even when nothing can be spared", () => {
    // A ceiling below the floor is incoherent; the floor wins, because a box
    // too short to show a single concern is worse than a slightly tall one.
    expect(
      resizeStanding(200, 500, {
        rowHeight: 40,
        contentHeight: 10,
        available: 5,
      }),
    ).toBe(40);
  });

  it("treats an UNMEASURED bound as no bound rather than as zero", () => {
    // jsdom, a display:none section and a detached node all report 0. Reading
    // that as a real ceiling would clamp every drag to the one-row minimum --
    // the handle would look wired up and do nothing but collapse the list.
    expect(
      resizeStanding(200, -60, {
        rowHeight: 0,
        contentHeight: 0,
        available: 0,
      }),
    ).toBe(260);
  });

  it("rounds to whole pixels", () => {
    expect(resizeStanding(200, -0.4, ROOMY)).toBe(200);
    expect(resizeStanding(200.6, -0.6, ROOMY)).toBe(201);
  });

  it("ignores a non-finite drag rather than producing NaN", () => {
    // A pointer event mid-teardown can hand back NaN; a NaN height would set
    // style.height to garbage and collapse the section to nothing.
    expect(resizeStanding(200, Number.NaN, ROOMY)).toBe(200);
  });

  it("defaults to today's size, so nothing moves until you drag it", () => {
    expect(ATLAS_STANDING_DEFAULT).toBe(208); // 16em at the panel's 13px
  });
});

describe("availableFor", () => {
  it("leaves the debrief a floor, and the section its own header", () => {
    // A 436px panel whose section spends 39px on the divider + the STILL OPEN
    // header: the list may take what is left after the debrief's floor.
    expect(availableFor(436, 39)).toBe(436 - ATLAS_BRIEF_FLOOR - 39);
  });

  it("reports nothing available rather than a negative height", () => {
    // A panel dragged shorter than its own chrome. resizeStanding reads 0 as
    // unmeasured, which is the right answer here too: there is nothing to
    // compute a ceiling from, so the floor governs.
    expect(availableFor(60, 39)).toBe(0);
  });

  it("reports nothing available when the panel cannot be measured", () => {
    expect(availableFor(0, 0)).toBe(0);
  });
});
