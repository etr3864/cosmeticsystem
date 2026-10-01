import { createSign } from "node:crypto";
import { prisma } from "@noa/db";
import { buildNtDescription, parseNtTag } from "@noa/shared";
import { decrypt } from "../../lib/crypto.js";
import { logEvent } from "../../lib/log.js";
import { cancelAppointment, createAppointment, placeAppointment } from "../appointments/service.js";

type Account = { client_email: string; private_key: string };
type GEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  extendedProperties?: { private?: { appointmentId?: string } };
};

const SCOPE = "https://www.googleapis.com/auth/calendar";
let cached: { value: string; exp: number } | null = null;
let pulling = false;

function signJwt(account: Account) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: account.client_email,
    scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(account.private_key).toString("base64url")}`;
}

async function account(): Promise<Account | null> {
  const secret = await prisma.secret.findUnique({ where: { key: "google_service_account" } });
  if (!secret) return null;
  try {
    const parsed = JSON.parse(decrypt(secret.ciphertext)) as Partial<Account>;
    if (!parsed.client_email || !parsed.private_key) return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return null;
  }
}

export async function googleAccountEmail() {
  return (await account())?.client_email ?? null;
}

export async function resetGoogleSync() {
  cached = null;
  await prisma.setting.deleteMany({ where: { key: "googleSyncToken" } });
}

async function calendarId() {
  const row = await prisma.setting.findUnique({ where: { key: "googleCalendarId" } });
  return typeof row?.value === "string" && row.value.trim() ? row.value.trim() : "";
}

async function token(creds: Account) {
  if (cached && cached.exp > Date.now() + 60_000) return cached.value;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signJwt(creds) }),
  });
  if (!response.ok) throw new Error("google token");
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("google token");
  cached = { value: body.access_token, exp: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}

async function google(path: string, init?: RequestInit) {
  const creds = await account();
  const id = await calendarId();
  if (!creds || !id) return null;
  const access = await token(creds);
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}${path}`, {
    ...init,
    signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  return response;
}

function eventBody(row: { id: string; startsAt: Date; endsAt: Date; contact: { name: string; phone: string }; service: { name: string; code: string } }) {
  return {
    summary: `${row.contact.name} · ${row.service.name}`,
    description: buildNtDescription(row.contact.phone, row.service.code, false),
    start: { dateTime: row.startsAt.toISOString(), timeZone: "Asia/Jerusalem" },
    end: { dateTime: row.endsAt.toISOString(), timeZone: "Asia/Jerusalem" },
    extendedProperties: { private: { appointmentId: row.id } },
  };
}

export async function mirrorAppointment(id: string) {
  try {
    const row = await prisma.appointment.findUnique({ where: { id }, include: { contact: true, service: true } });
    if (!row) return;
    if (row.status === "בוטל") {
      if (!row.googleEventId) return;
      const response = await google(`/events/${encodeURIComponent(row.googleEventId)}`, { method: "DELETE" });
      if (response && response.status !== 204 && response.status !== 404 && response.status !== 410) {
        await logEvent("google", "error", "מחיקת אירוע נכשלה", { status: response.status });
      }
      return;
    }
    const body = JSON.stringify(eventBody(row));
    if (row.googleEventId) {
      const patched = await google(`/events/${encodeURIComponent(row.googleEventId)}`, { method: "PATCH", body });
      if (patched?.ok) return;
      if (patched && patched.status !== 404 && patched.status !== 410) {
        await logEvent("google", "error", "עדכון אירוע נכשל", { status: patched.status });
        return;
      }
    }
    const created = await google("/events", { method: "POST", body });
    if (!created?.ok) {
      if (created) await logEvent("google", "error", "יצירת אירוע נכשלה", { status: created.status });
      return;
    }
    const event = await created.json() as GEvent;
    if (event.id) await prisma.appointment.update({ where: { id }, data: { googleEventId: event.id } });
  } catch (error) {
    await logEvent("google", "error", "סנכרון תור ליומן נכשל", { error: error instanceof Error ? error.message : "failed" });
  }
}

export async function testGoogle() {
  const response = await google("");
  if (!response) throw new Error("missing");
  if (response.status === 404 || response.status === 403) throw new Error("shared");
  if (!response.ok) throw new Error("google");
}

async function adopt(event: GEvent) {
  if (!event.id || event.status === "cancelled" || !event.start?.dateTime) return;
  const text = `${event.summary ?? ""}\n${event.description ?? ""}`;
  const parsed = parseNtTag(text);
  if (!parsed) return;
  const known = await prisma.appointment.findFirst({ where: { googleEventId: event.id } });
  if (known) return;
  const service = await prisma.service.findFirst({ where: { code: parsed.serviceCode ?? "NAILS" } })
    ?? await prisma.service.findFirst({ where: { code: "NAILS" } });
  if (!service) return;
  const startsAt = new Date(event.start.dateTime);
  const endsAt = event.end?.dateTime ? new Date(event.end.dateTime) : new Date(startsAt.getTime() + service.durationMin * 60000);
  if (Number.isNaN(startsAt.getTime()) || endsAt.getTime() < Date.now() || endsAt.getTime() - startsAt.getTime() < 30 * 60000) return;
  const name = (event.summary ?? "").split("[NT")[0]?.trim() || "בלי שם";
  const contact = await prisma.contact.findUnique({ where: { phone: parsed.phone } })
    ?? await prisma.contact.create({ data: { phone: parsed.phone, name, source: "יומן גוגל" } });
  const same = await prisma.appointment.findFirst({
    where: { contactId: contact.id, startsAt, status: { not: "בוטל" } },
  });
  if (same) {
    await prisma.appointment.update({ where: { id: same.id }, data: { googleEventId: event.id } });
    return;
  }
  try {
    const appointment = await createAppointment({
      contactId: contact.id,
      serviceId: service.id,
      startsAt,
      endsAt,
      bookedBy: "יומן גוגל",
      actor: "google",
    });
    await prisma.appointment.update({ where: { id: appointment.id }, data: { googleEventId: event.id } });
    await google(`/events/${encodeURIComponent(event.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        description: buildNtDescription(parsed.phone, service.code, false),
        extendedProperties: { private: { appointmentId: appointment.id } },
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "taken") return;
    throw error;
  }
}

async function apply(event: GEvent) {
  const linked = event.extendedProperties?.private?.appointmentId;
  const row = linked
    ? await prisma.appointment.findUnique({ where: { id: linked } })
    : event.id
      ? await prisma.appointment.findFirst({ where: { googleEventId: event.id } })
      : null;
  if (!row) {
    await adopt(event);
    return;
  }
  if (event.status === "cancelled") {
    if (row.status !== "בוטל") await cancelAppointment(row.id, "google");
    return;
  }
  if (!event.start?.dateTime || !event.end?.dateTime) return;
  const startsAt = new Date(event.start.dateTime);
  const endsAt = new Date(event.end.dateTime);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return;
  if (startsAt.getTime() === row.startsAt.getTime() && endsAt.getTime() === row.endsAt.getTime()) return;
  if (row.status === "בוטל" || endsAt.getTime() - startsAt.getTime() < 30 * 60000) return;
  try {
    await placeAppointment(row.id, startsAt, endsAt, { wasRescheduled: true });
    await prisma.scheduledJob.updateMany({
      where: { idempotencyKey: `noshow:${row.id}`, status: "pending" },
      data: { runAt: new Date(endsAt.getTime() + 2 * 60 * 60 * 1000) },
    });
  } catch (error) {
    if (!(error instanceof Error && error.message === "taken")) throw error;
  }
}

export async function pullGoogle() {
  if (pulling) return;
  pulling = true;
  try {
    if (!(await account()) || !(await calendarId())) return;
    const saved = await prisma.setting.findUnique({ where: { key: "googleSyncToken" } });
    const syncToken = typeof saved?.value === "string" ? saved.value : "";
    const query = new URLSearchParams({ singleEvents: "true", showDeleted: "true", maxResults: "100" });
    if (syncToken) query.set("syncToken", syncToken);
    else query.set("timeMin", new Date().toISOString());
    let page = "";
    let nextSync = "";
    do {
      if (page) query.set("pageToken", page);
      const response = await google(`/events?${query.toString()}`);
      if (!response) return;
      if (response.status === 410) {
        await prisma.setting.deleteMany({ where: { key: "googleSyncToken" } });
        return;
      }
      if (!response.ok) {
        await logEvent("google", "error", "קריאת היומן נכשלה", { status: response.status });
        return;
      }
      const body = await response.json() as { items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string };
      for (const event of body.items ?? []) await apply(event);
      page = body.nextPageToken ?? "";
      nextSync = body.nextSyncToken ?? nextSync;
    } while (page);
    if (nextSync) {
      await prisma.setting.upsert({
        where: { key: "googleSyncToken" },
        update: { value: nextSync },
        create: { key: "googleSyncToken", value: nextSync },
      });
    }
    const waiting = await prisma.appointment.findMany({
      where: { googleEventId: null, status: { not: "בוטל" }, endsAt: { gte: new Date() } },
      select: { id: true },
      take: 20,
    });
    for (const row of waiting) await mirrorAppointment(row.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    console.error("google skipped", message);
    await logEvent("google", "error", "סנכרון היומן נכשל", { error: message }).catch(() => undefined);
  } finally {
    pulling = false;
  }
}

