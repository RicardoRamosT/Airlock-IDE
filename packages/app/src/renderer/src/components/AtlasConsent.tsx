// The first-run gate. Atlas spends nothing until this is accepted, because the
// same call that costs the author quota costs an API-key user real money.
// The wording arrives from main, where the credential mode is known.
export function AtlasConsent(props: {
  disclosure: string;
  onAccept: () => void;
}) {
  return (
    <div className="atlas-consent">
      <h2>Turn on Atlas?</h2>
      <p>{props.disclosure}</p>
      <button type="button" onClick={props.onAccept}>
        Turn on Atlas
      </button>
    </div>
  );
}
