"use client";

import type { components } from "@vetx/api-client";
import { useState } from "react";

export type Clinic = components["schemas"]["ResourceSummaryDto"];
export type Member = components["schemas"]["DirectoryMemberDto"];
export type FieldLabels = {
  role: string;
  staff: string;
  admin: string;
  clinicAccess: string;
  allClinics: string;
  noClinicChoices: string;
};

export function MemberFields({
  member,
  clinics,
  labels,
}: {
  member?: Member;
  clinics: Clinic[];
  labels: FieldLabels;
}) {
  const [role, setRole] = useState<Member["role"]>(member?.role ?? "STAFF");
  return (
    <>
      <label>
        {labels.role}
        <select
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value === "ADMIN" ? "ADMIN" : "STAFF")}
        >
          <option value="STAFF">{labels.staff}</option>
          <option value="ADMIN">{labels.admin}</option>
        </select>
      </label>
      {role === "ADMIN" ? (
        <p>{labels.allClinics}</p>
      ) : (
        <fieldset>
          <legend>{labels.clinicAccess}</legend>
          {clinics.length ? (
            clinics.map((clinic) => (
              <label key={clinic.id} className="clinic-check">
                <input
                  type="checkbox"
                  name="clinicIds"
                  value={clinic.id}
                  defaultChecked={member?.clinicIds.includes(clinic.id)}
                />
                {clinic.name}
              </label>
            ))
          ) : (
            <p>{labels.noClinicChoices}</p>
          )}
        </fieldset>
      )}
    </>
  );
}
