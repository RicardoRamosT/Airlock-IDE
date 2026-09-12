// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { ProviderRows } from "./ProviderRows";

afterEach(cleanup);

it("always states a reason, even with nothing connected", () => {
  const { container } = render(
    <ProviderRows
      rows={[
        {
          id: "docker",
          name: "Docker",
          icon: "docker",
          state: "not installed",
          tone: "off",
          instances: [],
        },
      ]}
    />,
  );
  // Rule 1 still holds -- the row is never a bare blank. The reason is just no
  // longer NARRATED in the row: it rides the tooltip and the screen-reader
  // text, and the dot carries it visually.
  expect(screen.getByText("not installed")).toBeTruthy();
  expect(container.querySelector(".provider-head")?.getAttribute("title")).toBe(
    "not installed",
  );
  expect(screen.getByText("Docker")).toBeTruthy();
  expect(container.querySelector(".activity-dot.grey")).toBeTruthy();
});

it("renders no dot while a probe has not answered", () => {
  // "unknown" is NOT "off": a CLI probe takes seconds, and a grey dot during
  // it asserts "not connected" before anything knows that.
  const { container } = render(
    <ProviderRows
      rows={[
        {
          id: "azure",
          name: "Azure",
          icon: "azure",
          state: "checking…",
          tone: "unknown",
          instances: [],
        },
      ]}
    />,
  );
  expect(container.querySelector(".activity-dot")).toBeNull();
});

it("shows a bare count instead of a sentence", () => {
  render(
    <ProviderRows
      rows={[
        {
          id: "docker",
          name: "Docker",
          icon: "docker",
          state: "3 database containers",
          tone: "ok",
          count: 3,
          instances: [],
        },
      ]}
    />,
  );
  // "3", not "3 database containers" -- the section header already said what
  // they are, and the number is the only part that changes.
  expect(screen.getByText("3")).toBeTruthy();
});

it("links every provider to its own extension section", () => {
  render(
    <ProviderRows
      rows={[
        {
          id: "neon",
          name: "Neon",
          icon: "neon",
          state: "3 branches",
          tone: "ok",
          count: 3,
          instances: [],
        },
      ]}
    />,
  );
  fireEvent.click(screen.getByLabelText("Open Neon"));
  expect(useApp.getState().activeView).toBe("ext:neon");
});

it("renders instances with their own action under the provider", () => {
  const onClick = vi.fn();
  const { container } = render(
    <ProviderRows
      rows={[
        {
          id: "docker",
          name: "Docker",
          icon: "docker",
          state: "1 container",
          tone: "ok",
          count: 1,
          instances: [
            {
              key: "c1",
              label: "myapp-db",
              detail: "postgres:16 · :5432",
              action: { label: "Connect", onClick },
            },
          ],
        },
      ]}
    />,
  );
  expect(screen.getByText("myapp-db")).toBeTruthy();
  // The image/port detail moved OFF the row and into its tooltip: it is what
  // you go looking for, not what you scan the list for.
  expect(
    container.querySelector(".provider-instance")?.getAttribute("title"),
  ).toBe("myapp-db — postgres:16 · :5432");
  fireEvent.click(screen.getByText("Connect"));
  expect(onClick).toHaveBeenCalled();
});

it("offers a provider-level connect distinct from an instance action", () => {
  const onClick = vi.fn();
  render(
    <ProviderRows
      rows={[
        {
          id: "neon",
          name: "Neon",
          icon: "neon",
          state: "not connected",
          tone: "off",
          connect: { label: "Connect", onClick },
          instances: [],
        },
      ]}
    />,
  );
  // A provider with nothing to count carries an ACTION in the count's place,
  // rather than describing its own absence.
  fireEvent.click(screen.getByText("Connect"));
  expect(onClick).toHaveBeenCalled();
});

it("renders an instance with no action as plain text", () => {
  render(
    <ProviderRows
      rows={[
        {
          id: "snowflake",
          name: "Snowflake",
          icon: "snowflake",
          state: "1 warehouse",
          tone: "ok",
          count: 1,
          instances: [{ key: "w", label: "COMPUTE_WH" }],
        },
      ]}
    />,
  );
  // Snowflake is not Postgres -- offering Connect would be a lie.
  expect(screen.getByText("COMPUTE_WH")).toBeTruthy();
  expect(screen.queryByText("Connect")).toBeNull();
});
