// Phase 1.4.x — Task 9: agent-config bundle (export/import zip).
//
// Pure lib used by:
//  - GET /api/agent/export — buildBundle(userId) -> zip
//  - POST /api/agent/import (no confirm) — parseBundle + diffBundle -> diff JSON
//  - POST /api/agent/import (confirm)    — parseBundle + applyBundle -> upsert
//
// Strip rules (per spec section 1.4.x-T9):
//  - attached_mcps[*].oauth_tokens, .accessToken, .refreshToken, .oauth_token
//    -> DROPPED. We strip both top-level and nested oauth_tokens shapes
//    because the schema is jsonb and historical rows may use either.
//  - user_id is NOT exported. Re-bound on apply to current session user.
//
// Apply policy: ADDITIVE merge. We never delete user notes that the bundle
// happens not to mention. Skills/memories with the same path get their body
// overwritten; new ones are inserted. Safer for v1 — destructive sync can
// follow later behind an explicit flag.

import JSZip from "jszip";
import { and, eq, like, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentConfigs, notes, libraries } from "@episteme/db/schema";
import { getSkillStore } from "@/lib/skills-store";

// ---------- Types ----------------------------------------------------------

export type SerializedAgentConfig = {
  enabledSkills: string[];
  attachedMcps: Array<Record<string, unknown>>;
  modelPreference: string;
  approvalRules: Record<string, unknown>;
  settingsJson: Record<string, unknown>;
};

export type SkillNote = { path: string; body: string };
export type MemoryNote = { path: string; body: string };
export type PersonalSkillEntry = { slug: string; json: string };

export type AgentConfigSnapshot = {
  agentConfig: SerializedAgentConfig;
  skills: SkillNote[];
  personalSkills: PersonalSkillEntry[];
  memories: MemoryNote[];
};

export type AgentConfigBundle = {
  agent_config: SerializedAgentConfig;
  skills: SkillNote[];
  personalSkills: PersonalSkillEntry[];
  memories: MemoryNote[];
  settings_json: Record<string, unknown>;
};

export type BundleDiff = {
  skills: { added: string[]; removed: string[]; modified: string[] };
  personalSkills: { added: string[]; removed: string[]; modified: string[] };
  memories: { added: string[]; removed: string[]; modified: string[] };
  settings: { changed: string[] };
};

// ---------- Constants ------------------------------------------------------

const SKILLS_PREFIX = ".episteme/agents/skills/";
const PERSONAL_SKILLS_PREFIX = ".episteme/agents/skills-personal/";
const MEMORIES_PREFIX = ".episteme/agents/memories/";

// A5: source of truth is `services/agents/skills/*` on disk (seeded by DriveSkillsLoader). Add a new system skill there AND here.
const SYSTEM_SKILL_SLUGS: ReadonlySet<string> = new Set([
  "claim-verify",
  "data-extract",
  "deep-read",
  "lit-triage",
  "paper-search",
  "synthesis",
]);

function extractSkillSlug(path: string): string | null {
  if (!path.startsWith(SKILLS_PREFIX)) return null;
  const rest = path.slice(SKILLS_PREFIX.length);
  const slash = rest.indexOf("/");
  return slash === -1 ? rest : rest.slice(0, slash);
}

const OAUTH_KEYS_TO_STRIP = new Set([
  "oauth_tokens",
  "oauth_token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
]);

// ---------- Pure: serialize / strip ---------------------------------------

export function serializeAgentConfig(
  raw: Record<string, unknown> & Partial<SerializedAgentConfig>,
): SerializedAgentConfig {
  const mcpsRaw = Array.isArray(raw.attachedMcps) ? raw.attachedMcps : [];
  const attachedMcps = mcpsRaw.map((m) => stripOAuth(m as Record<string, unknown>));
  return {
    enabledSkills: Array.isArray(raw.enabledSkills) ? [...raw.enabledSkills] : [],
    attachedMcps,
    modelPreference: typeof raw.modelPreference === "string" ? raw.modelPreference : "",
    approvalRules:
      raw.approvalRules && typeof raw.approvalRules === "object"
        ? { ...(raw.approvalRules as Record<string, unknown>) }
        : {},
    settingsJson:
      raw.settingsJson && typeof raw.settingsJson === "object"
        ? { ...(raw.settingsJson as Record<string, unknown>) }
        : {},
  };
}

function stripOAuth(mcp: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(mcp)) {
    if (OAUTH_KEYS_TO_STRIP.has(k)) continue;
    out[k] = v;
  }
  return out;
}

// ---------- Pure: zip build / parse ---------------------------------------

function encodeNotes(items: Array<{ path: string; body: string }>): string {
  // Each entry begins with a header line so the exported .md is human-skimmable
  // but still machine-splittable.
  if (items.length === 0) return "";
  return items
    .map((n) => `<!-- @path: ${n.path} -->\n${n.body}`)
    .join("\n\n");
}

function decodeNotes(blob: string): Array<{ path: string; body: string }> {
  if (!blob.trim()) return [];
  const lines = blob.split("\n");
  const out: Array<{ path: string; body: string }> = [];
  let curPath: string | null = null;
  let buf: string[] = [];
  const headerRe = /^<!--\s*@path:\s*(.+?)\s*-->\s*$/;
  for (const line of lines) {
    const m = headerRe.exec(line);
    if (m) {
      if (curPath !== null) {
        out.push({ path: curPath, body: buf.join("\n").replace(/\n+$/, "") });
      }
      curPath = m[1];
      buf = [];
    } else if (curPath !== null) {
      buf.push(line);
    }
  }
  if (curPath !== null) {
    out.push({ path: curPath, body: buf.join("\n").replace(/\n+$/, "") });
  }
  return out;
}

/**
 * B13/A5: skill export filter — system skills (those whose slug appears in
 * `SYSTEM_SKILL_SLUGS`, seeded from `services/agents/skills/*` on disk)
 * are stripped from the exported bundle. Personal skills survive via
 * `personalSkills`. The previous implementation used a brittle path-prefix
 * check that also dropped personal skills sharing the `.episteme/agents/skills/`
 * prefix; the allowlist is the explicit fix.
 */
export function filterExportableSkills(skills: SkillNote[]): SkillNote[] {
  return skills.filter((s) => {
    const slug = extractSkillSlug(s.path);
    return slug === null || !SYSTEM_SKILL_SLUGS.has(slug);
  });
}

export async function buildBundleFromSnapshot(
  s: AgentConfigSnapshot,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("agent_config.json", JSON.stringify(s.agentConfig, null, 2));
  zip.file("memory.md", encodeNotes(s.memories));
  zip.file("settings.json", JSON.stringify(s.agentConfig.settingsJson, null, 2));
  // Skip system skills (`.episteme/agents/skills/...`) on export — they
  // live in the agent service and shouldn't ship in user-bundle exports.
  const exportableSkills = filterExportableSkills(s.skills);
  for (const sk of exportableSkills) {
    zip.file(sk.path, sk.body);
  }
  // Personal skills as structured .json entries
  for (const ps of s.personalSkills) {
    zip.file(`${PERSONAL_SKILLS_PREFIX}${ps.slug}/SKILL.json`, ps.json);
  }
  return zip.generateAsync({ type: "uint8array" });
}

export async function parseBundle(zipBytes: Uint8Array): Promise<AgentConfigBundle> {
  const zip = await JSZip.loadAsync(zipBytes);
  const cfgFile = zip.file("agent_config.json");
  if (!cfgFile) throw new Error("bundle missing agent_config.json");
  const cfgRaw = JSON.parse(await cfgFile.async("string")) as Record<string, unknown>;
  const agent_config = serializeAgentConfig(cfgRaw);

  const memBlob = (await zip.file("memory.md")?.async("string")) ?? "";
  const settingsBlob = (await zip.file("settings.json")?.async("string")) ?? "{}";

  // Collect system skills from structured .episteme/agents/skills/<slug>/SKILL.md entries
  const skills: SkillNote[] = [];
  for (const [relativePath, file] of Object.entries(zip.files)) {
    if (!file.dir && relativePath.startsWith(SKILLS_PREFIX) && relativePath.endsWith(".md")) {
      const body = await file.async("string");
      skills.push({ path: relativePath, body });
    }
  }

  // Collect personal skills from .episteme/agents/skills-personal/<slug>/SKILL.json
  const personalSkills: PersonalSkillEntry[] = [];
  for (const [relativePath, file] of Object.entries(zip.files)) {
    if (!file.dir && relativePath.startsWith(PERSONAL_SKILLS_PREFIX) && relativePath.endsWith("/SKILL.json")) {
      const json = await file.async("string");
      // Extract slug: .episteme/agents/skills-personal/<slug>/SKILL.json
      const slug = relativePath.slice(PERSONAL_SKILLS_PREFIX.length, -"/SKILL.json".length);
      personalSkills.push({ slug, json });
    }
  }

  let settings_json: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(settingsBlob);
    if (parsed && typeof parsed === "object") settings_json = parsed;
  } catch {
    // ignore — keep empty
  }

  return {
    agent_config,
    skills,
    personalSkills,
    memories: decodeNotes(memBlob),
    settings_json,
  };
}

// ---------- Pure: diff -----------------------------------------------------

function diffNoteSets(local: SkillNote[], bundle: SkillNote[]) {
  const localByPath = new Map(local.map((n) => [n.path, n.body.trim()]));
  const bundleByPath = new Map(bundle.map((n) => [n.path, n.body.trim()]));
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  for (const [path, body] of bundleByPath) {
    if (!localByPath.has(path)) added.push(path);
    else if (localByPath.get(path) !== body) modified.push(path);
  }
  for (const path of localByPath.keys()) {
    if (!bundleByPath.has(path)) removed.push(path);
  }
  return { added: added.sort(), removed: removed.sort(), modified: modified.sort() };
}

function diffSettings(
  local: SerializedAgentConfig,
  bundle: SerializedAgentConfig,
): { changed: string[] } {
  const changed: string[] = [];
  const keys: Array<keyof SerializedAgentConfig> = [
    "enabledSkills",
    "attachedMcps",
    "modelPreference",
    "approvalRules",
    "settingsJson",
  ];
  for (const k of keys) {
    if (JSON.stringify(local[k]) !== JSON.stringify(bundle[k])) changed.push(k);
  }
  return { changed };
}

function diffPersonalSkills(
  local: PersonalSkillEntry[],
  bundle: PersonalSkillEntry[],
): { added: string[]; removed: string[]; modified: string[] } {
  const localBySlug = new Map(local.map((ps) => [ps.slug, ps.json.trim()]));
  const bundleBySlug = new Map(bundle.map((ps) => [ps.slug, ps.json.trim()]));
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  for (const [slug, json] of bundleBySlug) {
    if (!localBySlug.has(slug)) added.push(slug);
    else if (localBySlug.get(slug) !== json) modified.push(slug);
  }
  for (const slug of localBySlug.keys()) {
    if (!bundleBySlug.has(slug)) removed.push(slug);
  }
  return { added: added.sort(), removed: removed.sort(), modified: modified.sort() };
}

export function diffSnapshots(
  local: AgentConfigSnapshot,
  bundle: AgentConfigSnapshot,
): BundleDiff {
  return {
    skills: diffNoteSets(local.skills, bundle.skills),
    personalSkills: diffPersonalSkills(local.personalSkills, bundle.personalSkills),
    memories: diffNoteSets(local.memories, bundle.memories),
    settings: diffSettings(local.agentConfig, bundle.agentConfig),
  };
}

// ---------- DB-bound: snapshot reader / writer -----------------------------

async function readSnapshot(userId: string): Promise<AgentConfigSnapshot> {
  const cfgRows = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, userId));

  const cfg: SerializedAgentConfig = cfgRows[0]
    ? serializeAgentConfig(cfgRows[0] as unknown as Record<string, unknown>)
    : serializeAgentConfig({});

  const noteRows = await db
    .select({
      folderPath: notes.folderPath,
      title: notes.title,
      contentMd: notes.contentMd,
    })
    .from(notes)
    .where(
      and(
        eq(notes.userId, userId),
        or(
          like(notes.folderPath, `${SKILLS_PREFIX}%`),
          like(notes.folderPath, `${MEMORIES_PREFIX}%`),
        ),
      ),
    );

  const skills: SkillNote[] = [];
  const memories: MemoryNote[] = [];
  for (const r of noteRows) {
    const fp = r.folderPath ?? "";
    const path = `${fp}${fp.endsWith("/") || fp === "" ? "" : "/"}${r.title}.md`;
    if (path.startsWith(SKILLS_PREFIX)) {
      skills.push({ path, body: r.contentMd });
    } else if (path.startsWith(MEMORIES_PREFIX)) {
      memories.push({ path, body: r.contentMd });
    }
  }

  // Personal skills from MinIO (SkillStore)
  const personalSkills: PersonalSkillEntry[] = [];
  const store = getSkillStore();
  const manifests = await store.list(userId);
  for (const m of manifests) {
    try {
      const json = await store.read(userId, m.slug);
      personalSkills.push({ slug: m.slug, json });
    } catch {
      // Keep export resilient to one unreadable object, matching SkillStore.list().
    }
  }

  return { agentConfig: cfg, skills, personalSkills, memories };
}

// ---------- Public DB-bound facade ----------------------------------------

export async function buildBundle(userId: string): Promise<Uint8Array> {
  const s = await readSnapshot(userId);
  return buildBundleFromSnapshot(s);
}

export async function diffBundle(
  userId: string,
  bundle: AgentConfigBundle,
): Promise<BundleDiff> {
  const local = await readSnapshot(userId);
  return diffSnapshots(local, {
    agentConfig: bundle.agent_config,
    skills: bundle.skills,
    personalSkills: bundle.personalSkills,
    memories: bundle.memories,
  });
}

export async function applyBundle(
  userId: string,
  bundle: AgentConfigBundle,
): Promise<void> {
  // 1) Upsert agent_configs (re-bound to current user_id).
  const cfg = bundle.agent_config;
  await db
    .insert(agentConfigs)
    .values({
      userId,
      enabledSkills: cfg.enabledSkills,
      attachedMcps: cfg.attachedMcps,
      modelPreference: cfg.modelPreference,
      approvalRules: cfg.approvalRules,
      settingsJson: cfg.settingsJson,
    })
    .onConflictDoUpdate({
      target: agentConfigs.userId,
      set: {
        enabledSkills: cfg.enabledSkills,
        attachedMcps: cfg.attachedMcps,
        modelPreference: cfg.modelPreference,
        approvalRules: cfg.approvalRules,
        settingsJson: cfg.settingsJson,
        updatedAt: new Date(),
      },
    });

  // 2) Additive merge of skill + memory notes. We never delete.
  if (bundle.skills.length > 0 || bundle.memories.length > 0) {
    // Resolve default library for inserts.
    const libRows = await db
      .select({ id: libraries.id })
      .from(libraries)
      .where(eq(libraries.userId, userId))
      .limit(1);
    if (libRows.length === 0) {
      throw new Error(`applyBundle: no library found for user ${userId}`);
    }
    const libraryId = libRows[0].id;

    for (const note of [...bundle.skills, ...bundle.memories]) {
      await upsertNoteByPath(userId, libraryId, note.path, note.body);
    }
  }

  // 3) Additive merge of personal skills into MinIO.
  if (bundle.personalSkills.length > 0) {
    const store = getSkillStore();
    for (const ps of bundle.personalSkills) {
      await store.write(userId, ps.slug, ps.json);
    }
  }
}

function splitPath(path: string): { folderPath: string; title: string } {
  const parts = path.split("/");
  const last = parts.pop() ?? "";
  const title = last.endsWith(".md") ? last.slice(0, -3) : last;
  const folderPath = parts.length > 0 ? `${parts.join("/")}/` : "";
  return { folderPath, title };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";
}

async function upsertNoteByPath(
  userId: string,
  libraryId: number,
  path: string,
  body: string,
): Promise<void> {
  const { folderPath, title } = splitPath(path);
  // Match an existing note by (userId, folderPath, title) — stable enough
  // for the additive-merge contract. If found, UPDATE its body; else INSERT.
  const existing = await db
    .select({ id: notes.id })
    .from(notes)
    .where(
      and(
        eq(notes.userId, userId),
        eq(notes.folderPath, folderPath),
        eq(notes.title, title),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(notes)
      .set({ contentMd: body, updatedAt: new Date() })
      .where(eq(notes.id, existing[0].id));
    return;
  }

  const baseSlug = slugify(`${folderPath}${title}`);
  await db.insert(notes).values({
    libraryId,
    userId,
    folderPath,
    title,
    slug: baseSlug,
    contentMd: body,
  });
}
