/** Normalise Play-Cricket / fantasy names for matching scorecard rows to roster players. */
export function normalizePlayCricketName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
