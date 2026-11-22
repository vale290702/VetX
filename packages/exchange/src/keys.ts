import { calculateJwkThumbprint, exportJWK, generateKeyPair, importJWK, type JWK } from "jose";
import { z } from "zod";
import { invalid, isBase64url } from "./limits.js";
import { clinicSchema, type ExchangeClinic } from "./manifest.js";

export const signatureAlgorithm = "Ed25519";
export const wrappingAlgorithm = "ECDH-ES+A256KW";
export const keyString = z.string().length(43).refine(isBase64url);
export const publicPoint = z.strictObject({
  kty: z.literal("OKP"),
  crv: z.enum(["Ed25519", "X25519"]),
  x: keyString,
});
const privatePoint = publicPoint.extend({ d: keyString });

export interface ExchangeKeyBinding extends ExchangeClinic {
  kid: string;
  jwk: JWK;
}

export interface ExchangeKeyPair {
  publicKey: ExchangeKeyBinding;
  privateKey: ExchangeKeyBinding;
}

export async function generateExchangeKeys(clinic: ExchangeClinic) {
  const identity = clinicSchema.parse(clinic);
  async function generate(signing: boolean): Promise<ExchangeKeyPair> {
    const pair = signing
      ? await generateKeyPair(signatureAlgorithm, { extractable: true })
      : await generateKeyPair(wrappingAlgorithm, { crv: "X25519", extractable: true });
    const pub = await exportJWK(pair.publicKey);
    const kid = await calculateJwkThumbprint(pub);
    return {
      publicKey: { ...identity, kid, jwk: pub },
      privateKey: { ...identity, kid, jwk: await exportJWK(pair.privateKey) },
    };
  }
  return { signing: await generate(true), encryption: await generate(false) };
}

export async function loadKey(
  binding: ExchangeKeyBinding,
  curve: "Ed25519" | "X25519",
  visibility: "public" | "private",
) {
  const parsed = clinicSchema
    .extend({ kid: keyString, jwk: visibility === "public" ? publicPoint : privatePoint })
    .safeParse(binding);
  if (!parsed.success) return invalid();
  const { jwk, kid } = parsed.data;
  if (jwk.crv !== curve || (await calculateJwkThumbprint(jwk)) !== kid) return invalid();
  return {
    ...parsed.data,
    key: await importJWK(jwk, curve === "Ed25519" ? signatureAlgorithm : wrappingAlgorithm),
  };
}
