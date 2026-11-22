import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { calculateJwkThumbprint } from "jose";
test("the offline operator command creates role-specific keys exclusively and protects private files", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "vetx-keygen-"));
  t.after(() => rm(parent, { force: true, recursive: true }));
  const target = join(parent, "clinic-keys");
  const org = randomUUID(),
    clinic = randomUUID();
  const args = [fileURLToPath(new URL("../dist/keygen.js", import.meta.url)), org, clinic, target];
  const output = execFileSync(process.execPath, args, { encoding: "utf8" });
  for (const role of ["signing", "encryption"]) {
    const read = async (which) =>
      JSON.parse(await readFile(join(target, role + "-" + which + ".json"), "utf8"));
    const pub = await read("public"),
      priv = await read("private");
    assert.equal(pub.organizationId, org);
    assert.equal(pub.clinicId, clinic);
    assert.equal(pub.kid, await calculateJwkThumbprint(pub.jwk));
    assert.equal(pub.jwk.d, undefined);
    assert.equal(priv.kid, pub.kid);
    assert.ok(priv.jwk.d);
    assert.ok(!output.includes(priv.jwk.d));
    assert.equal((await stat(join(target, role + "-private.json"))).mode & 0o077, 0);
  }
  assert.notEqual(spawnSync(process.execPath, args).status, 0);
  assert.equal((await stat(target)).mode & 0o077, 0);
});

test("an interrupted key write removes only the new keyset and allows a retry", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "vetx-keygen-retry-"));
  t.after(() => rm(parent, { force: true, recursive: true }));
  const target = join(parent, "new-keys");
  const args = [
    fileURLToPath(new URL("../dist/keygen.js", import.meta.url)),
    randomUUID(),
    randomUUID(),
    target,
  ];
  // Grant creation of the directory and its first file. The next file write fails.
  const failed = spawnSync(
    process.execPath,
    [
      "--permission",
      "--allow-fs-read=*",
      "--allow-fs-write=" + target,
      "--allow-fs-write=" + join(target, "signing-public.json"),
      ...args,
    ],
    { encoding: "utf8" },
  );
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /allow-fs-write/);
  await assert.rejects(stat(target), { code: "ENOENT" });
  execFileSync(process.execPath, args);
  const keys = await readFile(join(target, "signing-private.json"));
  assert.notEqual(spawnSync(process.execPath, args).status, 0);
  assert.deepEqual(await readFile(join(target, "signing-private.json")), keys);
});
