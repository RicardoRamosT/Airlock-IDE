// EslintBar.tsx -- the one-time question before a repo's ESLint may run.
//
// Running a project's ESLint executes its eslint.config.* and every plugin it
// imports, so the bar says exactly that rather than a vague "enable linting?".
// It names the folder being trusted because a project can hold several ESLint
// units (client/ and server/), each asked about separately.
export function EslintBar({
  state,
  unit,
  onEnable,
  onDismiss,
}: {
  state: "untrusted" | "missing-eslint";
  /** Root-relative config folder; "" = the project root. */
  unit: string;
  onEnable: () => void;
  onDismiss: () => void;
}) {
  const where = unit ? <code>{unit}</code> : "this project";
  return (
    <div className="eslint-bar" role="status">
      <span className="eslint-bar-text">
        <i className="codicon codicon-shield" aria-hidden="true" />
        {state === "untrusted" ? (
          <>
            {where} has an ESLint config. Running it executes code from this
            repo.
          </>
        ) : (
          <>
            {where} has an ESLint config, but ESLint isn't installed. Run{" "}
            <code>npm install</code> to see its problems here.
          </>
        )}
      </span>
      <span className="eslint-bar-actions">
        <button type="button" className="btn" onClick={onDismiss}>
          Not now
        </button>
        {state === "untrusted" && (
          <button type="button" className="btn primary" onClick={onEnable}>
            Enable ESLint here
          </button>
        )}
      </span>
    </div>
  );
}
