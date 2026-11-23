import unitCodes from "./unit-codes.v4.4.json" with { type: "json" };
import vatTariffs from "./vat-tariffs.v4.4.json" with { type: "json" };
import { DOMImplementation, XMLSerializer, type Element } from "@xmldom/xmldom";
import type { FiscalIdentity, FiscalEnvelope } from "./index.js";
import type { FiscalXmlSigner } from "./signing.js";
import { validateSignedInvoice } from "./schema.js";

const namespace = "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica";
interface Party {
  name: string;
  identity: FiscalIdentity;
  email?: string;
}
export interface InvoiceIssuer extends Party {
  email: string;
  address: { province: string; canton: string; district: string; details: string };
}
export interface FiscalLine {
  cabys: string;
  name: string;
  unitCode: string;
  category: "goods" | "service";
  quantity: string;
  unitPrice: string;
  vatTariffCode: string;
  taxRate: string;
  subtotal: string;
  tax: string;
  total: string;
  medicine?: { registration: string; form: string };
}
/** A snapshot of an ordinary domestic sale with a named recipient and VAT. */
export interface FiscalInvoice {
  consecutive: string;
  securityCode: string;
  issuedAt: string;
  providerId: string;
  issuerActivity: string;
  recipientActivity?: string;
  issuer: InvoiceIssuer;
  recipient: Party;
  terms: { code: "01" } | { code: "02"; days: number };
  currency: string;
  exchangeRate: string;
  lines: FiscalLine[];
  subtotal: string;
  tax: string;
  total: string;
  payments: { code: "01" | "02" | "04"; amount: string }[];
}
function requireValue(ok: unknown): asserts ok {
  if (!ok) throw new Error("Invalid fiscal invoice snapshot");
}
function scaled(value: string, places = 5) {
  requireValue(typeof value === "string" && /^(?:0|[1-9]\d{0,12})(?:\.\d{1,5})?$/.test(value));
  const [whole, fraction = ""] = value.split(".");
  requireValue(fraction.length <= places);
  return BigInt(whole + fraction.padEnd(places, "0"));
}
function money(amount: bigint) {
  requireValue(amount >= 0n && amount < 10n ** 18n);
  return String(amount / 100000n) + "." + String(amount % 100000n).padStart(5, "0");
}
function documentKey(input: FiscalInvoice) {
  const { issuedAt, issuer, consecutive, securityCode } = input;
  requireValue(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?-06:00$/.test(issuedAt));
  const instant = new Date(issuedAt);
  requireValue(Number.isFinite(instant.getTime()));
  const localDate = new Date(instant.getTime() - 6 * 60 * 60 * 1000).toISOString().slice(0, 19);
  requireValue(localDate === issuedAt.slice(0, 19));
  requireValue(/^\d{8}01\d{10}$/.test(consecutive) && Number(consecutive.slice(10)) > 0);
  requireValue(/^\d{1,12}$/.test(issuer.identity.number) && /^\d{8}$/.test(securityCode));
  const date = issuedAt.slice(8, 10) + issuedAt.slice(5, 7) + issuedAt.slice(2, 4);
  return "506" + date + issuer.identity.number.padStart(12, "0") + consecutive + "1" + securityCode;
}

export function buildFiscalInvoice(input: FiscalInvoice): { key: string; xml: string } {
  const key = documentKey(input);
  requireValue(input.lines.length > 0 && scaled(input.exchangeRate) > 0n);
  const doc = new DOMImplementation().createDocument(namespace, "FacturaElectronica", null);
  const root = doc.documentElement!;
  function element(parent: Element, name: string, value?: string) {
    const child = doc.createElementNS(namespace, name);
    parent.appendChild(child);
    if (value !== undefined) {
      requireValue(typeof value === "string" && value.trim() && !/[\p{Cc}]/u.test(value));
      child.appendChild(doc.createTextNode(value));
    }
    return child;
  }
  function party(tag: string, value: Party, address?: InvoiceIssuer["address"]) {
    const node = element(root, tag);
    element(node, "Nombre", value.name);
    const id = element(node, "Identificacion");
    element(id, "Tipo", value.identity.type);
    element(id, "Numero", value.identity.number);
    if (address) {
      const location = element(node, "Ubicacion");
      element(location, "Provincia", address.province);
      element(location, "Canton", address.canton);
      element(location, "Distrito", address.district);
      element(location, "OtrasSenas", address.details);
    }
    if (value.email) element(node, "CorreoElectronico", value.email);
  }
  element(root, "Clave", key);
  element(root, "ProveedorSistemas", input.providerId);
  element(root, "CodigoActividadEmisor", input.issuerActivity);
  if (input.recipientActivity) element(root, "CodigoActividadReceptor", input.recipientActivity);
  element(root, "NumeroConsecutivo", input.consecutive);
  element(root, "FechaEmision", input.issuedAt);
  party("Emisor", input.issuer, input.issuer.address);
  party("Receptor", input.recipient);
  element(root, "CondicionVenta", input.terms.code);
  if (input.terms.code === "02") {
    requireValue(Number.isInteger(input.terms.days) && input.terms.days > 0);
    element(root, "PlazoCredito", String(input.terms.days));
  }
  const detail = element(root, "DetalleServicio");
  const taxes = new Map<string, bigint>();
  let goods = 0n,
    services = 0n,
    taxTotal = 0n;
  input.lines.forEach((line, index) => {
    const quantity = scaled(line.quantity, 3);
    const net = scaled(line.subtotal),
      tax = scaled(line.tax),
      rate = scaled(line.taxRate);
    // Half-up decimal rounding follows the stored per-line sale calculation.
    requireValue(quantity > 0n && unitCodes.includes(line.unitCode));
    const tariff = Object.entries(vatTariffs).find(([code]) => code === line.vatTariffCode);
    requireValue(tariff && rate === scaled(tariff[1]));
    requireValue(net === (scaled(line.unitPrice) * quantity + 500n) / 1000n);
    requireValue(tax === (net * rate + 5000000n) / 10000000n && net + tax === scaled(line.total));
    requireValue(line.category === "goods" || line.category === "service");
    if (line.category === "goods") goods += net;
    else services += net;
    taxTotal += tax;
    taxes.set(line.vatTariffCode, (taxes.get(line.vatTariffCode) ?? 0n) + tax);
    const row = element(detail, "LineaDetalle");
    element(row, "NumeroLinea", String(index + 1));
    element(row, "CodigoCABYS", line.cabys);
    element(row, "Cantidad", line.quantity);
    element(row, "UnidadMedida", line.unitCode);
    element(row, "Detalle", line.name);
    if (line.medicine) {
      element(row, "RegistroMedicamento", line.medicine.registration);
      element(row, "FormaFarmaceutica", line.medicine.form);
    }
    element(row, "PrecioUnitario", line.unitPrice);
    element(row, "MontoTotal", money(net));
    element(row, "SubTotal", money(net));
    element(row, "BaseImponible", money(net));
    const vat = element(row, "Impuesto");
    element(vat, "Codigo", "01");
    element(vat, "CodigoTarifaIVA", line.vatTariffCode);
    element(vat, "Tarifa", line.taxRate.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1"));
    element(vat, "Monto", money(tax));
    element(row, "ImpuestoAsumidoEmisorFabrica", money(0n));
    element(row, "ImpuestoNeto", money(tax));
    element(row, "MontoTotalLinea", money(net + tax));
  });
  const subtotal = goods + services,
    total = subtotal + taxTotal;
  requireValue(
    scaled(input.total) === total &&
      scaled(input.subtotal) === subtotal &&
      scaled(input.tax) === taxTotal,
  );
  const summary = element(root, "ResumenFactura"),
    currency = element(summary, "CodigoTipoMoneda");
  element(currency, "CodigoMoneda", input.currency);
  element(currency, "TipoCambio", input.exchangeRate);
  if (services) element(summary, "TotalServGravados", money(services));
  if (goods) element(summary, "TotalMercanciasGravadas", money(goods));
  element(summary, "TotalGravado", money(subtotal));
  element(summary, "TotalVenta", money(subtotal));
  element(summary, "TotalVentaNeta", money(subtotal));
  for (const [code, tax] of taxes) {
    const item = element(summary, "TotalDesgloseImpuesto");
    element(item, "Codigo", "01");
    element(item, "CodigoTarifaIVA", code);
    element(item, "TotalMontoImpuesto", money(tax));
  }
  element(summary, "TotalImpuesto", money(taxTotal));
  const tender = new Map<string, bigint>();
  let paid = 0n;
  for (const payment of input.payments) {
    const amount = scaled(payment.amount);
    requireValue(amount > 0n && ["01", "02", "04"].includes(payment.code));
    tender.set(payment.code, (tender.get(payment.code) ?? 0n) + amount);
    paid += amount;
  }
  requireValue(paid <= total && (input.terms.code !== "01" || paid === total));
  for (const [code, amount] of tender) {
    const method = element(summary, "MedioPago");
    element(method, "TipoMedioPago", code);
    element(method, "TotalMedioPago", money(amount));
  }
  element(summary, "TotalComprobante", money(total));
  return { key, xml: new XMLSerializer().serializeToString(doc) };
}
export async function prepareFiscalInvoice(
  snapshot: FiscalInvoice,
  signer: FiscalXmlSigner,
  timeoutMs: number,
): Promise<FiscalEnvelope> {
  const { key, xml } = buildFiscalInvoice(snapshot);
  const signedXml = await signer.signInvoice(xml, key);
  await validateSignedInvoice(signedXml, timeoutMs);
  return {
    key,
    issuedAt: snapshot.issuedAt,
    issuer: snapshot.issuer.identity,
    recipient: snapshot.recipient.identity,
    signedXml,
  };
}
