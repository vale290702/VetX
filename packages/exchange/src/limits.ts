export interface VetpkgLimits {
  maxPackageBytes: number;
  maxManifestBytes: number;
  maxRecords: number;
  maxAttachmentBytes: number;
  maxTotalAttachmentBytes: number;
}

const mib = 1024 * 1024;
export const defaultVetpkgLimits: Readonly<VetpkgLimits> = Object.freeze({
  maxPackageBytes: 48 * mib,
  maxManifestBytes: 24 * mib,
  maxRecords: 1024,
  maxAttachmentBytes: 8 * mib,
  maxTotalAttachmentBytes: 16 * mib,
});

export function resolveLimits(overrides: Partial<VetpkgLimits> = {}): VetpkgLimits {
  const limits = { ...defaultVetpkgLimits, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Object.hasOwn(defaultVetpkgLimits, name) || !Number.isSafeInteger(value) || value < 1)
      throw new Error("Invalid exchange resource limit");
  }
  return limits;
}

export class VetpkgSizeError extends Error {
  constructor() {
    super("Invalid VetX exchange package");
    this.name = "VetpkgSizeError";
  }
}

export function invalid(): never {
  throw new Error("Invalid VetX exchange package");
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export function isBase64url(value: string): boolean {
  if (!value || /[^A-Za-z0-9_-]/.test(value)) return false;
  const remaining = value.length % 4;
  const tail = alphabet.indexOf(value.charAt(value.length - 1));
  return (
    remaining === 0 ||
    (remaining === 2 && (tail & 15) === 0) ||
    (remaining === 3 && (tail & 3) === 0)
  );
}
