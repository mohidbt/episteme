const MAX_LEN = 80;

export function toSlug(input: string): string {
  const slug = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LEN)
    .replace(/-+$/g, "");

  return slug || "untitled";
}

export function toPublicSlug(title: string): string {
  const suffix = randomSuffix(6);
  const base = toSlug(title);
  return `${base}-${suffix}`;
}

function randomSuffix(len: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
