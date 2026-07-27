// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { ProviderRows } from "./ProviderRows";

afterEach(cleanup);

it("always states a reason, even with nothing connected", () => {
  render(
    <ProviderRows
      rows={[
        {
          id: "docker",
          name: "Docker",
          icon: "docker",
          state: "not installed",
          instances: [],
        },
      ]}
    />,
  );
  // The whole point: never a bare blank or "Nothing to show yet."
  expect(screen.getByText("not installed")).toBeTruthy();
  expect(screen.getByText("Docker")).toBeTruthy();
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
  render(
    <ProviderRows
      rows={[
        {
          id: "docker",
          name: "Docker",
          icon: "docker",
          state: "1 container",
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
  expect(screen.getByText("postgres:16 · :5432")).toBeTruthy();
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
          connect: { label: "Connect Neon", onClick },
          instances: [],
        },
      ]}
    />,
  );
  fireEvent.click(screen.getByText("Connect Neon"));
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
          instances: [{ key: "w", label: "COMPUTE_WH" }],
        },
      ]}
    />,
  );
  // Snowflake is not Postgres -- offering Connect would be a lie.
  expect(screen.getByText("COMPUTE_WH")).toBeTruthy();
  expect(screen.queryByText("Connect")).toBeNull();
});
