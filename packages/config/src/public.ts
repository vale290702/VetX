export function parseHttpOrigin(value: string | undefined): string | undefined {
  if (!value || !/^https?:\/\/[^/\\?#@\s]+\/?$/i.test(value)) {
    return undefined;
  }

  try {
    const url = new URL(value);
    return url.username || url.password ? undefined : url.origin;
  } catch {
    return undefined;
  }
}
