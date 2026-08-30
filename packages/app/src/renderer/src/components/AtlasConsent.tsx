// The first-run gate. Atlas spends nothing until this is accepted, because the
// same call that costs the author quota costs an API-key user real money.
//
// It also has to EXPLAIN Atlas. A sparkle in the menu bar tells nobody what
// this is; if the app says nothing, the user is left to guess.
export function AtlasConsent(props: {
  disclosure: string;
  onAccept: () => void;
}) {
  return (
    <div className="atlas-consent">
      <h2>
        <span className="atlas-mark" aria-hidden="true">
          &#10022;
        </span>{" "}
        Meet Atlas
      </h2>
      <p className="atlas-what">
        Atlas keeps track of every project you have. It reads your repositories
        on its own, writes you a short debrief each day, and answers questions
        about what to work on. Tell it something worth remembering and it will.
      </p>
      <p>{props.disclosure}</p>
      <button
        type="button"
        className="atlas-btn primary"
        onClick={props.onAccept}
      >
        Turn on Atlas
      </button>
    </div>
  );
}
