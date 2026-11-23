import { readFileSync } from "node:fs";
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { ConfigurationError } from "@vetx/config";
interface ExchangeJwk {
  kty: "OKP";
  crv: "Ed25519" | "X25519";
  x: string;
  d?: string;
}

export interface ExchangeClinicId {
  organizationId: string;
  clinicId: string;
}
export interface ProvisionedKey extends ExchangeClinicId {
  kid: string;
  jwk: ExchangeJwk;
}
export interface ClinicKeys extends ExchangeClinicId {
  name: string;
  signing: ProvisionedKey[];
  encryption: ProvisionedKey[];
}
interface Route {
  source: ExchangeClinicId;
  destination: ExchangeClinicId;
}
function invalid(): never {
  throw new ConfigurationError("Invalid clinical exchange key directory");
}
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return invalid();
  return v as Record<string, unknown>;
}
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function clinicId(raw: unknown): ExchangeClinicId {
  const { organizationId, clinicId } = object(raw);
  if (
    typeof organizationId !== "string" ||
    !uuid.test(organizationId) ||
    typeof clinicId !== "string" ||
    !uuid.test(clinicId)
  )
    return invalid();
  return { organizationId: organizationId.toLowerCase(), clinicId: clinicId.toLowerCase() };
}
export const sameClinic = (a: ExchangeClinicId, b: ExchangeClinicId) =>
  a.organizationId.toLowerCase() === b.organizationId.toLowerCase() &&
  a.clinicId.toLowerCase() === b.clinicId.toLowerCase();
function keys(
  raw: unknown,
  scope: ExchangeClinicId,
  curve: "Ed25519" | "X25519",
): ProvisionedKey[] {
  if (!Array.isArray(raw) || !raw.length) return invalid();
  return raw.map((entry) => {
    const key = object(entry),
      jwk = object(key.jwk),
      { kty, crv, x, d } = jwk;
    if (
      !sameClinic(clinicId(key), scope) ||
      kty !== "OKP" ||
      crv !== curve ||
      typeof x !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(x) ||
      (d !== undefined && (typeof d !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(d)))
    )
      return invalid();
    const kid = createHash("sha256").update(JSON.stringify({ crv, kty, x })).digest("base64url");
    if (key.kid !== kid || Buffer.from(x, "base64url").toString("base64url") !== x)
      return invalid();
    if (typeof d === "string") {
      if (Buffer.from(d, "base64url").toString("base64url") !== d) return invalid();
      try {
        const privateKey = createPrivateKey({ key: { kty, crv: curve, x, d }, format: "jwk" });
        if (createPublicKey(privateKey).export({ format: "jwk" }).x !== x) return invalid();
      } catch {
        return invalid();
      }
    }
    return { ...scope, kid, jwk: { kty, crv: curve, x, ...(typeof d === "string" ? { d } : {}) } };
  });
}
export class ExchangeKeyDirectory {
  private constructor(
    private readonly clinics: ClinicKeys[],
    private readonly routes: Route[],
  ) {}
  static parse(raw: unknown): ExchangeKeyDirectory {
    const data = object(raw);
    if (data.version !== 1 || !Array.isArray(data.clinics) || !Array.isArray(data.routes))
      return invalid();
    const clinics = data.clinics.map((row: unknown) => {
      const v = object(row),
        scope = clinicId(row);
      if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 180) return invalid();
      return {
        ...scope,
        name: v.name,
        signing: keys(v.signing, scope, "Ed25519"),
        encryption: keys(v.encryption, scope, "X25519"),
      };
    });
    const fingerprints = clinics.flatMap((c) => [...c.signing, ...c.encryption].map((k) => k.kid));
    if (
      new Set(fingerprints).size !== fingerprints.length ||
      new Set(clinics.map((c) => c.organizationId + "/" + c.clinicId)).size !== clinics.length
    )
      return invalid();
    const routes = data.routes.map((row: unknown) => {
      const v = object(row),
        source = clinicId(v.source),
        destination = clinicId(v.destination);
      if (
        sameClinic(source, destination) ||
        ![source, destination].every((point) => clinics.some((c) => sameClinic(c, point)))
      )
        return invalid();
      return { source, destination };
    });
    return new ExchangeKeyDirectory(clinics, routes);
  }
  static read(path: string) {
    try {
      return ExchangeKeyDirectory.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      return invalid();
    }
  }
  clinic(scope: ExchangeClinicId) {
    return this.clinics.find((c) => sameClinic(c, scope));
  }
  destinations(source: ExchangeClinicId) {
    return this.clinics
      .filter((c) => this.allows(source, c))
      .map(({ organizationId, clinicId, name }) => ({ organizationId, clinicId, name }));
  }
  allows(source: ExchangeClinicId, destination: ExchangeClinicId) {
    return this.routes.some(
      (r) => sameClinic(r.source, source) && sameClinic(r.destination, destination),
    );
  }
  trustedSources(destination: ExchangeClinicId) {
    return this.clinics
      .filter((c) => this.allows(c, destination))
      .flatMap((c) => c.signing.map(publicBinding));
  }
}
export function publicBinding(key: ProvisionedKey): ProvisionedKey {
  const { kty, crv, x } = key.jwk;
  return { ...key, jwk: { kty, crv, x } };
}
