# Clinical care

## Patient records

Staff with access to a clinic can open a patient and record an encounter. Enter the visit time, the reason and at least one clinical section. The four sections hold the subjective history, objective findings, assessment and plan. The service records who entered the note and when the server received it.

An encounter remains part of the original history. To correct a detail, create an addendum linked to the earlier entry. Each addendum has its own author, timestamp and sharing decision.

## Sharing with guardians

Encounters begin private. Staff can release each entry to specific linked guardians and withdraw that access later. A guardian uses the pet-owner app to read entries released to their account across the pet’s linked clinics. The API checks the current link and sharing decision on every request. The owner can see a reference to an earlier encounter only when that encounter has also been released to them.

## Appointments

Staff can book a patient, reschedule an open appointment, cancel it or mark it completed. The schedule uses the selected time window. API timestamps include a UTC offset and are stored as instants. Two appointments for the same patient at the same clinic can meet at a boundary. An overlapping booking returns `409 APPOINTMENT_OVERLAP`. Cancelling a booking frees the interval. Completed visits retain their original place in the schedule.

The API accepts client-generated identifiers for creation and checks revisions for scheduling and sharing changes. Clients can retry the same request after a lost response. Conflicting edits require fresh data. Clinical mutations and their audit events commit in one PostgreSQL transaction.
