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

export type InferableTaskFields = {
  estimatedMinutes: number | null;
  stress: number | null;
  exhaustion: number | null;
  importance: number | null;
  urgency: number | null;
  tagIds: string[];
};

export type AvailableTag = { id: string; name: string; description: string | null };

export type InferTaskInput = {
  title: string;
  description: string | null;
  // Pass through any fields the user already filled — Claude won't overwrite them.
  provided: Partial<Omit<InferableTaskFields, "tagIds">> & { tagIds?: string[] };
  // The user's tag library. Claude picks zero or more that apply.
  availableTags?: AvailableTag[];
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
  },
  required: ["estimatedMinutes", "stress", "exhaustion", "importance", "urgency", "tagIds"],
  additionalProperties: false,
} as const;

function clampInt(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(min, Math.min(max, Math.round(v)));
}

const NUMERIC_BOUNDS: Record<keyof Omit<InferableTaskFields, "tagIds">, [number, number]> = {
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

  if (missingNumeric.length === 0 && !wantsTags) {
    console.log("[ai-infer-task] all fields provided — skipping inference");
    return {};
  }
  console.log(
    `[ai-infer-task] inferring ${missingNumeric.join(", ")}${wantsTags ? " + tags" : ""} for "${input.title}"`,
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

  const userText = [
    `Title: ${input.title}`,
    input.description ? `Description: ${input.description}` : "Description: (none)",
    providedSummary ? `User already set: ${providedSummary}. Match these — don't contradict.` : "",
    tagCatalog,
    `Output JSON with all 6 fields. The caller will keep only the ones the user left blank.`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const resp = await c.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
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
    console.log("[ai-infer-task] inferred:", result);
    return result;
  } catch (err) {
    console.error("[ai-infer-task] inference failed:", err);
    return {};
  }
}
