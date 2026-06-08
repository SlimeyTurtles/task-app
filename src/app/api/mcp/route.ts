import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ChatRole, EventKind, EventSource, MemoryStatus, TaskStatus } from "@prisma/client";
import { z } from "zod";

import { db } from "@/lib/db";
import { hashApiKey, looksLikeApiKey } from "@/server/lib/api-keys";
import { applyFactDeltas } from "@/server/lib/apply-fact-deltas";
import { gatherUserContext } from "@/server/lib/context";
import { inferTaskMetadata } from "@/server/lib/ai-infer-task";
import { findFreeSlot, gatherBusy } from "@/server/trpc/routers/events";
import { getSchedulingSettings } from "@/server/trpc/routers/settings";

/**
 * MCP server endpoint for Almanac. Bearer-token authenticated, scoped to
 * a single user. Exposes a broad set of read+write tools so the Claude
 * CLI (or any MCP client) can journal conversations, manage the second
 * brain, and schedule things on the user's behalf.
 *
 * Stateless transport: each HTTP request creates a fresh server +
 * transport. Fine for personal-scale use; if multi-tenant load ever
 * matters we'd cache by sessionId.
 */

export const runtime = "nodejs";

// Helper: shape the value as the MCP tool result format.
function ok(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

function err(message: string): { content: Array<{ type: "text"; text: string }>; isError: true } {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

async function authenticate(req: Request): Promise<string | Response> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing bearer token" }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }
  const token = auth.slice(7);
  if (!looksLikeApiKey(token)) {
    return new Response(
      JSON.stringify({ error: "Invalid token format" }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }
  const apiKey = await db.apiKey.findUnique({ where: { hashedKey: hashApiKey(token) } });
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Invalid token" }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return new Response(
      JSON.stringify({ error: "Token expired" }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }
  // Best-effort touch — don't block the request on it.
  void db.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return apiKey.userId;
}

function registerTools(server: McpServer, userId: string): void {
  // ── Journal: folders, sessions, messages ────────────────────────────
  server.registerTool(
    "journal_list_folders",
    {
      description: "List the user's chat folders.",
      inputSchema: {},
    },
    async () =>
      ok(
        await db.chatFolder.findMany({
          where: { userId },
          orderBy: { name: "asc" },
          select: { id: true, name: true, createdAt: true },
        }),
      ),
  );

  server.registerTool(
    "journal_create_folder",
    {
      description: "Create a chat folder.",
      inputSchema: { name: z.string().trim().min(1).max(80) },
    },
    async ({ name }) =>
      ok(await db.chatFolder.create({ data: { userId, name } })),
  );

  server.registerTool(
    "journal_list_sessions",
    {
      description: "List chat sessions, newest first. Optionally filter by folderId.",
      inputSchema: {
        folderId: z.string().nullish(),
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    async ({ folderId, limit }) =>
      ok(
        await db.chatSession.findMany({
          where: {
            userId,
            ...(folderId !== undefined ? { folderId } : {}),
          },
          orderBy: { updatedAt: "desc" },
          take: limit,
          select: {
            id: true,
            title: true,
            model: true,
            folderId: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      ),
  );

  server.registerTool(
    "journal_get_session",
    {
      description: "Get a session with all its messages in chronological order.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const session = await db.chatSession.findFirst({
        where: { id, userId },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });
      if (!session) return err("Session not found.");
      return ok(session);
    },
  );

  server.registerTool(
    "journal_create_session",
    {
      description:
        "Create a new chat session. Use this at the start of a conversation you want to log. " +
        "Returns the session id — pass it to journal_append_message for each turn.",
      inputSchema: {
        title: z.string().trim().min(1).max(200).optional(),
        folderId: z.string().nullish(),
        model: z.string().trim().max(80).nullish(),
      },
    },
    async ({ title, folderId, model }) => {
      if (folderId) {
        const exists = await db.chatFolder.findFirst({
          where: { id: folderId, userId },
          select: { id: true },
        });
        if (!exists) return err("Folder not found.");
      }
      return ok(
        await db.chatSession.create({
          data: {
            userId,
            title: title ?? "Untitled",
            folderId: folderId ?? null,
            model: model ?? null,
          },
        }),
      );
    },
  );

  server.registerTool(
    "journal_append_message",
    {
      description: "Append a single message to a session. Role: user / assistant / system.",
      inputSchema: {
        sessionId: z.string(),
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().min(1).max(50_000),
      },
    },
    async ({ sessionId, role, content }) => {
      const exists = await db.chatSession.findFirst({
        where: { id: sessionId, userId },
        select: { id: true },
      });
      if (!exists) return err("Session not found.");
      const msg = await db.chatMessage.create({
        data: {
          sessionId,
          role: role.toUpperCase() as ChatRole,
          content,
        },
      });
      await db.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
      return ok(msg);
    },
  );

  // ── Wiki: profile + pages ───────────────────────────────────────────
  server.registerTool(
    "wiki_get_profile",
    { description: "Get the user's always-on profile doc (markdown).", inputSchema: {} },
    async () => {
      const p = await db.userProfile.findUnique({ where: { userId } });
      return ok({ content: p?.content ?? "" });
    },
  );

  server.registerTool(
    "wiki_update_profile",
    {
      description: "Replace the user's profile doc with this markdown content.",
      inputSchema: { content: z.string().max(20_000) },
    },
    async ({ content }) => {
      await db.userProfile.upsert({
        where: { userId },
        create: { userId, content },
        update: { content },
      });
      return ok({ ok: true });
    },
  );

  server.registerTool(
    "wiki_list_pages",
    { description: "List wiki pages (title, slug, aliases).", inputSchema: {} },
    async () =>
      ok(
        await db.wikiPage.findMany({
          where: { userId },
          orderBy: { updatedAt: "desc" },
          select: { id: true, slug: true, title: true, aliases: true, updatedAt: true },
        }),
      ),
  );

  server.registerTool(
    "wiki_get_page",
    {
      description: "Fetch one wiki page by slug.",
      inputSchema: { slug: z.string() },
    },
    async ({ slug }) => {
      const page = await db.wikiPage.findUnique({ where: { userId_slug: { userId, slug } } });
      if (!page) return err("Page not found.");
      return ok(page);
    },
  );

  server.registerTool(
    "wiki_upsert_page",
    {
      description:
        "Create or update a wiki page by title. Slug is derived from the title. " +
        "Use [[wikilinks]] in content to connect pages.",
      inputSchema: {
        title: z.string().trim().min(1).max(200),
        content: z.string().max(50_000).optional(),
        aliases: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
      },
    },
    async ({ title, content, aliases }) => {
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]+/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 120) || "untitled";
      const existing = await db.wikiPage.findUnique({ where: { userId_slug: { userId, slug } } });
      const page = existing
        ? await db.wikiPage.update({
            where: { id: existing.id },
            data: {
              title,
              ...(content !== undefined ? { content } : {}),
              ...(aliases !== undefined ? { aliases } : {}),
            },
          })
        : await db.wikiPage.create({
            data: { userId, slug, title, content: content ?? "", aliases: aliases ?? [] },
          });
      return ok(page);
    },
  );

  // ── Memory ──────────────────────────────────────────────────────────
  server.registerTool(
    "memory_list",
    {
      description: "List memories. Default returns CONFIRMED + STALE + PENDING.",
      inputSchema: {
        status: z
          .array(z.enum(["PENDING", "CONFIRMED", "REJECTED", "STALE", "SUPERSEDED"]))
          .optional(),
        limit: z.number().int().min(1).max(500).default(100),
      },
    },
    async ({ status, limit }) =>
      ok(
        await db.memory.findMany({
          where: {
            userId,
            ...(status?.length
              ? { status: { in: status as MemoryStatus[] } }
              : { status: { in: ["PENDING", "CONFIRMED", "STALE"] } }),
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        }),
      ),
  );

  server.registerTool(
    "memory_create",
    {
      description:
        "Add a new memory. Status defaults to PENDING — it shows up in the user's confirm queue.",
      inputSchema: {
        content: z.string().trim().min(1).max(800),
        confirmedImmediately: z.boolean().default(false),
      },
    },
    async ({ content, confirmedImmediately }) =>
      ok(
        await db.memory.create({
          data: {
            userId,
            content,
            source: "mcp",
            status: confirmedImmediately ? "CONFIRMED" : "PENDING",
            confirmedAt: confirmedImmediately ? new Date() : null,
          },
        }),
      ),
  );

  server.registerTool(
    "memory_supersede",
    {
      description:
        "Replace an existing memory with a corrected one. The old memory becomes SUPERSEDED.",
      inputSchema: {
        supersedesId: z.string(),
        content: z.string().trim().min(1).max(800),
      },
    },
    async ({ supersedesId, content }) => {
      try {
        await applyFactDeltas(
          db,
          userId,
          [{ kind: "update", supersedesMemoryId: supersedesId, content }],
          "mcp",
        );
        return ok({ ok: true });
      } catch (e) {
        return err(e instanceof Error ? e.message : "Failed to supersede.");
      }
    },
  );

  server.registerTool(
    "memory_set_status",
    {
      description: "Confirm / reject / mark-stale / re-pending a memory.",
      inputSchema: {
        id: z.string(),
        status: z.enum(["PENDING", "CONFIRMED", "REJECTED", "STALE"]),
      },
    },
    async ({ id, status }) => {
      const owned = await db.memory.findFirst({ where: { id, userId }, select: { id: true } });
      if (!owned) return err("Memory not found.");
      return ok(
        await db.memory.update({
          where: { id },
          data: {
            status: status as MemoryStatus,
            confirmedAt: status === "CONFIRMED" ? new Date() : null,
          },
        }),
      );
    },
  );

  // ── Tasks ───────────────────────────────────────────────────────────
  server.registerTool(
    "task_list",
    {
      description: "List the user's tasks. Default: INBOX + SCHEDULED. Recent first.",
      inputSchema: {
        status: z.array(z.nativeEnum(TaskStatus)).optional(),
        limit: z.number().int().min(1).max(500).default(50),
      },
    },
    async ({ status, limit }) =>
      ok(
        await db.task.findMany({
          where: {
            userId,
            status: { in: status?.length ? status : [TaskStatus.INBOX, TaskStatus.SCHEDULED] },
          },
          orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
          take: limit,
          include: {
            area: { select: { id: true, name: true, color: true } },
            project: { select: { id: true, name: true } },
            tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
          },
        }),
      ),
  );

  server.registerTool(
    "task_create",
    {
      description:
        "Create a task. status defaults to INBOX. Pass tagIds if you have specific tags in mind; " +
        "otherwise leave blank and use task_ai_schedule to have the AI fill metadata + schedule.",
      inputSchema: {
        name: z.string().trim().min(1).max(300),
        description: z.string().trim().max(10_000).nullish(),
        status: z.nativeEnum(TaskStatus).optional(),
        estimatedMinutes: z.number().int().min(0).nullish(),
        stress: z.number().int().min(0).max(10).nullish(),
        importance: z.number().int().min(0).max(10).nullish(),
        urgency: z.number().int().min(0).max(10).nullish(),
        dueDate: z.string().datetime().nullish(),
        tagIds: z.array(z.string()).optional(),
      },
    },
    async (input) =>
      ok(
        await db.task.create({
          data: {
            userId,
            name: input.name,
            description: input.description ?? null,
            status: input.status ?? TaskStatus.INBOX,
            estimatedMinutes: input.estimatedMinutes ?? null,
            stress: input.stress ?? null,
            importance: input.importance ?? null,
            urgency: input.urgency ?? null,
            dueDate: input.dueDate ? new Date(input.dueDate) : null,
            ...(input.tagIds?.length
              ? { tags: { create: input.tagIds.map((tagId: string) => ({ tagId })) } }
              : {}),
          },
        }),
      ),
  );

  server.registerTool(
    "task_ai_schedule",
    {
      description:
        "Run the AI scheduler on an existing task. Rewrites title/description, fills any blank " +
        "metadata, finds the next free slot in working hours, attaches an Event, marks SCHEDULED.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const task = await db.task.findFirst({
        where: { id, userId },
        include: { tags: { select: { tagId: true } } },
      });
      if (!task) return err("Task not found.");

      const availableTags = task.tags.length
        ? undefined
        : await db.tag.findMany({
            where: { userId },
            select: { id: true, name: true, description: true },
          });
      const context = await gatherUserContext(
        db,
        userId,
        `${task.name}\n${task.description ?? ""}`,
      );
      const inferred = await inferTaskMetadata({
        title: task.name,
        description: task.description,
        provided: {
          estimatedMinutes: task.estimatedMinutes,
          stress: task.stress,
          exhaustion: task.exhaustion,
          importance: task.importance,
          urgency: task.urgency,
          tagIds: task.tags.length ? task.tags.map((t) => t.tagId) : undefined,
        },
        availableTags,
        enhanceText: true,
        userContext: context.promptText,
        contextMemories: context.memories.map((m) => ({
          id: m.id,
          content: m.content,
          status: m.status,
        })),
      });

      const newName = inferred.improvedTitle ?? task.name;
      const newDescription = inferred.improvedDescription ?? task.description;
      const estimatedMinutes = task.estimatedMinutes ?? inferred.estimatedMinutes ?? null;
      const stress = task.stress ?? inferred.stress ?? null;
      const exhaustion = task.exhaustion ?? inferred.exhaustion ?? null;
      const importance = task.importance ?? inferred.importance ?? null;
      const urgency = task.urgency ?? inferred.urgency ?? null;
      const newTagIds = inferred.tagIds ?? [];
      const durationMin = Math.min(12 * 60, Math.max(15, estimatedMinutes ?? 60));

      const now = new Date();
      const scheduling = await getSchedulingSettings(db, userId);
      const busy = await gatherBusy(db, userId, now, scheduling.horizonDays, scheduling.respectTimeBlocks);
      const slot = findFreeSlot(now, durationMin, busy, scheduling);

      const result = await db.$transaction(async (tx) => {
        const updatedTask = await tx.task.update({
          where: { id },
          data: {
            name: newName,
            description: newDescription,
            estimatedMinutes,
            stress,
            exhaustion,
            importance,
            urgency,
            status: TaskStatus.SCHEDULED,
          },
        });
        if (newTagIds.length && task.tags.length === 0) {
          await tx.taskTag.createMany({
            data: newTagIds.map((tagId) => ({ taskId: id, tagId })),
            skipDuplicates: true,
          });
        }
        const event = await tx.event.create({
          data: {
            userId,
            title: newName,
            startsAt: slot.start,
            endsAt: slot.end,
            kind: EventKind.ACTIVE,
            source: EventSource.SUGGESTED,
            confidence: 1,
            attributions: { create: { taskId: id, weight: 1, ratioUnknown: false } },
          },
        });
        return { task: updatedTask, event };
      });

      if (inferred.factDeltas?.length) {
        try {
          await applyFactDeltas(db, userId, inferred.factDeltas, "mcp-aiSchedule");
        } catch (e) {
          console.error("[mcp aiSchedule] applyFactDeltas failed:", e);
        }
      }
      return ok({ ...result, inferred });
    },
  );

  server.registerTool(
    "task_mark_complete",
    {
      description: "Mark a task DONE. Optionally record calibration data (actuals).",
      inputSchema: {
        id: z.string(),
        actualMinutes: z.number().int().min(0).nullish(),
        actualStress: z.number().int().min(0).max(10).nullish(),
      },
    },
    async ({ id, actualMinutes, actualStress }) => {
      const owned = await db.task.findFirst({ where: { id, userId }, select: { id: true } });
      if (!owned) return err("Task not found.");
      const now = new Date();
      await db.$transaction([
        db.task.update({
          where: { id },
          data: { status: TaskStatus.DONE, completedAt: now },
        }),
        db.taskCompletion.create({
          data: {
            taskId: id,
            userId,
            completedAt: now,
            actualMinutes: actualMinutes ?? null,
            actualStress: actualStress ?? null,
          },
        }),
      ]);
      return ok({ ok: true });
    },
  );

  // ── Events ──────────────────────────────────────────────────────────
  server.registerTool(
    "event_list",
    {
      description: "List events in a date range (ISO strings).",
      inputSchema: {
        start: z.string().datetime(),
        end: z.string().datetime(),
      },
    },
    async ({ start, end }) =>
      ok(
        await db.event.findMany({
          where: {
            userId,
            AND: [{ startsAt: { lte: new Date(end) } }, { endsAt: { gte: new Date(start) } }],
          },
          orderBy: { startsAt: "asc" },
          include: {
            attributions: { include: { task: { select: { id: true, name: true } } } },
          },
        }),
      ),
  );

  server.registerTool(
    "event_create",
    {
      description: "Create an event at a specific time. Optionally attribute to one or more tasks.",
      inputSchema: {
        title: z.string().trim().max(300).nullish(),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        notes: z.string().max(5000).nullish(),
        taskIds: z.array(z.string()).optional(),
      },
    },
    async ({ title, startsAt, endsAt, notes, taskIds }) => {
      const start = new Date(startsAt);
      const end = new Date(endsAt);
      if (end <= start) return err("End must be after start.");
      const event = await db.event.create({
        data: {
          userId,
          title: title ?? null,
          startsAt: start,
          endsAt: end,
          notes: notes ?? null,
          kind: EventKind.ACTIVE,
          source: EventSource.MANUAL,
          confidence: 1,
          attributions: taskIds?.length
            ? {
                create: taskIds.map((taskId) => ({
                  taskId,
                  weight: 1,
                  ratioUnknown: taskIds.length > 1,
                })),
              }
            : undefined,
        },
      });
      return ok(event);
    },
  );
}

async function handle(req: Request): Promise<Response> {
  const userIdOrResponse = await authenticate(req);
  if (typeof userIdOrResponse !== "string") return userIdOrResponse;

  const server = new McpServer({ name: "almanac", version: "0.1.0" });
  registerTools(server, userIdOrResponse);

  // Stateless: each request gets its own transport. No session-id cache.
  const transport = new WebStandardStreamableHTTPServerTransport({});
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
