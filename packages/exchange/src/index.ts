import { CompactEncrypt, CompactSign, compactDecrypt, compactVerify } from "jose";
import { z } from "zod";
import { invalid, isBase64url, resolveLimits, type VetpkgLimits } from "./limits.js";
import { parseBoundedJson } from "./json.js";
import {
  keyString,
  loadKey,
  publicPoint,
  signatureAlgorithm,
  wrappingAlgorithm,
  type ExchangeKeyBinding,
} from "./keys.js";
import { sameClinic, validateVetpkgManifest, type VetpkgManifest } from "./manifest.js";

export { defaultVetpkgLimits, type VetpkgLimits } from "./limits.js";
export { generateExchangeKeys, type ExchangeKeyBinding, type ExchangeKeyPair } from "./keys.js";
export {
  validateVetpkgManifest,
  type VetpkgManifest,
  type ExchangeClinic,
  type ExchangeRecord,
} from "./manifest.js";

export interface SealVetpkgOptions {
  signer: ExchangeKeyBinding;
  recipient: ExchangeKeyBinding;
  limits?: Partial<VetpkgLimits>;
}
export interface OpenVetpkgOptions {
  recipient: ExchangeKeyBinding;
  trustedSources: readonly ExchangeKeyBinding[];
  limits?: Partial<VetpkgLimits>;
}

const outerType = "application/vnd.vetx.vetpkg.v1";
const innerType = "application/vnd.vetx.manifest.v1+json";
const encryption = "A256GCM";
const contentType = "application/jose";
const signatureHeader = z.strictObject({
  alg: z.literal(signatureAlgorithm),
  typ: z.literal(innerType),
  kid: keyString,
});
const encryptedHeader = z.strictObject({
  alg: z.literal(wrappingAlgorithm),
  enc: z.literal(encryption),
  typ: z.literal(outerType),
  cty: z.literal(contentType),
  kid: keyString,
  epk: publicPoint.extend({ crv: z.literal("X25519") }),
});
const maxHeaderChars = 2048;

function parseHeader(segment: string) {
  if (segment.length > maxHeaderChars || !isBase64url(segment)) return invalid();
  return parseBoundedJson(Buffer.from(segment, "base64url"), 0);
}

function inspectCompact(compact: string, count: number) {
  const [header, ...segments] = compact.split(".", count + 1);
  if (header === undefined || segments.length !== count - 1 || !segments.every(isBase64url))
    return invalid();
  return { segments, header: parseHeader(header) };
}

/** Unauthenticated key-selection hint. Only openVetpkg authenticates the file. */
export function vetpkgRecipientKid(bytes: Uint8Array, overrides?: Partial<VetpkgLimits>): string {
  const limits = resolveLimits(overrides);
  try {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > limits.maxPackageBytes)
      return invalid();
    const prefix = bytes.subarray(0, maxHeaderChars + 1);
    const boundary = prefix.indexOf(0x2e);
    if (boundary <= 0 || boundary + 1 >= bytes.length) return invalid();
    const encoded = Buffer.from(prefix.buffer, prefix.byteOffset, boundary).toString("latin1");
    return encryptedHeader.parse(parseHeader(encoded)).kid;
  } catch {
    return invalid();
  }
}

export async function sealVetpkg(
  input: VetpkgManifest,
  options: SealVetpkgOptions,
): Promise<Uint8Array> {
  const limits = resolveLimits(options.limits);
  const manifest = validateVetpkgManifest(input, limits);
  const signer = await loadKey(options.signer, "Ed25519", "private");
  const recipient = await loadKey(options.recipient, "X25519", "public");
  if (!sameClinic(manifest.source, signer) || !sameClinic(manifest.destination, recipient))
    return invalid();
  const bytes = Buffer.from(JSON.stringify(manifest));
  const signed = await new CompactSign(bytes)
    .setProtectedHeader({ alg: signatureAlgorithm, typ: innerType, kid: signer.kid })
    .sign(signer.key);
  const sealed = await new CompactEncrypt(Buffer.from(signed))
    .setProtectedHeader({
      alg: wrappingAlgorithm,
      enc: encryption,
      typ: outerType,
      cty: contentType,
      kid: recipient.kid,
    })
    .encrypt(recipient.key);
  if (sealed.length > limits.maxPackageBytes) return invalid();
  return Buffer.from(sealed);
}

export async function openVetpkg(
  bytes: Uint8Array,
  options: OpenVetpkgOptions,
): Promise<VetpkgManifest> {
  const limits = resolveLimits(options.limits);
  try {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > limits.maxPackageBytes)
      return invalid();
    const compact = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
      "latin1",
    );
    const outer = inspectCompact(compact, 5);
    const header = encryptedHeader.parse(outer.header);
    const [wrappedKey, iv, ciphertext, tag] = outer.segments;
    const maxSignedChars = Math.ceil((limits.maxManifestBytes * 4) / 3) + maxHeaderChars + 88;
    if (
      wrappedKey?.length !== 54 ||
      iv?.length !== 16 ||
      tag?.length !== 22 ||
      !ciphertext ||
      ciphertext.length > Math.ceil((maxSignedChars * 4) / 3)
    )
      return invalid();
    const recipient = await loadKey(options.recipient, "X25519", "private");
    if (header.kid !== recipient.kid) return invalid();
    const decrypted = await compactDecrypt(compact, recipient.key, {
      keyManagementAlgorithms: [wrappingAlgorithm],
      contentEncryptionAlgorithms: [encryption],
    });
    const signed = Buffer.from(
      decrypted.plaintext.buffer,
      decrypted.plaintext.byteOffset,
      decrypted.plaintext.byteLength,
    ).toString("latin1");
    const inner = inspectCompact(signed, 3);
    const signature = signatureHeader.parse(inner.header);
    const [payload, auth] = inner.segments;
    if (
      auth?.length !== 86 ||
      !payload ||
      payload.length > Math.ceil((limits.maxManifestBytes * 4) / 3)
    )
      return invalid();
    const candidates = options.trustedSources.filter((source) => source.kid === signature.kid);
    if (candidates.length !== 1 || !candidates[0]) return invalid();
    const signer = await loadKey(candidates[0], "Ed25519", "public");
    const verified = await compactVerify(signed, signer.key, { algorithms: [signatureAlgorithm] });
    const manifest = validateVetpkgManifest(
      parseBoundedJson(verified.payload, limits.maxRecords),
      limits,
    );
    if (!sameClinic(manifest.source, signer) || !sameClinic(manifest.destination, recipient))
      return invalid();
    return manifest;
  } catch {
    // Callers can expose one rejection without leaking clinical data or decryption details.
    return invalid();
  }
}
