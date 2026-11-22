import { Temporal } from "@js-temporal/polyfill";

export const defaultZone = "America/Costa_Rica";
export const zoneOptions = ["UTC", ...Intl.supportedValuesOf("timeZone")];

export function operatorZone(value: unknown) {
  return typeof value === "string" && zoneOptions.includes(value) ? value : defaultZone;
}

export function agendaDay(value: unknown, timeZone: string) {
  let date = Temporal.Now.plainDateISO(timeZone);
  if (typeof value === "string" && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) {
    try {
      date = Temporal.PlainDate.from(value);
    } catch {
      // Invalid bookmark dates open today's agenda.
    }
  }
  const next = date.add({ days: 1 });
  return {
    day: date.toString(),
    from: date.toZonedDateTime(timeZone).toInstant().toString(),
    to: next.toZonedDateTime(timeZone).toInstant().toString(),
    previous: date.subtract({ days: 1 }).toString(),
    next: next.toString(),
  };
}

export function localInstant(value: unknown, zone: string) {
  if (
    typeof value !== "string" ||
    !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)
  )
    return null;
  try {
    return Temporal.PlainDateTime.from(value)
      .toZonedDateTime(zone, { disambiguation: "reject" })
      .toInstant()
      .toString();
  } catch {
    return null;
  }
}

export function localInput(instant: string, timeZone: string, preservePrecision = false) {
  const dateTime = Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone).toPlainDateTime();
  if (preservePrecision && (dateTime.second || dateTime.millisecond)) return dateTime.toString();
  return dateTime.toString({ smallestUnit: "minute" });
}

export function displayTime(instant: string, locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(instant));
}
