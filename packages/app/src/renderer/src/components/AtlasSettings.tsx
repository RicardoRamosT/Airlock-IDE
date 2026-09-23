import type { AtlasProject } from "../../../shared/ipc";

// Atlas's own settings, rendered as a third view of the panel rather than a
// screen elsewhere. It therefore inherits the 412px grid: rows at --row-h,
// controls at --control-h, blocks at --sb-block-gap.
//
// The hour and surface controls were MOVED here from the app Settings tab,
// not copied -- two controls over one pref is how they disagree, and the
// Settings tab copy was the one nobody found.
//
// What did NOT move is atlas.enabled. The Settings tab's select conflates
// enabled and surface into one off/app/both list, and moving the whole thing
// in here would be a one-way door: choosing "off" removes the surface you are
// standing on and leaves no way back. The Settings tab decides whether Atlas
// exists; this decides how Atlas behaves.

export interface AtlasSettingsProps {
  hour: number;
  surface: "app" | "both";
  // null = NOT ASKED YET. Distinct from [], which is a real empty portfolio.
  projects: AtlasProject[] | null;
  onPrefs: (patch: { hour?: number; surface?: "app" | "both" }) => void;
  onToggle: (root: string, enabled: boolean) => void;
  // Drop a project from the registry for good. Offered ONLY on a row whose
  // folder is gone: forgetting a live project would just re-seed it from
  // recents on the next read, so the button would appear to do nothing.
  onForget: (root: string) => void;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function label(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

export function AtlasSettings({
  hour,
  surface,
  projects,
  onPrefs,
  onToggle,
  onForget,
}: AtlasSettingsProps) {
  const on = projects?.filter((p) => p.enabled && !p.missing) ?? [];

  return (
    <div className="atlas-settings">
      <div className="atlas-field">
        <label htmlFor="atlas-panel-hour">Debrief no earlier than</label>
        <select
          id="atlas-panel-hour"
          className="sb-control"
          value={String(hour)}
          onChange={(e) => onPrefs({ hour: Number(e.target.value) })}
        >
          {HOURS.map((h) => (
            <option key={h} value={String(h)}>
              {label(h)}
            </option>
          ))}
        </select>
      </div>

      <div className="atlas-field">
        <label htmlFor="atlas-panel-surface">Where Atlas appears</label>
        <select
          id="atlas-panel-surface"
          className="sb-control"
          value={surface}
          onChange={(e) =>
            onPrefs({ surface: e.target.value === "app" ? "app" : "both" })
          }
        >
          <option value="app">In the app</option>
          <option value="both">App and menu bar</option>
        </select>
      </div>

      <p className="sb-section-head">Projects in the debrief</p>
      <p className="atlas-settings-note">
        Each morning Atlas reads what changed in these projects, then asks
        Claude about the ones you worked in.
      </p>

      {projects === null ? (
        <p className="atlas-note">Loading...</p>
      ) : projects.length === 0 ? (
        <p className="atlas-note">
          Atlas has not seen any projects yet. Open one and it will appear here.
        </p>
      ) : (
        <div className="atlas-projects">
          {projects.map((p) => (
            <div
              key={p.root}
              className={`atlas-project${p.enabled ? "" : " off"}`}
            >
              <button
                type="button"
                role="switch"
                aria-checked={p.enabled}
                aria-label={p.name}
                className="atlas-switch"
                onClick={() => onToggle(p.root, !p.enabled)}
              />
              <span className="atlas-project-name" title={p.root}>
                {p.name}
              </span>
              {p.missing ? (
                <>
                  {/* WHAT WAS OBSERVED, not what it implies. The folder did
                      not answer -- which could be a deletion, a rename, an
                      unmounted drive or a permission AirLock has not been
                      granted, and one stat cannot tell those apart. The tag
                      said only "missing" with no way to find out what that
                      meant or when it was last seen. */}
                  <span
                    className="atlas-project-tag warn"
                    title={`Not found at ${p.root}. Last seen ${new Date(
                      p.lastSeenAt,
                    ).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}. The folder may have been deleted, renamed, moved, or be on a drive that is not mounted.`}
                  >
                    missing
                  </span>
                  {/* The row was permanent before this: forgetProject is
                      reachable only from a debrief concern, so a folder you
                      deleted sat here for good and kept counting toward
                      "N of M on". Removal stays the USER's call -- AirLock
                      flags, and never drops on its own, because it cannot
                      prove a deletion.

                      ALWAYS VISIBLE, and LABELLED. It shipped once as a
                      `row-action reveal` trash icon, and `.reveal` is
                      opacity:0 with the un-hiding rule wired per row
                      container -- .atlas-project has none, so the control was
                      invisible and still perfectly clickable, and a project
                      got removed by someone who could not see what they hit.
                      A hover-reveal is for a cheap, repeatable action; this
                      one cannot be undone. The word "Remove" also settles
                      what a trash can next to a project name does NOT mean:
                      nothing on disk is touched. */}
                  <button
                    type="button"
                    className="atlas-project-forget"
                    title={`Remove ${p.name} from Atlas's list. The folder itself is not touched -- it is already gone from ${p.root}.`}
                    onClick={() => onForget(p.root)}
                  >
                    Remove
                  </button>
                </>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {projects !== null && projects.length > 0 ? (
        // What a switch COSTS, in the unit the user actually pays in. An
        // enabled project that saw work spends a reporter call, so the price
        // belongs next to the switch rather than in a changelog.
        <p className="atlas-settings-cost">
          <b>{on.length}</b> of {projects.length} on. Up to {on.length} short
          Claude calls each morning, about 20K to 50K tokens each. Projects with
          no activity are skipped and cost nothing.
        </p>
      ) : null}
    </div>
  );
}
