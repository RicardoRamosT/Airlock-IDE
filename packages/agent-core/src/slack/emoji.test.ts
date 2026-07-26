import { describe, expect, it } from "vitest";
import { renderEmoji } from "./emoji";

describe("renderEmoji", () => {
  it("replaces a known shortcode with its Unicode emoji", () => {
    expect(renderEmoji(":slightly_smiling_face:")).toBe("🙂");
    expect(renderEmoji("hola :tada:")).toBe("hola 🎉");
  });

  it("replaces several shortcodes in one message", () => {
    expect(renderEmoji(":+1: ship it :rocket:")).toBe("👍 ship it 🚀");
  });

  it("leaves an UNKNOWN shortcode intact rather than blanking it", () => {
    // Workspace custom emoji (:parrot:) have no Unicode equivalent; showing the
    // shortcode is honest, showing nothing loses information.
    expect(renderEmoji("nice :some_custom_thing:")).toBe(
      "nice :some_custom_thing:",
    );
  });

  it("strips a trailing skin-tone modifier after mapping the base", () => {
    expect(renderEmoji(":+1::skin-tone-4:")).toBe("👍");
  });

  it("leaves text with no shortcodes untouched", () => {
    expect(renderEmoji("plain text")).toBe("plain text");
    expect(renderEmoji("")).toBe("");
  });

  it("does not maul ratios or times that contain colons", () => {
    expect(renderEmoji("ready at 15:49 sharp")).toBe("ready at 15:49 sharp");
    expect(renderEmoji("a 3:1 ratio")).toBe("a 3:1 ratio");
  });

  it("handles aliases Slack accepts for the same emoji", () => {
    expect(renderEmoji(":thumbsup:")).toBe("👍");
    expect(renderEmoji(":smile:")).toBe("😄");
  });

  it("covers the FULL Slack table, not a curated subset", () => {
    // The reported gap: :face_with_peeking_eye: rendered as a shortcode.
    expect(renderEmoji(":face_with_peeking_eye:")).toBe("🫣");
    // A few more from across the table, including flags and multi-codepoint
    // sequences, which are the ones a naive single-codepoint map gets wrong.
    expect(renderEmoji(":melting_face:")).toBe("🫠");
    expect(renderEmoji(":saluting_face:")).toBe("🫡");
    expect(renderEmoji(":flag-mx:")).toBe("🇲🇽");
    expect(renderEmoji(":man-woman-girl:")).toBe("👨‍👩‍👧");
    expect(renderEmoji(":pirate_flag:")).toBe("🏴‍☠️");
  });

  it("leaves an already-Unicode emoji alone", () => {
    expect(renderEmoji("🙂 hi")).toBe("🙂 hi");
  });
});
