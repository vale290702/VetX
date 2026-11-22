import {
  openVetpkg,
  sealVetpkg,
  validateVetpkgManifest,
  type ExchangeRecord,
  type OpenVetpkgOptions,
  type SealVetpkgOptions,
  type VetpkgManifest,
} from "@vetx/exchange";

declare const input: unknown;
declare const opening: OpenVetpkgOptions;
declare const sealing: SealVetpkgOptions;
const manifest: VetpkgManifest = validateVetpkgManifest(input);
const roundTrip: Promise<VetpkgManifest> = sealVetpkg(manifest, sealing).then((bytes) =>
  openVetpkg(bytes, opening),
);
void roundTrip;
declare const row: ExchangeRecord;
if (row.kind === "document") {
  const content: string = row.data.content;
  void content;
  // @ts-expect-error Document data has no prescription instructions.
  void row.data.instructions;
}
// @ts-expect-error Callers must specify the recipient.
void openVetpkg(new Uint8Array(), { trustedSources: [] });
// @ts-expect-error Version 1 is required.
void sealVetpkg({ ...manifest, version: 2 }, sealing);
