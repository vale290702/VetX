import { invalid } from "./limits.js";

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// Scan structural punctuation before JSON.parse allocates any arrays or objects.
// The profile has a single array (records) and small, fixed-shape objects.
export function parseBoundedJson(bytes: Uint8Array, maxRecords: number): unknown {
  const text = decoder.decode(bytes);
  const frames: ({ keys: Set<string> } | { commas: number })[] = [];
  let sawArray = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const frame = frames.at(-1);
    if (c === '"') {
      const start = i;
      // Skip the literal, including any escaped quote, without copying its contents.
      while (true) {
        const quote = text.indexOf('"', i + 1);
        if (quote < 0) return invalid();
        let slash = quote - 1;
        while (slash > start && text[slash] === "\\") slash--;
        i = quote;
        if ((quote - slash) % 2 === 1) break;
      }
      let next = i + 1;
      while (next < text.length && " \t\n\r".includes(text.charAt(next))) next++;
      if (text[next] === ":") {
        if (!frame || !("keys" in frame) || i - start > 128 || frame.keys.size >= 32)
          return invalid();
        const key: string = JSON.parse(text.slice(start, i + 1));
        if (frame.keys.has(key)) return invalid();
        frame.keys.add(key);
      }
    } else if (c === "{" || c === "[") {
      if (frames.length >= 6) return invalid();
      if (c === "[") {
        if (sawArray || maxRecords === 0) return invalid();
        sawArray = true;
        frames.push({ commas: 0 });
      } else {
        frames.push({ keys: new Set() });
      }
    } else if (c === "}" || c === "]") {
      if (!frame || c !== ("keys" in frame ? "}" : "]")) return invalid();
      frames.pop();
    } else if (c === "," && frame && "commas" in frame && ++frame.commas >= maxRecords) {
      return invalid();
    }
  }
  return JSON.parse(text);
}
