// Whether the sparkle should show its dot.
//
// Pure and separate because the first version was `brief !== null` -- which is
// just "a brief exists", not "you have not read it", so the dot stayed lit
// forever. The distinction is the whole point of the indicator.
export function isUnread(
  brief: { day: string } | null,
  acknowledged: boolean,
  lastReadDay: string,
): boolean {
  if (!acknowledged) return false;
  if (brief === null) return false;
  // Day keys are YYYY-MM-DD, so a string compare is a date compare.
  return brief.day > lastReadDay;
}
