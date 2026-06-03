import type { PrismaClient, WikiPage, Memory, UserProfile } from "@prisma/client";

/**
 * Second-brain retrieval. Given the user and a free-text query (a task
 * title, a description, both concatenated, etc.), return the slice of
 * their wiki + memory + profile that's worth showing the LLM.
 *
 * Strategy:
 *  1) UserProfile — always included (the stable "who am I" doc).
 *  2) WikiPages   — title + alias match against the query, plus the
 *     pages explicitly referenced via [[wikilinks]] in the query.
 *     Then one level of [[wikilink]] expansion from those matched pages
 *     so closely-linked context comes along.
 *  3) Memories    — keyword overlap on confirmed memories + the N most
 *     recent confirmed memories (recency bias). Stale memories included
 *     but flagged so the model knows to verify.
 *
 * Returns a render-ready string for the system prompt plus the raw
 * matched objects so the caller can show citations in the UI.
 */

export type RetrievedContext = {
  profile: string | null;
  pages: WikiPage[];
  memories: Memory[];
  /** A pre-formatted string ready to drop into a system prompt. */
  promptText: string;
};

// Tunables.
const MAX_WIKI_PAGES = 4;
const MAX_MEMORIES_KEYWORD = 5;
const MAX_MEMORIES_RECENT = 3;
const MAX_PAGE_CHARS = 800;
const MAX_MEMORY_CHARS = 280;

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/** Lowercase non-stopword tokens, length ≥ 3. Tight on purpose — we want
 *  high-signal hits, not vibes-based recall. */
function tokenize(input: string): string[] {
  const STOP = new Set([
    "the","a","an","and","or","but","of","to","in","on","at","for","with","from",
    "is","are","was","were","be","being","been","this","that","these","those",
    "i","me","my","you","your","we","our","they","their","it","its","as","if","so",
    "do","does","did","will","just","about","into","over","than","then","more","also",
  ]);
  return Array.from(
    new Set(
      input
        .toLowerCase()
        .replace(/[^a-z0-9\s'-]+/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOP.has(w)),
    ),
  );
}

/** Pull [[Wikilinks]] out of a string. Returns the page titles. */
function extractWikilinks(input: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(input)) != null) {
    out.push(m[1].trim());
  }
  return out;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function dedupePagesById(pages: WikiPage[]): WikiPage[] {
  const seen = new Set<string>();
  const out: WikiPage[] = [];
  for (const p of pages) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

export async function gatherUserContext(
  db: PrismaClient,
  userId: string,
  query: string,
): Promise<RetrievedContext> {
  const tokens = tokenize(query);
  const explicitLinks = extractWikilinks(query).map((t) => t.toLowerCase());

  const [profile, allPages, recentMemories]: [
    UserProfile | null,
    WikiPage[],
    Memory[],
  ] = await Promise.all([
    db.userProfile.findUnique({ where: { userId } }),
    // Pages list isn't huge for a single user; just pull them all and
    // score in-memory. If it ever grows large, switch to FTS.
    db.wikiPage.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    }),
    db.memory.findMany({
      where: {
        userId,
        status: { in: ["CONFIRMED", "STALE", "PENDING"] },
      },
      orderBy: { createdAt: "desc" },
      take: 200, // cap on what we score in-memory
    }),
  ]);

  // ── Wiki page matching ──────────────────────────────────────────────
  function scorePage(p: WikiPage): number {
    let score = 0;
    const titleLower = p.title.toLowerCase();
    const aliasesLower = p.aliases.map((a) => a.toLowerCase());

    if (explicitLinks.includes(titleLower)) score += 100;
    for (const a of aliasesLower) {
      if (explicitLinks.includes(a)) score += 80;
    }
    // Title or alias appears whole in the query (case-insensitive).
    const queryLower = query.toLowerCase();
    if (queryLower.includes(titleLower)) score += 40;
    for (const a of aliasesLower) {
      if (queryLower.includes(a)) score += 30;
    }
    // Token overlap (weak signal).
    for (const t of tokens) {
      if (titleLower === t) score += 5;
      else if (titleLower.includes(t)) score += 1;
      if (aliasesLower.includes(t)) score += 3;
    }
    return score;
  }

  const scoredPages = allPages
    .map((p) => ({ p, s: scorePage(p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_WIKI_PAGES)
    .map((x) => x.p);

  // One level of [[wikilink]] expansion from matched pages.
  const pagesByTitle = new Map(allPages.map((p) => [p.title.toLowerCase(), p]));
  const linkedFromMatched: WikiPage[] = [];
  for (const p of scoredPages) {
    for (const link of extractWikilinks(p.content)) {
      const target = pagesByTitle.get(link.toLowerCase());
      if (target && !scoredPages.some((s) => s.id === target.id)) {
        linkedFromMatched.push(target);
      }
    }
  }
  const matchedPages = dedupePagesById([...scoredPages, ...linkedFromMatched.slice(0, 2)]);

  // ── Memory matching ─────────────────────────────────────────────────
  const matchedTokens = new Set(tokens);
  function scoreMemory(m: Memory): number {
    if (matchedTokens.size === 0) return 0;
    const lower = m.content.toLowerCase();
    let score = 0;
    for (const t of matchedTokens) {
      if (lower.includes(t)) score += 1;
    }
    if (m.status === "STALE") score *= 0.5; // de-prioritise possibly-stale
    return score;
  }

  const keywordMemories = recentMemories
    .map((m) => ({ m, s: scoreMemory(m) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_MEMORIES_KEYWORD)
    .map((x) => x.m);

  const confirmedRecent = recentMemories
    .filter((m) => m.status === "CONFIRMED")
    .slice(0, MAX_MEMORIES_RECENT);

  const memorySeen = new Set<string>();
  const memories: Memory[] = [];
  for (const m of [...keywordMemories, ...confirmedRecent]) {
    if (!memorySeen.has(m.id)) {
      memorySeen.add(m.id);
      memories.push(m);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────
  const parts: string[] = [];
  if (profile?.content?.trim()) {
    parts.push(`## About the user (from their profile)\n${truncate(profile.content.trim(), 1500)}`);
  }
  if (matchedPages.length > 0) {
    parts.push(
      `## Relevant wiki pages\n` +
        matchedPages
          .map((p) => {
            const aliasNote = p.aliases.length ? ` (also: ${p.aliases.join(", ")})` : "";
            return `### ${p.title}${aliasNote}\n${truncate(p.content.trim() || "(empty)", MAX_PAGE_CHARS)}`;
          })
          .join("\n\n"),
    );
  }
  if (memories.length > 0) {
    parts.push(
      `## Recent memories (some may be stale — verify before relying on them)\n` +
        memories
          .map((m) => {
            const tag = m.status === "STALE" ? " [stale]" : m.status === "PENDING" ? " [unverified]" : "";
            return `- ${truncate(m.content.trim(), MAX_MEMORY_CHARS)}${tag}`;
          })
          .join("\n"),
    );
  }

  const promptText = parts.join("\n\n");

  return { profile: profile?.content ?? null, pages: matchedPages, memories, promptText };
}
