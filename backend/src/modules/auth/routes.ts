import { Hono } from "hono";
import { z } from "zod";
import argon2 from "argon2";
import { prisma } from "@noa/db";
import { canSeeTechnical } from "@noa/shared";
import { clearSession, currentUser, requireUser, startSession } from "../../http/session.js";
import { jsonError } from "../../http/errors.js";

const attempts = new Map<string, { count: number; reset: number }>();

export const authRoutes = new Hono();

authRoutes.post("/login", async (c) => {
  const body = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(await c.req.json());
  const key = `${c.req.header("x-forwarded-for") ?? "local"}:${body.username}`;
  const current = attempts.get(key);
  if (current && current.reset > Date.now() && current.count >= 5) return jsonError(c, 429, "rate", "יותר מדי ניסיונות. נסי שוב בעוד רבע שעה");
  const user = await prisma.user.findUnique({ where: { username: body.username } });
  const ok = user?.active && (await argon2.verify(user.passwordHash, body.password).catch(() => false));
  if (!ok || !user) {
    const prev = attempts.get(key);
    attempts.set(key, { count: (prev && prev.reset > Date.now() ? prev.count : 0) + 1, reset: Date.now() + 15 * 60 * 1000 });
    return jsonError(c, 401, "unauthorized", "שם המשתמש או הסיסמה לא נכונים");
  }
  attempts.delete(key);
  await startSession(c, user.id);
  return c.json({ id: user.id, username: user.username, role: user.role, technical: canSeeTechnical(user.role as "owner") });
});

authRoutes.post("/logout", requireUser, async (c) => {
  await clearSession(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", requireUser, (c) => {
  const user = currentUser(c);
  return c.json({ ...user, technical: canSeeTechnical(user.role) });
});
