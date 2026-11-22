# Patients and guardians

## Register a patient

Sign in to a staff app, open an organization and select the clinic where the patient receives care. In the patient registry, staff can search by name, create a record, update demographics and manage guardians. Each record belongs to its clinic. When two staff members edit the same patient, the second editor must reload the latest revision before saving a conflicting change.

Add a guardian with the name and email address the clinic has verified for that patient. Use the same contact when registering another pet in the same clinic. A conflicting name for an existing email requires staff review. Each authorized guardian receives an individual linking code.

## Link a clinic record

1. Staff select the guardian, issue a linking code, and give it privately to the intended recipient. The staff app displays the expiry. Reissuing replaces the earlier pending code.
2. The guardian signs into the pet-owner app with the verified email used by the clinic and enters the code. For an existing pet, select it to group the new clinic record with the owner’s other records for that animal.
3. The owner can see which clinics contributed records. Other guardians keep their own authorizations and pet groupings. The clinic can remove a guardian to withdraw access, including on devices already signed in.

The API checks the account’s verified email when the code is redeemed. Subsequent access uses the identity provider’s issuer and immutable subject. Grouping records in an owner’s app leaves each clinic’s source record intact.

## Configuration

For development, run `node scripts/init-local-env.mjs` from the repository root. It keeps existing environment values, generates a local `PET_LINK_HMAC_KEY_HEX` when needed, and supplies the example duration and attempt settings. For deployments, configure a secret of 32 cryptographically random bytes encoded as hexadecimal and give the same secret to every API instance.

`PET_LINK_LIFETIME_SECONDS` supplies the default expiry. The organization’s optional `pet_link_lifetime_seconds` setting can override it. `PET_LINK_ATTEMPT_LIMIT` and `PET_LINK_WINDOW_SECONDS` limit failed redemption attempts per owner account across API instances. The database stores a digest and the expiry. Retrying a successful issuance with its original request ID can reproduce the same active code. A new issuance invalidates the earlier code. After rotating the signing key, use a new request ID to issue a replacement.
