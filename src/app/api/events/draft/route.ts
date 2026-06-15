/**
 * Streaming draft inference for the event-creation wizard. The client sends
 * a free-text description (plus optional time hints); we ask Claude Haiku
 * 4.5 to fill in every field of the event with a confidence score, and
 * stream the result back as Server-Sent Events — one `data:` line per
 * field, in arrival order, so the wizard's confidence panel can light up
 * dots progressively as the model commits to each value.
 *
 * Wire format: each event is `data: {"field":"<name>","value":<v>,"confidence":<0..1>}\n\n`.
 * The stream ends with `data: [DONE]\n\n` and then closes the connection.
 */

import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

import { auth } from "@/lib/auth";

const SYSTEM_PROMPT = `You estimate metadata for a single calendar event from a free-text description.

Output JSON with these fields:
- title: a clean imperative title ("Draft Q3 deck" not "Q3 deck")
- estimatedMinutes: realistic focused-work minutes, 5..720
- stress: 0..10 (0 trivial, 10 high-stakes)
- exhaustion: 0..10 (0 restorative, 10 utterly draining)
- importance: 0..10 (long-term significance)
- urgency: 0..10 (time-pressure)
- repeat: one of "none" | "daily" | "weekdays" | "weekly"
- whenHint: "asap" | "this_week" | "this_month" | "no_rush" | "specific" — whether the user implied a deadline

For every field, also produce a sibling "<field>Confidence" key with a 0..1 score:
- 0.85+ — description directly states or strongly implies the value (e.g. "30 min standup" → estimatedMinutes confidence ≥ 0.9)
- 0.5–0.84 — description gives partial signal, you're inferring with reasonable confidence
- <0.5 — you're guessing from the task type; the user should confirm

Be conservative: a one-line vague description should NOT produce 0.9 confidence across the board. If the user just wrote "do taxes", urgency/importance can be high-confidence (clear category), but estimatedMinutes/stress/exhaustion should be 0.4-0.6 (guess based on typical tax sessions).

Output ONLY the JSON. No commentary.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    titleConfidence: { type: "number" },
    estimatedMinutes: { type: "integer" },
    estimatedMinutesConfidence: { type: "number" },
    stress: { type: "integer" },
    stressConfidence: { type: "number" },
    exhaustion: { type: "integer" },
    exhaustionConfidence: { type: "number" },
    importance: { type: "integer" },
    importanceConfidence: { type: "number" },
    urgency: { type: "integer" },
    urgencyConfidence: { type: "number" },
    repeat: { type: "string", enum: ["none", "daily", "weekdays", "weekly"] },
    repeatConfidence: { type: "number" },
    whenHint: { type: "string", enum: ["asap", "this_week", "this_month", "no_rush", "specific"] },
    whenHintConfidence: { type: "number" },
  },
  required: [
    "title", "titleConfidence",
    "estimatedMinutes", "estimatedMinutesConfidence",
    "stress", "stressConfidence",
    "exhaustion", "exhaustionConfidence",
    "importance", "importanceConfidence",
    "urgency", "urgencyConfidence",
    "repeat", "repeatConfidence",
    "whenHint", "whenHintConfidence",
  ],
  additionalProperties: false,
} as const;

const FIELDS = ["title", "estimatedMinutes", "stress", "exhaustion", "importance", "urgency", "repeat", "whenHint"] as const;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response("AI not configured", { status: 503 });

  const body = (await req.json()) as { description?: string; pickedTime?: { startsAt: string; endsAt: string } | null };
  const description = (body.description ?? "").trim();
  if (!description) return new Response("Description required", { status: 400 });

  const client = new Anthropic({ apiKey });

  const userText = [
    `Description: ${description}`,
    body.pickedTime
      ? `The user has already picked a time on the calendar (${body.pickedTime.startsAt} to ${body.pickedTime.endsAt}). Set whenHint to "specific" with high confidence; the duration implied by their pick is authoritative for estimatedMinutes (high confidence).`
      : "",
  ].filter(Boolean).join("\n");

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        const resp = await client.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 1024,
          system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          output_config: { format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
          messages: [{ role: "user", content: userText }],
        });

        const block = resp.content.find((b) => b.type === "text");
        if (!block || block.type !== "text") {
          send({ error: "no_response" });
        } else {
          const parsed = JSON.parse(block.text) as Record<string, unknown>;
          for (const field of FIELDS) {
            send({
              field,
              value: parsed[field],
              confidence: typeof parsed[`${field}Confidence`] === "number" ? parsed[`${field}Confidence`] : 0.5,
            });
          }
        }
      } catch (err) {
        send({ error: err instanceof Error ? err.message : "unknown" });
      }

      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "Connection": "keep-alive",
    },
  });
}
