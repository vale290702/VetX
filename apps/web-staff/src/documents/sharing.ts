import "server-only";
import type { components } from "@vetx/api-client";
import { isDirectoryId } from "../directory/forms.ts";

export async function readSharingBody(
  request: Request,
): Promise<components["schemas"]["DocumentSharingDto"] | null> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json" || !request.body)
    return null;
  let size = 0;
  const limited = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > 100 * 1024) throw new RangeError("Sharing request size exceeded");
        controller.enqueue(chunk);
      },
    }),
  );
  try {
    const body = await new Response(limited).json();
    if (
      !body ||
      !Number.isInteger(body.revision) ||
      body.revision < 0 ||
      body.revision > 2_147_483_647 ||
      !Array.isArray(body.guardianIds) ||
      !body.guardianIds.every(isDirectoryId)
    )
      return null;
    return { revision: body.revision, guardianIds: body.guardianIds };
  } catch {
    return null;
  }
}
