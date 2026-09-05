import { NextResponse, type NextRequest } from 'next/server';

/**
 * The edge-of-application gate. (Named `proxy` because Next 16 renamed the
 * `middleware` convention; the runtime is Node.)
 *
 * It answers one question cheaply: does this request carry a session cookie at
 * all? That is enough to keep an anonymous visitor out of the dashboard without
 * a network call on every navigation, including for prefetches.
 *
 * It is explicitly NOT authorisation. The cookie's signature is not checked
 * here, nor whether the session is expired, revoked or banned — only the API
 * can answer that, and it does, on every request. Treating cookie presence as
 * proof of identity is the classic middleware mistake; this is a redirect, not
 * a permission.
 */

const SESSION_COOKIES = [
  'trendhunter.session_token',
  // Production sets the `__Secure-` prefix, which is part of the cookie's name.
  '__Secure-trendhunter.session_token',
];

const PUBLIC_PATHS = ['/sign-in'];

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const hasSessionCookie = SESSION_COOKIES.some((name) => request.cookies.get(name) !== undefined);
  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  if (!hasSessionCookie && !isPublic) {
    const signIn = new URL('/sign-in', request.url);
    // Where to return to afterwards. Only the path and query are carried, never
    // a full URL from the request: an attacker-supplied absolute URL here is
    // an open redirect.
    if (pathname !== '/') signIn.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(signIn);
  }

  if (hasSessionCookie && isPublic) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Everything except Next's own assets and the favicon.
   *
   * `_next/static` and `_next/image` are excluded because they are public by
   * construction and matching them would run this on every asset request.
   */
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
