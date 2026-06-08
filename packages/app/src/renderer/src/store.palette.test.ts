import { afterEach, beforeEach, expect, it } from "vitest";
import { useApp } from "./store";

const initialState = useApp.getState();
beforeEach(() => useApp.setState(initialState, true));
afterEach(() => useApp.setState(initialState, true));

it("openPalette sets the mode, closePalette clears it", () => {
  expect(useApp.getState().palette).toBeNull();
  useApp.getState().openPalette("files");
  expect(useApp.getState().palette).toEqual({ mode: "files" });
  useApp.getState().openPalette("commands");
  expect(useApp.getState().palette).toEqual({ mode: "commands" });
  useApp.getState().closePalette();
  expect(useApp.getState().palette).toBeNull();
});
