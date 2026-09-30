// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentRequest } from "../../../shared/agentRequests";
import { VISIBLE_STACK_MAX } from "../../../shared/agentRequests";
import { useApp } from "../store";
import { AgentRequestStack } from "./AgentRequestStack";

const initialState = useApp.getState();

let agentRequestsList: ReturnType<typeof vi.fn>;
let agentRequestDismiss: ReturnType<typeof vi.fn>;
let requestSecretResolve: ReturnType<typeof vi.fn>;
let terminalGrantResolve: ReturnType<typeof vi.fn>;
let secretsSet: ReturnType<typeof vi.fn>;

const secret = (over: Record<string, unknown> = {}): AgentRequest =>
  ({
    kind: "secret",
    requestId: "r1",
    state: "pending",
    createdAt: 1,
    dismissed: false,
    root: "/proj",
    projectName: "proj",
    name: "DATABASE_URL",
    ...over,
  }) as AgentRequest;

const grant = (over: Record<string, unknown> = {}): AgentRequest =>
  ({
    kind: "terminalGrant",
    requestId: "g1",
    state: "pending",
    createdAt: 1,
    dismissed: false,
    root: null,
    projectName: "proj",
    ptyId: "p1",
    label: "proj",
    preview: "npm test",
    ...over,
  }) as AgentRequest;

function mount(requests: AgentRequest[]) {
  agentRequestsList.mockResolvedValue(requests);
  render(<AgentRequestStack />);
}

beforeEach(() => {
  agentRequestsList = vi.fn(async () => []);
  agentRequestDismiss = vi.fn(async () => undefined);
  requestSecretResolve = vi.fn(async () => undefined);
  terminalGrantResolve = vi.fn(async () => undefined);
  secretsSet = vi.fn(async (_r, name) => ({
    name,
    provider: null,
    valid: true,
    createdAt: "",
    updatedAt: "",
  }));
  window.airlock = new Proxy(
    {
      agentRequestsList,
      agentRequestDismiss,
      requestSecretResolve,
      terminalGrantResolve,
      secretsSet,
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

it("renders one card per pending request", async () => {
  mount([secret(), grant()]);
  expect(await screen.findByText(/Claude needs DATABASE_URL/)).toBeTruthy();
  expect(screen.getByText(/type into this terminal/)).toBeTruthy();
});

it("caps the visible stack and points the rest at the bell", async () => {
  mount(
    Array.from({ length: VISIBLE_STACK_MAX + 2 }, (_, i) =>
      secret({ requestId: `r${i}`, createdAt: i, name: `S${i}` }),
    ),
  );
  await screen.findByText(/\+2 more in the bell/);
  // Only VISIBLE_STACK_MAX cards are rendered, not all of them.
  expect(screen.queryByText(/Claude needs S0/)).toBeNull();
});

it("does NOT auto-dismiss a pending card", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mount([secret()]);
  await screen.findByText(/Claude needs DATABASE_URL/);
  vi.advanceTimersByTime(10 * 60 * 1000);
  // A normal toast would be gone by now. A pending request must not be.
  expect(screen.getByText(/Claude needs DATABASE_URL/)).toBeTruthy();
  vi.useRealTimers();
});

it("shows an expired secret card instead of unmounting it", async () => {
  mount([secret({ state: "expired" })]);
  expect(await screen.findByText(/Claude stopped waiting/)).toBeTruthy();
  // Still actionable: vaulting it later is useful, so the field remains.
  expect(screen.getByPlaceholderText("Paste the value")).toBeTruthy();
});

it("does not steal focus when a card appears", async () => {
  const input = document.createElement("input");
  document.body.appendChild(input);
  input.focus();
  mount([secret()]);
  await screen.findByText(/Claude needs DATABASE_URL/);
  // The whole point of the corner surface: the user keeps typing where they were.
  expect(document.activeElement).toBe(input);
  input.remove();
});

it("announces politely rather than assertively", async () => {
  mount([secret()]);
  await screen.findByText(/Claude needs DATABASE_URL/);
  // "assertive" would interrupt a screen reader mid-sentence, which is the
  // audible equivalent of stealing focus.
  expect(
    document.querySelector(".agent-request-stack")?.getAttribute("aria-live"),
  ).toBe("polite");
});

it("renders nothing at all when there are no requests", async () => {
  mount([]);
  await waitFor(() => expect(agentRequestsList).toHaveBeenCalled());
  expect(document.querySelector(".agent-request-stack")).toBeNull();
});

it("Later dismisses to the bell WITHOUT resolving the agent", async () => {
  mount([secret()]);
  fireEvent.click(await screen.findByText("Later"));
  expect(agentRequestDismiss).toHaveBeenCalledWith("r1");
  // Dismiss means later, not denied -- the agent keeps waiting.
  expect(requestSecretResolve).not.toHaveBeenCalled();
});

it("vaults the pasted value and reports vaulted to the agent", async () => {
  mount([secret()]);
  const field = await screen.findByPlaceholderText("Paste the value");
  fireEvent.change(field, { target: { value: "postgres://x" } });
  fireEvent.click(screen.getByText("Vault it"));
  await waitFor(() =>
    expect(secretsSet).toHaveBeenCalledWith(
      "/proj",
      "DATABASE_URL",
      "postgres://x",
    ),
  );
  await waitFor(() =>
    expect(requestSecretResolve).toHaveBeenCalledWith("r1", true),
  );
});

// The terminal most likely to be active when an agent asks for a secret is the
// one running THAT agent. Replacing it to pick up the new env killed the claude
// session and its subagents mid-turn (2026-09-30). The agent reads vaulted
// values at call time via run_command(injectSecrets), so a restart gains it
// nothing and costs it everything.
it("vaulting for an agent never replaces the running terminal, even with injection on", async () => {
  const ptyKill = vi.fn();
  (window.airlock as unknown as Record<string, unknown>).ptyKill = ptyKill;
  const tid = useApp.getState().activeTabId;
  const claudeTerm = {
    id: "t1",
    title: "claude",
    renamed: false,
    ptyId: "p-claude",
  };
  // Through setConfig, not setState: the tab slice is the source of truth and
  // any tab patch (setSecrets, on save) re-mirrors it over the top level.
  // biome-ignore lint/suspicious/noExplicitAny: only the field under test matters
  useApp.getState().setConfig({ injectSecretsIntoTerminal: true } as any, tid);
  useApp.setState({
    tabTerminals: {
      [tid]: {
        terminals: [claudeTerm],
        activeTerminalId: "t1",
        splitTerminalId: null,
        claudeAutoId: "t1",
      },
    },
  });
  mount([secret()]);
  const field = await screen.findByPlaceholderText("Paste the value");
  fireEvent.change(field, { target: { value: "sk-ant-x" } });
  fireEvent.click(screen.getByText("Vault it"));
  await waitFor(() =>
    expect(requestSecretResolve).toHaveBeenCalledWith("r1", true),
  );
  expect(ptyKill).not.toHaveBeenCalled();
  expect(useApp.getState().tabTerminals[tid]?.terminals).toEqual([claudeTerm]);
});

it("Allow and Deny resolve the terminal grant", async () => {
  mount([grant()]);
  fireEvent.click(await screen.findByText("Allow"));
  expect(terminalGrantResolve).toHaveBeenCalledWith("g1", true);
  cleanup();
  mount([grant()]);
  fireEvent.click(await screen.findByText("Deny"));
  expect(terminalGrantResolve).toHaveBeenCalledWith("g1", false);
});

it("renders the grant's project label and input preview", async () => {
  mount([grant()]);
  expect(await screen.findByText("proj")).toBeTruthy();
  expect(screen.getByText("npm test")).toBeTruthy();
});
