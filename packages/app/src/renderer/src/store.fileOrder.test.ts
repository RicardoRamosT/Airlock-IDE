import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "./store";

const initialState = useApp.getState();
const ROOT = "/workspace";

let getFileOrder: ReturnType<typeof vi.fn>;
let setFileOrder: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getFileOrder = vi.fn(() => Promise.resolve({ ".": ["b.ts", "a.ts"] }));
  setFileOrder = vi.fn(() => Promise.resolve(undefined));
  (globalThis as { window?: unknown }).window = {
    airlock: { getFileOrder, setFileOrder },
  };
  useApp.setState(initialState, true);
});
afterEach(() => useApp.setState(initialState, true));

it("loadFileOrder pulls the saved map into the store", async () => {
  await useApp.getState().loadFileOrder(ROOT);
  expect(getFileOrder).toHaveBeenCalledWith(ROOT);
  expect(useApp.getState().fileOrder[ROOT]).toEqual({ ".": ["b.ts", "a.ts"] });
});

it("setFolderOrder optimistically updates the store and persists", async () => {
  await useApp.getState().setFolderOrder(ROOT, "src", ["y.ts", "x.ts"]);
  expect(useApp.getState().fileOrder[ROOT]?.src).toEqual(["y.ts", "x.ts"]);
  expect(setFileOrder).toHaveBeenCalledWith(ROOT, "src", ["y.ts", "x.ts"]);
});

it("setFolderOrder rolls back when the write rejects", async () => {
  setFileOrder.mockReturnValueOnce(Promise.reject(new Error("disk full")));
  await useApp.getState().setFolderOrder(ROOT, "src", ["y.ts"]);
  // src had no prior order -> rollback removes the key entirely.
  expect(useApp.getState().fileOrder[ROOT]?.src).toBeUndefined();
});
