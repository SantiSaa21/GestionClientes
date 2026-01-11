export function normalizeFullName(input: string) {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";

  return trimmed
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
