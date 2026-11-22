// Native timers use a signed 32-bit millisecond delay.
const maxDelay = 2_147_483_647;

export function startCodeExpiry(expiresAt: string, clearCode: () => void) {
  const deadline = Date.parse(expiresAt);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function stop() {
    stopped = true;
    clearTimeout(timer);
  }

  function check() {
    if (stopped) return;
    clearTimeout(timer);
    const remaining = deadline - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      stop();
      clearCode();
      return;
    }
    timer = setTimeout(check, Math.min(remaining, maxDelay));
  }

  check();
  return { check, stop };
}
