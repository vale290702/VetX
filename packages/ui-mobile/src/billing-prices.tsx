import { useCallback, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, Field } from "./controls";
import type { ClinicPatientProps } from "./patient-form";
import { Items } from "./inventory-lists";
import { BillingRows, GoBack, Heading, Submit, useBillingWrite } from "./billing-controls";
import { formatDecimal, priceBody, type Price, type PriceInput } from "./billing-forms";
export function Prices({
  client,
  scope,
  styles,
  render,
}: { render: (p: Price) => ReactNode } & ClinicPatientProps) {
  const { t, i18n } = useTranslation(),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const load = useCallback(
    async (page: number) => {
      const r = await client.billing.prices(scope, page, query);
      return { rows: r.prices, hasNextPage: r.hasNextPage };
    },
    [client, scope, query],
  );
  return (
    <View style={styles.section}>
      <Field
        styles={styles}
        disabled={false}
        label={t("nativeBilling.searchPrices")}
        value={search}
        onChange={setSearch}
        maxLength={120}
      />
      <Action
        styles={styles}
        label={t("nativePatients.search")}
        onPress={() => setQuery(search.trim())}
      />
      <BillingRows
        key={query}
        styles={styles}
        load={load}
        empty={t("nativeBilling.emptyPrices")}
        render={(price) => (
          <>
            <Heading styles={styles}>{price.name}</Heading>
            <Text style={styles.support}>
              {t("nativeBilling.priceSummary", {
                amount: formatDecimal(price.unitPrice, i18n.language),
                currency: price.currency,
                unit: price.unit,
                rate: formatDecimal(price.taxRate, i18n.language),
                cabys: price.cabys,
              })}
            </Text>
            {render(price)}
          </>
        )}
      />
    </View>
  );
}
const blank: PriceInput = {
  name: "",
  unit: "",
  currency: "CRC",
  unitPrice: "",
  taxRate: "",
  cabys: "",
  stockItemId: null,
  revision: 0,
};
export function PriceCatalog(
  props: ClinicPatientProps & { admin: boolean | undefined; back: () => void },
) {
  const { t } = useTranslation(),
    [edit, setEdit] = useState<Price | "new">(),
    { styles, admin } = props;
  if (edit && admin)
    return (
      <PriceEditor
        {...props}
        existing={edit === "new" ? undefined : edit}
        back={() => setEdit(undefined)}
      />
    );
  return (
    <View style={styles.section}>
      <GoBack styles={styles} onPress={props.back} />
      <Heading styles={styles}>{t("nativeBilling.prices")}</Heading>
      {admin && (
        <Action
          styles={styles}
          label={t("nativeBilling.newPrice")}
          onPress={() => setEdit("new")}
        />
      )}
      <Prices
        {...props}
        render={(p) =>
          admin && (
            <Action
              styles={styles}
              label={t("nativeBilling.editPrice", { name: p.name })}
              onPress={() => setEdit(p)}
            />
          )
        }
      />
    </View>
  );
}
function PriceEditor(props: ClinicPatientProps & { existing?: Price; back: () => void }) {
  const { t } = useTranslation(),
    { account, client, scope, styles, existing, back } = props;
  const [draft, setDraft] = useState<PriceInput>(existing ?? blank),
    [pick, setPick] = useState(false),
    [itemName, setItemName] = useState(existing?.stockItemId ?? "");
  const write = useBillingWrite<PriceInput, Price>(
    account,
    (id, b) => client.billing.price(scope, id, b),
    back,
  );
  const body = priceBody(draft),
    locked = !!write.pending;
  if (pick)
    return (
      <View style={styles.section}>
        <GoBack styles={styles} onPress={() => setPick(false)} />
        <Heading styles={styles}>{t("nativeBilling.selectItem")}</Heading>
        <Items
          {...props}
          render={(i) => (
            <Action
              styles={styles}
              label={i.name + " · " + i.sku + " · " + i.unit}
              onPress={() => {
                setDraft({ ...draft, stockItemId: i.id, unit: i.unit });
                setItemName(i.name + " · " + i.sku);
                setPick(false);
              }}
            />
          )}
        />
      </View>
    );
  return (
    <View style={styles.section}>
      <GoBack styles={styles} onPress={back} disabled={locked} />
      <Heading styles={styles}>
        {existing
          ? t("nativeBilling.editPrice", { name: existing.name })
          : t("nativeBilling.newPrice")}
      </Heading>
      {write.issue !== "denied" && (
        <>
          <Action
            styles={styles}
            label={t("nativeBilling.service")}
            role="radio"
            selected={!draft.stockItemId}
            disabled={locked}
            onPress={() => {
              setDraft({ ...draft, stockItemId: null, unit: "" });
              setItemName("");
            }}
          />
          <Action
            styles={styles}
            label={
              draft.stockItemId
                ? t("nativeBilling.linkedItem", { name: itemName })
                : t("nativeBilling.selectItem")
            }
            disabled={locked}
            onPress={() => setPick(true)}
          />
          {(["name", "unit", "currency", "unitPrice", "taxRate", "cabys"] as const).map((k) => (
            <Field
              key={k}
              styles={styles}
              label={t(`nativeBilling.fields.${k}`)}
              value={draft[k]}
              disabled={locked || (k === "unit" && !!draft.stockItemId)}
              maxLength={
                k === "name"
                  ? 120
                  : k === "unit"
                    ? 40
                    : k === "currency"
                      ? 3
                      : k === "cabys"
                        ? 13
                        : 19
              }
              identifier={k !== "name" && k !== "unit"}
              inputMode={
                k === "unitPrice" || k === "taxRate"
                  ? "decimal"
                  : k === "cabys"
                    ? "numeric"
                    : "text"
              }
              onChange={(v) => setDraft({ ...draft, [k]: v })}
            />
          ))}
        </>
      )}
      <Submit
        styles={styles}
        state={write}
        valid={!!body}
        label={t("nativeBilling.savePrice")}
        onPress={() => write.submit(body, existing?.id)}
      />
      {write.issue === "conflict" && (
        <Action styles={styles} label={t("nativeBilling.reviewPrices")} onPress={back} />
      )}
    </View>
  );
}
