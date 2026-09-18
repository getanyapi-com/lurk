import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/** The app shell needs the query string a layout cannot otherwise see. */
export const URL_HEADER = "x-request-url";

// Attaches the Clerk session to every request. Authorization is not done here:
// each page, route and server action that reads tenant data calls
// requireLocalUser, so a route can never be protected by path matching alone.
export default clerkMiddleware((_auth, request) => {
  const headers = new Headers(request.headers);
  headers.set(URL_HEADER, request.url);
  return NextResponse.next({ request: { headers } });
});

export const config = {
  matcher: ["/((?!_next|ingest|.*\\..*).*)", "/(api|trpc)(.*)"],
};
