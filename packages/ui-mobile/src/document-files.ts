import { getDocumentAsync } from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import { Platform } from "react-native";
import {
  absoluteSizeLimit,
  extensions,
  recognizedType,
  type PickedDocument,
  type MedicalFile,
} from "./documents";

export class DocumentFileError extends Error {
  readonly issue: "fileSize" | "fileType" | "openUnavailable";
  constructor(issue: DocumentFileError["issue"]) {
    super(issue);
    this.issue = issue;
  }
}
const handoffLifetime = 5 * 60 * 1000;
const sharedDirectory = () => new Directory(Paths.cache, "vetx-handoff");
const pickerDirectory = () => new Directory(Paths.cache, "DocumentPicker");

function remove(file: File) {
  try {
    if (file.exists) file.delete();
  } catch {
    /* A later sweep retries temporary cache cleanup. */
  }
}

export function clearOldDocumentFiles() {
  for (const dir of [sharedDirectory(), pickerDirectory()]) {
    try {
      if (!dir.exists) continue;
      for (const file of dir.list()) {
        if (!(file instanceof File)) continue;
        const remaining = (file.modificationTime ?? 0) + handoffLifetime - Date.now();
        if (remaining <= 0) remove(file);
        else setTimeout(() => remove(file), Math.min(remaining, handoffLifetime));
      }
    } catch {
      /* The OS may have already purged its cache. */
    }
  }
}

export async function pickDocument(): Promise<PickedDocument | undefined> {
  const result = await getDocumentAsync({
    type: Object.keys(extensions),
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return;
  const asset = result.assets[0];
  if (!asset) return;
  const file = new File(asset.uri);
  try {
    if (file.size < 1 || file.size > absoluteSizeLimit) throw new DocumentFileError("fileSize");
    const mediaType = recognizedType(asset.mimeType, asset.name);
    if (!mediaType) throw new DocumentFileError("fileType");
    const bytes = await file.bytes();
    if (!bytes.length || bytes.length > absoluteSizeLimit) throw new DocumentFileError("fileSize");
    return { name: asset.name, bytes, mediaType };
  } finally {
    // Never delete a source URI returned by the device's document provider.
    if (file.uri.startsWith(pickerDirectory().uri.replace(/\/?$/, "/"))) remove(file);
  }
}

export async function openDocument(
  doc: MedicalFile,
  download: () => Promise<Uint8Array>,
  active: () => boolean,
  dialogTitle: string,
) {
  if (!(await isAvailableAsync())) throw new DocumentFileError("openUnavailable");
  if (!active()) return;
  const bytes = await download();
  if (!active()) return;
  const dir = sharedDirectory();
  dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, "VetX-" + globalThis.expo.uuidv4() + "." + extensions[doc.mediaType]);
  let handedOff = false;
  try {
    file.create();
    file.write(bytes);
    const uti = {
      "image/png": "public.png",
      "image/jpeg": "public.jpeg",
      "application/pdf": "com.adobe.pdf",
    }[doc.mediaType];
    await shareAsync(file.uri, { mimeType: doc.mediaType, UTI: uti, dialogTitle });
    handedOff = true;
  } finally {
    // Android's chooser can resolve before the chosen app reads its one-time content URI.
    if (handedOff && Platform.OS === "android") setTimeout(() => remove(file), handoffLifetime);
    else remove(file);
  }
}
