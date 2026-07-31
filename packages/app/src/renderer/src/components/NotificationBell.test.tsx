// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentRequest } from "../../../shared/agentRequests";
import { useApp } from "../store";
import { NotificationBell } from "./NotificationBell";

const initialState = useApp.getState();

let agentRequestsList: ReturnType<typeof vi.fn>;
let agentRequestDismiss: ReturnType<typeof vi.fn>;
let requestSecretResolve: ReturnType<typeof vi.fn>;

const secret = (over: Record<string, unknown> = {}): AgentRequest =>
  ({
    kind: "secret",
    requestId: "r1",
    state: "pending",
    createdAt: 1,
    dismissed: true, // in the bell
    root: "/proj",
    projectName: "proj",
    name: "DATABASE_URL",
    ...over,
  }) as AgentRequest;

function mount(requests: AgentRequest[]) {
  agentRequestsList.mockResolvedValue(requests);
  render(<NotificationBell />);
}

beforeEach(() => {
  agentRequestsList = vi.fn(async () => []);
  agentRequestDismiss = vi.fn(async () => undefined);
  requestSecretResolve = vi.fn(async () => undefined);
  window.airlock = new Proxy(
    {
      agentRequestsList,
      agentRequestDismiss,
      requestSecretResolve,
      secretsSet: async () => ({
        name: "DATABASE_URL",
        provider: null,
        valid: true,
        createdAt: "",
        updatedAt: "",
      }),
      secretsList: async () => [],
      onAgentRequests: () => () => {},
    },
    {
      get: (t, k) =>
        k in t ? t[k as keyof typeof t] : () => Promise.resolve(),
    },
    // biome-ignore lint/suspicious/noExplicitAny: test double for the preload bridge
  ) as any;
  useApp.setState(initialState, true);
});

afterEach(cleanup);

it("shows no badge when nothing is waiting", async () => {
  mount([]);
  await screen.findByRole("button");
  expect(document.querySelector(".titlebar-bell-badge")).toBeNull();
});

it("badges the number of items you can still act on", async () => {
  mount([secret({ requestId: "a" }), secret({ requestId: "b" })]);
  expect(
    (await screen.findByText("2")).classList.contains("titlebar-bell-badge"),
  ).toBe(true);
});

it("does not count an expired terminal grant", async () => {
  // Main prunes expired grants, but if one ever reached the bell it is not
  // actionable -- approving it would authorise nothing -- so it must not badge.
  mount([
    secret({ requestId: "a" }),
    {
      kind: "terminalGrant",
      requestId: "g",
      state: "expired",
      createdAt: 2,
      dismissed: true,
      root: null,
      projectName: "proj",
      ptyId: "p1",
      label: "proj",
      preview: "ls",
    } as AgentRequest,
  ]);
  expect(await screen.findByText("1")).toBeTruthy();
});

it("opens a panel listing the dismissed requests", async () => {
  mount([secret()]);
  fireEvent.click(await screen.findByRole("button"));
  expect(screen.getByText(/Claude needs DATABASE_URL/)).toBeTruthy();
});

it("keeps an EXPIRED secret request actionable in the panel", async () => {
  mount([secret({ state: "expired" })]);
  fireEvent.click(await screen.findByRole("button"));
  // Vaulting it later is still useful, so the input must be there.
  expect(screen.getByPlaceholderText("Paste the value")).toBeTruthy();
  expect(screen.getByText(/Claude stopped waiting/)).toBeTruthy();
});

it("offers no second Later inside the bell", async () => {
  mount([secret()]);
  fireEvent.click(await screen.findByRole("button"));
  // The item is already dismissed; dismissing again would do nothing.
  expect(screen.queryByText("Later")).toBeNull();
});

it("toggles the panel shut on a second click", async () => {
  mount([secret()]);
  const btn = await screen.findByRole("button");
  fireEvent.click(btn);
  expect(screen.getByText(/Claude needs DATABASE_URL/)).toBeTruthy();
  fireEvent.click(btn);
  expect(screen.queryByText(/Claude needs DATABASE_URL/)).toBeNull();
});
