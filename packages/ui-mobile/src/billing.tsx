import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ClinicPatientProps } from "./patient-form";
import { Action } from "./controls";
import { GoBack, Heading } from "./billing-controls";
import { PriceCatalog } from "./billing-prices";
import { Checkout } from "./billing-cart";
import { Invoice, Invoices } from "./billing-invoices";
import { Drawers } from "./billing-drawers";

type Screen = "checkout" | "prices" | "invoices" | "drawers";
export function ClinicBilling(
  props: ClinicPatientProps & { back: () => void; admin: boolean | undefined },
) {
  const { t } = useTranslation(),
    [section, setSection] = useState<Screen>(),
    [saleId, setSaleId] = useState<string>(),
    { styles } = props;
  const back = () => setSection(undefined);
  if (saleId)
    return (
      <Invoice
        {...props}
        id={saleId}
        back={() => {
          setSaleId(undefined);
          setSection("invoices");
        }}
      />
    );
  if (section === "checkout") return <Checkout {...props} back={back} openSale={setSaleId} />;
  if (section === "prices") return <PriceCatalog {...props} back={back} />;
  if (section === "invoices") return <Invoices {...props} back={back} openSale={setSaleId} />;
  if (section === "drawers") return <Drawers {...props} back={back} />;
  return (
    <View style={styles.section}>
      <GoBack styles={styles} onPress={props.back} />
      <Heading styles={styles}>{t("nativeBilling.title")}</Heading>
      {(["checkout", "invoices", "drawers", "prices"] as const).map((key) => (
        <Action
          key={key}
          styles={styles}
          primary={key === "checkout"}
          label={t(`nativeBilling.${key}`)}
          onPress={() => setSection(key)}
        />
      ))}
    </View>
  );
}
