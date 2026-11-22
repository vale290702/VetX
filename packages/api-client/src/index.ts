import createClient from "openapi-fetch";
import type { paths } from "./schema";

export function createVetxClient(baseUrl: string) {
  return createClient<paths>({ baseUrl });
}

export async function checkVetxReadiness(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<"available" | "unavailable"> {
  try {
    const { data } = await createVetxClient(baseUrl).GET("/health/ready", { signal });
    return data?.status === "ok" ? "available" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export type { components, paths } from "./schema";
