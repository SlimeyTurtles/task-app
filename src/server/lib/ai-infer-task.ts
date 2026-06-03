import Anthropic from "@anthropic-ai/sdk";

// Read at call time, not module-load time, so env edits without a hard reboot
// (Next.js does pick up .env.local on warm reload) actually take effect.
function getApiKey(): string | undefined {
  return process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
}

// Lazily construct the client so the module can be imported without the key.
let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

/**
 * One thing Claude proposes adding to or updating in the second brain.
 *  - kind "new":    create a fresh memory with `content`.
 *  - kind "update": supersede `supersedesMemoryId` with `content`. Only allowed
 *                   if the id appeared in the context Claude was shown.
 *  - kind "stale":  flag `supersedesMemoryId` as stale (no replacement yet).
 */
export type FactDelta =
  | { kind: "new"; content: string }
  | { kind: "update"; supersedesMemoryId: string; content: string }
  | { kind: "stale"; supersedesMemoryId: string };

export type InferableTaskFields = {
  estimatedMinutes: number | null;
  stress: number | null;
  exhaustion: number | null;
  importance: number | null;
  urgency: number | null;
  tagIds: string[];
  improvedTitle: string | null;
  improvedDescription: string | null;
  /** New / updated / staled memories Claude suggests writing back. */
  factDeltas: FactDelta[];
};

export type AvailableTag = { id: string; name: string; description: string | null };

/** A memory id Claude is allowed to supersede or flag stale. Passed in as
 *  part of the retrieved context so Claude can reference them by id. */
export type ContextMemory = { id: string; content: string; status: string };

export type InferTaskInput = {
  title: string;
  description: string | null;
  // Pass through any fields the user already filled — Claude won't overwrite them.
  provided: Partial<Omit<InferableTaskFields, "tagIds" | "improvedTitle" | "improvedDescription" | "factDeltas">> & {
    tagIds?: string[];
  };
  // The user's tag library. Claude picks zero or more that apply.
  availableTags?: AvailableTag[];
  // When true, Claude is told the title and description are rough notes from
  // an inbox capture — it should rewrite both into a clearer task. When
  // false (or unset), it leaves them alone (returns identical strings).
  enhanceText?: boolean;
  // The pre-rendered second-brain context block — already formatted markdown
  // ready to drop into the system prompt. Built by gatherUserContext().
  userContext?: string;
  // The memory ids that appeared in the context above. Claude is allowed to
  // reference these in "update"/"stale" deltas; any other id is rejected.
  contextMemories?: ContextMemory[];
};

const SYSTEM_PROMPT = `You estimate task metadata for a personal task planner.

Given a task title and optional description, output integer estimates for:

- estimatedMinutes (5-720): realistic focused-work time
- stress (0-10): how stressful this task feels; 0 = trivial, 10 = high-stakes/anxiety-inducing
- exhaustion (0-10): how physically/mentally draining; 0 = restorative, 10 = utterly draining
- importance (0-10): long-term significance; 0 = trivial, 10 = life-defining
- urgency (0-10): time-pressure to complete; 0 = no deadline, 10 = must do now

And select tags:

- tagIds: an array of zero or more tag IDs from the user's library that clearly apply to this task. Be precise — only tag when the task obviously fits. If no tag clearly applies, return an empty array. Never invent tag IDs that weren't given to you.

And produce text:

- improvedTitle: A clear, concrete task title in imperative form ("Draft Q3 board deck" not "Q3 board deck"). If the caller flagged the text as rough/inbox notes, rewrite freely for clarity. Otherwise return the input title verbatim — don't second-guess a deliberate title.
- improvedDescription: A 1-3 sentence description that's actionable: what to produce, key constraints. If the input description is rough notes, rewrite for clarity. If it's empty, infer something plausible from the title. If it's already clear, return it verbatim. Never invent specifics (names, deadlines, numbers) that weren't in the input.

And maintain the second brain (factDeltas, may be empty):

- If the input reveals a fact about the user, a person, a project, or a recurring thing that isn't already in the context, return one entry with kind="new" and a concise sentence stating the fact (e.g. "Avinh's PI is Dr. Chen, who works on graph neural networks.").
- If the input contradicts or refines an existing memory shown in context, return one entry with kind="update", supersedesMemoryId set to that memory's id, and content set to the corrected fact.
- If a memory appears outdated (e.g. talks about "current" something that may no longer hold), you may return one entry with kind="stale" and supersedesMemoryId set to it.
- Only reference memory ids that appeared in the context. Never invent ids. When in doubt, return an empty factDeltas array — over-recording is worse than under-recording.
- Facts should be atomic (one claim each), durable (not "Avinh is meeting Dr. Chen tomorrow" — that's a calendar event, not a fact), and useful for future context.

Guidelines:
- Be conservative on stress/exhaustion (use 3-6 for typical tasks).
- Calibrate minutes to honest focused work, not optimistic estimates.
- Reading a one-line description does not justify high stress.
- A "quick" or "small" task should rarely exceed estimatedMinutes=30.
- Errand-like tasks (call X, email Y, pick up Z): low stress, low exhaustion, ~15-30 min.
- Output ONLY the JSON, no commentary.`;

// Claude's structured output rejects min/max/format on integer types — constraints
// live in the system prompt instead, and we clamp on return.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    estimatedMinutes: { type: "integer" },
    stress: { type: "integer" },
    exhaustion: { type: "integer" },
    importance: { type: "integer" },
    urgency: { type: "integer" },
    tagIds: { type: "array", items: { type: "string" } },
    improvedTitle: { type: "string" },
    improvedDescription: { type: "string" },
    factDeltas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["new", "update", "stale"] },
          content: { type: "string" },
          supersedesMemoryId: { type: "string" },
        },
        required: ["kind", "content", "supersedesMemoryId"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "estimatedMinutes",
    "stress",
    "exhaustion",
    "importance",
    "urgency",
    "tagIds",
    "improvedTitle",
    "improvedDescription",
    "factDeltas",
  ],
  additionalProperties: false,
} as const;

function clampInt(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(min, Math.min(max, Math.round(v)));
}

type NumericFieldKey = "estimatedMinutes" | "stress" | "exhaustion" | "importance" | "urgency";
const NUMERIC_BOUNDS: Record<NumericFieldKey, [number, number]> = {
  estimatedMinutes: [5, 720],
  stress: [0, 10],
  exhaustion: [0, 10],
  importance: [0, 10],
  urgency: [0, 10],
};

/**
 * Ask Claude to fill in the task fields the user left blank, and suggest tags
 * from the user's library. Returns a partial object containing only fields the
 * user didn't already provide. If the API is unavailable or errors, returns an
 * empty object — caller decides whether to proceed with nulls.
 */
export async function inferTaskMetadata(input: InferTaskInput): Promise<Partial<InferableTaskFields>> {
  const c = getClient();
  if (!c) {
    console.warn("[ai-infer-task] no CLAUDE_API_KEY / ANTHROPIC_API_KEY set — skipping inference");
    return {};
  }

  const numericKeys = Object.keys(NUMERIC_BOUNDS) as (keyof typeof NUMERIC_BOUNDS)[];
  const missingNumeric = numericKeys.filter((k) => input.provided[k] == null);
  const wantsTags = input.provided.tagIds == null && (input.availableTags?.length ?? 0) > 0;
  const wantsText = input.enhanceText === true;
  // Always ask Claude for factDeltas when there's user context available —
  // that's the whole point of the second brain. Without context, skip (no
  // ids to reference and no profile to compare against).
  const wantsFacts = Boolean(input.userContext?.trim() || input.contextMemories?.length);

  if (missingNumeric.length === 0 && !wantsTags && !wantsText && !wantsFacts) {
    console.log("[ai-infer-task] all fields provided — skipping inference");
    return {};
  }
  console.log(
    `[ai-infer-task] inferring ${missingNumeric.join(", ")}${wantsTags ? " + tags" : ""}${wantsText ? " + text" : ""}${wantsFacts ? " + facts" : ""} for "${input.title}"`,
  );

  const providedSummary = Object.entries(input.provided)
    .filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.join(",")}]` : v}`)
    .join(", ");

  const tagCatalog = input.availableTags?.length
    ? "Available tags (pick zero or more IDs that clearly apply):\n" +
      input.availableTags
        .map((t) => `- ${t.id}: ${t.name}${t.description ? ` — ${t.description}` : ""}`)
        .join("\n")
    : "Available tags: (none — return tagIds: [])";

  const textInstruction = wantsText
    ? "TEXT IS ROUGH INBOX NOTES — rewrite improvedTitle and improvedDescription for clarity and action."
    : "TEXT IS DELIBERATE — return improvedTitle and improvedDescription identical to the input.";

  // The second-brain context block. If contextMemories are provided we include
  // their ids inline so Claude can reference them in factDeltas.
  const ctxBlock = input.userContext?.trim()
    ? `\n=== SECOND BRAIN CONTEXT ===\n${input.userContext.trim()}`
    : "";
  const ctxIdsBlock = input.contextMemories?.length
    ? `\n=== Memory ids visible to you (only these are valid in factDeltas updates/stale) ===\n${input.contextMemories
        .map((m) => `- [${m.id}] (${m.status}) ${m.content}`)
        .join("\n")}`
    : "";

  const userText = [
    `Title: ${input.title}`,
    input.description ? `Description: ${input.description}` : "Description: (none)",
    providedSummary ? `User already set: ${providedSummary}. Match these — don't contradict.` : "",
    tagCatalog,
    textInstruction,
    ctxBlock,
    ctxIdsBlock,
    `Output JSON with all 9 fields. The caller will keep only the ones the user left blank. For factDeltas, set kind="new" with content for new facts (supersedesMemoryId=""); kind="update" with supersedesMemoryId+content for refinements; kind="stale" with supersedesMemoryId (content="") for outdated facts. Empty array if nothing to add or change.`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const resp = await c.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: RESPONSE_SCHEMA,
        },
      },
      messages: [{ role: "user", content: userText }],
    });

    const textBlock = resp.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return {};
    const parsed = JSON.parse(textBlock.text) as Record<string, unknown>;

    const result: Partial<InferableTaskFields> = {};
    for (const k of missingNumeric) {
      const [lo, hi] = NUMERIC_BOUNDS[k];
      const clamped = clampInt(parsed[k], lo, hi);
      if (clamped != null) result[k] = clamped;
    }
    if (wantsTags && Array.isArray(parsed.tagIds)) {
      // Filter out any hallucinated IDs Claude returned that aren't in the user's library.
      const validIds = new Set(input.availableTags!.map((t) => t.id));
      const tagIds = (parsed.tagIds as unknown[])
        .filter((x): x is string => typeof x === "string" && validIds.has(x));
      if (tagIds.length > 0) result.tagIds = tagIds;
    }
    if (wantsText) {
      if (typeof parsed.improvedTitle === "string" && parsed.improvedTitle.trim()) {
        result.improvedTitle = parsed.improvedTitle.trim().slice(0, 300);
      }
      if (typeof parsed.improvedDescription === "string" && parsed.improvedDescription.trim()) {
        result.improvedDescription = parsed.improvedDescription.trim().slice(0, 2000);
      }
    }
    if (wantsFacts && Array.isArray(parsed.factDeltas)) {
      const validMemoryIds = new Set((input.contextMemories ?? []).map((m) => m.id));
      const deltas: FactDelta[] = [];
      for (const raw of parsed.factDeltas as unknown[]) {
        if (typeof raw !== "object" || raw == null) continue;
        const r = raw as Record<string, unknown>;
        const kind = r.kind;
        const content = typeof r.content === "string" ? r.content.trim() : "";
        const sup = typeof r.supersedesMemoryId === "string" ? r.supersedesMemoryId : "";
        if (kind === "new") {
          if (content.length > 0 && content.length <= 800) {
            deltas.push({ kind: "new", content });
          }
        } else if (kind === "update") {
          if (validMemoryIds.has(sup) && content.length > 0 && content.length <= 800) {
            deltas.push({ kind: "update", supersedesMemoryId: sup, content });
          }
        } else if (kind === "stale") {
          if (validMemoryIds.has(sup)) {
            deltas.push({ kind: "stale", supersedesMemoryId: sup });
          }
        }
      }
      if (deltas.length > 0) result.factDeltas = deltas;
    }
    console.log("[ai-infer-task] inferred:", result);
    return result;
  } catch (err) {
    console.error("[ai-infer-task] inference failed:", err);
    return {};
  }
}
