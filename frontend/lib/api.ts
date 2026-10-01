export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/backend${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? "לא הצלחנו");
  }
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("text/csv")) return (await response.text()) as T;
  return response.json() as Promise<T>;
}
