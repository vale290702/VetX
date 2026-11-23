"use client";
import { sharingOptions } from "../care/forms.ts";
import { Write, Disclosure, Picker, Quantity, Refresh, type Context } from "./controls";
import { tradeMessages } from "./messages.ts";
import type { Schema, Choices } from "./forms.ts";
export function GrantForm({ ctx, grant }: { ctx: Context; grant: Schema["CapabilityDto"] }) {
  const t = tradeMessages(ctx.locale);
  return (
    <Write
      ctx={ctx}
      action="grant"
      label={t("saveAccess")}
      fields={(d) => ({
        subject: grant.subject,
        revision: grant.revision,
        canPrescribe: d.has("prescribe"),
        canDispense: d.has("dispense"),
      })}
    >
      <label className="clinic-check">
        <input
          type="checkbox"
          name="prescribe"
          disabled={!grant.clinicAccess && !grant.canPrescribe}
          defaultChecked={grant.canPrescribe}
        />
        {t("canPrescribe")}
      </label>
      <label className="clinic-check">
        <input
          type="checkbox"
          name="dispense"
          disabled={!grant.clinicAccess && !grant.canDispense}
          defaultChecked={grant.canDispense}
        />
        {t("canDispense")}
      </label>
    </Write>
  );
}
export function Prescribe({
  ctx,
  patientId,
  catalog,
}: {
  ctx: Context;
  patientId: string;
  catalog: Choices;
}) {
  const t = tradeMessages(ctx.locale);
  if (!catalog.options.length) return <p>{t("noItems")}</p>;
  return (
    <Disclosure label={t("prescribe")}>
      <Write
        ctx={ctx}
        action="prescribe"
        label={t("prescribe")}
        fields={(d) => ({
          patientId,
          itemId: d.get("item"),
          expectedUnit: d.get("unit"),
          quantity: d.get("quantity"),
          medication: d.get("medication"),
          instructions: d.get("instructions"),
        })}
      >
        <Picker
          ctx={ctx}
          kind="items"
          initial={catalog}
          name="item"
          unitName="unit"
          label={t("item")}
        />
        <label>
          {t("medication")}
          <input name="medication" required maxLength={250} />
        </label>
        <label>
          {t("directions")}
          <textarea name="instructions" required maxLength={8000} rows={4} />
        </label>
        <Quantity ctx={ctx} />
      </Write>
    </Disclosure>
  );
}
export function Dispense({
  ctx,
  rx,
  locations,
}: {
  ctx: Context;
  rx: Schema["PrescriptionDto"];
  locations: Choices;
}) {
  const t = tradeMessages(ctx.locale);
  return (
    <Disclosure label={t("dispense")}>
      <Write
        ctx={ctx}
        action="dispense"
        label={t("dispense")}
        fields={(d) => ({
          patientId: rx.patientId,
          rxId: rx.id,
          warehouseId: d.get("warehouse"),
          quantity: d.get("quantity"),
          lot: d.get("lot"),
        })}
      >
        <Picker
          ctx={ctx}
          kind="warehouses"
          initial={locations}
          name="warehouse"
          label={t("warehouse")}
        />
        <label>
          {t("lot")}
          <input name="lot" maxLength={120} />
        </label>
        <Quantity ctx={ctx} unit={rx.unit} />
      </Write>
    </Disclosure>
  );
}
export function Share({
  ctx,
  rx,
  guardians,
}: {
  ctx: Context;
  rx: Schema["PrescriptionDto"];
  guardians: Schema["GuardianDto"][];
}) {
  const t = tradeMessages(ctx.locale),
    linked = sharingOptions(guardians, rx.sharing.guardianIds);
  if (!linked)
    return (
      <Disclosure label={t("sharing")}>
        <p>{t("refreshGuardians")}</p>
        <Refresh locale={ctx.locale} />
      </Disclosure>
    );
  return (
    <Disclosure label={t("sharing")}>
      <Write
        ctx={ctx}
        id={rx.id}
        action="share"
        label={t("share")}
        fields={(d) => ({
          patientId: rx.patientId,
          rxId: rx.id,
          revision: rx.sharing.revision,
          guardianIds: d.getAll("guardian"),
        })}
      >
        {linked.length ? (
          <fieldset className="directory-form">
            <legend>{t("guardians")}</legend>
            {linked.map((g) => (
              <label key={g.id} className="clinic-check">
                <input
                  name="guardian"
                  type="checkbox"
                  value={g.id}
                  defaultChecked={rx.sharing.guardianIds.includes(g.id)}
                />
                {g.name} · {g.email}
              </label>
            ))}
          </fieldset>
        ) : (
          <p>{t("noGuardians")}</p>
        )}
      </Write>
    </Disclosure>
  );
}
