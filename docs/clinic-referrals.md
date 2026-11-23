# Clinic referrals

A staff member opens the source patient, chooses a linked guardian and a destination clinic, and records the reason for referral and a clinical summary. The destination options come from the configured routes for that source clinic. The request captures the source patient, clinic labels, author and time. Include the information the specialist needs to answer the referral.

The selected guardian reviews the request in their pet's referrals and chooses **Approve** or **Decline**. Approval places the referral in the destination clinic's inbox. Its staff can read the referral summary and record one counter-referral. The source clinic and guardian can then read the response with its author and timestamp. A declined request stays in the source history.

The guardian can withdraw approval, including after a response. Withdrawal or removal of the guardian link removes the referral from the destination inbox and blocks further responses. The source clinic keeps the original request and any recorded response. Removing a route also blocks destination access. Source history, guardian review, decline and withdrawal remain available during route-directory outages.

The workflow uses the current revision for each decision and response. If a colleague or guardian acts first, refresh the referral to review its current state. A retried request uses the original request ID and the same signed-in staff identity.
