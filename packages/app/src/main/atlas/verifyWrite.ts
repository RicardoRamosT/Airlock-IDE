// ASCII comments only. Write a text value, then check the database actually
// kept all of it.
//
// WHY THIS EXISTS. Atlas's stored text was silently coming back SHORT. Found
// 2026-09-16: six of eighteen snapshots were unparseable JSON, two debriefs
// ended mid-word ("since neither has been confirme"), and a standup row stopped
// at `"quiet":` with no value. Nothing errored anywhere, because every reader
// swallows a parse failure and answers null -- which is indistinguishable from
// "nothing was stored today".
//
// The mechanism is NOT known, and this does not pretend to fix it. What was
// ruled out, with evidence:
//   - the read path: the sqlite3 CLI and node:sqlite report identical lengths,
//     so the bytes really are short on disk
//   - multibyte: good rows carry MORE of it (19 in a 56 KB snapshot) than the
//     corrupt ones (1 to 11)
//   - size: 36 KB stored fine the day a 24 KB write was cut
//   - embedded NULs: none in any row
//   - the store itself: saveBrief/saveReports round-trip exactly, in system
//     Node and inside Electron, ASCII and multibyte, to 80 KB
//   - the host IPC: Electron utilityProcess structured-clone round-trips
//     multibyte strings intact at 2x byte expansion
//   - a code change: no commit touched atlas in the window
//   - a crash: no crash report in the window
//
// The one documented precedent is node:sqlite's Utf8Value mispredicting a
// UTF-8 length -- see the long comment in store.ts, which fired twice on this
// machine as an abort(). A misprediction that under-allocates WITHOUT tripping
// that assert would write a short value instead of crashing: the same root
// cause wearing a quieter costume. Unproven, so it is written here as a lead
// rather than a conclusion.
//
// Until it is understood, the honest behaviour is: check, retry once (the
// corruption is intermittent, so a second attempt usually lands), and if it is
// still short, THROW. A loud failure the caller can report beats a debrief that
// ends mid-sentence with nobody the wiser.

export function writeVerified(
  label: string,
  value: string,
  run: () => void,
  readBack: () => string | null,
): void {
  run();
  // An empty value takes the plain-string bind path (see bytes() in store.ts)
  // and has no length to lose.
  if (value.length === 0) return;
  if (readBack() === value) return;

  // One retry. Every observed instance was intermittent -- the same code wrote
  // the same shape correctly on the days either side.
  run();
  const again = readBack();
  if (again === value) return;

  throw new Error(
    `atlas: ${label} stored ${again === null ? 0 : again.length} of ${value.length} chars`,
  );
}
