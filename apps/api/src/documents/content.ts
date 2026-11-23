import { createHash } from "node:crypto";

export const documentTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/dicom",
] as const;
export type DocumentMediaType = (typeof documentTypes)[number];
export interface FileIntegrity {
  mediaType: DocumentMediaType;
  byteLength: number;
  sha256: string;
}
export class InvalidDocument extends Error {}
const pngStart = Buffer.from("89504e470d0a1a0a", "hex");
const pngEnd = Buffer.from("0000000049454e44ae426082", "hex");
function identify(bytes: Buffer): DocumentMediaType | undefined {
  if (
    bytes.length >= 45 &&
    bytes.subarray(0, 8).equals(pngStart) &&
    bytes.readUInt32BE(8) === 13 &&
    bytes.toString("ascii", 12, 16) === "IHDR" &&
    bytes.subarray(-12).equals(pngEnd)
  )
    return "image/png";
  if (
    bytes.length > 7 &&
    bytes.readUInt16BE(0) === 0xffd8 &&
    bytes[2] === 0xff &&
    bytes.readUInt16BE(bytes.length - 2) === 0xffd9
  )
    return "image/jpeg";
  if (
    /^%PDF-\d\.\d/.test(bytes.subarray(0, 8).toString("latin1")) &&
    /%%EOF[\t\r\n ]*$/.test(bytes.subarray(-1024).toString("latin1"))
  )
    return "application/pdf";
  if (bytes.length > 144 && bytes.toString("ascii", 128, 132) === "DICM")
    return "application/dicom";
  return undefined;
}
export function inspectDocument(
  bytes: Buffer,
  declaredType: string,
  maxBytes: number,
): FileIntegrity {
  if (!bytes.length || bytes.length > maxBytes) throw new InvalidDocument();
  const mediaType = identify(bytes);
  if (!mediaType || declaredType !== mediaType) throw new InvalidDocument();
  return {
    mediaType,
    byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
export function documentKey(
  org: string,
  clinic: string,
  patient: string,
  document: string,
  sha256: string,
): string {
  const ids = [org, clinic, patient, document];
  if (
    !ids.every((id) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) ||
    !/^[a-f0-9]{64}$/.test(sha256)
  )
    throw new InvalidDocument();
  return ["clinical", "v1", ...ids.map((id) => id.toLowerCase()), sha256].join("/");
}
