import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const backend = (process.env.BACKEND_URL ?? "http://localhost:4000").replace(/\/$/, "");
  const path = request.nextUrl.pathname.replace(/^\/backend/, "") || "/";
  const target = new URL(`${path}${request.nextUrl.search}`, `${backend}/`);
  return NextResponse.rewrite(target);
}

export const config = { matcher: ["/backend/:path*"] };
