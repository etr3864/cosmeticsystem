import type { Context } from "hono";
import { PhoneInvalidError } from "@noa/shared";
import { ZodError } from "zod";

export function jsonError(c: Context, status: 400 | 401 | 404 | 422 | 429, code: string, message: string, field?: string) {
  return c.json({ error: { code, message, field } }, status);
}

export function handleError(error: unknown, c: Context) {
  if (error instanceof PhoneInvalidError) return jsonError(c, 400, "invalid_phone", error.message, "phone");
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const field = issue?.code === "unrecognized_keys" ? issue.keys[0] : issue?.path.join(".");
    return jsonError(c, 400, "invalid", "חסר או לא תקין", field || undefined);
  }
  if (error instanceof Error && error.message === "missing") return jsonError(c, 422, "missing", "חסרה סיבה");
  if (error instanceof Error && error.message === "not_found") return jsonError(c, 404, "not_found", "לא נמצא");
  if (error instanceof Error && error.message === "taken") return jsonError(c, 422, "taken", "השעה נתפסה");
  console.error(error);
  return jsonError(c, 400, "failed", "לא הצלחנו לשמור");
}
