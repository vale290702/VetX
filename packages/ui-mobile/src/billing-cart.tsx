import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, Field } from "./controls";
import type { ClinicPatientProps } from "./patient-form";
import { PatientNotice, usePatientAction } from "./patient-controls";
import { Warehouses, Balances } from "./inventory-lists";
import type { Balance, Warehouse } from "./inventory-forms";
import { BillingRows, GoBack, Heading, Submit, Totals, useBillingWrite } from "./billing-controls";
import { PatientError } from "./patient-transport";
import { Prices } from "./billing-prices";
import {
  lineFitsStock,
  formatDecimal,
  quoteCart,
  refreshLines,
  saleBody,
  type CartLine,
  type Price,
  type Sale,
  type SaleInput,
} from "./billing-forms";

function PatientChoice(
  props: ClinicPatientProps & {
    select: (p: { id: string; name: string }) => void;
    back: () => void;
  },
) {
  const { t } = useTranslation(),
    { styles, scope, client } = props,
    [text, setText] = useState(""),
    [query, setQuery] = useState("");
  const load = useCallback(
    async (page: number) => {
      const r = await client.list(scope, page, query);
      return { rows: r.patients, hasNextPage: r.hasNextPage };
    },
    [client, scope, query],
  );
  return (
    <View style={styles.section}>
      <GoBack styles={styles} onPress={props.back} />
      <Field
        styles={styles}
        label={t("nativePatients.searchLabel")}
        value={text}
        maxLength={120}
        disabled={false}
        onChange={setText}
      />
      <Action
        styles={styles}
        label={t("nativePatients.search")}
        onPress={() => setQuery(text.trim())}
      />
      <BillingRows
        key={query}
        styles={styles}
        load={load}
        empty={t("nativePatients.emptyPatients")}
        render={(p) => (
          <Action
            styles={styles}
            label={p.name + " · " + p.species}
            onPress={() => props.select(p)}
          />
        )}
      />
    </View>
  );
}

function CartItem(
  props: ClinicPatientProps & {
    line: CartLine;
    others: CartLine[];
    save: (l: CartLine) => void;
    back: () => void;
  },
) {
  const { t, i18n } = useTranslation(),
    { styles, others } = props,
    [line, setLine] = useState(props.line);
  const [picking, setPicking] = useState(false),
    [warehouse, setWarehouse] = useState<Warehouse>();
  const quote = quoteCart([line]);
  const fits = lineFitsStock(line, others);
  const canAdd = !!quote && fits;
  if (picking)
    return (
      <View style={styles.section}>
        <GoBack
          styles={styles}
          onPress={() => {
            if (warehouse) setWarehouse(undefined);
            else setPicking(false);
          }}
        />
        {warehouse ? (
          <>
            <Heading styles={styles}>{warehouse.name}</Heading>
            <Balances
              {...props}
              warehouseId={warehouse.id}
              itemId={line.price.stockItemId!}
              render={(b) => (
                <Action
                  styles={styles}
                  label={t("nativeBilling.lotSummary", {
                    lot: b.lot || t("nativeBilling.noLot"),
                    quantity: formatDecimal(b.quantity, i18n.language),
                    unit: b.unit,
                  })}
                  disabled={b.unit !== line.price.unit || /^0(?:\.0+)?$/.test(b.quantity)}
                  onPress={() => {
                    setLine({ ...line, balance: b });
                    setPicking(false);
                  }}
                />
              )}
            />
          </>
        ) : (
          <>
            <Heading styles={styles}>{t("nativeBilling.selectWarehouse")}</Heading>
            <Warehouses
              {...props}
              render={(w) => (
                <Action styles={styles} label={w.name} onPress={() => setWarehouse(w)} />
              )}
            />
          </>
        )}
      </View>
    );
  return (
    <View style={styles.section}>
      <GoBack styles={styles} onPress={props.back} />
      <Heading styles={styles}>{line.price.name}</Heading>
      <Text style={styles.support}>
        {t("nativeBilling.priceSummary", {
          amount: formatDecimal(line.price.unitPrice, i18n.language),
          currency: line.price.currency,
          unit: line.price.unit,
          rate: formatDecimal(line.price.taxRate, i18n.language),
          cabys: line.price.cabys,
        })}
      </Text>
      {!!line.price.stockItemId && (
        <>
          {line.balance && (
            <Text style={styles.support}>
              {line.balance.warehouseName +
                " · " +
                t("nativeBilling.lotSummary", {
                  lot: line.balance.lot || t("nativeBilling.noLot"),
                  quantity: formatDecimal(line.balance.quantity, i18n.language),
                  unit: line.balance.unit,
                })}
            </Text>
          )}
          <Action
            styles={styles}
            label={t("nativeBilling.selectLot")}
            onPress={() => {
              setWarehouse(undefined);
              setPicking(true);
            }}
          />
        </>
      )}
      <Field
        styles={styles}
        label={t("nativeBilling.quantity", { unit: line.price.unit })}
        inputMode="decimal"
        identifier
        value={line.quantity}
        onChange={(quantity) => setLine({ ...line, quantity })}
        maxLength={17}
        disabled={false}
      />
      {quote && line.balance && !fits && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("nativeBilling.insufficientLot")}
        </Text>
      )}
      {quote && <Totals styles={styles} values={quote} currency={line.price.currency} />}
      <Action
        styles={styles}
        primary
        label={t("nativeBilling.saveLine")}
        disabled={!canAdd}
        onPress={() => props.save(line)}
      />
    </View>
  );
}
async function reviewLines(props: ClinicPatientProps, lines: CartLine[]) {
  const { client, scope } = props,
    prices = new Map<string, Price>(),
    balances: Balance[] = [];
  const need = new Set(lines.map((x) => x.price.id));
  for (let page = 1; need.size; page++) {
    const r = await client.billing.prices(scope, page, "");
    for (const price of r.prices) if (need.delete(price.id)) prices.set(price.id, price);
    if (!r.hasNextPage) break;
  }
  for (const id of new Set(lines.flatMap((x) => (x.balance ? [x.balance.warehouseId] : [])))) {
    const wanted = new Set(
      lines
        .filter((l) => l.balance?.warehouseId === id)
        .map((l) => JSON.stringify([l.balance!.itemId, l.balance!.lot])),
    );
    for (let page = 1; wanted.size; page++) {
      const r = await client.inventory.balances(scope, id, page);
      for (const b of r.balances)
        if (wanted.delete(JSON.stringify([b.itemId, b.lot]))) balances.push(b);
      if (!r.hasNextPage) break;
    }
  }
  return refreshLines(lines, prices, balances);
}
export function Checkout(
  props: ClinicPatientProps & { back: () => void; openSale: (id: string) => void },
) {
  const { t, i18n } = useTranslation(),
    { account, scope, client, styles } = props;
  const [lines, setLines] = useState<CartLine[]>([]),
    [patient, setPatient] = useState<{ id: string; name: string }>(),
    [pick, setPick] = useState<"patient" | "price">(),
    [edit, setEdit] = useState<CartLine>();
  const write = useBillingWrite<SaleInput, Sale>(
    account,
    (id, body) => client.billing.checkout(scope, id, body),
    (s) => props.openSale(s.id),
  );
  const [missing, setMissing] = useState(false);
  const read = usePatientAction(account),
    locked = !!write.pending || read.busy;
  const body = saleBody(patient?.id ?? null, lines),
    quote = quoteCart(lines);
  if (edit)
    return (
      <CartItem
        {...props}
        line={edit}
        others={lines.filter((l) => l.key !== edit.key)}
        save={(line) => {
          setLines((ls) =>
            ls.some((l) => l.key === line.key)
              ? ls.map((l) => (l.key === line.key ? line : l))
              : [...ls, line],
          );
          setEdit(undefined);
        }}
        back={() => setEdit(undefined)}
      />
    );
  if (pick === "price")
    return (
      <View style={styles.section}>
        <GoBack styles={styles} onPress={() => setPick(undefined)} />
        <Heading styles={styles}>{t("nativeBilling.addLine")}</Heading>
        <Prices
          {...props}
          render={(price) => (
            <Action
              styles={styles}
              label={t("nativeBilling.addNamed", { name: price.name })}
              disabled={!!lines.length && lines[0]!.price.currency !== price.currency}
              onPress={() => {
                setPick(undefined);
                setEdit({ key: globalThis.expo.uuidv4(), price, quantity: "1" });
              }}
            />
          )}
        />
      </View>
    );
  if (pick === "patient")
    return (
      <PatientChoice
        {...props}
        select={(p) => {
          setPatient(p);
          setPick(undefined);
        }}
        back={() => setPick(undefined)}
      />
    );
  return (
    <View style={styles.section}>
      <GoBack styles={styles} disabled={locked} onPress={props.back} />
      <Heading styles={styles}>{t("nativeBilling.checkout")}</Heading>
      {write.issue !== "denied" && (
        <>
          <Text style={styles.support}>
            {patient
              ? t("nativeBilling.patient", { name: patient.name })
              : t("nativeBilling.anonymous")}
          </Text>
          <View style={styles.actions}>
            <Action
              styles={styles}
              disabled={locked}
              label={t("nativeBilling.choosePatient")}
              onPress={() => setPick("patient")}
            />
            {patient && (
              <Action
                styles={styles}
                disabled={locked}
                label={t("nativeBilling.clearPatient")}
                onPress={() => setPatient(undefined)}
              />
            )}
          </View>
          {lines.map((line) => (
            <View key={line.key} style={styles.row}>
              <Heading styles={styles}>{line.price.name}</Heading>
              <Text style={styles.support}>
                {t("nativeBilling.cartLine", {
                  quantity: formatDecimal(line.quantity.replace(",", "."), i18n.language),
                  unit: line.price.unit,
                  amount: formatDecimal(line.price.unitPrice, i18n.language),
                  currency: line.price.currency,
                })}
              </Text>
              <Text style={styles.support}>
                {t("nativeBilling.lineTax", {
                  rate: formatDecimal(line.price.taxRate, i18n.language),
                  cabys: line.price.cabys,
                })}
              </Text>
              {line.balance && (
                <Text style={styles.support}>
                  {line.balance.warehouseName +
                    " · " +
                    (line.balance.lot || t("nativeBilling.noLot"))}
                </Text>
              )}
              {line.unavailable && (
                <Text style={styles.error}>{t("nativeBilling.unavailablePrice")}</Text>
              )}
              <View style={styles.actions}>
                <Action
                  styles={styles}
                  disabled={locked || line.unavailable}
                  label={t("nativeBilling.editNamed", { name: line.price.name })}
                  onPress={() => setEdit(line)}
                />
                <Action
                  styles={styles}
                  disabled={locked}
                  label={t("nativeBilling.removeNamed", { name: line.price.name })}
                  onPress={() => setLines(lines.filter((l) => l.key !== line.key))}
                />
              </View>
            </View>
          ))}
          <Action
            styles={styles}
            label={t("nativeBilling.addLine")}
            disabled={locked || lines.length >= 1000}
            onPress={() => setPick("price")}
          />
          {lines.length > 0 && quote && (
            <Totals styles={styles} values={quote} currency={lines[0]!.price.currency} />
          )}
        </>
      )}
      <Submit
        styles={styles}
        state={write}
        valid={!!body && !read.busy}
        label={t("nativeBilling.issueInvoice")}
        onPress={() => {
          setMissing(false);
          write.submit(body);
        }}
      />
      {write.pending && !write.busy && (
        <Action
          styles={styles}
          busy={read.busy}
          label={t("nativeBilling.checkSale")}
          onPress={() => {
            const id = write.pending!.id;
            void read.run(
              async () => {
                try {
                  return await client.billing.sale(scope, id);
                } catch (err) {
                  if (err instanceof PatientError && err.status === 404) return null;
                  throw err;
                }
              },
              (sale) => {
                if (sale) props.openSale(sale.id);
                else setMissing(true);
              },
            );
          }}
        />
      )}
      {missing && write.pending && (
        <Text accessibilityRole="alert" style={styles.support}>
          {t("nativeBilling.notRecorded")}
        </Text>
      )}
      {lines.length > 0 && !write.pending && write.issue !== "denied" && (
        <Action
          styles={styles}
          busy={read.busy}
          label={t("nativeBilling.reviewCart")}
          onPress={() =>
            void read.run(
              () => reviewLines(props, lines),
              (ls) => {
                setLines(ls);
                write.clear();
              },
            )
          }
        />
      )}
      <PatientNotice styles={styles} error={read.error} />
    </View>
  );
}
