const two = (value: number) => String(value).padStart(2, "0");

export function localDay(date = new Date()) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

export function localMinute(date = new Date()) {
  return `${localDay(date)} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function minuteInstant(value: string, original?: string) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value) || value.startsWith("0000-")) return undefined;
  // A visit in the second instance of a repeated hour retains its offset when editing other fields.
  if (original && localMinute(new Date(original)) === value) return original;
  const date = new Date(value.replace(" ", "T") + ":00");
  if (!(date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999) || localMinute(date) !== value)
    return undefined;
  // The local parser chooses the earlier instant in a repeated hour. Reject an ambiguous new entry.
  const tomorrow = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  const offsetChange = tomorrow.getTimezoneOffset() - date.getTimezoneOffset();
  if (offsetChange > 0 && localMinute(new Date(date.getTime() + offsetChange * 60_000)) === value)
    return undefined;
  return date.toISOString();
}

export function moveDay(value: string, by: number) {
  const date = new Date(value + "T12:00:00");
  date.setDate(date.getDate() + by);
  return localDay(date);
}
export function dayRange(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return undefined;
  const from = new Date(value + "T00:00:00");
  if (!Number.isFinite(from.valueOf()) || localDay(from) !== value) return undefined;
  const to = new Date(moveDay(value, 1) + "T00:00:00");
  if (!Number.isFinite(to.valueOf()) || from.getUTCFullYear() < 1 || to.getUTCFullYear() > 9999)
    return undefined;
  return { from: from.toISOString(), to: to.toISOString() };
}
