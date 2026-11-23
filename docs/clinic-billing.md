# Clinic billing and cash registers

Open Billing from the clinic in the staff web or staff mobile app. Administrators maintain clinic prices, the billing currency and base unit, the applicable CABYS and tax rate, and the optional stock item. Each edit records a revision. A cashier reviews a price and its unit when adding it to a sale. A changed price requires another review.

A sale can contain services and stock items in one currency. Select a warehouse and lot for each stock item. Saving the cart assigns the clinic's internal sale number, stores the price and tax amounts and deducts the exact quantity in one transaction. An unavailable lot rejects the entire sale. Reopening a sale shows the original prices, payments and outstanding balance. A lost response can be recovered using the same request ID and body.

Cash payments require the employee's open drawer in the sale currency. Record its starting float, take partial or full payments, then enter the physical count to close. The drawer displays its expected total and the difference. For card or bank transfer payments, complete the payment through the clinic's provider and enter its transaction reference. These entries record an existing payment.

The clinic's sale number and the tax authority's electronic invoice key have separate lifecycles. Recording a payment or sale does not submit a tax document. Financial and stock operations run within the authorized clinic and retain the submitting employee's identity.
