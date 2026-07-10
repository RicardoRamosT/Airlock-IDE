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
