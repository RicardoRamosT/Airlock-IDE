import { useCallback, useEffect, useState } from "react";
import type {
  OverviewResult,
  ProjectTech,
  TechCategory,
} from "../../../shared/ipc";
import { logoUrl } from "../lib/overviewLogos";

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
        <i className="codicon codicon-circle-large-outline" />
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

  const load = useCallback(() => {
    window.airlock
      .overviewGet(root)
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [root]);

  useEffect(load, [load]);

  if (error)
    return (
      <div className="overview empty">Couldn't read project info: {error}</div>
    );
  if (!data) return <div className="overview empty">Loading…</div>;

  const { profile, summary } = data;
  const techGroups = groupByCategory(profile.techs);
  const projectName = root.split("/").pop() ?? root;

  return (
    <div className="overview">
      <div className="overview-header">
        <span className="overview-title">
          <i className="codicon codicon-info" /> {projectName}
        </span>
        <button type="button" className="btn overview-refresh" onClick={load}>
          <i className="codicon codicon-refresh" /> Reload
        </button>
      </div>

      {techGroups.map(([cat, items]) => (
        <Group key={cat} label={CATEGORY_LABEL[cat] ?? cat} items={items} />
      ))}
      <Group label="Services" items={profile.services} />

      <div className="overview-areas">
        <div className="overview-group-label">Areas</div>
        {summary ? (
          <pre className="overview-summary">{summary}</pre>
        ) : (
          <div className="overview-areas-skeleton">
            {profile.areas.map((a) => (
              <div key={a.path} className="overview-area-row">
                {a.name}
              </div>
            ))}
            <div className="section-note">
              No written summary yet — use “Generate summary” to have Claude
              describe each area.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
