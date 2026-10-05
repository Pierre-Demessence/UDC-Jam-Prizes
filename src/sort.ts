/**
 * Comparing rows whose value may be missing, shared by the gallery and the
 * admin table.
 */
export type Direction = 1 | -1;

/**
 * Empty values sort last whichever direction a column is in: an asset nobody
 * priced is not "the cheapest", and one with no author is not the first author.
 * The rule is applied before the direction is, which is why the direction is a
 * parameter here rather than a sign the caller multiplies in.
 */
export function compareOptional<T>(
  left: T | null,
  right: T | null,
  compare: (left: T, right: T) => number,
  direction: Direction = 1,
): number {
  if (left === null || right === null)
    return left === right ? 0 : left === null ? 1 : -1;

  return direction * compare(left, right);
}
