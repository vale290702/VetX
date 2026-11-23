/** One client instance serves one fiscal issuer and one authority environment. */
export interface HaciendaSettings {
  tokenUrl: string;
  receptionUrl: string;
  clientId: string;
  timeoutMs: number;
  maxResponseBytes: number;
}
export interface FiscalIdentity {
  type: string;
  number: string;
}
export interface FiscalEnvelope {
  key: string;
  issuedAt: string;
  issuer: FiscalIdentity;
  recipient?: FiscalIdentity;
  signedXml: Uint8Array;
}
export interface FiscalCredentials {
  username: string;
  password: string;
}
const states = ["recibido", "procesando", "aceptado", "rechazado", "error"] as const;
export type HaciendaState = (typeof states)[number];
export interface FiscalStatus {
  key: string;
  reportedAt: string;
  state: HaciendaState;
  receiptXml?: Buffer;
}
export type Submission =
  { key: string; status: "submitted" } | { key: string; status: "known"; state: HaciendaState };
export interface FiscalReception {
  submit(envelope: FiscalEnvelope): Promise<Submission>;
  status(key: string): Promise<FiscalStatus | null>;
}
type Failure =
  | "configuration"
  | "invalid_submission"
  | "authentication"
  | "rate_limited"
  | "unconfirmed"
  | "unexpected_response"
  | "unavailable";
export class HaciendaError extends Error {
  constructor(
    readonly kind: Failure,
    readonly retryAfterSeconds?: number,
  ) {
    super(kind);
    this.name = "HaciendaError";
  }
}
function endpoint(value: string): string {
  const url = URL.parse(value);
  if (
    !url ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new HaciendaError("configuration");
  return url.href.replace(/\/$/, "");
}
const keyPattern = /^\d{50}$/;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
function dateTime(value: unknown): value is string {
  return typeof value === "string" && timestamp.test(value) && Number.isFinite(Date.parse(value));
}
function identity(value: FiscalIdentity) {
  if (!/^\d{2}$/.test(value.type) || !/^\d{1,12}$/.test(value.number))
    throw new HaciendaError("invalid_submission");
  return { tipoIdentificacion: value.type, numeroIdentificacion: value.number };
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
async function readJson(response: Response, limit: number): Promise<Record<string, unknown>> {
  const stream = response.body;
  if (!stream) throw new HaciendaError("unexpected_response");
  const reader = stream.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > limit) {
        await reader.cancel();
        throw new HaciendaError("unexpected_response");
      }
      chunks.push(next.value);
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
    if (!object(data)) throw new HaciendaError("unexpected_response");
    return data;
  } catch (error) {
    if (error instanceof HaciendaError) throw error;
    throw new HaciendaError("unexpected_response");
  } finally {
    reader.releaseLock();
  }
}
function requireKey(key: string) {
  if (!keyPattern.test(key)) throw new HaciendaError("invalid_submission");
}
function decodeReceipt(value: unknown): Buffer | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.length) throw new HaciendaError("unexpected_response");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new HaciendaError("unexpected_response");
  return bytes;
}
async function rejectResponse(response: Response): Promise<never> {
  await response.body?.cancel();
  if (response.status === 401 || response.status === 403) throw new HaciendaError("authentication");
  if (response.status === 429) {
    const seconds = response.headers.get("retry-after");
    const reset = response.headers.get("x-ratelimit-reset");
    const delay =
      seconds && /^\d+$/.test(seconds)
        ? Number(seconds)
        : reset && /^\d+$/.test(reset)
          ? Math.max(0, Number(reset) - Math.floor(Date.now() / 1000))
          : undefined;
    throw new HaciendaError("rate_limited", delay);
  }
  throw new HaciendaError(response.status >= 500 ? "unavailable" : "unexpected_response");
}
export class HaciendaClient implements FiscalReception {
  private readonly tokenUrl: string;
  private readonly receptionUrl: string;
  private token?: { value: string; expiresAt: number };
  private authenticating?: Promise<string>;
  constructor(
    private readonly config: HaciendaSettings,
    private readonly credentials: FiscalCredentials,
    private readonly request: typeof fetch = fetch,
  ) {
    this.tokenUrl = endpoint(config.tokenUrl);
    this.receptionUrl = endpoint(config.receptionUrl);
    if (
      !config.clientId.trim() ||
      !credentials.username ||
      !credentials.password ||
      ![config.timeoutMs, config.maxResponseBytes].every(
        (v) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647,
      )
    )
      throw new HaciendaError("configuration");
  }
  private async http(url: string, init: RequestInit) {
    try {
      return await this.request(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(this.config.timeoutMs),
        cache: "no-store",
      });
    } catch {
      throw new HaciendaError("unavailable");
    }
  }
  private async login() {
    const body = new URLSearchParams({
      grant_type: "password",
      client_id: this.config.clientId,
      username: this.credentials.username,
      password: this.credentials.password,
    });
    const response = await this.http(this.tokenUrl, { method: "POST", body });
    if (response.status !== 200) {
      if (response.status === 400) {
        await response.body?.cancel();
        throw new HaciendaError("authentication");
      }
      return rejectResponse(response);
    }
    const data = await readJson(response, this.config.maxResponseBytes);
    if (
      typeof data.access_token !== "string" ||
      !data.access_token.length ||
      /[\s\p{Cc}]/u.test(data.access_token) ||
      typeof data.expires_in !== "number" ||
      !Number.isSafeInteger(data.expires_in) ||
      data.expires_in <= 0
    )
      throw new HaciendaError("unexpected_response");
    this.token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 900 };
    return this.token.value;
  }
  private accessToken() {
    if (this.token && this.token.expiresAt > Date.now()) return Promise.resolve(this.token.value);
    this.authenticating ??= this.login().finally(() => {
      this.authenticating = undefined;
    });
    return this.authenticating;
  }
  async status(key: string): Promise<FiscalStatus | null> {
    requireKey(key);
    let token = await this.accessToken();
    const lookup = () =>
      this.http(this.receptionUrl + "/" + key, {
        headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      });
    let response = await lookup();
    if (response.status === 401) {
      await response.body?.cancel();
      if (this.token?.value === token) this.token = undefined;
      token = await this.accessToken();
      response = await lookup();
    }
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (response.status !== 200) return rejectResponse(response);
    const data = await readJson(response, this.config.maxResponseBytes),
      state = states.find((s) => s === data["ind-estado"]);
    if (data.clave !== key || !dateTime(data.fecha) || !state)
      throw new HaciendaError("unexpected_response");
    const receiptXml = decodeReceipt(data["respuesta-xml"]);
    return { key, reportedAt: data.fecha, state, ...(receiptXml ? { receiptXml } : {}) };
  }
  async submit(envelope: FiscalEnvelope): Promise<Submission> {
    requireKey(envelope.key);
    if (
      !dateTime(envelope.issuedAt) ||
      !(envelope.signedXml instanceof Uint8Array) ||
      !envelope.signedXml.byteLength
    )
      throw new HaciendaError("invalid_submission");
    const body = JSON.stringify({
      clave: envelope.key,
      fecha: envelope.issuedAt,
      emisor: identity(envelope.issuer),
      ...(envelope.recipient ? { receptor: identity(envelope.recipient) } : {}),
      comprobanteXml: Buffer.from(envelope.signedXml).toString("base64"),
    });
    const token = await this.accessToken();
    let response: Response | undefined;
    try {
      response = await this.http(this.receptionUrl, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
      });
    } catch (error) {
      if (!(error instanceof HaciendaError && error.kind === "unavailable")) throw error;
    }
    if (response?.status === 201) {
      await response.body?.cancel();
      return { key: envelope.key, status: "submitted" };
    }
    if (response && response.status !== 400 && response.status !== 409 && response.status < 500) {
      if (response.status === 401 && this.token?.value === token) this.token = undefined;
      return rejectResponse(response);
    }
    await response?.body?.cancel();
    // A lost reply or duplicate-key response can follow a successful intake.
    // Reconcile the existing key before the outbox decides whether to retry.
    const existing = await this.status(envelope.key);
    if (existing) return { key: envelope.key, status: "known", state: existing.state };
    throw new HaciendaError("unconfirmed");
  }
}

export { loadFiscalSettings } from "./config.js";
export { FiscalXmlSigner, type FiscalSigningMaterial } from "./signing.js";
export { validateSignedInvoice } from "./schema.js";
export {
  buildFiscalInvoice,
  prepareFiscalInvoice,
  type FiscalInvoice,
  type FiscalLine,
  type InvoiceIssuer,
} from "./invoice.js";
