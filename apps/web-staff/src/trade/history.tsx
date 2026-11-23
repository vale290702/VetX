"use client";
import { Button } from "@vetx/ui-web";
import { useEffect, useState } from "react";
import { stockQuantity } from "../inventory/forms.ts";
import { notice, tradeMessages } from "./messages.ts";
import { ReturnForm } from "./purchase-forms";
import type { Context } from "./controls";
import type { Schema, Choices } from "./forms.ts";
type Data =
  Schema["PurchaseReceiptPageDto"] | Schema["SupplierReturnPageDto"] | Schema["DispensingPageDto"];
type Props = { ctx: Context; locations: Choices } & (
  | { kind: "receipts" | "returns"; order: Schema["PurchaseOrderDto"] }
  | { kind: "dispensings"; rx: Schema["PrescriptionDto"] }
);
export function History(props: Props) {
  const { ctx, kind } = props,
    t = tradeMessages(ctx.locale),
    [open, setOpen] = useState(false),
    [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0),
    [result, setResult] = useState<{ url: string; data: Data }>(),
    [error, setError] = useState<number>();
  const id = "order" in props ? props.order.id : props.rx.id,
    patient = "rx" in props ? props.rx.patientId : undefined;
  const query = new URLSearchParams({ kind, id, page: String(page) });
  if (patient) query.set("patientId", patient);
  const url = ctx.endpoint + "/history?" + query;
  const data = result?.url === url ? result.data : undefined;
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    async function load() {
      setResult(undefined);
      setError(undefined);
      try {
        const r = await fetch(url, { signal: abort.signal, cache: "no-store", redirect: "error" });
        if (!r.ok) {
          if (!abort.signal.aborted) setError(r.status);
          return;
        }
        const list: Data = await r.json();
        if (!abort.signal.aborted) setResult({ url, data: list });
      } catch {
        if (!abort.signal.aborted) setError(503);
      }
    }
    void load();
    return () => abort.abort();
  }, [url, open, refresh]);
  const date = (value: string) =>
    new Intl.DateTimeFormat(ctx.locale, {
      dateStyle: "medium",
      timeStyle: "long",
      timeZone: "UTC",
    }).format(new Date(value));
  const amount = (value: string) => stockQuantity(value, ctx.locale);
  const warehouse = (id: string) => props.locations.options.find((o) => o.id === id)?.label ?? id;
  const label = t(
    kind === "receipts"
      ? "receiptHistory"
      : kind === "returns"
        ? "returnHistory"
        : "dispenseHistory",
  );
  return (
    <details className="directory-disclosure" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{label}</summary>
      {open && (
        <section aria-label={label}>
          <Button type="button" onClick={() => setRefresh((n) => n + 1)}>
            {t("refresh")}
          </Button>
          {error !== undefined ? (
            <p role="alert">{t(notice(error))}</p>
          ) : !data ? (
            <p role="status">{t("loading")}</p>
          ) : (
            <>
              {"receipts" in data &&
                "order" in props &&
                (data.receipts.length ? (
                  <ul className="directory-list">
                    {data.receipts.map((r) => (
                      <li key={r.id}>
                        <p>
                          {date(r.recordedAt)} · {r.author.subject}
                        </p>
                        {r.lines.map((l) => {
                          const item = props.order.lines.find((i) => i.itemId === l.itemId);
                          return (
                            <div key={l.movementId}>
                              <h4>{item?.itemName ?? l.itemId}</h4>
                              <p>
                                {amount(l.quantity)} {item?.unit} · {warehouse(l.warehouseId)} ·{" "}
                                {l.lot || t("noLot")}
                              </p>
                              <ReturnForm
                                ctx={ctx}
                                orderId={r.orderId}
                                line={l}
                                unit={item?.unit}
                              />
                            </div>
                          );
                        })}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{t("empty")}</p>
                ))}
              {"returns" in data &&
                (data.returns.length ? (
                  <ul className="directory-list">
                    {data.returns.map((r) => (
                      <li key={r.id}>
                        <strong>{r.reason}</strong>
                        <p>
                          {t("quantity")} · {amount(r.quantity)}
                        </p>
                        <p>
                          {t("receivedLine")} · {r.receiptMovementId}
                        </p>
                        <p>
                          {date(r.recordedAt)} · {r.author.subject}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{t("empty")}</p>
                ))}
              {"dispensings" in data &&
                "rx" in props &&
                (data.dispensings.length ? (
                  <ul className="directory-list">
                    {data.dispensings.map((d) => (
                      <li key={d.id}>
                        <strong>
                          {amount(d.quantity)} {props.rx.unit}
                        </strong>
                        <p>
                          {warehouse(d.warehouseId)} · {d.lot || t("noLot")}
                        </p>
                        <p>
                          {date(d.recordedAt)} · {d.author.subject}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{t("empty")}</p>
                ))}
              {(page > 1 || data.hasNextPage) && (
                <nav className="directory-paging" aria-label={t("pages")}>
                  <Button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>
                    {t("previous")}
                  </Button>
                  <span>{t("page", { n: page })}</span>
                  <Button
                    type="button"
                    disabled={!data.hasNextPage}
                    onClick={() => setPage(page + 1)}
                  >
                    {t("next")}
                  </Button>
                </nav>
              )}
            </>
          )}
        </section>
      )}
    </details>
  );
}
