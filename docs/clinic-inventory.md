# Clinic inventory

An organization administrator maintains each clinic's warehouse list and item catalog. Create an item with a clinic-unique SKU, a display name, and its base unit. Use the same base unit for all subsequent receipts, dispensing and transfers. Editing an existing entry requires its displayed revision. The unit is fixed once a movement has been posted.

Employees with access to the clinic can record receipts, issues, returns, transfers and adjustments. Choose the item, warehouse or warehouse pair, quantity, lot and reason. Enter a positive amount in the item's base unit, with at most three decimal places. Leave the lot empty for untracked items. A return records stock coming back into the clinic. A transfer deducts and credits the same item and lot in one transaction. Insufficient stock rejects the entire movement.

Warehouse balances show each item's lot and exact available quantity. The movement history retains the signed-in employee's identity, timestamp, change and resulting balances. Corrections use a new, explained adjustment. Retry a submission with the same movement ID and unchanged contents to recover the original result after a connection failure.

The authenticated API is under `/organizations/{organizationId}/clinics/{clinicId}/inventory`. Its OpenAPI operations cover warehouse and item creation and revision, catalog lookup, per-warehouse balances and the movement journal. Quantities are decimal strings in requests and responses.
