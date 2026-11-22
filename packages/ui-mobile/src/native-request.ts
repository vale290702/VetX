import type { fetch as expoFetch } from "expo/fetch";

export function nativeRequest(token: string, signal: AbortSignal, fetch: typeof expoFetch) {
  return {
    headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-store" },
    async fetch(request: Request) {
      return fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body:
          request.method === "GET" || request.method === "DELETE"
            ? undefined
            : await request.text(),
        credentials: "omit",
        redirect: "error",
        signal,
      });
    },
  };
}
