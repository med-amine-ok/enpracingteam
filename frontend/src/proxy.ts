import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { isPublicPage, SESSION_HINT_COOKIE } from "./lib/auth/session-hint";

const handleI18nRouting = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  const [, locale, ...rest] = request.nextUrl.pathname.split("/");
  if ((routing.locales as readonly string[]).includes(locale)) {
    const page = `/${rest.join("/")}`;
    // Shortcut only, for visitors without a session: the API checks the session on every request.
    if (!isPublicPage(page) && !request.cookies.has(SESSION_HINT_COOKIE)) {
      const login = new URL(`/${locale}/login`, request.url);
      if (page !== "/") {
        login.searchParams.set("next", `${page}${request.nextUrl.search}`);
      }
      return NextResponse.redirect(login);
    }
  }
  return handleI18nRouting(request);
}

export const config = {
  // Every page, but not Next.js internals and files (paths with a dot, such as icon.svg).
  matcher: "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
};
