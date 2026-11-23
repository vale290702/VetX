import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, Field } from "./controls";
import { importChoice, type Preview, type ImportDecision } from "./exchange-forms";
import { kindKey } from "./imported-history";
import {
  Pager,
  PatientNotice,
  PatientReadState,
  usePatientAction,
  usePatientRead,
} from "./patient-controls";
import type { ClinicPatientProps } from "./patient-form";
import type { PatientSummary } from "./patients";
type Props = ClinicPatientProps & {
  preview: Preview;
  back: () => void;
  openPatient: (id: string) => void;
};
type Target = { mode: "create" } | { mode: "match"; patient: PatientSummary };

function SearchResults({
  query,
  styles,
  client,
  scope,
  choice,
  choose,
  busy,
}: ClinicPatientProps & {
  query: string;
  choice?: Target;
  choose: (p: PatientSummary) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const load = useCallback(() => client.list(scope, page, query), [client, scope, query, page]);
  const { result, reload } = usePatientRead(load);
  if (!result || "error" in result)
    return <PatientReadState styles={styles} error={result?.error} retry={reload} />;
  return (
    <View style={styles.section}>
      {!result.value.patients.length && (
        <Text style={styles.support}>{t("nativePatients.emptyPatients")}</Text>
      )}
      {result.value.patients.map((p) => (
        <Action
          key={p.id}
          styles={styles}
          role="radio"
          selected={choice?.mode === "match" && choice.patient.id === p.id}
          disabled={busy}
          label={patientLabel(p)}
          onPress={() => choose(p)}
        />
      ))}
      {!busy && (
        <Pager page={page} next={result.value.hasNextPage} change={setPage} styles={styles} />
      )}
    </View>
  );
}
function patientLabel(p: PatientSummary) {
  return [p.name, p.species, p.birthDate, p.id].filter(Boolean).join(" · ");
}
function MappedPatient({
  id,
  choose,
  selected,
  busy,
  client,
  scope,
  styles,
}: ClinicPatientProps & {
  id: string;
  choose: (p: PatientSummary) => void;
  selected: boolean;
  busy: boolean;
}) {
  const load = useCallback(() => client.detail(scope, id), [client, scope, id]);
  const { result, reload } = usePatientRead(load);
  return !result || "error" in result ? (
    <PatientReadState styles={styles} retry={reload} error={result?.error} />
  ) : (
    <Action
      styles={styles}
      role="radio"
      selected={selected}
      disabled={busy}
      label={patientLabel(result.value.patient)}
      onPress={() => choose(result.value.patient)}
    />
  );
}
export function ImportReview({ preview, back, openPatient, ...props }: Props) {
  const { styles, account, scope, client } = props;
  const { t } = useTranslation();
  const [target, setTarget] = useState<Target>();
  const [text, setText] = useState(""),
    [search, setSearch] = useState("");
  const [complete, setComplete] = useState<{
    patientId: string;
    inserted: number;
    skipped: number;
  }>();
  const action = usePatientAction(account);
  const imported = complete?.patientId ?? preview.committedPatientId;
  const decision: ImportDecision | undefined =
    target?.mode === "match" ? { mode: "match", patientId: target.patient.id } : target;
  const choice = importChoice(preview, decision);
  const choose = (p: PatientSummary) => setTarget({ mode: "match", patient: p });
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeExchange.review")}
      </Text>
      <Text style={styles.heading}>
        {preview.patient.name} · {preview.patient.species}
        {preview.patient.birthDate ? " · " + preview.patient.birthDate : ""}
      </Text>
      <Text selectable style={styles.support}>
        {t("nativeExchange.original", {
          org: preview.source.organizationId,
          clinic: preview.source.clinicId,
          patient: preview.patient.id,
        })}
      </Text>
      <Text selectable style={styles.support}>
        {t("nativeExchange.packageId", { id: preview.packageId })}
      </Text>
      {preview.owner && (
        <Text style={styles.support}>
          {t("nativeExchange.owner", {
            name: [preview.owner.name, preview.owner.email].filter(Boolean).join(" · "),
          })}
        </Text>
      )}
      <Text style={styles.heading}>
        {t("nativeExchange.total", { count: preview.recordCount })}
      </Text>
      {preview.counts.map((c) => (
        <Text key={c.kind} style={styles.support}>
          {t(kindKey(c.kind))} · {c.count}
        </Text>
      ))}
      {imported ? (
        <>
          <Text style={styles.support} accessibilityLiveRegion="polite">
            {complete
              ? t("nativeExchange.result", {
                  inserted: complete.inserted,
                  skipped: complete.skipped,
                })
              : t("nativeExchange.alreadyImported")}
          </Text>
          <Action
            styles={styles}
            primary
            label={t("nativeExchange.openLocal")}
            onPress={() => openPatient(imported)}
          />
        </>
      ) : (
        <>
          <Text style={styles.support}>{t("nativeExchange.importDisclosure")}</Text>
          <Text accessibilityRole="header" style={styles.heading}>
            {t("nativeExchange.target")}
          </Text>
          {preview.mappedPatientId ? (
            <>
              <Text style={styles.support}>{t("nativeExchange.mapped")}</Text>
              <MappedPatient
                {...props}
                id={preview.mappedPatientId}
                selected={target?.mode === "match" && target.patient.id === preview.mappedPatientId}
                choose={choose}
                busy={action.busy}
              />
            </>
          ) : (
            <>
              {preview.candidates.length > 0 && (
                <Text style={styles.support}>{t("nativeExchange.suggested")}</Text>
              )}
              {preview.candidates.map((p) => (
                <Action
                  key={p.id}
                  styles={styles}
                  role="radio"
                  selected={target?.mode === "match" && target.patient.id === p.id}
                  disabled={action.busy}
                  label={patientLabel(p)}
                  onPress={() => choose(p)}
                />
              ))}
              <Field
                styles={styles}
                value={text}
                disabled={action.busy}
                maxLength={120}
                onChange={setText}
                label={t("nativePatients.searchLabel")}
              />
              <Action
                styles={styles}
                label={t("nativePatients.search")}
                disabled={action.busy || !text.trim()}
                onPress={() => setSearch(text.trim())}
              />
              {search && (
                <SearchResults
                  key={search}
                  {...props}
                  query={search}
                  choose={choose}
                  choice={target}
                  busy={action.busy}
                />
              )}
              <Action
                styles={styles}
                role="radio"
                selected={target?.mode === "create"}
                disabled={action.busy}
                label={t("nativeExchange.createNamed", { name: preview.patient.name })}
                onPress={() => setTarget({ mode: "create" })}
              />
            </>
          )}
          {target?.mode === "match" && (
            <Text style={styles.heading}>
              {t("nativeExchange.matchNamed", { name: patientLabel(target.patient) })}
            </Text>
          )}
          <PatientNotice styles={styles} error={action.error} />
          <Action
            styles={styles}
            primary
            busy={action.busy}
            disabled={!choice || action.error === "conflict" || action.error === "denied"}
            label={t("nativeExchange.confirmImport")}
            onPress={() => {
              if (choice)
                void action.run(
                  () => client.exchange.commit(scope, preview.receiptId, choice),
                  setComplete,
                );
            }}
          />
        </>
      )}
      <Action
        styles={styles}
        disabled={action.busy}
        label={t("nativeExchange.backToPackage")}
        onPress={back}
      />
    </View>
  );
}
