# Clinical record transfers

A guardian can export an individually selected set of released encounters and medical documents from a linked clinic record. A receiving clinic opens the encrypted package, reviews the patient and chooses an existing patient or creates one. Staff can find imported records in the patient's imported history. Each entry carries the original author, times, clinic and package. An imported contact does not establish guardianship.

## Enable a route

Generate clinic-specific keys using the instructions in [the format specification](./vetpkg-format.md). Mount a versioned JSON key directory from the deployment secret manager and set `VETPKG_KEYRING_FILE` to its absolute path. Set `VETPKG_MAX_PACKAGE_BYTES` and `VETPKG_MAX_RECORDS` to the deployment's accepted limits. The API also requires its configured private S3-compatible bucket. Restart the API after a key-directory change. A blank directory setting leaves exchanges unavailable.

The root object contains `version` (1), `clinics` and `routes`. Each clinic contains its `organizationId`, `clinicId`, display `name`, ordered `signing` bindings and ordered `encryption` bindings. Use the complete binding objects emitted by the key generator. Each route contains `source` and `destination` objects, each with the two clinic identity fields. Enabling a return transfer requires a separate reverse route. Share public bindings with partners through an authenticated channel and verify the clinic identities and fingerprints before adding a route.

Use the source signing private binding at the exporting clinic and the destination decryption private binding at the receiving clinic. The other party needs only the corresponding public binding. The first key in each list is active for new exports. Retain older trusted source signing public keys and older recipient decryption private keys for as long as the clinic must reopen those archives. Removing a route or an old binding prevents reopening packages which relied on it. A downloaded package may already have been decrypted by an authorized recipient.

## Export from the owner app

1. Open a linked pet, select its source clinic record and choose a configured receiving clinic.
2. Select released encounters and documents. Include guardian contact details only when desired.
3. Export and choose the intended receiving clinic in the device share sheet. The package is signed at the source and encrypted for that destination. Revoking a release or removing the guardian blocks new exports. The API rechecks the selected releases before returning a package and records its source, destination, actor and selection in the audit table.

The export assigns encounters stable, source-scoped exchange identifiers. An addendum keeps its type and parent reference across packages even when its parent is withheld. That reference cannot be used to retrieve the parent from the clinic's API.

## Review at the destination

1. Open the clinic's import screen and select a `.vetpkg` file. Verification checks destination, source signature, file integrity and configured limits before presenting a preview.
2. Review the source, patient, any shared guardian contact and record counts. Check suggested matches or search the clinic registry. Choose a patient explicitly or confirm creation.
3. Open imported history to read the original entries and retrieve verified attachments. Imported records keep their attribution and remain separate from locally authored notes. Repeating the same confirmed import returns its original outcome. A later package with identical source records skips them. Conflicting content for a previously seen source record rejects the entire transaction.

The staff web and mobile apps use the same API. A preview receipt belongs to the reviewing employee at the receiving clinic. After an interrupted upload, retry the same package. After an interrupted confirmation, retry the same patient choice. The destination checks its access and the archive again at confirmation. Imported attachment reads require current clinic access.

Guardians can select individual released prescriptions when exporting records from a source clinic. The signed package includes the recorded medication, instructions, prescribed quantity and unit, prescriber identity, and original timestamp. The final authorization check repeats after packaging and records each selected prescription ID. Imported prescriptions appear in read-only history. Dispensing at the receiving clinic uses its own prescribing and stock workflow.
