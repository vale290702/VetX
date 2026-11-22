import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { appointmentBody, type AppointmentEditorState, type Patient } from "./care-forms";
import { dayRange, localDay, localMinute, minuteInstant, moveDay } from "./care-time";
import { Action, Field } from "./controls";
import {
  Pager,
  PatientNotice,
  PatientReadState,
  usePatientAction,
  usePatientRead,
} from "./patient-controls";
import type { ClinicPatientProps } from "./patient-form";

function AppointmentEditor({
  editor,
  day,
  close,
  ...props
}: ClinicPatientProps & {
  editor: AppointmentEditorState;
  day: string;
  close: (savedOn?: string) => void;
}) {
  const { account, scope, client, styles } = props;
  const { t, i18n } = useTranslation();
  const action = usePatientAction(account);
  const visit = editor.kind === "book" ? editor.original : editor.visit;
  const [start, setStart] = useState(() =>
    visit ? localMinute(new Date(visit.startAt)) : day + " 09:00",
  );
  const [end, setEnd] = useState(() =>
    visit ? localMinute(new Date(visit.endAt)) : day + " 09:30",
  );
  const [reason, setReason] = useState(visit?.reason ?? "");
  const startAt = minuteInstant(start, visit?.startAt);
  const endAt = minuteInstant(end, visit?.endAt);
  const ordered = Boolean(startAt && endAt && Date.parse(endAt) > Date.parse(startAt));
  const blocked = action.error === "conflict" || action.error === "denied";
  const body = appointmentBody(editor, startAt, endAt, reason);
  function submit() {
    if (!body) return;
    const id = editor.kind === "finish" ? editor.visit.id : editor.id;
    void action.run(
      () => client.care.book(scope, id, body),
      (updated) => close(editor.kind === "finish" ? day : localDay(new Date(updated.startAt))),
    );
  }
  const title =
    editor.kind === "finish"
      ? t(editor.status === "CANCELLED" ? "nativeCare.cancelVisit" : "nativeCare.completeVisit")
      : t(editor.original ? "nativeCare.reschedule" : "nativeCare.schedule");
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      {editor.kind === "finish" ? (
        <Text style={styles.support}>
          {t(
            editor.status === "CANCELLED"
              ? "nativeCare.confirmCancel"
              : "nativeCare.confirmComplete",
            {
              name: editor.visit.patientName,
              reason: editor.visit.reason,
              time: new Date(editor.visit.startAt).toLocaleString(i18n.language),
            },
          )}
        </Text>
      ) : (
        <>
          <Text style={styles.heading}>{editor.patient.name}</Text>
          <Text style={styles.support}>
            {t("nativeCare.timeHelp", { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
          </Text>
          <Field
            styles={styles}
            identifier
            disabled={action.busy}
            label={t("nativeCare.starts")}
            value={start}
            maxLength={16}
            onChange={setStart}
          />
          <Field
            styles={styles}
            identifier
            disabled={action.busy}
            label={t("nativeCare.ends")}
            value={end}
            maxLength={16}
            onChange={setEnd}
          />
          {(!startAt || !endAt || !ordered) && (
            <Text style={styles.error}>
              {t(!startAt || !endAt ? "nativeCare.invalidTime" : "nativeCare.orderTimes")}
            </Text>
          )}
          <Field
            styles={styles}
            disabled={action.busy}
            label={t("nativeCare.visitReason")}
            value={reason}
            maxLength={250}
            onChange={setReason}
          />
        </>
      )}
      <PatientNotice styles={styles} error={action.error} />
      <View style={styles.actions}>
        <Action
          styles={styles}
          primary={editor.kind === "book" || editor.status === "COMPLETED"}
          destructive={editor.kind === "finish" && editor.status === "CANCELLED"}
          label={editor.kind === "finish" ? title : t("nativeCare.saveVisit")}
          busy={action.busy}
          disabled={blocked || !body}
          onPress={submit}
        />
        <Action
          styles={styles}
          label={t("nativeCare.backCalendar")}
          disabled={action.busy}
          onPress={() => close()}
        />
      </View>
    </View>
  );
}

export function Appointments({
  patient,
  back,
  ...props
}: ClinicPatientProps & { patient?: Patient; back: () => void }) {
  const { styles, client, scope } = props;
  const { t, i18n } = useTranslation();
  const [day, setDay] = useState(() => localDay());
  const [input, setInput] = useState(day);
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<AppointmentEditorState>();
  const [saved, setSaved] = useState(false);
  const patientId = patient?.id;
  const load = useCallback(async () => {
    const range = dayRange(day);
    if (!range) throw new Error("Invalid calendar date");
    return client.care.appointments(scope, range, page, patientId);
  }, [client, scope, day, page, patientId]);
  const { result, reload } = usePatientRead(load);
  function showDay(value: string) {
    if (!dayRange(value)) return;
    setDay(value);
    setInput(value);
    setPage(1);
    setSaved(false);
  }
  if (editor)
    return (
      <AppointmentEditor
        {...props}
        editor={editor}
        day={day}
        close={(savedOn) => {
          setEditor(undefined);
          if (savedOn) showDay(savedOn);
          setSaved(Boolean(savedOn));
          reload();
        }}
      />
    );
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <View style={styles.section}>
      <View style={styles.actions}>
        <Action
          styles={styles}
          label={t(patient ? "nativeCare.backPatient" : "nativePatients.backPatients")}
          onPress={back}
        />
      </View>
      <Text accessibilityRole="header" style={styles.heading}>
        {t(patient ? "nativeCare.appointments" : "nativeCare.calendar")}
      </Text>
      {saved && (
        <Text accessibilityLiveRegion="polite" style={styles.support}>
          {t("directory.saved")}
        </Text>
      )}
      <Text style={styles.heading}>
        {new Date(day + "T12:00:00").toLocaleDateString(i18n.language, {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })}{" "}
        · {zone}
      </Text>
      <View style={styles.actions}>
        <Action
          styles={styles}
          label={t("nativeCare.prevDay")}
          onPress={() => showDay(moveDay(day, -1))}
        />
        <Action styles={styles} label={t("nativeCare.today")} onPress={() => showDay(localDay())} />
        <Action
          styles={styles}
          label={t("nativeCare.nextDay")}
          onPress={() => showDay(moveDay(day, 1))}
        />
      </View>
      <Field
        styles={styles}
        disabled={false}
        identifier
        label={t("nativeCare.jumpDate")}
        value={input}
        onChange={setInput}
        maxLength={10}
      />
      <View style={styles.actions}>
        <Action
          styles={styles}
          label={t("nativeCare.showDay")}
          disabled={!dayRange(input)}
          onPress={() => {
            showDay(input);
            reload();
          }}
        />
        {patient && (
          <Action
            styles={styles}
            primary
            label={t("nativeCare.schedule")}
            disabled={!result || "error" in result}
            onPress={() => setEditor({ kind: "book", id: globalThis.expo.uuidv4(), patient })}
          />
        )}
      </View>
      {!result || "error" in result ? (
        <PatientReadState styles={styles} error={result?.error} retry={reload} />
      ) : (
        <>
          {!result.value.appointments.length && (
            <Text style={styles.support}>{t("nativeCare.noVisits")}</Text>
          )}
          {result.value.appointments.map((visit) => (
            <View key={visit.id} style={styles.row}>
              <Text accessibilityRole="header" style={styles.heading}>
                {visit.patientName} · {visit.reason}
              </Text>
              <Text style={styles.support}>
                {new Date(visit.startAt).toLocaleString(i18n.language)} –{" "}
                {new Date(visit.endAt).toLocaleString(i18n.language)}
              </Text>
              <Text style={styles.support}>{t(`nativeCare.${visit.status}`)}</Text>
              {visit.status === "BOOKED" && (
                <View style={styles.actions}>
                  <Action
                    styles={styles}
                    label={t("nativeCare.reschedule")}
                    onPress={() =>
                      setEditor({
                        kind: "book",
                        id: visit.id,
                        patient: { id: visit.patientId, name: visit.patientName },
                        original: visit,
                      })
                    }
                  />
                  <Action
                    styles={styles}
                    label={t("nativeCare.completeVisit")}
                    onPress={() => setEditor({ kind: "finish", visit, status: "COMPLETED" })}
                  />
                  <Action
                    styles={styles}
                    destructive
                    label={t("nativeCare.cancelVisit")}
                    onPress={() => setEditor({ kind: "finish", visit, status: "CANCELLED" })}
                  />
                </View>
              )}
            </View>
          ))}
          <Pager styles={styles} page={page} next={result.value.hasNextPage} change={setPage} />
        </>
      )}
    </View>
  );
}
