export type ChangeKind = "added" | "improved" | "fixed";

export type ChangelogEntry = {
  version: string;
  date: string; // ISO yyyy-mm-dd
  title: string;
  changes: { kind: ChangeKind; text: string }[];
};

export const PLANNED_FEATURES: string[] = [
  "External REST API (/api/v1) with API keys, OpenAPI spec, and HMAC-signed webhooks",
  "Someday / Bucketlist page for long-horizon ideas without due dates",
  "Dependencies graph — visualize task blocking relationships",
  "Areas dashboard and richer project detail views",
];

// Newest first. Keep the top entry's version in sync with package.json.
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.10.1",
    date: "2026-08-31",
    title: "Tag menu no longer summons the wizard",
    changes: [
      { kind: "fixed", text: "Clicking inside the right-click tag menu no longer falls through to the calendar and opens the new-event wizard." },
    ],
  },
  {
    version: "0.10.0",
    date: "2026-08-31",
    title: "Tags color your calendar",
    changes: [
      { kind: "added", text: "Right-click any event to tag it — no task required. Tags now live on events themselves." },
      { kind: "added", text: "Create a tag straight from the right-click menu: type a name and pick a color swatch." },
      { kind: "added", text: "A tag's color now paints the event on the calendar, so a \"meetings\" tag makes every meeting that color." },
      { kind: "improved", text: "Tagging a recurring event tags the whole series, and new occurrences inherit the tags." },
    ],
  },
  {
    version: "0.9.1",
    date: "2026-08-26",
    title: "Fits on your screen again",
    changes: [
      { kind: "fixed", text: "The event dialogs no longer overflow short screens — they cap at the viewport and scroll internally only when truly needed." },
      { kind: "improved", text: "The Repeats control is a single compact row when editing; the plain-English summary only appears for custom patterns." },
    ],
  },
  {
    version: "0.9.0",
    date: "2026-08-26",
    title: "Recurrence, properly",
    changes: [
      { kind: "added", text: "Full recurrence rules: every N days/weeks/months/years, weekday picks, monthly by day or nth weekday, ending never / on a date / after N occurrences." },
      { kind: "added", text: "Series now live on the calendar: occurrences appear up to a year ahead the moment you save." },
      { kind: "added", text: "Editing or deleting an occurrence asks whether to change only this event, this and following events, or all events — just like you'd expect." },
      { kind: "added", text: "Calendar items now have a type: Event or Reminder. Reminders show as compact pills and ring the notification bell at their time." },
      { kind: "improved", text: "Recurring series can optionally create a to-do per occurrence (the old behavior), now a checkbox at creation." },
    ],
  },
  {
    version: "0.8.0",
    date: "2026-08-26",
    title: "Graceful when the lights go out",
    changes: [
      { kind: "added", text: "Clear in-app errors when the database is unreachable: a warning banner when saves fail, and a dedicated error screen with retry for pages that can't load." },
      { kind: "added", text: "Health endpoint (/api/health) that reports database connectivity." },
    ],
  },
  {
    version: "0.7.0",
    date: "2026-08-26",
    title: "A changelog is born",
    changes: [
      { kind: "added", text: "This changelog page, with version history and planned features." },
    ],
  },
  {
    version: "0.6.0",
    date: "2026-06-15",
    title: "Recurrence, notifications & the event wizard",
    changes: [
      { kind: "added", text: "Recurring events: a materializer worker, the /recurring page, and a Repeats section on the event dialog." },
      { kind: "added", text: "Due-soon notifications with an in-app bell and a notification settings page." },
      { kind: "added", text: "3-step event creation wizard with a streaming AI confidence panel." },
      { kind: "improved", text: "Edit dialog surfaces Repeats and syncs the recurrence rule on save." },
    ],
  },
  {
    version: "0.5.0",
    date: "2026-06-07",
    title: "MCP server, journal & API keys",
    changes: [
      { kind: "added", text: "MCP server so AI assistants can work with your tasks directly." },
      { kind: "added", text: "Journal pages and API key management." },
      { kind: "fixed", text: "Calendar drag-to-create respects the picked time; event descriptions survive re-opening the dialog." },
    ],
  },
  {
    version: "0.4.0",
    date: "2026-06-03",
    title: "AI scheduling & the second brain",
    changes: [
      { kind: "added", text: "One-button AI scheduling from the inbox, plus title/description rewriting." },
      { kind: "added", text: "Second brain: Profile, Wiki, and Memories — used and maintained by the AI." },
      { kind: "added", text: "Theme switcher (light / dark / system) in the user menu." },
      { kind: "improved", text: "Scheduler respects time blocks via the new scheduling settings page." },
      { kind: "improved", text: "Playful rotating empty states across Inbox, Wiki, Areas, Projects, Tags, and Memories." },
      { kind: "fixed", text: "Scheduler no longer proposes 1 AM slots." },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-06-02",
    title: "Going live",
    changes: [
      { kind: "added", text: "Production deploy with auto-deploy on push to main." },
      { kind: "added", text: "Invite-only signup with admin invite management and transactional email." },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-05-28",
    title: "The Almanac redesign & sharing",
    changes: [
      { kind: "added", text: "Per-task and per-tag sharing with read/write permissions and a Shared-with-me page." },
      { kind: "improved", text: "Full visual redesign: warm editorial Almanac look, unified drag-driven calendar, no-scroll layout." },
      { kind: "improved", text: "Multi-day events, recurring background blocks, inline task creation, rolling/static views, quick-add find-a-spot." },
      { kind: "fixed", text: "Calendar drag-create crash, hydration mismatch from the now-line, move-detaches-task bug." },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-05-26",
    title: "First build",
    changes: [
      { kind: "added", text: "Scaffold, schema, auth, and the app shell." },
      { kind: "added", text: "Task graph CRUD: Inbox, All Tasks, Areas, Projects, and nested Tags." },
      { kind: "added", text: "Visual day + week scheduler with events, parallel attribution, and lazy logging." },
      { kind: "added", text: "Capacity model, recommendation engine, and the plan-ahead dialog." },
      { kind: "added", text: "Completion logging, estimate calibration engine, nightly recalibration worker, and the Metrics page." },
    ],
  },
];
