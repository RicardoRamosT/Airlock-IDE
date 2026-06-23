import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GitStatus,
  OverviewResult,
  ProjectTech,
  TechCategory,
} from "../../../shared/ipc";
import { openFileInRoot } from "../lib/editorFiles";
import { relativeTime, uncoveredAreaPaths } from "../lib/overviewFreshness";
import { categoryGlyph } from "../lib/overviewGlyphs";
import { logoUrl } from "../lib/overviewLogos";
import { buildOverviewPrompt } from "../lib/overviewPrompt";
import { planOverviewRun } from "../lib/overviewRun";
import { useApp } from "../store";
import { OverviewMarkdown } from "./OverviewMarkdown";

const CATEGORY_LABEL: Partial<Record<TechCategory, string>> = {
  language: "Languages & Runtimes",
  runtime: "Languages & Runtimes",
  framework: "Frameworks",
  build: "Build & Tooling",
  packageManager: "Package Manager",
  orm: "ORM",
  database: "Databases",
  hosting: "Hosting",
  backend: "Backend",
  auth: "Auth",
  payments: "Payments",
  infra: "Infra",
  observability: "Observability",
  other: "Other",
};

function Tile({ tech }: { tech: ProjectTech }) {
  const url = logoUrl(tech.id);
  const title = `${tech.name}${tech.version ? ` ${tech.version}` : ""}\nvia ${tech.sources.join(", ")}`;
  return (
    <div className="overview-tile" title={title}>
      {url ? (
        <img
          className="overview-logo"
          src={url}
          alt=""
          width={20}
          height={20}
        />
      ) : (
        <i className={`codicon codicon-${categoryGlyph(tech.category)}`} />
      )}
      <span className="overview-tile-name">{tech.name}</span>
    </div>
  );
}

function Group({ label, items }: { label: string; items: ProjectTech[] }) {
  if (items.length === 0) return null;
  return (
    <div className="overview-group">
      <div className="overview-group-label">{label}</div>
      <div className="overview-tiles">
        {items.map((t) => (
          <Tile key={t.id} tech={t} />
        ))}
      </div>
    </div>
  );
}

function groupByCategory(
  techs: ProjectTech[],
): Array<[TechCategory, ProjectTech[]]> {
  const map = new Map<TechCategory, ProjectTech[]>();
  for (const t of techs) {
    const arr = map.get(t.category) ?? [];
    arr.push(t);
    map.set(t.category, arr);
  }
  return [...map.entries()];
}

// GitHub-ish per-language colors for the stats bar; unknowns fall back to Other.
const LANG_COLORS: Record<string, string> = {
  typescript: "#3178c6",
  javascript: "#f1e05a",
  python: "#3572a5",
  rust: "#dea584",
  go: "#00add8",
  java: "#b07219",
  kotlin: "#a97bff",
  ruby: "#701516",
  php: "#4f5d95",
  csharp: "#178600",
  c: "#828282",
  cpp: "#f34b7d",
  swift: "#f05138",
  css: "#563d7c",
  html: "#e34c26",
  vue: "#41b883",
  svelte: "#ff3e00",
  json: "#cbcb41",
  markdown: "#083fa1",
  shell: "#89e051",
  sql: "#e38c00",
  yaml: "#cb171e",
  toml: "#9c4221",
  other: "#6b7280",
};

function LanguageBar({
  languages,
}: {
  languages: { id: string; name: string; files: number }[];
}) {
  const total = languages.reduce((s, l) => s + l.files, 0) || 1;
  return (
    <div className="overview-lang">
      <div className="overview-lang-bar">
        {languages.map((l) => (
          <span
            key={l.id}
            className="overview-lang-seg"
            style={{
              width: `${(l.files / total) * 100}%`,
              background: LANG_COLORS[l.id] ?? LANG_COLORS.other,
            }}
            title={`${l.name} — ${l.files} files`}
          />
        ))}
      </div>
      <div className="overview-lang-legend">
        {languages.map((l) => (
          <span key={l.id} className="overview-lang-item">
            <span
              className="overview-lang-dot"
              style={{ background: LANG_COLORS[l.id] ?? LANG_COLORS.other }}
            />
            {l.name} <em>{Math.round((l.files / total) * 100)}%</em>
          </span>
        ))}
      </div>
    </div>
  );
}

export function OverviewTab({ root }: { root: string }) {
  const [data, setData] = useState<OverviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [staged, setStaged] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const readyPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeTabId = useApp((s) => s.activeTabId);
  const tabTerminals = useApp((s) => s.tabTerminals);
  const sessionWorking = useApp((s) => s.sessionWorking);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const load = useCallback(() => {
    window.airlock
      .overviewGet(root)
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [root]);

  // Live status (separate from the cached profile -- it changes as you work).
  // Best-effort: a non-repo / no-dev-url project just shows no chip.
  const loadStatus = useCallback(() => {
    window.airlock
      .gitStatus(root)
      .then(setGit)
      .catch(() => setGit(null));
    window.airlock
      .hostLocalUrl(root)
      .then(setDevUrl)
      .catch(() => setDevUrl(null));
  }, [root]);

  const reload = useCallback(() => {
    load();
    loadStatus();
  }, [load, loadStatus]);

  // Poll the file's mtime until it advances past the baseline (Claude has
  // rewritten overview.md), or give up after ~2 min with a real message.
  const startWatch = useCallback(() => {
    setNotice(null);
    setGenerating(true);
    const baseline = data?.summaryMtimeMs ?? 0;
    let tries = 0;
    stopPoll();
    pollRef.current = setInterval(() => {
      if (tries >= 60) {
        setGenerating(false);
        stopPoll();
        setNotice(
          "Didn't detect an update — Claude may still be working. Reload to check.",
        );
        return;
      }
      tries += 1;
      window.airlock
        .overviewGet(root)
        .then((r) => {
          if (r.summaryMtimeMs > baseline) {
            setData(r);
            setGenerating(false);
            stopPoll();
          }
        })
        .catch(() => {});
    }, 2000);
  }, [data, root, stopPoll]);

  const run = useCallback(() => {
    setConfirming(false);
    setStaged(null);
    const seed = data?.profile.areas.map((a) => a.path) ?? [];
    const prompt = buildOverviewPrompt(seed);
    if (
      useApp.getState().runOverviewPrompt(prompt, activeTabId) === "submitted"
    ) {
      startWatch();
    } else {
      setStaged(prompt); // spawning: wait for the user to send when Claude is ready
    }
  }, [data, activeTabId, startWatch]);

  const sendStaged = useCallback(() => {
    if (
      staged &&
      useApp.getState().sendOverviewPromptNow(staged, activeTabId)
    ) {
      setStaged(null);
      startWatch();
    }
  }, [staged, activeTabId, startWatch]);

  // Auto-submit the staged prompt when the newly-spawned Claude becomes ready.
  // Runs only while `staged` is non-null. Reads FRESH state each tick (via
  // useApp.getState()) to avoid stale closures. Stops on success or after ~30s
  // (25 ticks × 1200ms); on timeout it leaves `staged` intact so the manual
  // "Send to Claude" button remains as the fallback.
  useEffect(() => {
    if (!staged) return;
    const TICK_MS = 1200;
    const MAX_TICKS = 25;
    let ticks = 0;
    readyPollRef.current = setInterval(() => {
      ticks += 1;
      if (ticks > MAX_TICKS) {
        if (readyPollRef.current) {
          clearInterval(readyPollRef.current);
          readyPollRef.current = null;
        }
        return;
      }
      const state = useApp.getState();
      const plan = planOverviewRun(
        state.tabTerminals[activeTabId],
        state.sessionWorking,
      );
      if (
        plan.mode === "reuse" &&
        state.sessionReady[plan.ptyId] &&
        !state.sessionWorking[plan.ptyId]
      ) {
        if (readyPollRef.current) {
          clearInterval(readyPollRef.current);
          readyPollRef.current = null;
        }
        sendStaged();
      }
    }, TICK_MS);
    return () => {
      if (readyPollRef.current) {
        clearInterval(readyPollRef.current);
        readyPollRef.current = null;
      }
    };
  }, [staged, activeTabId, sendStaged]);

  useEffect(load, [load]);
  useEffect(loadStatus, [loadStatus]);
  useEffect(() => stopPoll, [stopPoll]);

  if (error)
    return (
      <div className="overview empty">Couldn't read project info: {error}</div>
    );
  if (!data) return <div className="overview empty">Loading…</div>;

  const { profile, summary, stats, readme } = data;
  const generatedAgo =
    summary && data.summaryMtimeMs
      ? relativeTime(data.summaryMtimeMs, Date.now())
      : null;
  const uncovered = summary
    ? uncoveredAreaPaths(
        summary,
        profile.areas.map((a) => a.path),
      )
    : [];
  const techGroups = groupByCategory(profile.techs);
  const projectName = root.split("/").pop() ?? root;
  const plan = planOverviewRun(tabTerminals[activeTabId], sessionWorking);
  const confirmText =
    plan.mode === "spawn"
      ? "No Claude is running here — start one and run the summary?"
      : plan.busy
        ? "Run the summary in this project's Claude? It looks busy — it'll queue after the current turn."
        : "Run the summary in this project's Claude? It'll be typed in and submitted.";
  const dirty = git
    ? git.staged.length + git.unstaged.length + git.untracked.length
    : 0;
  const devHost = devUrl ? devUrl.replace(/^https?:\/\//, "") : null;

  return (
    <div className="overview">
      <div className="overview-header">
        <span className="overview-title">
          <i className="codicon codicon-book" /> {projectName}
        </span>
        <span className="overview-status">
          {git ? (
            <span
              className="overview-chip"
              title={`${git.branch.head}${dirty ? ` · ${dirty} uncommitted` : " · clean"}${git.branch.ahead ? ` · ${git.branch.ahead} ahead` : ""}${git.branch.behind ? ` · ${git.branch.behind} behind` : ""}`}
            >
              <i className="codicon codicon-git-branch" />
              {git.branch.head}
              {dirty > 0 ? (
                <em className="overview-chip-dirty">●{dirty}</em>
              ) : null}
              {git.branch.ahead > 0 ? <span>↑{git.branch.ahead}</span> : null}
              {git.branch.behind > 0 ? <span>↓{git.branch.behind}</span> : null}
            </span>
          ) : null}
          {devHost ? (
            <button
              type="button"
              className="overview-chip overview-chip-link"
              title={`Open ${devUrl}`}
              onClick={() => devUrl && window.airlock.hostOpenExternal(devUrl)}
            >
              <i className="codicon codicon-link-external" />
              {devHost}
            </button>
          ) : null}
        </span>
        <span className="overview-actions">
          {confirming ? (
            <span className="overview-confirm">
              <span className="overview-confirm-text">{confirmText}</span>
              <button type="button" className="btn" onClick={run}>
                Run
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="btn overview-generate"
              disabled={generating}
              onClick={() => setConfirming(true)}
            >
              {generating
                ? "Generating…"
                : summary
                  ? "Regenerate"
                  : "Generate summary"}
            </button>
          )}
          <button
            type="button"
            className="btn overview-refresh"
            onClick={reload}
          >
            <i className="codicon codicon-refresh" /> Reload
          </button>
        </span>
      </div>

      <div className="overview-grid">
        <aside className="overview-aside">
          <section className="overview-card">
            {techGroups.map(([cat, items]) => (
              <Group
                key={cat}
                label={CATEGORY_LABEL[cat] ?? cat}
                items={items}
              />
            ))}
            <Group label="Services" items={profile.services} />
          </section>

          {stats.languages.length > 0 ? (
            <section className="overview-card">
              <div className="overview-group-label">
                Code
                <span className="overview-fresh">
                  {" "}
                  · {stats.fileCount.toLocaleString()} files
                </span>
              </div>
              <LanguageBar languages={stats.languages} />
            </section>
          ) : null}
        </aside>

        <main className="overview-main">
          <section className="overview-card overview-areas">
            <div className="overview-group-label">
              Areas
              {generatedAgo ? (
                <span className="overview-fresh">
                  {" "}
                  · generated {generatedAgo}
                </span>
              ) : null}
            </div>
            {summary ? (
              <>
                {uncovered.length > 0 ? (
                  <div className="section-note">
                    {uncovered.length === 1
                      ? `1 area not covered (${uncovered[0]})`
                      : `${uncovered.length} areas not covered (${uncovered.join(", ")})`}{" "}
                    — Regenerate to refresh.
                  </div>
                ) : null}
                <OverviewMarkdown
                  md={summary}
                  onOpenFile={(p) => void openFileInRoot(root, p)}
                />
              </>
            ) : (
              <div className="overview-areas-skeleton">
                {profile.areas.map((a) => (
                  <div key={a.path} className="overview-area-row">
                    {a.name}
                  </div>
                ))}
                <div className="section-note">
                  No written summary yet — "Generate summary" has Claude
                  describe each area.
                </div>
              </div>
            )}
            {generating && (
              <div className="section-note">
                Generating… watching Claude write .airlock/overview.md
              </div>
            )}
            {staged && (
              <div className="section-note overview-staged">
                <span>
                  Claude is starting — the summary will run automatically when
                  it&apos;s ready, or click Send to Claude.
                </span>
                <button type="button" className="btn" onClick={sendStaged}>
                  Send to Claude
                </button>
              </div>
            )}
            {notice && <div className="section-note">{notice}</div>}
          </section>

          {readme ? (
            <section className="overview-card overview-readme">
              <div className="overview-group-label">README</div>
              <OverviewMarkdown
                md={readme}
                onOpenFile={(p) => void openFileInRoot(root, p)}
              />
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
