// Hipolabs free university search. GSD-119.
//
// Why HTTP (not HTTPS): upstream only serves HTTP. On HTTPS sites this
// can be blocked by mixed-content rules. Callers MUST tolerate `[]`
// (network/CORS/HTTP failure) and fall back to free-text input.
//
// No internal allowlist, no normalization — out of scope.
const UNIVERSITIES_URL = "http://universities.hipolabs.com/search";

export interface UniversityOption {
  name: string;
  country: string;
}

interface HipolabsUniversity {
  name: string;
  country: string;
  domains?: string[];
  web_pages?: string[];
}

export async function fetchUniversities(
  query: string,
  signal?: AbortSignal,
): Promise<UniversityOption[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const res = await fetch(
      `${UNIVERSITIES_URL}?name=${encodeURIComponent(q)}`,
      { signal },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as HipolabsUniversity[];
    if (!Array.isArray(body)) return [];
    return body.map((u) => ({ name: u.name, country: u.country }));
  } catch {
    return [];
  }
}
