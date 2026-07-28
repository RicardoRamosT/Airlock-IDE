// Pure: given a project's current Slack extension config and a fresh auth.test
// result, compute the config PATCH to persist after a (re)connect. Records the
// connected workspace {id,name} for display; if the workspace CHANGED from the
// one the current channel allow-list belongs to, resets `channels` (their ids are
// workspace-scoped, so a stale list is meaningless). Import-free -> testable.
export function slackWorkspacePatch(
  curExt: Record<string, unknown> | undefined,
  auth: { teamId?: string; team?: string },
): Record<string, unknown> {
  const id = auth.teamId ?? "";
  const name = auth.team ?? "";
  const patch: Record<string, unknown> = { workspace: { id, name } };
  const prev = curExt?.workspace;
  const prevId =
    prev && typeof prev === "object"
      ? (prev as { id?: unknown }).id
      : undefined;
  if (typeof prevId === "string" && prevId && prevId !== id) {
    patch.channels = [];
  }
  return patch;
}

// Pure: the patch to persist when a project BINDS to a pooled workspace (the
// hub's one-click reuse), or unbinds (`ref` null).
//
// It exists because bind used to write only `workspace`, spreading the rest of
// the slack config through untouched -- so it silently skipped the
// workspace-change reset slackWorkspacePatch above has always done for the
// connect path. Channel ids are workspace-scoped, so a re-bind to a DIFFERENT
// workspace left the previous workspace's ids in the allow-list, and the Slack
// section listed them as though they were this workspace's channels.
//
// `channels` is cleared in three cases, all of them "this list can no longer be
// shown to belong to the bound workspace":
//   - binding to a different workspace than the list was built for
//   - binding when the list is ORPHANED (present with no workspace at all --
//     what a connect-then-disconnect leaves behind)
//   - unbinding
// Re-binding the SAME workspace keeps it: the ids still resolve, so discarding
// the user's picks would be gratuitous.
export function slackBindPatch(
  curExt: Record<string, unknown> | undefined,
  ref: { id: string; name?: string; domain?: string } | null,
): Record<string, unknown> {
  const prev = curExt?.workspace;
  const prevId =
    prev && typeof prev === "object"
      ? (prev as { id?: unknown }).id
      : undefined;
  const hadList = Array.isArray(curExt?.channels) && curExt.channels.length > 0;

  if (ref === null) {
    // undefined (not delete) because this is a merge patch: writing the key as
    // undefined is how the caller's spread drops it.
    return { workspace: undefined, channels: [] };
  }
  const workspace = {
    id: ref.id,
    ...(ref.name !== undefined ? { name: ref.name } : {}),
    ...(ref.domain !== undefined ? { domain: ref.domain } : {}),
  };
  const sameWorkspace = typeof prevId === "string" && prevId === ref.id;
  const orphaned = typeof prevId !== "string" || !prevId;
  return hadList && (!sameWorkspace || orphaned)
    ? { workspace, channels: [] }
    : { workspace };
}
