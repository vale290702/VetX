import { randomUUID } from "node:crypto";
import { Button } from "@vetx/ui-web";
import { getTranslations } from "next-intl/server";
import { Link } from "../i18n/routing";
import { Fields, SaveForm, endpoint, type CareFormContext } from "./controls";
import { getWebAuthRuntime } from "../auth/runtime.ts";
import { signAppointment } from "./appointment-snapshot.ts";
import { carePath } from "./forms.ts";
import { displayTime, localInput } from "./time.ts";
import type { Appointment } from "./api.ts";

function ViewedAppointment({
  appointment,
  context,
}: {
  appointment: Appointment;
  context: CareFormContext;
}) {
  const runtime = getWebAuthRuntime();
  if (!runtime) throw new Error("Staff session configuration is unavailable");
  const value = signAppointment(
    appointment,
    context.scope,
    context.csrf,
    runtime.config.clientSecret,
  );
  return <input type="hidden" name="viewedAppointment" value={value} />;
}

export async function AppointmentForm({
  context,
  patientId,
  appointment,
  day,
  page,
}: {
  context: CareFormContext;
  patientId: string;
  appointment?: Appointment;
  day?: string;
  page?: number;
}) {
  const t = await getTranslations("care");
  return (
    <details className="directory-disclosure">
      <summary>{t(appointment ? "reschedule" : "book")}</summary>
      <SaveForm context={context} label={appointment ? "saveAppointment" : "book"}>
        <Fields context={context} patientId={patientId} />
        <input type="hidden" name="appointmentId" value={appointment?.id ?? randomUUID()} />
        <input type="hidden" name="revision" value={appointment?.revision ?? 0} />
        {appointment && <ViewedAppointment appointment={appointment} context={context} />}
        <input type="hidden" name="action" value="book" />
        {day && (
          <>
            <input type="hidden" name="source" value="calendar" />
            <input type="hidden" name="day" value={day} />
            <input type="hidden" name="page" value={page} />
          </>
        )}
        <label>
          {t("starts", { zone: context.timeZone })}
          <input
            type="datetime-local"
            step="any"
            required
            name="startAt"
            defaultValue={
              appointment ? localInput(appointment.startAt, context.timeZone, true) : undefined
            }
          />
        </label>
        <label>
          {t("ends", { zone: context.timeZone })}
          <input
            type="datetime-local"
            step="any"
            required
            name="endAt"
            defaultValue={
              appointment ? localInput(appointment.endAt, context.timeZone, true) : undefined
            }
          />
        </label>
        <label>
          {t("appointmentReason")}
          <input required name="reason" maxLength={250} defaultValue={appointment?.reason} />
        </label>
      </SaveForm>
    </details>
  );
}
export async function AgendaRow({
  context,
  appointment: a,
  day,
  page,
}: {
  context: CareFormContext;
  appointment: Appointment;
  day: string;
  page: number;
}) {
  const t = await getTranslations("care"),
    { timeZone, locale, scope } = context;
  return (
    <li className="agenda-row">
      <div>
        <time dateTime={a.startAt}>{displayTime(a.startAt, locale, timeZone)}</time> –{" "}
        <time dateTime={a.endAt}>{displayTime(a.endAt, locale, timeZone)}</time>
        <p>{t(a.status)}</p>
      </div>
      <div>
        <h3>
          <Link className="directory-back" href={carePath(scope, a.patientId, { timeZone })}>
            {a.patientName}
          </Link>
        </h3>
        <p>{a.reason}</p>
        {a.status === "BOOKED" && (
          <>
            <AppointmentForm
              context={context}
              patientId={a.patientId}
              appointment={a}
              day={day}
              page={page}
            />
            <details className="directory-disclosure">
              <summary>{t("updateStatus")}</summary>
              <form method="post" action={endpoint(context)} className="directory-form">
                <Fields context={context} patientId={a.patientId} />
                <input type="hidden" name="source" value="calendar" />
                <input type="hidden" name="day" value={day} />
                <input type="hidden" name="page" value={page} />
                <input type="hidden" name="appointmentId" value={a.id} />
                <input type="hidden" name="revision" value={a.revision} />
                <ViewedAppointment appointment={a} context={context} />
                <p>{t("statusHint")}</p>
                <div className="auth-actions">
                  <Button variant="selected" type="submit" name="action" value="complete">
                    {t("complete")}
                  </Button>
                  <Button type="submit" name="action" value="cancel">
                    {t("cancel")}
                  </Button>
                </div>
              </form>
            </details>
          </>
        )}
      </div>
    </li>
  );
}
