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
    if (context.parentURL?.endsWith("/document-files.ts") && specifier === "./exchange-forms")
      return next("./exchange-forms.ts", context);
    return next(specifier, context);
  },
});
const { pickDocument, pickPackage, openDocument, openPrivateFile } =
  await import("../src/document-files.ts");
loader.deregister();
const bytes = Uint8Array.of(137, 80, 78, 71);
const doc = { mediaType: "image/png", byteLength: bytes.length, ready: true };

test("picker reads a private copy and removes it; source files are never deleted", async () => {
  for (const uri of ["file:///cache/DocumentPicker/pick.png", "content://provider/original"]) {
    files.set(uri, bytes);
    globalThis.documentDevice.pick = async (options) => {
      assert.equal(options.copyToCacheDirectory, true);
      assert.deepEqual(options.type, ["*/*"]);
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

test("encrypted exports reach the OS as a private .vetpkg file and are cleared afterward", async () => {
  const uri = "file:///cache/vetx-handoff/VetX-random.vetpkg";
  const mimeType = "application/vnd.vetx.vetpkg.v1";
  let opened = false;
  globalThis.documentDevice.share = async (local, options) => {
    assert.equal(local, uri);
    assert.equal(options.mimeType, mimeType);
    assert.deepEqual(files.get(local), bytes);
    opened = true;
  };
  await openPrivateFile(
    { extension: "vetpkg", mimeType },
    async () => bytes,
    () => true,
    "Share package",
  );
  assert.ok(opened);
  assert.equal(files.has(uri), false);
});

test("the exchange picker accepts generic provider data with a .vetpkg name and discards invalid private copies", async () => {
  const uri = "file:///cache/DocumentPicker/archive";
  function supply(name, data) {
    files.set(uri, data);
    globalThis.documentDevice.pick = async (options) => {
      assert.deepEqual(options.type, ["*/*"]);
      assert.equal(options.copyToCacheDirectory, true);
      return { canceled: false, assets: [{ uri, name, mimeType: "application/octet-stream" }] };
    };
  }
  supply("clinical.VETPKG", bytes);
  const selected = await pickPackage();
  assert.equal(selected.name, "clinical.VETPKG");
  assert.deepEqual(selected.bytes, bytes);
  assert.equal(files.has(uri), false);
  supply("report.pdf", bytes);
  await assert.rejects(pickPackage(), (e) => e.issue === "fileType");
  assert.equal(files.has(uri), false);
  supply("oversize.vetpkg", { length: 64 * 1024 * 1024 + 1 });
  await assert.rejects(pickPackage(), (e) => e.issue === "fileSize");
  assert.equal(files.has(uri), false);
  globalThis.documentDevice.pick = async () => ({ canceled: true });
  assert.equal(await pickPackage(), undefined);
});

test("an unavailable share target clears the private copy and reports a recoverable handoff error", async () => {
  globalThis.documentDevice.share = async () => {
    throw new Error("No target");
  };
  await assert.rejects(
    openPrivateFile(
      { extension: "vetpkg", mimeType: "application/vnd.vetx.vetpkg.v1" },
      async () => bytes,
      () => true,
      "Export",
    ),
    (e) => e.issue === "openUnavailable",
  );
  assert.equal(files.has("file:///cache/vetx-handoff/VetX-random.vetpkg"), false);
});

test("DICOM originals keep the dcm file extension even when the picker reports generic data", async () => {
  const uri = "file:///cache/DocumentPicker/source.DCM";
  files.set(uri, bytes);
  globalThis.documentDevice.pick = async (options) => {
    assert.ok(options.type.includes("*/*"));
    return {
      canceled: false,
      assets: [{ uri, name: "source.DCM", mimeType: "application/octet-stream" }],
    };
  };
  const file = await pickDocument();
  assert.equal(file.mediaType, "application/dicom");
  globalThis.documentDevice.share = async (uri, options) => {
    assert.equal(options.mimeType, "application/dicom");
    assert.match(uri, /\.dcm$/);
    assert.deepEqual(files.get(uri), bytes);
  };
  await openDocument(
    file,
    async () => bytes,
    () => true,
    "original",
  );
});
test("the first-frame cache is private, released on close, and never written after scope changes", async () => {
  const { preparePreview } = await import("../src/document-files.ts");
  let active = true;
  const dropped = await preparePreview(
    async () => {
      active = false;
      return bytes;
    },
    () => active,
  );
  assert.equal(dropped, undefined);
  const opened = await preparePreview(
    async () => bytes,
    () => true,
  );
  assert.match(opened.uri, /vetx-preview/);
  assert.deepEqual(files.get(opened.uri), bytes);
  opened.close();
  assert.equal(files.has(opened.uri), false);
});

test("retained fiscal XML downloads with a session token and reaches the device as a private temporary file", async () => {
  const { xmlFormat } = await import("../src/fiscal-forms.ts");
  const { createFiscal } = await import("../src/fiscal-client.ts"),
    { createPatientTransport } = await import("../src/patient-transport.ts");
  const scope = { subject: "staff", organizationId: "org", clinicId: "c" },
    signal = new AbortController().signal,
    opened = [];
  const api = createFiscal(
    createPatientTransport(
      {
        forOrganization: (subject, org, work) => {
          assert.equal(subject, "staff");
          assert.equal(org, "org");
          return work("private-token", signal);
        },
      },
      "https://vet.test",
      async (url, init) => {
        const req = new Request(url, init);
        assert.equal(req.headers.get("Authorization"), "Bearer private-token");
        assert.equal(req.headers.get("Cache-Control"), "no-store");
        assert.equal(init.signal, signal);
        return new Response(
          new URL(url).pathname.endsWith("receipt") ? "<receipt/>" : "<signed/>",
          { headers: { "Content-Type": "application/xml" } },
        );
      },
    ),
  );
  globalThis.documentDevice.share = async (uri, options) => {
    assert.match(uri, /^file:\/\/\/cache\/vetx-handoff\/1{50}-(?:invoice|receipt)-.+\.xml$/);
    assert.equal(options.UTI, "public.xml");
    assert.equal(options.mimeType, "application/xml");
    opened.push(new TextDecoder().decode(files.get(uri)));
    assert.ok(!uri.includes("private-token"));
  };
  for (const kind of ["invoice", "receipt"]) {
    await openPrivateFile(
      xmlFormat(kind, "1".repeat(50)),
      () => api.artifact(scope, "sale", "production", kind),
      () => true,
      "Open XML",
    );
    assert.equal(
      [...files.keys()].some((uri) => uri.endsWith(".xml")),
      false,
    );
  }
  assert.deepEqual(opened, ["<signed/>", "<receipt/>"]);
});
