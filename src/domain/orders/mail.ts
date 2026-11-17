// Turns what a person uploads (.eml files, or JSON lines in the data pack's shape) into inbox rows, and gives every
// email a content fingerprint so the same email is recognised however it arrives. Pure: no database, no I/O.
import crypto from "node:crypto";
import { INGEST_TEXT as M } from "../../copy/orders.ts";

export type ParsedEmail = {
  messageId: string | null; receivedAt: string; fromName: string; fromEmail: string; to: string;
  subject: string; body: string; attachments: string[];
};
export type Parsed = { ok: true; email: ParsedEmail } | { ok: false; reason: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number | string) => String(n).padStart(2, "0");

/** The same email from any source: sender, moment, subject and text, with whitespace evened out. */
export function fingerprint(e: Pick<ParsedEmail, "fromEmail" | "receivedAt" | "subject" | "body">): string {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  return crypto.createHash("sha256").update([e.fromEmail, Date.parse(e.receivedAt), e.subject, e.body].map((x) => norm(String(x))).join("\u0000")).digest("hex");
}

/** "Mon, 02 Nov 2026 07:02:00 -0500" as "2026-11-02T07:02:00-05:00": the sender's own clock, as the pack keeps it. */
export function isoDate(header: string): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4})/.exec(header);
  const month = m ? MONTHS.indexOf(m[2][0].toUpperCase() + m[2].slice(1, 3).toLowerCase()) : -1;
  if (!m || month < 0) return null;
  return `${m[3]}-${pad(month + 1)}-${pad(m[1])}T${pad(m[4])}:${m[5]}:${m[6] ?? "00"}${m[7].slice(0, 3)}:${m[7].slice(3)}`;
}

/** RFC 2047 encoded words (=?utf-8?B?...?= or ?Q?), as mail clients write non-ASCII names and subjects. */
function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, enc: string, text: string) => {
    const bytes = enc.toUpperCase() === "B" ? Buffer.from(text, "base64") : Buffer.from(qp(text.replace(/_/g, " ")), "latin1");
    return new TextDecoder(charset.toLowerCase()).decode(bytes);
  });
}

/** Quoted-printable to the raw bytes it stands for, as a latin1 string. */
const qp = (s: string) => s.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

function splitHeaders(raw: string): { headers: Map<string, string>; body: string } {
  const text = raw.replace(/\r\n/g, "\n");
  const cut = text.indexOf("\n\n");
  const head = (cut < 0 ? text : text.slice(0, cut)).replace(/\n[ \t]+/g, " ");
  const headers = new Map<string, string>();
  for (const line of head.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0 && !headers.has(line.slice(0, i).toLowerCase())) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  return { headers, body: cut < 0 ? "" : text.slice(cut + 2) };
}

function decodeBody(body: string, headers: Map<string, string>): string {
  const enc = (headers.get("content-transfer-encoding") ?? "").toLowerCase();
  const charset = /charset="?([\w-]+)/i.exec(headers.get("content-type") ?? "")?.[1]?.toLowerCase() ?? "utf-8";
  if (enc === "base64") return new TextDecoder(charset).decode(Buffer.from(body.replace(/\s+/g, ""), "base64"));
  if (enc === "quoted-printable") return new TextDecoder(charset).decode(Buffer.from(qp(body), "latin1"));
  return body;
}

const attachmentName = (h: Map<string, string>) =>
  /filename\*?="?([^";]+)/i.exec(h.get("content-disposition") ?? "")?.[1] ?? /name="?([^";]+)/i.exec(h.get("content-type") ?? "")?.[1] ?? null;

/** A multipart message: the first plain-text part is the body, every part sent as a file is an attachment. */
function readParts(body: string, boundary: string): { text: string; attachments: string[] } {
  const parts = body.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith("--")).map((p) => splitHeaders(p.replace(/^\n/, "")));
  const plain = parts.find((p) => /text\/plain/i.test(p.headers.get("content-type") ?? "text/plain") && !/attachment/i.test(p.headers.get("content-disposition") ?? ""));
  const attachments = parts.filter((p) => /attachment/i.test(p.headers.get("content-disposition") ?? "")).map((p) => decodeWords(attachmentName(p.headers) ?? M.unnamed));
  return { text: plain ? decodeBody(plain.body, plain.headers) : "", attachments };
}

function address(header: string): { name: string; email: string } | null {
  const angle = /^(.*)<([^>]+)>\s*$/.exec(header);
  const email = (angle ? angle[2] : header).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return { name: decodeWords(angle ? angle[1].trim().replace(/^"|"$/g, "") : "") || email, email };
}

export function parseEml(raw: string): Parsed {
  const { headers, body } = splitHeaders(raw);
  const from = address(headers.get("from") ?? "");
  const receivedAt = isoDate(headers.get("date") ?? "");
  if (!from) return { ok: false, reason: M.noFrom };
  if (!receivedAt) return { ok: false, reason: M.noDate };
  const boundary = /boundary="?([^";]+)"?/i.exec(headers.get("content-type") ?? "")?.[1];
  const content = boundary ? readParts(body, boundary) : { text: decodeBody(body, headers), attachments: [] };
  return { ok: true, email: {
    messageId: headers.get("message-id")?.replace(/[<>]/g, "").trim() || null, receivedAt, fromName: from.name, fromEmail: from.email,
    to: headers.get("to") ?? "", subject: decodeWords(headers.get("subject") ?? ""), body: content.text.trim(), attachments: content.attachments,
  } };
}

/** One JSON line in the data pack's shape. Any email_id in it is ignored: the inbox gives its own. */
export function parseJsonLine(line: string): Parsed {
  let o: Record<string, unknown>;
  try { o = JSON.parse(line) as Record<string, unknown>; } catch { return { ok: false, reason: M.badJson }; }
  const from = address(`${String(o.from_name ?? "")} <${String(o.from_email ?? "")}>`);
  const receivedAt = typeof o.received_at === "string" && !Number.isNaN(Date.parse(o.received_at)) ? o.received_at : null;
  if (!from) return { ok: false, reason: M.noFrom };
  if (!receivedAt) return { ok: false, reason: M.noDate };
  return { ok: true, email: {
    messageId: typeof o.message_id === "string" ? o.message_id : null, receivedAt, fromName: from.name, fromEmail: from.email,
    to: String(o.to ?? ""), subject: String(o.subject ?? ""), body: String(o.body ?? "").trim(), attachments: Array.isArray(o.attachments) ? o.attachments.map(String) : [],
  } };
}
