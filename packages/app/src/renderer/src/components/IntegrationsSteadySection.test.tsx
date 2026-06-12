// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SteadyIntegration } from "../../../shared/ipc";
import { IntegrationsSteadySection } from "./IntegrationsSteadySection";

afterEach(cleanup);

const mockSteady = (all: SteadyIntegration[]) => {
  (
    window as unknown as {
      airlock: { integrationsSteady: () => Promise<SteadyIntegration[]> };
    }
  ).airlock = { integrationsSteady: vi.fn(() => Promise.resolve(all)) };
};

it("renders nothing when the only integration is absent", async () => {
  mockSteady([
    {
      id: "snowflake",
      name: "Snowflake",
      view: "databases",
      status: "absent",
      resources: [],
    },
  ]);
  const { container } = render(<IntegrationsSteadySection view="databases" />);
  await waitFor(() =>
    expect(window.airlock.integrationsSteady).toHaveBeenCalled(),
  );
  expect(container.textContent).toBe("");
});

it("shows a 'not connected' hint when unauthed", async () => {
  mockSteady([
    {
      id: "snowflake",
      name: "Snowflake",
      view: "databases",
      status: "unauthed",
      resources: [],
    },
  ]);
  render(<IntegrationsSteadySection view="databases" />);
  expect(await screen.findByText(/Snowflake . not connected/)).toBeTruthy();
});

it("renders a header and a row per resource when ready", async () => {
  mockSteady([
    {
      id: "snowflake",
      name: "Snowflake",
      view: "databases",
      status: "ready",
      resources: [
        {
          id: "int:snowflake:COMPUTE_WH",
          title: "COMPUTE_WH",
          subtitle: "X-Small",
          state: "running",
        },
        {
          id: "int:snowflake:ETL_WH",
          title: "ETL_WH",
          subtitle: "Small",
          state: "idle",
        },
      ],
    },
  ]);
  render(<IntegrationsSteadySection view="databases" />);
  expect(await screen.findByText("COMPUTE_WH")).toBeTruthy();
  expect(screen.getByText("ETL_WH")).toBeTruthy();
});

it("ignores integrations targeting other views", async () => {
  mockSteady([
    {
      id: "x",
      name: "X",
      view: "host",
      status: "ready",
      resources: [
        { id: "int:x:1", title: "svc", subtitle: "", state: "running" },
      ],
    },
  ]);
  const { container } = render(<IntegrationsSteadySection view="databases" />);
  await waitFor(() =>
    expect(window.airlock.integrationsSteady).toHaveBeenCalled(),
  );
  expect(container.textContent).toBe("");
});
