import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  attachmentsDir,
  describeAttachments,
  extensionForMime,
  MAX_ATTACHMENT_BYTES,
  pruneAttachments,
  saveAttachment,
} from "./attachments";

const dir = () => mkdtempSync(path.join(tmpdir(), "atlas-att-"));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe("saveAttachment", () => {
  it("writes the bytes verbatim under the mime's extension", () => {
    const d = dir();
    const file = saveAttachment(d, PNG, "image/png") as string;
    expect(file.endsWith(".png")).toBe(true);
    expect(new Uint8Array(readFileSync(file))).toEqual(PNG);
  });

  it("refuses a mime it cannot name an extension for", () => {
    // Guessing would hand Atlas a file Read cannot open, with no reason given.
    const d = dir();
    expect(saveAttachment(d, PNG, "application/pdf")).toBeNull();
    expect(saveAttachment(d, PNG, "text/html")).toBeNull();
    expect(saveAttachment(d, PNG, undefined)).toBeNull();
    expect(readdirSync(d)).toEqual([]);
  });

  it("refuses an empty or oversized payload", () => {
    const d = dir();
    expect(saveAttachment(d, new Uint8Array(0), "image/png")).toBeNull();
    const huge = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    expect(saveAttachment(d, huge, "image/png")).toBeNull();
  });

  it("names files itself, so two pastes never collide", () => {
    const d = dir();
    const a = saveAttachment(d, PNG, "image/png");
    const b = saveAttachment(d, PNG, "image/png");
    expect(a).not.toBe(b);
    expect(readdirSync(d)).toHaveLength(2);
  });

  it("keeps attachments out of any project root", () => {
    // A screenshot is a message to Atlas, not a file in the user's repo.
    expect(attachmentsDir("/u/data")).toBe("/u/data/atlas-attachments");
  });
});

describe("pruneAttachments", () => {
  it("keeps the newest and drops the rest", () => {
    const d = dir();
    for (let i = 0; i < 6; i++) {
      const f = path.join(d, `f${i}.png`);
      writeFileSync(f, PNG);
      // Distinct mtimes, oldest first.
      const t = new Date(Date.now() - (6 - i) * 60_000);
      require("node:fs").utimesSync(f, t, t);
    }
    pruneAttachments(d, 2);
    const left = readdirSync(d).sort();
    expect(left).toEqual(["f4.png", "f5.png"]);
  });

  it("is a no-op on a directory that does not exist", () => {
    expect(() => pruneAttachments("/nope/definitely/not/here")).not.toThrow();
  });
});

describe("describeAttachments", () => {
  it("adds nothing when there is nothing attached", () => {
    expect(describeAttachments([])).toBe("");
  });

  it("names the tool, not just the path", () => {
    // The path alone leaves Atlas guessing whether to open it or quote it.
    const out = describeAttachments(["/tmp/a.png"]);
    expect(out).toContain("Read tool");
    expect(out).toContain("/tmp/a.png");
  });

  it("lists every path when several are attached", () => {
    const out = describeAttachments(["/tmp/a.png", "/tmp/b.png"]);
    expect(out).toContain("/tmp/a.png");
    expect(out).toContain("/tmp/b.png");
    expect(out).toContain("images");
  });
});

describe("extensionForMime", () => {
  it("maps the clipboard image types", () => {
    expect(extensionForMime("image/png")).toBe("png");
    expect(extensionForMime("image/jpeg")).toBe("jpg");
  });
  it("rejects anything else, including inherited keys", () => {
    expect(extensionForMime("constructor")).toBeNull();
    expect(extensionForMime(null)).toBeNull();
  });
});
