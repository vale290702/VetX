# Clinical records and laboratory review

Open the patient and select the encounter that supports the entry. Record a diagnosis and optional code, a treatment and optional notes, or a vaccination with the product name and any lot number and next due date. The clinician supplies the findings, dates and treatment details.

To amend a signed entry, open the current version, enter the correction and explain the change. VetX keeps the previous text, author and recording time in the revision history. If another staff member changed the entry, refresh and review the current version before correcting it. Repeating the same request with the same signed-in staff identity and payload returns the saved revision.

## Laboratory workflow

Order the named test and enter the specimen when known. Enter the result as reported, with its unit and reference range when supplied. Review the saved result before releasing it to a guardian. Signing the review preserves the original result, its author and its timestamp, alongside the reviewer and review time. To correct a reviewed result, record the correction and review that version before sharing it again.

## Hospitalization

Open the relevant patient encounter and create an admission with the ward and admission note. Enter a location when useful. A patient can have one active admission per clinic. Open the active admission to add a progress note or move the patient to a different ward or location. The history preserves each signed entry, its author, its observed time and its recording time.

To discharge, enter the final ward note and a separate summary intended for the guardian. A discharge closes the admission and allows a subsequent admission. To correct a discharge, keep the discharge time, supply the correction reason and review the new summary before releasing it again.

## Surgery

Create a planned surgery against its encounter, name the planned procedure and enter its scheduled date and time. Use the occurrence time to record when the planning or clinical event happened. Update the plan to reschedule it before marking it in progress. Starting, completing or cancelling uses the saved procedure and schedule.

At completion, enter the procedure performed, private recovery notes and a separate guardian summary. A planned or in-progress surgery can also be cancelled with a guardian summary. A terminal correction retains the recorded completion or cancellation time and creates a new version. To schedule another procedure, create another surgical record.

## Guardian access and transfer

Select the linked guardians who may see the current version of an individual entry. After discharge, surgical completion or cancellation, the release exposes the status and the separately written guardian summary. Ward locations, internal notes, surgical plans and recovery notes stay in the staff history. An amendment withdraws the previous release. Release the updated version explicitly when it is ready. Removing a guardian or withdrawing the release ends future access through that link.

A guardian can select released versions for an encrypted clinic-to-clinic transfer. The transfer preserves the recorded data, clinical revision, recording time, author and source. A reviewed lab also includes the original result author and time. The receiving clinic reviews the package and confirms the local patient before importing. Importing the same version from another package skips the duplicate. A later released correction remains a distinct revision in the receiving history. Withdrawing a release controls future reads and exports. A clinic that already imported a version retains its received copy.
