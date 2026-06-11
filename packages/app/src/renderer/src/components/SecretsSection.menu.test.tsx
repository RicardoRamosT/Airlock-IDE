// @vitest-environment jsdom
//
// Secret row overflow menu: the "..." button replaces the old eye/copy/trash
// cluster and opens a context menu with ALL row actions (reveal/copy/update/
// delete). Mirrors the FileTree.menu.test.tsx harness: window.airlock Proxy
// mock + pristine-store restore per test.

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SecretMeta } from "../../../shared/ipc";
import { ProjectPaneContext } from "../lib/projectPane";
import { useApp } from "../store";
import { SecretsSection } from "./SecretsSection";

const initialState = useApp.getState();

const ROOT = "/workspace";
const METAS = [{ name: "TEST", valid: true }] as SecretMeta[];

let secretsReveal: ReturnType<typeof vi.fn>;
let clipboardCopySecret: ReturnType<typeof vi.fn>;
let secretsDelete: ReturnType<typeof vi.fn>;

beforeEach(() => {
  secretsReveal = vi.fn(() => Promise.resolve<string | null>("plain-value"));
  clipboardCopySecret = vi.fn(() =>
    Promise.resolve({ copied: true, clearAfterSeconds: 30 }),
  );
  secretsDelete = vi.fn(() => Promise.resolve(undefined));
  // onSecretsChanged must return an UNSUBSCRIBE FUNCTION (the component's
  // effect returns it as the cleanup) -- the Proxy default (a Promise) would
  // make React warn about a non-function effect return.
  window.airlock = new Proxy(
    {
      secretsList: () => Promise.resolve(METAS),
      configGet: () => Promise.resolve({ injectSecretsIntoTerminal: false }),
      onSecretsChanged: () => () => {},
      secretsReveal,
      clipboardCopySecret,
      secretsDelete,
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

const get = () => useApp.getState();

// Seed the initial blank tab's root so the section mounts and refresh() pulls
// METAS through the secretsList mock; return the tabId for the pane context.
function seedRoot(): string {
  const tabId = get().tabs[0]?.id;
  if (!tabId) throw new Error("no initial tab");
  const cur = get().tabState[tabId];
  if (!cur) throw new Error("no tabState for initial tab");
  useApp.setState({
    tabState: { ...get().tabState, [tabId]: { ...cur, root: ROOT } },
  });
  return tabId;
}

const renderSection = (tabId: string) =>
  render(
    <ProjectPaneContext.Provider value={tabId}>
      <SecretsSection />
    </ProjectPaneContext.Provider>,
  );

it('"..." opens a menu with all four actions (old buttons gone)', async () => {
  const tabId = seedRoot();
  const { findByTitle, getByText, queryByTitle } = renderSection(tabId);

  fireEvent.click(await findByTitle("Secret actions"));

  expect(getByText("Reveal value")).toBeTruthy();
  expect(getByText("Copy value")).toBeTruthy();
  expect(getByText("Update value…")).toBeTruthy();
  expect(getByText("Delete")).toBeTruthy();
  // The standalone hover-revealed buttons were replaced by the menu.
  expect(queryByTitle("Copy value to clipboard")).toBeNull();
  expect(queryByTitle("Delete from Keychain")).toBeNull();
});

it("Reveal shows the plaintext and the item flips to Hide", async () => {
  const tabId = seedRoot();
  const { findByTitle, getByText, findByText } = renderSection(tabId);

  fireEvent.click(await findByTitle("Secret actions"));
  fireEvent.click(getByText("Reveal value"));

  expect(secretsReveal).toHaveBeenCalledWith(ROOT, "TEST");
  expect(await findByText("plain-value")).toBeTruthy();

  fireEvent.click(await findByTitle("Secret actions"));
  expect(getByText("Hide value")).toBeTruthy();
});

it("Copy calls the by-name clipboard IPC and shows the caption", async () => {
  const tabId = seedRoot();
  const { findByTitle, getByText, findByText } = renderSection(tabId);

  fireEvent.click(await findByTitle("Secret actions"));
  fireEvent.click(getByText("Copy value"));

  expect(clipboardCopySecret).toHaveBeenCalledWith(ROOT, "TEST");
  expect(await findByText(/Copied/)).toBeTruthy();
});

it("Update opens the update modal for the row's secret", async () => {
  const tabId = seedRoot();
  const { findByTitle, getByText } = renderSection(tabId);

  fireEvent.click(await findByTitle("Secret actions"));
  fireEvent.click(getByText("Update value…"));

  expect(get().modal).toEqual({ update: "TEST" });
});

it("Delete calls secretsDelete and the menu closes", async () => {
  const tabId = seedRoot();
  const { findByTitle, getByText, queryByText } = renderSection(tabId);

  fireEvent.click(await findByTitle("Secret actions"));
  fireEvent.click(getByText("Delete"));

  expect(secretsDelete).toHaveBeenCalledWith(ROOT, "TEST");
  await waitFor(() => expect(queryByText("Delete")).toBeNull());
});

it("backdrop click and Escape both close the menu", async () => {
  const tabId = seedRoot();
  const { findByTitle, getByLabelText, queryByText } = renderSection(tabId);

  fireEvent.click(await findByTitle("Secret actions"));
  fireEvent.click(getByLabelText("Close menu"));
  expect(queryByText("Copy value")).toBeNull();

  fireEvent.click(await findByTitle("Secret actions"));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(queryByText("Copy value")).toBeNull();
});
