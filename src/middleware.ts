import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Security headers are applied globally by next.config.ts (source: "/(.*)")
// with the correct strict values (X-Frame-Options: DENY, frame-ancestors 'none',
// HSTS max-age=63072000 with preload). Do NOT add headers here — middleware
// responses run after next.config headers and would silently override them with
// weaker values, defeating the hardened configuration.

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session — network errors are non-fatal and treated as unauthenticated.
  // Do not remove this call; it is what triggers the token refresh side-effect.
  const { data: { user } } = await supabase.auth.getUser().catch((err: unknown) => {
    console.error('[middleware] getUser failed:', err instanceof Error ? err.message : String(err))
    return { data: { user: null } }
  });

  // Gate /account/** — redirect unauthenticated visitors to /login
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/account") && !user) {
    const loginUrl = new URL("/login", request.url);
    // Preserve query string so ?tab=... and similar params survive the round-trip through login
    const dest = pathname + request.nextUrl.search
    loginUrl.searchParams.set("next", dest);
    return NextResponse.redirect(loginUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
