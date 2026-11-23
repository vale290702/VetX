import { useCallback, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, Field, type AccessStyles } from "./controls";
import {
  Pager,
  PatientNotice,
  PatientReadState,
  usePatientAction,
  usePatientRead,
} from "./patient-controls";
import { updateReferral } from "./referral-client";
import {
  decisionInput,
  responseInput,
  referralMatches,
  type ReferralPage,
  type Referral,
  type Decision,
  type CounterReferral,
} from "./referral-forms";
import type { MobileAccount } from "./session";

type Role =
  | { kind: "outgoing" }
  | { kind: "incoming"; respond: (id: string, body: CounterReferral) => Promise<unknown> }
  | { kind: "owner"; decide: (id: string, body: Decision) => Promise<unknown> };
type Notice = "saved" | "changed";
type Common = { styles: AccessStyles; account: MobileAccount; role: Role };
export function ReferralList({
  account,
  styles,
  role,
  title,
  back,
  backLabel,
  loadPage,
  children,
}: Common & {
  title: string;
  back: () => void;
  backLabel: string;
  loadPage: (page: number) => Promise<ReferralPage>;
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1),
    [filter, setFilter] = useState(""),
    [expanded, setExpanded] = useState<string>(),
    [notice, setNotice] = useState<Notice>();
  const load = useCallback(() => loadPage(page), [loadPage, page]);
  const { result, reload } = usePatientRead(load);
  const rows = result && "value" in result ? result.value.referrals : undefined;
  const shown = rows?.filter((r) => referralMatches(r, filter));
  function refresh(message?: Notice) {
    setExpanded(undefined);
    setNotice(message);
    reload();
  }
  return (
    <View style={styles.section}>
      <Action styles={styles} label={backLabel} onPress={back} />
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      {children}
      {notice && (
        <Text accessibilityLiveRegion="polite" style={styles.support}>
          {t(`nativeReferrals.${notice}`)}
        </Text>
      )}
      {!rows || !result || "error" in result ? (
        <PatientReadState
          styles={styles}
          error={result && "error" in result ? result.error : undefined}
          retry={() => refresh()}
        />
      ) : (
        <>
          <Action styles={styles} label={t("nativeReferrals.refresh")} onPress={() => refresh()} />
          {rows.length > 0 && (
            <Field
              styles={styles}
              label={t("nativeReferrals.pageFilter")}
              disabled={false}
              maxLength={120}
              value={filter}
              onChange={setFilter}
            />
          )}
          {!rows.length && (
            <Text style={styles.support}>
              {t(
                role.kind === "owner"
                  ? "nativeReferrals.emptyOwner"
                  : role.kind === "incoming"
                    ? "nativeReferrals.emptyInbox"
                    : "nativeReferrals.emptyOutbox",
              )}
            </Text>
          )}
          {!!rows.length && !shown?.length && (
            <Text style={styles.support}>{t("nativeReferrals.noMatches")}</Text>
          )}
          {shown?.map((r) => (
            <View key={r.id} style={styles.row}>
              <Text accessibilityRole="header" style={styles.heading}>
                {r.patient.name} · {r.reason}
              </Text>
              <Text style={styles.support}>
                {r.source.clinicName} → {r.destination.clinicName}
              </Text>
              <Text style={styles.support}>
                {t(`nativeReferrals.status.${r.status}`)} ·{" "}
                {new Date(r.requestedAt).toLocaleDateString(i18n.language)}
              </Text>
              <Action
                styles={styles}
                expanded={expanded === r.id}
                label={t(expanded === r.id ? "nativeReferrals.hide" : "nativeReferrals.open", {
                  reason: r.reason,
                })}
                onPress={() => setExpanded(expanded === r.id ? undefined : r.id)}
              />
              {expanded === r.id && (
                <ReferralDetail
                  key={r.id + ":" + r.revision}
                  role={role}
                  account={account}
                  styles={styles}
                  record={r}
                  changed={refresh}
                />
              )}
            </View>
          ))}
          <Pager
            styles={styles}
            page={page}
            next={result.value.hasNextPage}
            change={(p) => {
              setExpanded(undefined);
              setNotice(undefined);
              setPage(p);
            }}
          />
        </>
      )}
    </View>
  );
}
const actions = ["approve", "decline", "withdraw"] as const;
function ReferralDetail({
  account,
  styles,
  role,
  record,
  changed,
}: Common & { record: Referral; changed: (status: Notice) => void }) {
  const { t, i18n } = useTranslation();
  const [decision, setDecision] = useState<Decision["action"]>(),
    [summary, setSummary] = useState("");
  const action = usePatientAction(account);
  const body = decision && decisionInput(record, decision);
  const response = responseInput(record, summary);
  const origin = record.source.clinicName + " · " + record.source.organizationName;
  const destination = record.destination.clinicName + " · " + record.destination.organizationName;
  const author = (a: Referral["requestedBy"]) => a.subject + " · " + a.issuer;
  function save(work: () => Promise<unknown>) {
    void action.run(() => updateReferral(work), changed);
  }
  return (
    <View style={styles.section}>
      <Text style={styles.support}>
        {t("nativeReferrals.patient", {
          name: record.patient.name,
          species: record.patient.species,
        })}
      </Text>
      <Text style={styles.support}>{t("nativeReferrals.source", { clinic: origin })}</Text>
      <Text style={styles.support}>{t("nativeReferrals.recipient", { clinic: destination })}</Text>
      <Text selectable style={styles.support}>
        {t("nativeReferrals.authored", {
          time: new Date(record.requestedAt).toLocaleString(i18n.language),
          author: author(record.requestedBy),
        })}
      </Text>
      {!!record.summary && (
        <>
          <Text style={styles.heading}>{t("nativeReferrals.summary")}</Text>
          <Text selectable style={styles.support}>
            {record.summary}
          </Text>
        </>
      )}
      {record.response && (
        <>
          <Text style={styles.heading}>{t("nativeReferrals.counter")}</Text>
          <Text selectable style={styles.support}>
            {record.response.summary}
          </Text>
          <Text selectable style={styles.support}>
            {t("nativeReferrals.authored", {
              time: new Date(record.response.recordedAt).toLocaleString(i18n.language),
              author: author(record.response.author),
            })}
          </Text>
        </>
      )}
      <PatientNotice styles={styles} error={action.error} />
      {role.kind === "owner" &&
        (body ? (
          <>
            <Text style={styles.support}>
              {t(`nativeReferrals.confirmText.${body.action}`, { clinic: destination })}
            </Text>
            <View style={styles.actions}>
              <Action
                styles={styles}
                primary
                busy={action.busy}
                label={t(`nativeReferrals.confirm.${body.action}`)}
                onPress={() => save(() => role.decide(record.id, body))}
              />
              <Action
                styles={styles}
                disabled={action.busy}
                label={t("directory.cancel")}
                onPress={() => {
                  setDecision(undefined);
                  action.clear();
                }}
              />
            </View>
          </>
        ) : (
          <View style={styles.actions}>
            {actions
              .filter((a) => decisionInput(record, a))
              .map((a) => (
                <Action
                  key={a}
                  styles={styles}
                  label={t(`nativeReferrals.action.${a}`)}
                  onPress={() => setDecision(a)}
                />
              ))}
          </View>
        ))}
      {role.kind === "incoming" && record.status === "APPROVED" && (
        <>
          <Field
            styles={styles}
            label={t("nativeReferrals.responseLabel")}
            value={summary}
            onChange={setSummary}
            maxLength={8000}
            multiline
            disabled={action.busy}
          />
          <Text style={styles.support}>
            {t("nativeReferrals.responseHelp", { clinic: origin })}
          </Text>
          <Action
            styles={styles}
            primary
            label={t("nativeReferrals.sendResponse")}
            busy={action.busy}
            disabled={!response}
            onPress={() => {
              if (response) save(() => role.respond(record.id, response));
            }}
          />
        </>
      )}
    </View>
  );
}
