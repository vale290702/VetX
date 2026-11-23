import { randomUUID } from "node:crypto";

// A two-by-two secondary capture image in Explicit VR Little Endian.
// All identifiers are generated locally for the test.
function uid() {
  return "2.25." + BigInt("0x" + randomUUID().replaceAll("-", "")).toString();
}
function element(group, tag, vr, value) {
  let bytes;
  if (typeof value === "number") {
    bytes = Buffer.alloc(vr === "UL" ? 4 : 2);
    bytes.writeUIntLE(value, 0, bytes.length);
  } else {
    bytes = Buffer.from(value);
    if (bytes.length % 2) bytes = Buffer.concat([bytes, Buffer.from([vr === "UI" ? 0 : 32])]);
  }
  const wide = vr === "OB" || vr === "OW";
  const header = Buffer.alloc(wide ? 12 : 8);
  header.writeUInt16LE(group, 0);
  header.writeUInt16LE(tag, 2);
  header.write(vr, 4, 2, "ascii");
  header.writeUIntLE(bytes.length, wide ? 8 : 6, wide ? 4 : 2);
  return Buffer.concat([header, bytes]);
}
export function dicomFixture() {
  const secondaryCapture = "1.2.840.10008.5.1.4.1.1.7";
  const instance = uid();
  const meta = Buffer.concat([
    element(2, 1, "OB", [0, 1]),
    element(2, 2, "UI", secondaryCapture),
    element(2, 3, "UI", instance),
    element(2, 16, "UI", "1.2.840.10008.1.2.1"),
    element(2, 18, "UI", "2.25.143476926707170266070495542024173533705"),
  ]);
  return Buffer.concat([
    Buffer.alloc(128),
    Buffer.from("DICM"),
    element(2, 0, "UL", meta.length),
    meta,
    element(8, 22, "UI", secondaryCapture),
    element(8, 24, "UI", instance),
    element(8, 32, "DA", ""),
    element(8, 48, "TM", ""),
    element(8, 80, "SH", ""),
    element(8, 96, "CS", "OT"),
    element(8, 100, "CS", "SYN"),
    element(8, 144, "PN", ""),
    element(16, 16, "PN", "Synthetic^VetX"),
    element(16, 32, "LO", randomUUID()),
    element(16, 48, "DA", ""),
    element(16, 64, "CS", ""),
    element(32, 13, "UI", uid()),
    element(32, 14, "UI", uid()),
    element(32, 16, "SH", "TEST"),
    element(32, 17, "IS", "1"),
    element(32, 19, "IS", "1"),
    element(40, 2, "US", 1),
    element(40, 4, "CS", "MONOCHROME2"),
    element(40, 16, "US", 2),
    element(40, 17, "US", 2),
    element(40, 256, "US", 8),
    element(40, 257, "US", 8),
    element(40, 258, "US", 7),
    element(40, 259, "US", 0),
    element(32736, 16, "OB", [0, 64, 128, 255]),
  ]);
}
