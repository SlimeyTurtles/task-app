import { Resend } from "resend";

// Lazily construct so the module imports cleanly without the API key
// configured (e.g. on dev machines where email isn't wired up). Calls
// to send* return a structured result instead of throwing so the caller
// can show a clear error in the UI.

let client: Resend | null = null;
function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!client) client = new Resend(key);
  return client;
}

export const EMAIL_FROM = process.env.EMAIL_FROM ?? "Almanac <almanac@avinh.net>";
export const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO ?? "avinhahuynh@gmail.com";

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendInviteEmail(args: {
  to: string;
  invitedByName: string | null;
  code: string;
  url: string;
  note: string | null;
}): Promise<SendResult> {
  const c = getClient();
  if (!c) return { ok: false, error: "Email sending isn't configured (no RESEND_API_KEY)." };

  const inviter = args.invitedByName?.trim() || "Avinh";
  const subject = `${inviter} invited you to Almanac`;

  // Minimal HTML — works in every client, no external CSS, no images.
  // Inline styles only.
  const html = `<!doctype html>
<html><body style="margin:0;background:#fafaf7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fafaf7;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#ffffff;border:1px solid #e8e4dc;border-radius:12px;padding:32px;">
        <tr><td>
          <h1 style="margin:0 0 4px;font-family:Georgia,serif;font-size:22px;font-weight:600;letter-spacing:-0.01em;">You're invited to Almanac</h1>
          <p style="margin:0 0 24px;color:#666;font-size:14px;">${escapeHtml(inviter)} set up a personal planning app and added you.</p>
          ${args.note ? `<p style="margin:0 0 24px;padding:12px 14px;background:#f5f2eb;border-radius:8px;font-size:13px;color:#5a5346;">${escapeHtml(args.note)}</p>` : ""}
          <table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="background:#a8552f;border-radius:8px;">
            <a href="${args.url}" style="display:inline-block;padding:11px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;">Create your account</a>
          </td></tr></table>
          <p style="margin:24px 0 0;color:#888;font-size:12px;">Or paste this code on the signup page: <code style="font-family:ui-monospace,monospace;background:#f5f2eb;padding:2px 6px;border-radius:4px;">${escapeHtml(args.code)}</code></p>
          <p style="margin:8px 0 0;color:#888;font-size:12px;word-break:break-all;">Link: <a href="${args.url}" style="color:#a8552f;">${escapeHtml(args.url)}</a></p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;color:#aaa;font-size:11px;">If you weren't expecting this, you can ignore the email.</p>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `${inviter} invited you to Almanac.`,
    args.note ? `Note: ${args.note}` : "",
    "",
    `Create your account: ${args.url}`,
    `Or paste this code on the signup page: ${args.code}`,
    "",
    "If you weren't expecting this, ignore the email.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await c.emails.send({
      from: EMAIL_FROM,
      to: args.to,
      replyTo: EMAIL_REPLY_TO,
      subject,
      html,
      text,
    });
    if (res.error) return { ok: false, error: res.error.message };
    return { ok: true, id: res.data?.id ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
