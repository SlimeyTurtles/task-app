import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PATHS = ["/login", "/register"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow NextAuth, static assets, and public marketing pages to pass through.
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    PUBLIC_PATHS.includes(pathname)
  ) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  // Authenticated users hitting `/` go to the calendar (week view).
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/calendar", req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Run on every request except internal Next.js assets and image optimization.
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)"],
};
