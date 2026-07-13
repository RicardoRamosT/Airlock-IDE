// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ExtensionSummary } from "../../../shared/ipc";
import { useApp } from "../store";
import { ExtensionsSection } from "./ExtensionsSection";

const prefsSet = vi.fn(() => Promise.resolve({} as never));

afterEach(() => {
  cleanup();
  prefsSet.mockClear();
  useApp.setState({ extensionsPrefs: {} });
});

const mockApi = (list: ExtensionSummary[]) => {
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    extensionsList: vi.fn(() => Promise.resolve(list)),
    prefsSet,
  };
};

const summary = (over: Partial<ExtensionSummary>): ExtensionSummary => ({
  id: "x",
  name: "X",
  tier: "status",
  status: "ready",
  enabled: true,
  pinned: false,
  hasConfig: false,
  authKind: "token",
  ...over,
});

it("groups integrations by status and shows a Disabled group", async () => {
  mockApi([
    summary({ id: "azure", name: "Azure", category: "host", status: "ready" }),
    summary({ id: "vercel", name: "Vercel", status: "absent" }),
    summary({
      id: "snow",
      name: "Snowflake",
      status: "disabled",
      enabled: false,
    }),
  ]);
  render(<ExtensionsSection />);
  expect(await screen.findByText("Azure")).toBeTruthy();
  expect(screen.getByText("Connected")).toBeTruthy();
  expect(screen.getByText("Not installed")).toBeTruthy();
  expect(screen.getByText("Disabled")).toBeTruthy();
});

it("eye toggle on a category integration -> prefsSet with the merged extensions map", async () => {
  mockApi([
    summary({ id: "azure", name: "Azure", category: "host", status: "ready" }),
  ]);
  render(<ExtensionsSection />);
  const eye = await screen.findByRole("button", {
    name: /show azure in sidebar/i,
  });
  fireEvent.click(eye);
  await waitFor(() =>
    expect(prefsSet).toHaveBeenCalledWith({
      extensions: { azure: { pinned: true } },
    }),
  );
});

it("keeps the enable checkbox as the last control so it stays flush-right", async () => {
  // A pinnable row renders a trailing eye button; it must sit BEFORE the enable
  // checkbox so the checkbox is the last (right-flush) child and lines up with
  // category-less rows' checkboxes.
  mockApi([
    summary({ id: "azure", name: "Azure", category: "host", status: "ready" }),
  ]);
  const { container } = render(<ExtensionsSection />);
  await screen.findByText("Azure");
  const actions = container.querySelector(".ext-actions");
  expect(actions).toBeTruthy();
  const last = actions?.lastElementChild as HTMLElement;
  expect(last?.tagName).toBe("INPUT");
  expect(last?.getAttribute("type")).toBe("checkbox");
  // ...and the eye precedes it, in the eye column.
  const eye = screen.getByRole("button", { name: /show azure in sidebar/i });
  expect(eye.className).toContain("ext-col-pin");
  expect(
    eye.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("standardizes action icons into a fixed column per action type", async () => {
  // Connected Slack shows the full manage cluster (swap + configure +
  // disconnect); each carries its canonical column class so the same action
  // lines up vertically across rows (grid tracks defined in theme.css).
  mockApi([
    summary({
      id: "slack",
      name: "Slack",
      tier: "connected",
      status: "connected",
      hasConfig: true, // Slack has a channel allow-list -> configure gear shows
    }),
  ]);
  render(<ExtensionsSection />);
  const swap = await screen.findByRole("button", {
    name: /change slack workspace/i,
  });
  const config = screen.getByRole("button", { name: /configure slack/i });
  const disconnect = screen.getByRole("button", { name: /disconnect slack/i });
  expect(swap.className).toContain("ext-col-swap");
  expect(config.className).toContain("ext-col-config");
  expect(disconnect.className).toContain("ext-col-conn");
});

it("hides the configure gear when the extension has no config", async () => {
  // GitHub (Phase A) has an empty config schema -> hasConfig false. The gear
  // used to render for every connected extension but only did something for
  // Slack, so GitHub's gear was a dead button. It must not render at all.
  mockApi([
    summary({
      id: "github",
      name: "GitHub",
      tier: "connected",
      status: "connected",
      hasConfig: false,
    }),
  ]);
  render(<ExtensionsSection />);
  await screen.findByText("GitHub");
  expect(
    screen.queryByRole("button", { name: /configure github/i }),
  ).toBeNull();
  // ...but disconnect is still offered.
  expect(
    screen.getByRole("button", { name: /disconnect github/i }),
  ).toBeTruthy();
});

it("puts connect in the shared connection column", async () => {
  mockApi([
    summary({
      id: "slack",
      name: "Slack",
      tier: "connected",
      status: "unauthed",
    }),
  ]);
  render(<ExtensionsSection />);
  const connect = await screen.findByRole("button", { name: /connect slack/i });
  expect(connect.className).toContain("ext-col-conn");
});

it("offers no eye control for a category-less integration", async () => {
  mockApi([summary({ id: "nc", name: "NoCat", status: "ready" })]); // no category
  render(<ExtensionsSection />);
  await screen.findByText("NoCat");
  expect(
    screen.queryByRole("button", { name: /nocat in sidebar/i }),
  ).toBeNull();
});

it("shows an empty-state note when there are no integrations", async () => {
  mockApi([]);
  const { container } = render(<ExtensionsSection />);
  await waitFor(() => expect(window.airlock.extensionsList).toHaveBeenCalled());
  expect(container.querySelector(".section-empty")).toBeTruthy();
});
