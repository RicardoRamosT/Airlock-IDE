// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { useVaultSecret, type VaultSaveResult } from "./useVaultSecret";

const initialState = useApp.getState();

let secretsSet: ReturnType<typeof vi.fn>;
let secretsList: ReturnType<typeof vi.fn>;

beforeEach(() => {
  secretsSet = vi.fn(async (_root, name) => ({
    name,
    provider: "postgres-url",
    valid: true,
    createdAt: "",
    updatedAt: "",
  }));
  secretsList = vi.fn(async () => []);
  window.airlock = new Proxy(
    { secretsSet, secretsList },
    {
      get: (t, k) =>
        k in t ? t[k as keyof typeof t] : () => Promise.resolve(),
    },
    // biome-ignore lint/suspicious/noExplicitAny: test double for the preload bridge
  ) as any;
  useApp.setState(initialState, true);
});

afterEach(cleanup);

// render() is synchronous, so the hook's value is available as soon as it
// returns -- no waiting, and no non-null assertion at each call site.
function mountHook(): ReturnType<typeof useVaultSecret> {
  let api: ReturnType<typeof useVaultSecret> | undefined;
  function Probe() {
    api = useVaultSecret();
    return null;
  }
  render(<Probe />);
  if (!api) throw new Error("useVaultSecret did not render");
  return api;
}

it("writes to the keychain with the given root, name and value", async () => {
  const r = await mountHook().save("/proj", "  DATABASE_URL  ", "postgres://x");
  // The name is trimmed; the value is passed through untouched.
  expect(secretsSet).toHaveBeenCalledWith(
    "/proj",
    "DATABASE_URL",
    "postgres://x",
  );
  expect(r).toEqual<VaultSaveResult>({ ok: true });
});

it("refreshes the secret list after a successful write", async () => {
  await mountHook().save("/proj", "A", "v");
  expect(secretsList).toHaveBeenCalledWith("/proj");
});

it("reports an unusual value as a WARNING, not a failure -- it is vaulted", async () => {
  secretsSet.mockResolvedValueOnce({
    name: "A",
    provider: null,
    valid: false,
    createdAt: "",
    updatedAt: "",
  });
  const r = await mountHook().save("/proj", "A", "hmm");
  expect(r.ok).toBe(true);
  expect(r.warning).toMatch(/looks unusual/);
  expect(r.error).toBeUndefined();
});

it("surfaces a write failure as an error and does not refresh", async () => {
  secretsSet.mockRejectedValueOnce(new Error("keychain locked"));
  const r = await mountHook().save("/proj", "A", "v");
  expect(r).toEqual<VaultSaveResult>({ ok: false, error: "keychain locked" });
  expect(secretsList).not.toHaveBeenCalled();
});
