import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { prisma } from "@noa/db";
import { sha256, randomToken } from "../lib/crypto.js";

declare module "hono" {
  interface ContextVariableMap {
    user: SessionUser;
  }
}

const COOKIE = "noa_session";
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

export type SessionUser = { id: string; username: string; role: "super_admin" | "owner"; phone: string | null };

export async function startSession(c: Context, userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + THIRTY_DAYS);
  await prisma.session.create({ data: { userId, tokenHash: sha256(token), expiresAt } });
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Lax", path: "/", secure: process.env.NODE_ENV === "production", expires: expiresAt });
}

export async function clearSession(c: Context) {
  const token = getCookie(c, COOKIE);
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  deleteCookie(c, COOKIE, { path: "/" });
}

export async function requireUser(c: Context, next: Next) {
  const token = getCookie(c, COOKIE);
  if (!token) return c.json({ error: { code: "unauthorized", message: "צריך להתחבר" } }, 401);
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.expiresAt.getTime() < Date.now() || !session.user.active) {
    return c.json({ error: { code: "unauthorized", message: "צריך להתחבר" } }, 401);
  }
  const expiresAt = new Date(Date.now() + THIRTY_DAYS);
  await prisma.session.update({ where: { id: session.id }, data: { expiresAt } });
  c.set("user", { id: session.user.id, username: session.user.username, role: session.user.role as SessionUser["role"], phone: session.user.phone });
  await next();
}

export function currentUser(c: Context): SessionUser {
  return c.get("user");
}
