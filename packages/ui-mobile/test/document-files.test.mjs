import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// Exercise the production picker and OS handoff against native-module adapters in Node.
const sources = {
  "expo-document-picker":
    "export const getDocumentAsync=(options)=>globalThis.documentDevice.pick(options);",
  "expo-file-system": "export const {File, Directory, Paths}=globalThis.documentDevice;",
  "expo-sharing":
    "export const isAvailableAsync=async()=>true; export const shareAsync=(uri,options)=>globalThis.documentDevice.share(uri,options);",
  "react-native": "export const Platform=globalThis.documentDevice.platform;",
};
const files = new Map();
class File {
  constructor(dir, name) {
    this.uri = name ? dir.uri + "/" + name : dir;
  }
  get exists() {
    return files.has(this.uri);
  }
  get size() {
    return files.get(this.uri)?.length ?? 0;
  }
  bytes() {
    return Promise.resolve(files.get(this.uri));
  }
  create() {
    files.set(this.uri, new Uint8Array());
  }
  write(data) {
    files.set(this.uri, data);
  }
  delete() {
    files.delete(this.uri);
  }
}
class Directory {
  constructor(dir, name) {
    this.uri = dir.uri + "/" + name;
  }
  create() {}
}
globalThis.documentDevice = {
  File,
  Directory,
  Paths: { cache: { uri: "file:///cache" } },
  platform: { OS: "ios" },
};
globalThis.expo = { uuidv4: () => "random" };
const loader = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith("/document-files.ts") && Object.hasOwn(sources, specifier)) {
      return {
        shortCircuit: true,
        url: "data:text/javascript," + encodeURIComponent(sources[specifier]),
      };
    }
    if (context.parentURL?.endsWith("/document-files.ts") && specifier === "./documents")
      return next("./documents.ts", context);
    return next(specifier, context);
  },
});
const { pickDocument, openDocument } = await import("../src/document-files.ts");
loader.deregister();
const bytes = Uint8Array.of(137, 80, 78, 71);
const doc = { mediaType: "image/png", byteLength: bytes.length, ready: true };

test("picker reads a private copy and removes it; source files are never deleted", async () => {
  for (const uri of ["file:///cache/DocumentPicker/pick.png", "content://provider/original"]) {
    files.set(uri, bytes);
    globalThis.documentDevice.pick = async (options) => {
      assert.equal(options.copyToCacheDirectory, true);
      assert.ok(options.type.includes("application/pdf"));
      return { canceled: false, assets: [{ uri, name: "scan.png", mimeType: "image/png" }] };
    };
    assert.deepEqual(await pickDocument(), { name: "scan.png", mediaType: "image/png", bytes });
    assert.equal(files.has(uri), uri.startsWith("content:"));
  }
});
test("a stale scope drops a completed download before writing or opening a file", async () => {
  let active = true;
  globalThis.documentDevice.share = () => assert.fail("stale document handed to OS");
  await openDocument(
    doc,
    async () => {
      active = false;
      return bytes;
    },
    () => active,
    "scan",
  );
  assert.equal(files.has("file:///cache/vetx-handoff/VetX-random.png"), false);
});
test("OS handoff receives a local file with exact downloaded bytes and removes the iOS copy on return", async () => {
  let handedOff;
  globalThis.documentDevice.share = async (uri, options) => {
    assert.equal(options.mimeType, doc.mediaType);
    assert.equal(options.UTI, "public.png");
    assert.deepEqual(files.get(uri), bytes);
    handedOff = uri;
  };
  await openDocument(
    doc,
    async () => bytes,
    () => true,
    "Scan",
  );
  assert.equal(handedOff, "file:///cache/vetx-handoff/VetX-random.png");
  assert.equal(files.has(handedOff), false);
});
