# Clinical records and laboratory review

Open the patient and select the encounter that supports the entry. Record a diagnosis and optional code, a treatment and optional notes, or a vaccination with the product name and any lot number and next due date. The clinician supplies the findings, dates and treatment details.

To amend a signed entry, open the current version, enter the correction and explain the change. VetX keeps the previous text, author and recording time in the revision history. If another staff member changed the entry, refresh and review the current version before correcting it. Repeating the same request with the same signed-in staff identity and payload returns the saved revision.

## Laboratory workflow

Order the named test and enter the specimen when known. Enter the result as reported, with its unit and reference range when supplied. Review the saved result before releasing it to a guardian. Signing the review preserves the original result, its author and its timestamp, alongside the reviewer and review time. To correct a reviewed result, record the correction and review that version before sharing it again.

## Guardian access and transfer

Select the linked guardians who may see the current version of an individual entry. An amendment withdraws the previous release. Release the updated version explicitly when it is ready. Removing a guardian or withdrawing the release ends future access through that link.

A guardian can select released versions for an encrypted clinic-to-clinic transfer. The transfer preserves the recorded data, clinical revision, recording time, author and source. A reviewed lab also includes the original result author and time. The receiving clinic reviews the package and confirms the local patient before importing. Importing the same version from another package skips the duplicate. A later released correction remains a distinct revision in the receiving history. Withdrawing a release controls future reads and exports. A clinic that already imported a version retains its received copy.
