import { expect, it } from "vitest";
import {
  CONCERNS_CLOSE,
  CONCERNS_OPEN,
  FACTS_CLOSE,
  FACTS_OPEN,
  splitReply,
} from "./reply";

const withFacts = (prose: string, json: string) =>
  `${prose}\n${FACTS_OPEN}\n${json}\n${FACTS_CLOSE}`;

it("returns the whole reply as prose when there is no facts block", () => {
  const out = splitReply("Work on Revaltone-CRM first.");
  expect(out.prose).toBe("Work on Revaltone-CRM first.");
  expect(out.facts).toEqual([]);
});

it("extracts one fact and strips the block from the prose", () => {
  // The block must NEVER reach the UI. Leaking JSON into a chat bubble is the
  // most visible possible bug in this feature.
  const out = splitReply(
    withFacts(
      "Noted.",
      '[{"project":"Muros-Estates","kind":"deadline","value":"2026-09-15","verbatim":"Muros is due the 15th"}]',
    ),
  );
  expect(out.prose).toBe("Noted.");
  expect(out.prose).not.toContain("{");
  expect(out.facts).toEqual([
    {
      project: "Muros-Estates",
      kind: "deadline",
      value: "2026-09-15",
      verbatim: "Muros is due the 15th",
    },
  ]);
});

it("extracts several facts from one turn", () => {
  const out = splitReply(
    withFacts(
      "Got it.",
      '[{"project":"A","kind":"status","value":"dead","verbatim":"A is dead"},' +
        '{"project":"B","kind":"priority","value":"high","verbatim":"B matters"}]',
    ),
  );
  expect(out.facts).toHaveLength(2);
});

it("accepts a portfolio-wide fact with a null project", () => {
  const out = splitReply(
    withFacts(
      "Ok.",
      '[{"project":null,"kind":"note","value":"ships Fridays","verbatim":"I ship on Fridays"}]',
    ),
  );
  expect(out.facts[0]?.project).toBeNull();
});

it("drops a fact with an unknown kind rather than storing junk", () => {
  const out = splitReply(
    withFacts(
      "Ok.",
      '[{"project":"A","kind":"weather","value":"x","verbatim":"y"}]',
    ),
  );
  expect(out.facts).toEqual([]);
  expect(out.prose).toBe("Ok.");
});

it("drops a fact missing required fields", () => {
  const out = splitReply(withFacts("Ok.", '[{"kind":"note"}]'));
  expect(out.facts).toEqual([]);
});

it("still strips the block and keeps the prose when the JSON is malformed", () => {
  // A broken block must not put raw JSON in front of the user.
  const out = splitReply(withFacts("Here is the plan.", "{not json"));
  expect(out.prose).toBe("Here is the plan.");
  expect(out.facts).toEqual([]);
});

it("strips an unterminated block rather than showing it", () => {
  const out = splitReply(`Here is the plan.\n${FACTS_OPEN}\n[{"kind":`);
  expect(out.prose).toBe("Here is the plan.");
  expect(out.facts).toEqual([]);
});

it("handles a reply that is only a facts block", () => {
  const out = splitReply(withFacts("", "[]"));
  expect(out.prose).toBe("");
  expect(out.facts).toEqual([]);
});

it("trims surrounding whitespace from the prose", () => {
  expect(splitReply("  hello  ").prose).toBe("hello");
});

it("pulls a concerns block out and keeps it out of the prose", () => {
  const out = splitReply(
    `Here is what I found.\n${CONCERNS_OPEN}\n[{"key":"elarqui-ipv6","project":"ElArqui","title":"apex answers on IPv6","detail":"Render is IPv4 only."}]\n${CONCERNS_CLOSE}`,
  );
  expect(out.prose).toBe("Here is what I found.");
  expect(out.concerns).toHaveLength(1);
  expect(out.concerns[0]?.key).toBe("elarqui-ipv6");
  expect(out.prose).not.toContain("ATLAS_CONCERNS");
});

it("handles BOTH blocks in one reply", () => {
  // Atlas can learn a fact and raise a concern in the same turn; neither block
  // may leak into what the user reads.
  const out = splitReply(
    `Noted.\n${CONCERNS_OPEN}\n[{"key":"k","title":"t","detail":"d"}]\n${CONCERNS_CLOSE}\n${FACTS_OPEN}\n[{"project":"ElArqui","kind":"deadline","value":"2026-10-26","verbatim":"renew before the 26th"}]\n${FACTS_CLOSE}`,
  );
  expect(out.prose).toBe("Noted.");
  expect(out.concerns).toHaveLength(1);
  expect(out.facts).toHaveLength(1);
});

it("strips a malformed concerns block rather than showing raw JSON", () => {
  const out = splitReply(
    `Text.\n${CONCERNS_OPEN}\n{not json\n${CONCERNS_CLOSE}`,
  );
  expect(out.concerns).toEqual([]);
  expect(out.prose).toBe("Text.");
});

it("drops a concern entry with no key or no title", () => {
  const out = splitReply(
    `T.\n${CONCERNS_OPEN}\n[{"title":"no key"},{"key":"k2"},{"key":"ok","title":"fine"}]\n${CONCERNS_CLOSE}`,
  );
  expect(out.concerns.map((c) => c.key)).toEqual(["ok"]);
});

it("carries a resolve flag through", () => {
  const out = splitReply(
    `T.\n${CONCERNS_OPEN}\n[{"key":"k","title":"t","resolved":true}]\n${CONCERNS_CLOSE}`,
  );
  expect(out.concerns[0]?.resolved).toBe(true);
});
