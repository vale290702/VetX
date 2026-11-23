// Expo and Hermes provide the UTF-8 encoder. This workspace uses native-only TypeScript libraries.
declare const TextEncoder: { new (): { encode(input: string): Uint8Array } };

// Expo's JSON adapter reads a Request body as text. Keep the binary part byte-for-byte intact.
export function multipartFile(
  bytes: Uint8Array,
  filename: string,
  mediaType: string,
  boundary: string,
  title?: string,
) {
  const encoder = new TextEncoder();
  const titlePart =
    title === undefined
      ? ""
      : `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n`;
  const prefix = encoder.encode(
    titlePart +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mediaType}\r\n\r\n`,
  );
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(prefix.length + bytes.length + suffix.length);
  body.set(prefix);
  body.set(bytes, prefix.length);
  body.set(suffix, prefix.length + bytes.length);
  return body;
}
