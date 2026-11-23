import { mkdir, open, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { generateExchangeKeys } from "./keys.js";

async function main() {
  const [organizationId, clinicId, directory, ...extra] = process.argv.slice(2);
  if (!organizationId || !clinicId || !directory || extra.length) {
    throw new Error("Usage: keygen <organization-uuid> <clinic-uuid> <new-directory>");
  }
  const keys = await generateExchangeKeys({ organizationId, clinicId });
  await mkdir(directory, { mode: 0o700 });
  const created: string[] = [];
  try {
    for (const [role, pair] of Object.entries(keys)) {
      for (const [visibility, binding] of [
        ["public", pair.publicKey],
        ["private", pair.privateKey],
      ] as const) {
        const path = join(directory, role + "-" + visibility + ".json");
        const file = await open(path, "wx", 0o600);
        created.push(path);
        try {
          await file.writeFile(JSON.stringify(binding, null, 2) + "\n");
        } finally {
          await file.close();
        }
      }
    }
  } catch (error) {
    for (const path of created) await unlink(path);
    await rmdir(directory);
    throw error;
  }
  console.log("Created clinic exchange keys in the requested directory.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Key generation failed");
  process.exitCode = 1;
});
