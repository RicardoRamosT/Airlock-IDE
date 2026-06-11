// @vitest-environment jsdom
//
// Update-mode modal: pre-fills the CURRENT value via the audited reveal IPC
// (the same owner-triggered door as the row's Reveal) so the user can see and
// edit it instead of overwriting blind. Add mode never reveals.

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { SecretModal } from "./SecretModal";

const initialState = useApp.getState();

const ROOT = "/workspace";

let secretsReveal: ReturnType<typeof vi.fn>;
let secretsSet: ReturnType<typeof vi.fn>;

beforeEach(() => {
  secretsReveal = vi.fn(() => Promise.resolve<string | null>("current-value"));
  secretsSet = vi.fn(() => Promise.resolve({ name: "TEST", valid: true }));
  window.airlock = new Proxy(
    {
      secretsReveal,
      secretsSet,
      secretsList: () => Promise.resolve([]),
    },
    {
      get: (target, prop) =>
        prop in target
          ? (target as Record<string, unknown>)[prop as string]
          : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
  useApp.setState(initialState, true);
});

afterEach(() => cleanup());

const valueArea = (container: HTMLElement) =>
  container.querySelector("textarea.modal-value") as HTMLTextAreaElement;

it("update mode fetches and pre-fills the current value (masked)", async () => {
  useApp.setState({ modal: { update: "TEST" }, root: ROOT });
  const { container } = render(<SecretModal />);

  await waitFor(() => expect(valueArea(container).value).toBe("current-value"));
  expect(secretsReveal).toHaveBeenCalledWith(ROOT, "TEST");
  expect(valueArea(container).className).toContain("masked");
});

it("editing and saving submits the edited value", async () => {
  useApp.setState({ modal: { update: "TEST" }, root: ROOT });
  const { container, getByText } = render(<SecretModal />);

  await waitFor(() => expect(valueArea(container).value).toBe("current-value"));
  fireEvent.change(valueArea(container), { target: { value: "edited-value" } });
  fireEvent.click(getByText("Save to Keychain"));

  await waitFor(() =>
    expect(secretsSet).toHaveBeenCalledWith(ROOT, "TEST", "edited-value"),
  );
});

it("a missing keychain value leaves the field empty and editable", async () => {
  secretsReveal.mockImplementation(() => Promise.resolve<string | null>(null));
  useApp.setState({ modal: { update: "TEST" }, root: ROOT });
  const { container } = render(<SecretModal />);

  await waitFor(() => expect(valueArea(container).disabled).toBe(false));
  expect(valueArea(container).value).toBe("");
});

it("add mode never calls reveal", async () => {
  useApp.setState({ modal: "add-secret", root: ROOT });
  const { container } = render(<SecretModal />);

  await waitFor(() => expect(valueArea(container).disabled).toBe(false));
  expect(secretsReveal).not.toHaveBeenCalled();
});
