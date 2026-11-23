# From SOP to product: NSD-MOPS-SOP-002 → Opervia Approval Portal

Source: *NSD-MOPS-SOP-002 Client Content Approval & Publishing*, v0.3 (Draft, not approved for use), prepared by Opervia as an illustrative portfolio sample for the **fictional** agency Northstar Digital. Every target in the SOP is an illustrative assumption (A-xx). This app implements the SOP's controls and leaves its unconfirmed policies configurable or out of scope, rather than inventing new ones.

## 1. Rules taken from the SOP and enforced by the app

| SOP rule | Where in SOP | How the app enforces it |
| --- | --- | --- |
| **No explicit approval, no publishing.** Silence is not approval | §6 Warning, §8.3 | Only an active Client Approver linked to that client can approve. Scheduling is only possible from *Approved*. There is no deemed approval |
| **Approved means this exact version** | §6 Warning, §8.5 | A version is frozen once sent (DB trigger; even the service role can't edit it). A decision must name the version being decided on, so stale screens are rejected. Scheduling requires the approved version to equal the current version. A change after approval goes through *Reopen*, which creates a new version that needs new approval |
| Every new version is saved separately; nothing is overwritten | §8.1 step 2, §8.4 step 4 | A revision request creates v(n+1) as a copy, with its files. v1…vn stay exactly as the client saw them |
| Revision requests are written and specific | §8.3 decision table | A comment is required (≥5 characters), checked in the browser, the server action and the database |
| Resubmission includes a short summary of what changed | §8.4 step 7 | A change summary is required when resubmitting and shown to the client as "What changed in version n" |
| Client response options: approve, request revisions or reject | §8.3 step 2 | All three exist. Reject requires a reason and is final (the item is never published) |
| Never send content to a client without a named approver | §7 Escalation | Sending fails until the client account has an active Client Approver |
| Approval evidence: who approved which version, and when | §4, §13 | `approval_events` records actor, role, action, version, previous status, new status, comment and timestamp. It is append-only (DB trigger) |
| Four-eyes check: the creator never checks their own work | §5.1, §5.2, §8.6 | The person who prepared or sent the approved version can't schedule it. Another team member or admin does, and is recorded as the checker. Admins can turn this off in Settings (on by default) |
| Publish date/time and time zone are part of what's approved | §8.1 step 3, §8.5 step 3 | If a planned publish time was approved, scheduling must use exactly that time. Client time zone is stored per client and used for display |
| A client change request after approval is a new revision round | §11 | *Reopen for changes* (approved or scheduled) requires a reason and creates a new version |
| Client asks to cancel a scheduled post | §11 | *Unschedule* requires a reason and returns the item to Approved |
| Two client revision rounds assumed in scope; tell the HMO before a third | §8.4, A-07 | Informational notice on the last included round and a warning beyond it. It does not block, because the SOP leaves that decision to the HMO |
| Client data stays separate | §13 Confidentiality | Organization-level and client-level RLS on every table and on storage objects |

## 2. Status mapping

The product brief asked for five core statuses. The SOP defines fourteen (A-16). This is how they map:

| SOP status | Portal status | Note |
| --- | --- | --- |
| Draft · Ready for Internal Review · Internal Changes Requested | **Draft** | The internal QC loop (§8.2) is not a separate state in v1 — see §4 |
| Ready for Client · With Client | **Pending Approval** | |
| Revision Requested | **Revision Required** | |
| Rejected | **Rejected** | Added because the SOP's client decision table includes it |
| On Hold – No Response | — | Not automated in v1. Overdue due dates are highlighted |
| Approved | **Approved** | |
| Final Approved | (part of *Schedule*) | The version match is enforced automatically, so no separate manual step is needed |
| Scheduled | **Scheduled for Publishing** | Includes the four-eyes check |
| Published · Verified · Closed | — | Post-publication work is outside this MVP |

## 3. Role mapping

| Portal role | SOP roles it covers | Can do |
| --- | --- | --- |
| **Agency Admin** | HMO, MD, OC (admin parts), AL | Everything a team member can, plus manage clients, invitations, member roles and activation, and workspace settings |
| **Content Team** | SMM, AL | Create and edit drafts and revisions, upload files, send and resubmit, schedule (subject to four-eyes), unschedule, reopen |
| **Client Approver** | CA (named approver and backup) | See only their own client's sent items. Approve, request changes, decline. See the client-visible history |

A client can have several active approvers (the SOP's named approver plus backup). The first valid decision on a version applies.

## 4. Ambiguities and decisions taken

| # | Topic | Decision in v1 | Why / SOP reference |
| --- | --- | --- | --- |
| D1 | Internal QC (§8.2) as its own step | Not modelled. "Send for approval" is the agency's release | The brief's core workflow goes straight from the team to the client. Adding *Ready for Internal Review* later is a small change |
| D2 | Deemed approval | Never | §8.3 Warning, Q1 open |
| D3 | Typo fixes after approval | Always need re-approval (new version) | Q4 is open, so the strict SOP default applies |
| D4 | Changing the publish time after approval | Needs re-approval (reopen) | §8.5 step 3. Strict default |
| D5 | Revision limit | Warn, don't block | A-07 and Q3: the HMO decides with the client |
| D6 | Deadlines (P−7, P−5, P−3 17:00, P−1 15:00) | Manual "client response due" date, with overdue and "due soon" highlighting | A-05 is unconfirmed. Business-day and working-hours rules (A-11) vary by client |
| D7 | No-response sequence / On Hold | Not automated | A-06 needs reminders, backup approver and HMO escalation, which belong to a later version with email or Slack |
| D8 | Independent Reviewer appointment (§5.1) | Not modelled. The four-eyes rule covers the core control | Keeps v1 small |
| D9 | High-risk second review (§8.2 step 5) | Not modelled | A-09 list is unconfirmed |
| D10 | Record retention | Nothing auto-deleted. Stored files are immutable | Q9 open |
| D11 | Client notification when a post goes live | Not applicable (no publishing integration) | Q11 open |
| D12 | One person in several workspaces | Not supported (one membership per account) | MVP simplification |
| D13 | Invitations | Single-use links the admin shares manually. No email is sent | The brief says not to pretend email works unless integrated |

## 5. Open questions to confirm before real use (from SOP §16)

Q1 deemed approval · Q2 named approver and backup per client · Q3 revision rounds per contract · Q4 typo fixes after approval · Q5 correcting live posts · Q6 legal review for promotions · Q7 client time zones and working hours · Q9 retention · Q10 paid content · Q11 go-live notifications · Q12 lighter routes for stories and reactive content · Q13 out-of-hours manual posts.
