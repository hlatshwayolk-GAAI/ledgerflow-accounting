
# Make LedgerFlow actually functional

You're currently stuck on `/app/onboarding`, which means no company exists yet — and without a company every other page is empty by design (Dashboard, Invoices, Customers, Suppliers, Chart of Accounts all filter by `company_id`). So step 1 is to make sure onboarding works end-to-end, then we deepen the existing modules and add the missing PRD pieces.

## 1. Fix the "nothing works" root cause

- Debug onboarding submit: confirm `companies.insert` actually returns a row (auth session + RLS + `owner_id` policy). If it silently fails, surface the error and fix the policy/grant.
- After company creation, force `useCompanies` to reload before redirect so the sidebar and pages immediately have an `active` company.
- Add a visible empty-state on every page that says "Create a company first" instead of rendering `null`, so the app never looks broken again.

## 2. Finish current modules properly

**Customers & Suppliers**
- Row click → detail drawer with edit + delete
- Search box, balance column (outstanding AR / AP from journals)
- Soft delete (`is_active`) so historical invoices keep their link

**Chart of Accounts**
- Add / edit / archive accounts (validate code uniqueness per company)
- Show running balance per account (sum of journal_lines)

**Invoices**
- Invoice detail page: line items, journal preview, status timeline
- Edit (only while `draft`), delete (only `draft`), duplicate
- "Record payment" action → posts a balanced journal (Dr Bank, Cr AR) and updates `amount_paid` + status (`paid` / `partially_paid`)
- Auto-mark `overdue` on read when `due_date < today` and unpaid
- PDF download (client-side react-pdf) and "Mark as sent"

**Dashboard**
- KPIs already query real data — add: cash position (sum of bank-type accounts), top 5 customers by outstanding, 12-week cashflow sparkline, overdue list with quick-pay button

## 3. Bills (supplier invoices) — new module

- Tables: `bills`, `bill_lines`, `bill_payments` (mirror invoices)
- RPC `create_bill_with_journal`: Dr Expense + Dr VAT Input, Cr Accounts Payable (2000)
- RPC `record_bill_payment`: Dr AP, Cr Bank
- UI: `/app/bills` list + new-bill dialog (supplier picker, lines, totals) + detail page

## 4. Bank Reconciliation — new module

- Tables: `bank_accounts` (linked to a CoA `1000`-type account), `bank_transactions` (date, description, amount signed, status: unmatched | matched | reconciled, match_id, match_type)
- Manual entry + CSV import (paste/upload, simple `date,description,amount` parser)
- Matching UI: side-by-side — bank txns left, open invoices/bills right; click to match → posts payment journal automatically and marks both reconciled
- Running balance + "Reconcile to statement" with target balance check

## 5. Financial Reports — new module

All computed from `journal_lines` filtered by date range and company.
- **Trial Balance**: every account with debit / credit totals; must sum to zero (proof the engine works)
- **Profit & Loss**: revenue − expenses, grouped, with period selector (this month / quarter / FY / custom)
- **Balance Sheet**: assets = liabilities + equity, as-of date
- **AR Aging** & **AP Aging**: current / 30 / 60 / 90+ buckets per customer / supplier
- Export each to CSV; print-friendly view

## Technical notes

- All new tables: `company_id` FK, RLS via `is_company_member()`, GRANT to authenticated + service_role, `updated_at` trigger.
- All money-moving actions go through SECURITY DEFINER RPCs that post balanced journals — never insert journal_lines directly from the client. The `check_journal_balanced` trigger guarantees integrity.
- New CoA defaults to add to `add_owner_as_member`: `1010 Cash on Hand`, `2150 VAT Input`, plus map every bank account to a `1000`-series account on creation.
- Reports use a single SQL function `get_account_balances(company_id, from_date, to_date)` returning `(account_id, debit, credit)` to keep all four reports consistent and fast.
- UI: keep existing Cloud White design system, shadcn primitives, sidebar nav. Add "Bills", "Banking", "Reports" entries.

## Suggested build order

```text
Step 1  Fix onboarding + empty states              (unblocks everything)
Step 2  Invoice payments + edit/delete + detail   (closes the AR loop)
Step 3  Bills module (mirror of invoices)         (closes the AP loop)
Step 4  Bank accounts + manual reconciliation     (ties AR/AP to cash)
Step 5  Financial Reports (TB, P&L, BS, Aging)    (proves the ledger)
Step 6  Dashboard upgrades + CSV/PDF exports      (polish)
```

Each step ships as one working slice — you can use the app after every step.
