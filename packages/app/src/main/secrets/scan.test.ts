import { afterEach, describe, expect, it, vi } from "vitest";

// Partial-mock @airlock/agent-core: replace the git-spawning and
// keychain-touching pieces with fakes (no spawn, no Electron, no real
// keychain -- per this repo's test-matrix convention) but keep the REAL
// scanForSecrets (pure) and the REAL session-secret store (pure, in-memory),
// since the whole point of these tests is to prove scan.ts's own composition
// of vaultedSecrets + sessionSecretEntries + scanForSecrets, not a re-mock of
// it.
vi.mock("@airlock/agent-core", async (orig) => ({
  ...(await orig<typeof import("@airlock/agent-core")>()),
  gitStatus: vi.fn(),
  gitFileVersions: vi.fn(),
  vaultedSecrets: vi.fn(async () => []),
}));

import {
  clearSessionSecrets,
  gitFileVersions,
  gitStatus,
  putSessionSecret,
  vaultedSecrets,
} from "@airlock/agent-core";
import { scanStaged } from "./scan";

const gitStatusMock = gitStatus as unknown as ReturnType<typeof vi.fn>;
const gitFileVersionsMock = gitFileVersions as unknown as ReturnType<
  typeof vi.fn
>;
const vaultedMock = vaultedSecrets as unknown as ReturnType<typeof vi.fn>;

const root = "/r";

function stubOneStagedFile(path: string, content: string): void {
  gitStatusMock.mockResolvedValue({
    branch: { head: "main", upstream: null, ahead: 0, behind: 0 },
    staged: [{ path, index: "M", worktree: ".", origPath: null }],
    unstaged: [],
    untracked: [],
  });
  gitFileVersionsMock.mockResolvedValue({
    original: "",
    modified: content,
    binary: false,
    truncated: false,
  });
}

describe("scanStaged", () => {
  afterEach(() => {
    clearSessionSecrets();
    vi.clearAllMocks();
  });

  // The regression this guards: a SESSION-captured secret (capture_secret) can
  // reach staged content exactly like a vaulted one -- injectSecrets into a
  // build, `printenv > file`, `docker compose config > resolved.yml` -- and
  // before this fix scanFiles built its match set from vaultedSecrets(root)
  // ALONE, so this leak went unreported and guardedCommit would let
  // git_commit through it silently. vaultedSecrets is stubbed to return
  // nothing, so this can only pass via the SESSION store reaching the scan.
  it("reports a leak for a session-captured value in staged content, with nothing vaulted", async () => {
    vaultedMock.mockResolvedValue([]);
    putSessionSecret(root, "PROD_URL", "postgres://user:pw@host/db", "az show");
    stubOneStagedFile(
      "resolved.yml",
      "DATABASE_URL=postgres://user:pw@host/db\n",
    );

    const leaks = await scanStaged(root);

    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toMatchObject({
      path: "resolved.yml",
      line: 1,
      name: "PROD_URL",
    });
  });

  it("reports nothing when the session store holds no matching value", async () => {
    vaultedMock.mockResolvedValue([]);
    stubOneStagedFile("resolved.yml", "DATABASE_URL=not-a-secret\n");

    const leaks = await scanStaged(root);

    expect(leaks).toEqual([]);
  });
});
