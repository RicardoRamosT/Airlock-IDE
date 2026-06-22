import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OverviewResult,
  ProjectTech,
  TechCategory,
} from "../../../shared/ipc";
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

export function OverviewTab({ root }: { root: string }) {
  const [data, setData] = useState<OverviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [staged, setStaged] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  useEffect(load, [load]);
  useEffect(() => stopPoll, [stopPoll]);

  if (error)
    return (
      <div className="overview empty">Couldn't read project info: {error}</div>
    );
  if (!data) return <div className="overview empty">Loading…</div>;

  const { profile, summary } = data;
  const techGroups = groupByCategory(profile.techs);
  const projectName = root.split("/").pop() ?? root;
  const plan = planOverviewRun(tabTerminals[activeTabId], sessionWorking);
  const confirmText =
    plan.mode === "spawn"
      ? "No Claude is running here — start one and run the summary?"
      : plan.busy
        ? "Run the summary in this project's Claude? It looks busy — it'll queue after the current turn."
        : "Run the summary in this project's Claude? It'll be typed in and submitted.";

  return (
    <div className="overview">
      <div className="overview-header">
        <span className="overview-title">
          <i className="codicon codicon-book" /> {projectName}
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
          <button type="button" className="btn overview-refresh" onClick={load}>
            <i className="codicon codicon-refresh" /> Reload
          </button>
        </span>
      </div>

      {techGroups.map(([cat, items]) => (
        <Group key={cat} label={CATEGORY_LABEL[cat] ?? cat} items={items} />
      ))}
      <Group label="Services" items={profile.services} />

      <div className="overview-areas">
        <div className="overview-group-label">Areas</div>
        {summary ? (
          <OverviewMarkdown md={summary} />
        ) : (
          <div className="overview-areas-skeleton">
            {profile.areas.map((a) => (
              <div key={a.path} className="overview-area-row">
                {a.name}
              </div>
            ))}
            <div className="section-note">
              No written summary yet — "Generate summary" has Claude describe
              each area.
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
            <span>Claude is starting here. When its prompt is ready:</span>
            <button type="button" className="btn" onClick={sendStaged}>
              Send to Claude
            </button>
          </div>
        )}
        {notice && <div className="section-note">{notice}</div>}
      </div>
    </div>
  );
}
