# Purchasing and pharmacy

## Receive a purchase

An organization administrator adds a supplier to the clinic. Clinic staff create a purchase order by selecting the supplier and ordering a quantity in each catalog item's base unit. Include each item once per order. Each order line sends the selected base unit as `expectedUnit`. If the unit changed while the order was being prepared, refresh the catalog and review the quantity before submitting it again. The order records the item, unit, supplier, operator and time. A catalog item's base unit becomes fixed when it appears on an order, prescription or stock movement.

Enter the warehouse, lot and quantity for each delivery line. Leave the lot empty for untracked stock. A receipt may cover part of an order and can split an item across warehouses or lots. The receipt uses the unit saved on the order for each line. Every line posts stock together. If any line exceeds the outstanding quantity or cannot be posted, the receipt is rejected in full. The order shows the gross quantity received and its current status.

To return stock to a supplier, choose the original receipt line and enter the quantity and reason. The return removes stock from that receipt's warehouse and lot in the original ordered unit. It must fit within both the unreturned quantity and stock on hand. The original receipt and order totals remain in the purchasing history.

## Authorize pharmacy staff

In the clinic's pharmacy permissions, an organization administrator grants prescribing and dispensing separately. Both permissions start off, including for administrators. A staff member must also have current access to the clinic. The permissions report shows each member's clinic access, prescribing and dispensing flags. A configured permission takes effect again if the member regains access to that clinic.

## Prescribe, dispense and share

An authorized prescriber opens the patient and selects the inventory item. The prescriber enters the medication, their directions and the total quantity authorized in the item's base unit. Signing sends the selected unit as `expectedUnit` and checks it against the current catalog. If it changed, review the quantity in the updated unit before signing. The prescription preserves its unit, text, author and timestamp.

An authorized dispenser selects the prescription, warehouse, lot and quantity. Each dispensing posts a stock issue in the signed unit and records the operator and time. Partial dispensing is supported until the authorized total has been dispensed. The clinical record shows the dispensed quantity. The stock ledger identifies the issue as prescription dispensing and keeps patient details and clinical directions in the clinical record.

Prescriptions begin private to the clinic. A prescriber can release an individual prescription to selected linked guardians and withdraw that release. The owner sees the medication, directions, prescribed quantity, unit, clinic and time. Removing the guardian's patient link ends that guardian's access.

For a network retry, the client uses the same request ID with the same input and signed-in operator. Each new order, receipt, return, prescription or dispensing uses a new ID. Catalog, permission and sharing edits use the current revision.
