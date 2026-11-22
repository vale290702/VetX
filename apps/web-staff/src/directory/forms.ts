export function isDirectoryId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function integer(value: unknown) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const number = Number(value);
  return number <= 2_147_483_647 ? number : null;
}

export function readDirectoryPage(value: unknown): number {
  return integer(value) || 1;
}

export function parseDirectoryChange(form: FormData) {
  const action = form.get("action");
  const revision = integer(form.get("revision"));
  if (revision === null) return null;
  if (action === "clinic") {
    const name = form.get("name");
    const clinicId = form.get("clinicId");
    if (
      !isDirectoryId(clinicId) ||
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 120
    )
      return null;
    return { action, revision, clinicId, name: name.trim() } as const;
  }
  const subject = form.get("subject");
  if (
    typeof subject !== "string" ||
    !subject.trim() ||
    subject.trim() !== subject ||
    subject.length > 255
  )
    return null;
  if (action === "revoke") return { action, revision, subject } as const;
  const role = form.get("role");
  if (action !== "member" || (role !== "STAFF" && role !== "ADMIN")) return null;
  const clinicIds = role === "STAFF" ? form.getAll("clinicIds") : [];
  if (!clinicIds.every(isDirectoryId)) return null;
  return { action, revision, subject, role, clinicIds } as const;
}

export const directoryNotices = [
  "saved",
  "invalid",
  "conflict",
  "lastAdmin",
  "denied",
  "writeUnavailable",
] as const;
export type DirectoryNotice = (typeof directoryNotices)[number];
