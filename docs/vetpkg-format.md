# VetX clinical exchange format v1

A `.vetpkg` file carries one source clinic's records for one patient to one destination clinic. Every file contains a signed UTF-8 JSON manifest encrypted for the recipient. The signing clinic attests to the record contents, author identifiers and timestamps. Staff permissions, guardian releases, import review and replay handling belong to the application that uses the codec.

## Wire encoding

The complete file consists of ASCII compact JWE bytes with five dot-separated segments and no trailing newline. The encrypted plaintext is a compact JWS with three segments. The JWS payload is the manifest. JOSE segments use unpadded base64url with zero unused bits. Header names are case-sensitive. The receiver accepts only these protected headers.

| Layer     | Required header members                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Outer JWE | `typ` = `application/vnd.vetx.vetpkg.v1`, `cty` = `application/jose`, `alg` = `ECDH-ES+A256KW`, `enc` = `A256GCM`, `kid` = recipient encryption key ID, `epk` = ephemeral public JWK |
| Inner JWS | `typ` = `application/vnd.vetx.manifest.v1+json`, `alg` = `Ed25519`, `kid` = source signing key ID                                                                                    |

The sender signs the exact manifest bytes with Ed25519. For each export it generates a fresh X25519 ephemeral key, wraps a fresh content encryption key, and encrypts the JWS with AES-256-GCM. The outer protected header and encrypted size are visible to anyone holding the file. The source signature, patient details and source record identifiers are encrypted. See [JSON Web Encryption](https://www.rfc-editor.org/rfc/rfc7516.html), [CFRG curves in JOSE](https://www.rfc-editor.org/rfc/rfc8037.html) and [fully specified JOSE algorithms](https://www.rfc-editor.org/rfc/rfc9864.html).

## Manifest

A clinic identity is an object with `organizationId` and `clinicId`. Both are lowercase UUIDs. Top-level fields are `version` (integer 1), `packageId` (fresh UUID), `createdAt` (timestamp), `source`, `destination`, `patient`, optional `owner`, and `records`. The patient object supplies the source patient `id`, `name`, `species` and optionally `birthDate` (date or null). An exporter may supply an explicitly authorized owner's `name` and optional `email`. Omitting the owner object exports zero owner contact fields. The codec consumes only the records passed by the exporter.

Every record has `kind`, source `id` (UUID), `occurredAt`, `recordedAt`, original `author` with `issuer` and `subject`, and a typed `data` object. Time instants carry UTC or an explicit numeric offset. Calendar dates use YYYY-MM-DD. Record IDs are unique within the manifest. The signed source organization, clinic, patient, kind and record ID form the provenance identity across exports. Importers should keep this identity and original authorship with the imported record. A new package ID or ciphertext can carry an already imported record.

For a versioned diagnosis, treatment, vaccination or reviewed lab result, the record ID identifies the immutable exported revision. The optional record-level `clinicalRevision` contains the source `recordId` and positive integer `revision`. A reviewed lab also carries `resultAuthor` and `resultRecordedAt` inside that object. Its top-level author and recording time identify the reviewer. A correction gets a new revision ID and keeps the same source record ID. Deploy a receiver that supports these fields before sending versioned records to it.

| Record kind       | Fields in `data`                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `encounter`       | `reason`, `subjective`, `objective`, `assessment`, `plan`                                                             |
| `addendum`        | All encounter fields and `addendumTo` (original encounter UUID)                                                       |
| `diagnosis`       | `diagnosis`, optional `code`                                                                                          |
| `treatment`       | `treatment`, optional `notes`                                                                                         |
| `prescription`    | `medication`, `instructions`                                                                                          |
| `vaccination`     | `vaccine`, optional `lotNumber`, optional `nextDueDate`                                                               |
| `labResult`       | `test`, `result`, optional `specimen`, `unit` and `referenceRange`                                                    |
| `document`        | Attachment fields, media type PDF, JPEG or PNG                                                                        |
| `radiograph`      | Attachment fields, media type JPEG or PNG                                                                             |
| `dicom`           | Attachment fields, media type `application/dicom`, optional `studyInstanceUid`, `seriesInstanceUid`, `sopInstanceUid` |
| `referral`        | `referredTo` (clinic identity), `reason`, optional `summary`                                                          |
| `counterReferral` | `referralId`, `referringClinic` (clinic identity), `summary`                                                          |

Attachments have `title`, `mediaType`, positive `byteLength`, lowercase hexadecimal `sha256`, and `content` containing unpadded base64url of the original bytes. The receiver checks length, encoding and SHA-256. Applications that display or store files apply their own file-type and content checks. Documents are self-contained. An encounter or addendum must contain at least one nonblank SOAP section. Addenda may point to an encounter or another addendum. In-package parent chains must be acyclic. Addenda and counter-referrals may reference records delivered separately so an exporter can honor individual releases.

## Using the codec

`@vetx/exchange` runs on the supported Node release and uses [jose](https://github.com/panva/jose). Each operation receives explicit local key bindings. The recipient supplies the expected private key and a list of trusted signing public keys. Only one pinned binding may match the signed key ID. After signature verification, the receiver compares both signed clinic identities to the selected bindings. Additional headers, compression, remote key discovery, embedded signing keys, duplicate JSON members, unknown manifest fields and unknown versions all cause rejection.

```ts
import { sealVetpkg, openVetpkg, validateVetpkgManifest } from "@vetx/exchange";

const manifest = validateVetpkgManifest(authorizedSelection);
const bytes = await sealVetpkg(manifest, {
  signer: sourceSigningPrivateKey,
  recipient: destinationEncryptionPublicKey,
});
const verified = await openVetpkg(bytes, {
  recipient: destinationEncryptionPrivateKey,
  trustedSources: trustedSigningPublicKeys,
});
```

The default limits are 48 MiB per encrypted file, 24 MiB per signed manifest, 1,024 records, 8 MiB per attachment and 16 MiB total attachment bytes. Applications may set positive integer overrides named `maxPackageBytes`, `maxManifestBytes`, `maxRecords`, `maxAttachmentBytes` and `maxTotalAttachmentBytes` in `options.limits`. Bound the transport body before buffering it for the codec. This in-memory implementation checks encrypted size before decryption, signed size before verification, array length before JSON materialization, and attachment sizes before decoding. It returns a complete verified manifest or throws. Serialize database writes and replay checks in the importer's transaction.

## Provisioning keys

On the clinic's trusted machine, generate keys in a new directory. Set the organization and clinic UUIDs to the clinic's registered identity.

```sh
pnpm --filter @vetx/exchange build
pnpm --filter @vetx/exchange keygen "$organization_id" "$clinic_id" "$new_key_directory"
```

The command creates four files named `signing-private.json`, `signing-public.json`, `encryption-private.json` and `encryption-public.json`. On POSIX systems the directory has mode 0700 and files have mode 0600. The command requires a fresh target directory. Each binding contains `organizationId`, `clinicId`, `kid` and `jwk`. The key ID is the base64url SHA-256 JWK thumbprint. The JWK contains exactly `kty` = `OKP`, `crv` = `Ed25519` or `X25519`, and `x`. A private JWK also contains `d`. Both coordinates and secrets use canonical 32-byte base64url encodings. See [JWK thumbprints](https://www.rfc-editor.org/rfc/rfc7638.html).

Keep private bindings in the appropriate clinic's secret store. Exchange the two public bindings over an authenticated administrative channel and verify their thumbprints and clinic identities independently. Provision a separate pair for each clinic. To rotate, distribute the new public bindings and select the new private bindings for new exports. Retain earlier recipient private keys for any older files that should remain readable. For an incoming file, `vetpkgRecipientKid(bytes, limits?)` reads a bounded, unauthenticated header hint. Use it only to look up a decryption key within the expected destination clinic. Pass the selected binding and the file to `openVetpkg` for full verification before displaying patient data or writing an import. Removing a source public binding from the trusted list rejects imports signed by that key.

Prescription records carry medication and directions. New exports also include the prescribed quantity (a positive decimal with three places) and its unit as a pair. The decoder accepts earlier prescriptions containing medication and directions alone. Receiving installations need the updated decoder for prescriptions that include quantities.
