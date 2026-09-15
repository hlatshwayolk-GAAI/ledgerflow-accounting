import { supabase } from "@/integrations/supabase/client";
import { isDemoMode, STANDARD_ACCOUNTS, DEMO_COMPANY } from "@/lib/demo-workspace";

// Shared types
export interface JournalLineInput {
  account_id: string;
  debit: number;
  credit: number;
}

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
}

export interface CreateInvoiceParams {
  company_id: string;
  customer_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  notes?: string;
  lines: InvoiceLineInput[];
}

export interface BillLineInput {
  description: string;
  account_id: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
}

export interface CreateBillParams {
  company_id: string;
  supplier_id: string;
  bill_number: string;
  issue_date: string;
  due_date: string;
  notes?: string;
  lines: BillLineInput[];
}

/**
 * Seed the Chart of Accounts for a company
 */
export async function seedCompanyAccounts(companyId: string) {
  if (isDemoMode()) return;

  try {
    const { data: existing } = await supabase
      .from("accounts")
      .select("code")
      .eq("company_id", companyId);

    const existingCodes = new Set((existing ?? []).map((a: any) => a.code));
    const toInsert = STANDARD_ACCOUNTS.filter((a) => !existingCodes.has(a.code)).map((a) => ({
      company_id: companyId,
      code: a.code,
      name: a.name,
      type: a.type,
    }));

    if (toInsert.length > 0) {
      await supabase.from("accounts").insert(toInsert as any);
    }
  } catch (err) {
    console.warn("Could not seed company accounts:", err);
  }
}

/**
 * Create an Invoice with an automatic double-entry journal
 * Dr Accounts Receivable (1100), Cr Revenue (4000), Cr VAT Payable (2100)
 */
export async function createInvoiceWithJournal(params: CreateInvoiceParams): Promise<string> {
  const { company_id, customer_id, invoice_number, issue_date, due_date, notes = "", lines } = params;

  if (lines.length === 0) throw new Error("Invoice must have at least one line item");

  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);
  const tax_total = lines.reduce((s, l) => s + ((Number(l.quantity) || 0) * (Number(l.unit_price) || 0) * (Number(l.tax_rate) || 0)) / 100, 0);
  const total = Number((subtotal + tax_total).toFixed(2));

  // ── DEMO MODE HANDLER ─────────────────────────────────────────────
  if (isDemoMode()) {
    const storedInvoices = JSON.parse(localStorage.getItem("ledgerflow.demo_invoices") || "[]");
    const storedCustomers = JSON.parse(localStorage.getItem("ledgerflow.demo_customers") || "[]");
    const storedJournals = JSON.parse(localStorage.getItem("ledgerflow.demo_journals") || "[]");
    const cust = storedCustomers.find((c: any) => c.id === customer_id);

    const invoiceId = `demo-inv-${Date.now()}`;
    const newInvoice = {
      id: invoiceId,
      company_id,
      customer_id,
      customer: cust ? { name: cust.name, email: cust.email } : null,
      invoice_number,
      issue_date,
      due_date,
      notes,
      status: "sent",
      subtotal,
      tax_total,
      total,
      amount_paid: 0,
      lines: lines.map((l, idx) => ({
        ...l,
        position: idx,
        line_total: Number(((Number(l.quantity) || 0) * (Number(l.unit_price) || 0)).toFixed(2)),
      })),
    };
    storedInvoices.unshift(newInvoice);
    localStorage.setItem("ledgerflow.demo_invoices", JSON.stringify(storedInvoices));

    // Post balancing journal in demo mode
    const journalId = `demo-jrn-${Date.now()}`;
    const jLines: any[] = [
      { account_id: "demo-acc-1100", debit: total, credit: 0, account: { code: "1100", name: "Accounts Receivable (Debtors)" } },
      { account_id: "demo-acc-4000", debit: 0, credit: subtotal, account: { code: "4000", name: "Freight Services Revenue" } },
    ];
    if (tax_total > 0) {
      jLines.push({ account_id: "demo-acc-2100", debit: 0, credit: tax_total, account: { code: "2100", name: "VAT Payable (SARS)" } });
    }

    storedJournals.unshift({
      id: journalId,
      company_id,
      entry_date: issue_date,
      description: `Invoice ${invoice_number}`,
      source_type: "invoice",
      source_id: invoiceId,
      created_at: new Date().toISOString(),
      journal_lines: jLines,
    });
    localStorage.setItem("ledgerflow.demo_journals", JSON.stringify(storedJournals));
    return invoiceId;
  }

  // ── LIVE CLOUD MODE HANDLER (Try RPC first, fallback to client transaction) ────
  try {
    const { data, error: rpcErr } = await supabase.rpc("create_invoice_with_journal", {
      _company_id: company_id,
      _customer_id: customer_id,
      _invoice_number: invoice_number,
      _issue_date: issue_date,
      _due_date: due_date,
      _notes: notes,
      _lines: lines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity) || 0,
        unit_price: Number(l.unit_price) || 0,
        tax_rate: Number(l.tax_rate) || 0,
      })),
    });
    if (!rpcErr && data) return data;
  } catch (e) {
    console.warn("create_invoice_with_journal RPC unavailable, using client-side fallback:", e);
  }

  // Client-side fallback insertion
  await seedCompanyAccounts(company_id);

  const { data: arAccount } = await supabase
    .from("accounts")
    .select("id")
    .eq("company_id", company_id)
    .eq("code", "1100")
    .maybeSingle();

  const { data: revAccount } = await supabase
    .from("accounts")
    .select("id")
    .eq("company_id", company_id)
    .eq("code", "4000")
    .maybeSingle();

  const { data: vatAccount } = await supabase
    .from("accounts")
    .select("id")
    .eq("company_id", company_id)
    .eq("code", "2100")
    .maybeSingle();

  if (!arAccount || !revAccount) {
    throw new Error("Default Chart of Accounts (AR 1100 or Revenue 4000) not found");
  }

  // 1. Insert invoice header
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .insert({
      company_id,
      customer_id,
      invoice_number,
      issue_date,
      due_date,
      notes,
      status: "sent" as any,
      subtotal,
      tax_total,
      total,
      amount_paid: 0,
    })
    .select("id")
    .single();

  if (invErr || !invoice) throw new Error(invErr?.message || "Failed to create invoice header");

  // 2. Insert line items
  const linesToInsert = lines.map((l, idx) => {
    const lTotal = Number(((Number(l.quantity) || 0) * (Number(l.unit_price) || 0)).toFixed(2));
    return {
      invoice_id: invoice.id,
      description: l.description,
      quantity: Number(l.quantity) || 0,
      unit_price: Number(l.unit_price) || 0,
      tax_rate: Number(l.tax_rate) || 0,
      line_total: lTotal,
      position: idx,
    };
  });

  const { error: lineInsertErr } = await supabase.from("invoice_lines").insert(linesToInsert);
  if (lineInsertErr) {
    await supabase.from("invoices").delete().eq("id", invoice.id);
    throw new Error(lineInsertErr.message || "Failed to insert invoice lines");
  }

  // 3. Post double-entry journal
  const { data: journal, error: jErr } = await supabase
    .from("journals")
    .insert({
      company_id,
      entry_date: issue_date,
      description: `Invoice ${invoice_number}`,
      source_type: "invoice",
      source_id: invoice.id,
    })
    .select("id")
    .single();

  if (jErr || !journal) {
    await supabase.from("invoices").delete().eq("id", invoice.id);
    throw new Error(jErr?.message || "Failed to create invoice journal entry");
  }

  const jLines = [
    { journal_id: journal.id, account_id: arAccount.id, debit: total, credit: 0 },
    { journal_id: journal.id, account_id: revAccount.id, debit: 0, credit: subtotal },
  ];
  if (tax_total > 0 && vatAccount) {
    jLines.push({ journal_id: journal.id, account_id: vatAccount.id, debit: 0, credit: tax_total });
  }

  const { error: jLinesErr } = await supabase.from("journal_lines").insert(jLines);
  if (jLinesErr) {
    await supabase.from("journals").delete().eq("id", journal.id);
    await supabase.from("invoices").delete().eq("id", invoice.id);
    throw new Error(jLinesErr.message || "Failed to balance invoice journal lines");
  }

  return invoice.id;
}

/**
 * Delete a draft/unpaid invoice and its corresponding journal
 */
export async function deleteDraftInvoice(invoiceId: string): Promise<void> {
  if (isDemoMode()) {
    const storedInvoices = JSON.parse(localStorage.getItem("ledgerflow.demo_invoices") || "[]");
    const inv = storedInvoices.find((i: any) => i.id === invoiceId);
    if (inv && Number(inv.amount_paid) > 0) throw new Error("Cannot delete an invoice with recorded payments");
    localStorage.setItem("ledgerflow.demo_invoices", JSON.stringify(storedInvoices.filter((i: any) => i.id !== invoiceId)));

    const storedJournals = JSON.parse(localStorage.getItem("ledgerflow.demo_journals") || "[]");
    localStorage.setItem("ledgerflow.demo_journals", JSON.stringify(storedJournals.filter((j: any) => !(j.source_type === "invoice" && j.source_id === invoiceId))));
    return;
  }

  // Try RPC first
  try {
    const { error: rpcErr } = await supabase.rpc("delete_draft_invoice", { _invoice_id: invoiceId });
    if (!rpcErr) return;
  } catch (e) {
    console.warn("delete_draft_invoice RPC unavailable, falling back:", e);
  }

  // Client-side fallback
  const { data: inv } = await supabase.from("invoices").select("amount_paid").eq("id", invoiceId).single();
  if (inv && Number(inv.amount_paid) > 0) throw new Error("Cannot delete an invoice with recorded payments");

  const { data: journals } = await supabase.from("journals").select("id").eq("source_type", "invoice").eq("source_id", invoiceId);
  const jIds = (journals ?? []).map((j: any) => j.id);

  if (jIds.length > 0) {
    await supabase.from("journal_lines").delete().in("journal_id", jIds);
    await supabase.from("journals").delete().in("id", jIds);
  }

  await supabase.from("invoice_lines").delete().eq("invoice_id", invoiceId);
  const { error: delErr } = await supabase.from("invoices").delete().eq("id", invoiceId);
  if (delErr) throw new Error(delErr.message || "Failed to delete invoice");
}

/**
 * Create a Supplier Bill with balanced double-entry journal
 * Dr Expenses/Assets, Dr VAT Input (2100), Cr Accounts Payable (2000)
 */
export async function createBillWithJournal(params: CreateBillParams): Promise<string> {
  const { company_id, supplier_id, bill_number, issue_date, due_date, notes = "", lines } = params;

  if (lines.length === 0) throw new Error("Bill must have at least one line item");
  if (lines.some((l) => !l.account_id)) throw new Error("Every line item must specify an account");

  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);
  const tax_total = lines.reduce((s, l) => s + ((Number(l.quantity) || 0) * (Number(l.unit_price) || 0) * (Number(l.tax_rate) || 0)) / 100, 0);
  const total = Number((subtotal + tax_total).toFixed(2));

  // ── DEMO MODE HANDLER ─────────────────────────────────────────────
  if (isDemoMode()) {
    const storedBills = JSON.parse(localStorage.getItem("ledgerflow.demo_bills") || "[]");
    const storedSuppliers = JSON.parse(localStorage.getItem("ledgerflow.demo_suppliers") || "[]");
    const storedJournals = JSON.parse(localStorage.getItem("ledgerflow.demo_journals") || "[]");
    const supp = storedSuppliers.find((s: any) => s.id === supplier_id);

    const billId = `demo-bill-${Date.now()}`;
    const newBill = {
      id: billId,
      company_id,
      supplier_id,
      supplier: supp ? { name: supp.name } : null,
      bill_number,
      issue_date,
      due_date,
      notes,
      status: "sent",
      subtotal,
      tax_total,
      total,
      amount_paid: 0,
      lines: lines.map((l, idx) => ({
        ...l,
        position: idx,
        line_total: Number(((Number(l.quantity) || 0) * (Number(l.unit_price) || 0)).toFixed(2)),
      })),
    };
    storedBills.unshift(newBill);
    localStorage.setItem("ledgerflow.demo_bills", JSON.stringify(storedBills));

    // Post balancing journal for bill
    const journalId = `demo-jrn-${Date.now()}`;
    const jLines: any[] = lines.map((l) => ({
      account_id: l.account_id,
      debit: Number(((Number(l.quantity) || 0) * (Number(l.unit_price) || 0)).toFixed(2)),
      credit: 0,
      account: { code: "5000", name: "Expense Account" },
    }));

    if (tax_total > 0) {
      jLines.push({ account_id: "demo-acc-2100", debit: tax_total, credit: 0, account: { code: "2100", name: "VAT Payable (SARS)" } });
    }
    jLines.push({ account_id: "demo-acc-2000", debit: 0, credit: total, account: { code: "2000", name: "Accounts Payable (Creditors)" } });

    storedJournals.unshift({
      id: journalId,
      company_id,
      entry_date: issue_date,
      description: `Supplier Bill ${bill_number}`,
      source_type: "bill",
      source_id: billId,
      created_at: new Date().toISOString(),
      journal_lines: jLines,
    });
    localStorage.setItem("ledgerflow.demo_journals", JSON.stringify(storedJournals));
    return billId;
  }

  // ── LIVE CLOUD MODE HANDLER ───────────────────────────────────────
  try {
    const { data, error: rpcErr } = await supabase.rpc("create_bill_with_journal" as any, {
      _company_id: company_id,
      _supplier_id: supplier_id,
      _bill_number: bill_number,
      _issue_date: issue_date,
      _due_date: due_date,
      _notes: notes,
      _lines: lines.map((l) => ({
        description: l.description,
        account_id: l.account_id,
        quantity: Number(l.quantity) || 0,
        unit_price: Number(l.unit_price) || 0,
        tax_rate: Number(l.tax_rate) || 0,
      })),
    });
    if (!rpcErr && data) return data;
  } catch (e) {
    console.warn("create_bill_with_journal RPC unavailable, using client-side fallback:", e);
  }

  // Client-side fallback insertion
  await seedCompanyAccounts(company_id);

  const { data: apAccount } = await supabase
    .from("accounts")
    .select("id")
    .eq("company_id", company_id)
    .eq("code", "2000")
    .maybeSingle();

  const { data: vatAccount } = await supabase
    .from("accounts")
    .select("id")
    .eq("company_id", company_id)
    .eq("code", "2100")
    .maybeSingle();

  if (!apAccount) throw new Error("Accounts Payable account (2000) not found for company");

  // 1. Insert bill header
  const { data: bill, error: billErr } = await supabase
    .from("bills" as any)
    .insert({
      company_id,
      supplier_id,
      bill_number,
      issue_date,
      due_date,
      notes,
      status: "sent",
      subtotal,
      tax_total,
      total,
      amount_paid: 0,
    })
    .select("id")
    .single();

  if (billErr || !bill) throw new Error(billErr?.message || "Failed to create bill header");

  // 2. Insert bill lines
  const billLinesToInsert = lines.map((l, idx) => {
    const lTotal = Number(((Number(l.quantity) || 0) * (Number(l.unit_price) || 0)).toFixed(2));
    return {
      bill_id: (bill as any).id,
      account_id: l.account_id,
      description: l.description,
      quantity: Number(l.quantity) || 0,
      unit_price: Number(l.unit_price) || 0,
      tax_rate: Number(l.tax_rate) || 0,
      line_total: lTotal,
      position: idx,
    };
  });

  const { error: linesInsertErr } = await supabase.from("bill_lines" as any).insert(billLinesToInsert);
  if (linesInsertErr) {
    await supabase.from("bills" as any).delete().eq("id", (bill as any).id);
    throw new Error(linesInsertErr.message || "Failed to insert bill lines");
  }

  // 3. Post double-entry journal
  const { data: journal, error: jErr } = await supabase
    .from("journals")
    .insert({
      company_id,
      entry_date: issue_date,
      description: `Supplier Bill ${bill_number}`,
      source_type: "bill",
      source_id: (bill as any).id,
    })
    .select("id")
    .single();

  if (jErr || !journal) {
    await supabase.from("bills" as any).delete().eq("id", (bill as any).id);
    throw new Error(jErr?.message || "Failed to create bill journal header");
  }

  const jLines: any[] = lines.map((l) => ({
    journal_id: journal.id,
    account_id: l.account_id,
    debit: Number(((Number(l.quantity) || 0) * (Number(l.unit_price) || 0)).toFixed(2)),
    credit: 0,
  }));

  if (tax_total > 0 && vatAccount) {
    jLines.push({ journal_id: journal.id, account_id: vatAccount.id, debit: tax_total, credit: 0 });
  }
  jLines.push({ journal_id: journal.id, account_id: apAccount.id, debit: 0, credit: total });

  const { error: jLinesErr } = await supabase.from("journal_lines").insert(jLines);
  if (jLinesErr) {
    await supabase.from("journals").delete().eq("id", journal.id);
    await supabase.from("bills" as any).delete().eq("id", (bill as any).id);
    throw new Error(jLinesErr.message || "Failed to balance bill journal lines");
  }

  return (bill as any).id;
}

/**
 * Delete a draft/unpaid bill and its corresponding journal
 */
export async function deleteDraftBill(billId: string): Promise<void> {
  if (isDemoMode()) {
    const storedBills = JSON.parse(localStorage.getItem("ledgerflow.demo_bills") || "[]");
    const bill = storedBills.find((b: any) => b.id === billId);
    if (bill && Number(bill.amount_paid) > 0) throw new Error("Cannot delete a bill with recorded payments");
    localStorage.setItem("ledgerflow.demo_bills", JSON.stringify(storedBills.filter((b: any) => b.id !== billId)));

    const storedJournals = JSON.parse(localStorage.getItem("ledgerflow.demo_journals") || "[]");
    localStorage.setItem("ledgerflow.demo_journals", JSON.stringify(storedJournals.filter((j: any) => !(j.source_type === "bill" && j.source_id === billId))));
    return;
  }

  try {
    const { error: rpcErr } = await supabase.rpc("delete_draft_bill" as any, { _bill_id: billId });
    if (!rpcErr) return;
  } catch (e) {
    console.warn("delete_draft_bill RPC unavailable, falling back:", e);
  }

  const { data: bill } = await supabase.from("bills" as any).select("amount_paid").eq("id", billId).single();
  if (bill && Number((bill as any).amount_paid) > 0) throw new Error("Cannot delete a bill with recorded payments");

  const { data: journals } = await supabase.from("journals").select("id").eq("source_type", "bill").eq("source_id", billId);
  const jIds = (journals ?? []).map((j: any) => j.id);

  if (jIds.length > 0) {
    await supabase.from("journal_lines").delete().in("journal_id", jIds);
    await supabase.from("journals").delete().in("id", jIds);
  }

  await supabase.from("bill_lines" as any).delete().eq("bill_id", billId);
  const { error: delErr } = await supabase.from("bills" as any).delete().eq("id", billId);
  if (delErr) throw new Error(delErr.message || "Failed to delete bill");
}

/**
 * Record an invoice payment (Dr Bank, Cr AR)
 */
export async function recordInvoicePayment(
  invoiceId: string,
  amount: number,
  paymentDate: string,
  bankAccountCode: string = "1000",
  notes: string = ""
) {
  if (isDemoMode()) {
    const storedInvoices = JSON.parse(localStorage.getItem("ledgerflow.demo_invoices") || "[]");
    const invIndex = storedInvoices.findIndex((i: any) => i.id === invoiceId);
    if (invIndex === -1) throw new Error("Invoice not found");
    const inv = storedInvoices[invIndex];

    const newPaid = Number(inv.amount_paid || 0) + amount;
    const newStatus = newPaid >= Number(inv.total) - 0.01 ? "paid" : "partially_paid";
    inv.amount_paid = newPaid;
    inv.status = newStatus;
    storedInvoices[invIndex] = inv;
    localStorage.setItem("ledgerflow.demo_invoices", JSON.stringify(storedInvoices));

    const storedJournals = JSON.parse(localStorage.getItem("ledgerflow.demo_journals") || "[]");
    const journalId = `demo-jrn-${Date.now()}`;
    storedJournals.unshift({
      id: journalId,
      company_id: inv.company_id,
      entry_date: paymentDate,
      description: `Payment for ${inv.invoice_number}${notes ? ` — ${notes}` : ""}`,
      source_type: "invoice_payment",
      source_id: invoiceId,
      created_at: new Date().toISOString(),
      journal_lines: [
        { account_id: "demo-acc-1000", debit: amount, credit: 0, account: { code: "1000", name: "Standard Bank Business Account" } },
        { account_id: "demo-acc-1100", debit: 0, credit: amount, account: { code: "1100", name: "Accounts Receivable (Debtors)" } },
      ],
    });
    localStorage.setItem("ledgerflow.demo_journals", JSON.stringify(storedJournals));
    return journalId;
  }

  // Try RPC first
  try {
    const { data: rpcData, error: rpcErr } = await supabase.rpc("record_invoice_payment", {
      _invoice_id: invoiceId,
      _amount: amount,
      _payment_date: paymentDate,
      _bank_account_code: bankAccountCode,
      _notes: notes,
    });
    if (!rpcErr && rpcData) return rpcData;
  } catch (e) {
    console.warn("record_invoice_payment RPC unavailable, using client fallback:", e);
  }

  // 1. Fetch invoice details
  const { data: invoice, error: invFetchErr } = await supabase
    .from("invoices")
    .select("company_id, total, amount_paid, invoice_number")
    .eq("id", invoiceId)
    .single();

  if (invFetchErr || !invoice) throw new Error(invFetchErr?.message || "Invoice not found");

  // 2. Fetch default accounts
  const { data: arAccount } = await supabase.from("accounts").select("id").eq("company_id", invoice.company_id).eq("code", "1100").maybeSingle();
  const { data: bankAccount } = await supabase.from("accounts").select("id").eq("company_id", invoice.company_id).eq("code", bankAccountCode).maybeSingle();

  if (!arAccount || !bankAccount) throw new Error("Missing default accounts (Accounts Receivable or Bank)");

  // 3. Create the journal entry
  const description = `Payment for ${invoice.invoice_number}${notes ? ` — ${notes}` : ""}`;
  const { data: journal, error: journalErr } = await supabase
    .from("journals")
    .insert({
      company_id: invoice.company_id,
      entry_date: paymentDate,
      description,
      source_type: "invoice_payment",
      source_id: invoiceId,
    })
    .select("id")
    .single();

  if (journalErr || !journal) throw new Error(journalErr?.message || "Failed to create payment journal entry");

  // 4. Create balancing journal lines
  const { error: linesErr } = await supabase.from("journal_lines").insert([
    { journal_id: journal.id, account_id: bankAccount.id, debit: amount, credit: 0 },
    { journal_id: journal.id, account_id: arAccount.id, debit: 0, credit: amount },
  ]);

  if (linesErr) {
    await supabase.from("journals").delete().eq("id", journal.id);
    throw new Error(linesErr.message || "Failed to post payment journal lines");
  }

  // 5. Update invoice status & amount_paid
  const newPaid = Number(invoice.amount_paid) + amount;
  const newStatus = newPaid >= Number(invoice.total) - 0.01 ? "paid" : "partially_paid";

  const { error: updateErr } = await supabase
    .from("invoices")
    .update({ amount_paid: newPaid, status: newStatus as any, updated_at: new Date().toISOString() })
    .eq("id", invoiceId);

  if (updateErr) throw new Error(updateErr.message || "Failed to update invoice payment status");

  return journal.id;
}

/**
 * Reverse an invoice payment
 */
export async function reverseInvoicePayment(invoiceId: string) {
  if (isDemoMode()) {
    const storedJournals = JSON.parse(localStorage.getItem("ledgerflow.demo_journals") || "[]");
    const jIndex = storedJournals.findIndex((j: any) => j.source_type === "invoice_payment" && j.source_id === invoiceId);
    if (jIndex === -1) throw new Error("No payment journal found to reverse");
    const j = storedJournals[jIndex];
    const pmtAmount = (j.journal_lines || []).reduce((sum: number, l: any) => sum + Number(l.debit || 0), 0);

    storedJournals.splice(jIndex, 1);
    localStorage.setItem("ledgerflow.demo_journals", JSON.stringify(storedJournals));

    const storedInvoices = JSON.parse(localStorage.getItem("ledgerflow.demo_invoices") || "[]");
    const invIndex = storedInvoices.findIndex((i: any) => i.id === invoiceId);
    if (invIndex !== -1) {
      const inv = storedInvoices[invIndex];
      const newPaid = Math.max(0, Number(inv.amount_paid || 0) - pmtAmount);
      inv.amount_paid = newPaid;
      inv.status = newPaid >= Number(inv.total) - 0.01 ? "paid" : newPaid > 0 ? "partially_paid" : "sent";
      storedInvoices[invIndex] = inv;
      localStorage.setItem("ledgerflow.demo_invoices", JSON.stringify(storedInvoices));
    }
    return;
  }

  // Try RPC first
  try {
    const { error: rpcErr } = await supabase.rpc("reverse_invoice_payment" as any, { _invoice_id: invoiceId });
    if (!rpcErr) return;
  } catch (e) {
    console.warn("reverse_invoice_payment RPC unavailable, using client fallback:", e);
  }

  const { data: invoice } = await supabase.from("invoices").select("company_id, total, amount_paid").eq("id", invoiceId).single();
  if (!invoice || Number(invoice.amount_paid) <= 0) throw new Error("No payment to reverse on this invoice");

  const { data: journal } = await supabase
    .from("journals")
    .select(`id, journal_lines(debit)`)
    .eq("source_type", "invoice_payment")
    .eq("source_id", invoiceId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!journal) throw new Error("No payment journal found to reverse");

  const journalAmount = (journal as any).journal_lines.reduce((sum: number, line: any) => sum + Number(line.debit || 0), 0);

  await supabase.from("journal_lines").delete().eq("journal_id", journal.id);
  await supabase.from("journals").delete().eq("id", journal.id);

  const newPaid = Math.max(0, Number(invoice.amount_paid) - journalAmount);
  let newStatus = "sent";
  if (newPaid >= Number(invoice.total) - 0.01) newStatus = "paid";
  else if (newPaid > 0) newStatus = "partially_paid";

  await supabase.from("invoices").update({ amount_paid: newPaid, status: newStatus as any, updated_at: new Date().toISOString() }).eq("id", invoiceId);
}

/**
 * Record a bill payment (Dr AP, Cr Bank)
 */
export async function recordBillPayment(
  billId: string,
  amount: number,
  paymentDate: string,
  bankAccountCode: string = "1000",
  notes: string = ""
) {
  if (isDemoMode()) {
    const storedBills = JSON.parse(localStorage.getItem("ledgerflow.demo_bills") || "[]");
    const billIndex = storedBills.findIndex((b: any) => b.id === billId);
    if (billIndex === -1) throw new Error("Bill not found");
    const bill = storedBills[billIndex];

    const newPaid = Number(bill.amount_paid || 0) + amount;
    const newStatus = newPaid >= Number(bill.total) - 0.01 ? "paid" : "partially_paid";
    bill.amount_paid = newPaid;
    bill.status = newStatus;
    storedBills[billIndex] = bill;
    localStorage.setItem("ledgerflow.demo_bills", JSON.stringify(storedBills));

    const storedJournals = JSON.parse(localStorage.getItem("ledgerflow.demo_journals") || "[]");
    const journalId = `demo-jrn-${Date.now()}`;
    storedJournals.unshift({
      id: journalId,
      company_id: bill.company_id,
      entry_date: paymentDate,
      description: `Payment for Bill ${bill.bill_number}${notes ? ` — ${notes}` : ""}`,
      source_type: "bill_payment",
      source_id: billId,
      created_at: new Date().toISOString(),
      journal_lines: [
        { account_id: "demo-acc-2000", debit: amount, credit: 0, account: { code: "2000", name: "Accounts Payable (Creditors)" } },
        { account_id: "demo-acc-1000", debit: 0, credit: amount, account: { code: "1000", name: "Standard Bank Business Account" } },
      ],
    });
    localStorage.setItem("ledgerflow.demo_journals", JSON.stringify(storedJournals));
    return journalId;
  }

  try {
    const { data: rpcData, error: rpcErr } = await supabase.rpc("record_bill_payment" as any, {
      _bill_id: billId,
      _amount: amount,
      _payment_date: paymentDate,
      _bank_account_code: bankAccountCode,
      _notes: notes,
    });
    if (!rpcErr && rpcData) return rpcData;
  } catch (e) {
    console.warn("record_bill_payment RPC unavailable, using client fallback:", e);
  }

  const { data: bill } = await supabase.from("bills" as any).select("company_id, total, amount_paid, bill_number").eq("id", billId).single();
  if (!bill) throw new Error("Bill not found");

  const { data: apAccount } = await supabase.from("accounts").select("id").eq("company_id", (bill as any).company_id).eq("code", "2000").maybeSingle();
  const { data: bankAccount } = await supabase.from("accounts").select("id").eq("company_id", (bill as any).company_id).eq("code", bankAccountCode).maybeSingle();

  if (!apAccount || !bankAccount) throw new Error("Missing default accounts (AP or Bank)");

  const description = `Payment for Bill ${(bill as any).bill_number}${notes ? ` — ${notes}` : ""}`;
  const { data: journal, error: journalErr } = await supabase
    .from("journals")
    .insert({ company_id: (bill as any).company_id, entry_date: paymentDate, description, source_type: "bill_payment", source_id: billId })
    .select("id")
    .single();

  if (journalErr || !journal) throw new Error(journalErr?.message || "Failed to create payment journal entry");

  const { error: linesErr } = await supabase.from("journal_lines").insert([
    { journal_id: journal.id, account_id: apAccount.id, debit: amount, credit: 0 },
    { journal_id: journal.id, account_id: bankAccount.id, debit: 0, credit: amount },
  ]);

  if (linesErr) {
    await supabase.from("journals").delete().eq("id", journal.id);
    throw new Error(linesErr.message || "Failed to post payment journal lines");
  }

  const newPaid = Number((bill as any).amount_paid) + amount;
  const newStatus = newPaid >= Number((bill as any).total) - 0.01 ? "paid" : "partially_paid";

  await supabase.from("bills" as any).update({ amount_paid: newPaid, status: newStatus as any, updated_at: new Date().toISOString() }).eq("id", billId);

  return journal.id;
}

/**
 * Reverse a bill payment
 */
export async function reverseBillPayment(billId: string) {
  if (isDemoMode()) {
    const storedJournals = JSON.parse(localStorage.getItem("ledgerflow.demo_journals") || "[]");
    const jIndex = storedJournals.findIndex((j: any) => j.source_type === "bill_payment" && j.source_id === billId);
    if (jIndex === -1) throw new Error("No payment journal found to reverse");
    const j = storedJournals[jIndex];
    const pmtAmount = (j.journal_lines || []).reduce((sum: number, l: any) => sum + Number(l.debit || 0), 0);

    storedJournals.splice(jIndex, 1);
    localStorage.setItem("ledgerflow.demo_journals", JSON.stringify(storedJournals));

    const storedBills = JSON.parse(localStorage.getItem("ledgerflow.demo_bills") || "[]");
    const billIndex = storedBills.findIndex((b: any) => b.id === billId);
    if (billIndex !== -1) {
      const bill = storedBills[billIndex];
      const newPaid = Math.max(0, Number(bill.amount_paid || 0) - pmtAmount);
      bill.amount_paid = newPaid;
      bill.status = newPaid >= Number(bill.total) - 0.01 ? "paid" : newPaid > 0 ? "partially_paid" : "sent";
      storedBills[billIndex] = bill;
      localStorage.setItem("ledgerflow.demo_bills", JSON.stringify(storedBills));
    }
    return;
  }

  try {
    const { error: rpcErr } = await supabase.rpc("reverse_bill_payment" as any, { _bill_id: billId });
    if (!rpcErr) return;
  } catch (e) {
    console.warn("reverse_bill_payment RPC unavailable, using client fallback:", e);
  }

  const { data: bill } = await supabase.from("bills" as any).select("company_id, total, amount_paid").eq("id", billId).single();
  if (!bill || Number((bill as any).amount_paid) <= 0) throw new Error("No payment to reverse on this bill");

  const { data: journal } = await supabase
    .from("journals")
    .select(`id, journal_lines(debit)`)
    .eq("source_type", "bill_payment")
    .eq("source_id", billId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!journal) throw new Error("No payment journal found to reverse");

  const journalAmount = (journal as any).journal_lines.reduce((sum: number, line: any) => sum + Number(line.debit || 0), 0);

  await supabase.from("journal_lines").delete().eq("journal_id", journal.id);
  await supabase.from("journals").delete().eq("id", journal.id);

  const newPaid = Math.max(0, Number((bill as any).amount_paid) - journalAmount);
  let newStatus = "sent";
  if (newPaid >= Number((bill as any).total) - 0.01) newStatus = "paid";
  else if (newPaid > 0) newStatus = "partially_paid";

  await supabase.from("bills" as any).update({ amount_paid: newPaid, status: newStatus as any, updated_at: new Date().toISOString() }).eq("id", billId);
}

/**
 * Create a manual journal entry with validation that debits == credits
 */
export async function createManualJournal(
  companyId: string,
  entryDate: string,
  description: string,
  reference: string | null,
  lines: JournalLineInput[]
) {
  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);

  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new Error(`Journal is not balanced. Debits: ${totalDebit.toFixed(2)}, Credits: ${totalCredit.toFixed(2)}`);
  }

  if (totalDebit === 0) {
    throw new Error("Journal entry must have at least one non-zero amount");
  }

  const descriptionWithRef = reference?.trim() ? `${description.trim()} [Ref: ${reference.trim()}]` : description.trim();

  if (isDemoMode()) {
    const storedJournals = JSON.parse(localStorage.getItem("ledgerflow.demo_journals") || "[]");
    const storedAccounts = JSON.parse(localStorage.getItem("ledgerflow.demo_accounts") || "[]");
    const journalId = `demo-jrn-${Date.now()}`;

    const jLines = lines.map((l) => {
      const acc = storedAccounts.find((a: any) => a.id === l.account_id);
      return {
        account_id: l.account_id,
        debit: l.debit || 0,
        credit: l.credit || 0,
        account: acc ? { code: acc.code, name: acc.name } : null,
      };
    });

    storedJournals.unshift({
      id: journalId,
      company_id: companyId,
      entry_date: entryDate,
      description: descriptionWithRef,
      source_type: "manual",
      created_at: new Date().toISOString(),
      journal_lines: jLines,
    });
    localStorage.setItem("ledgerflow.demo_journals", JSON.stringify(storedJournals));
    return journalId;
  }

  try {
    const { data: rpcData, error: rpcErr } = await supabase.rpc("create_manual_journal" as any, {
      _company_id: companyId,
      _entry_date: entryDate,
      _description: descriptionWithRef,
      _lines: lines.map((l) => ({ account_id: l.account_id, debit: l.debit || 0, credit: l.credit || 0 })),
    });
    if (!rpcErr && rpcData) return rpcData;
  } catch (e) {
    console.warn("create_manual_journal RPC unavailable, using client fallback:", e);
  }

  const { data: journal, error: jErr } = await supabase
    .from("journals")
    .insert({
      company_id: companyId,
      entry_date: entryDate,
      description: descriptionWithRef,
      source_type: "manual",
    })
    .select("id")
    .single();

  if (jErr || !journal) throw new Error(jErr?.message || "Failed to post manual journal header");

  const linesToInsert = lines
    .filter((l) => (l.debit || 0) > 0 || (l.credit || 0) > 0)
    .map((l) => ({
      journal_id: journal.id,
      account_id: l.account_id,
      debit: l.debit || 0,
      credit: l.credit || 0,
    }));

  const { error: linesErr } = await supabase.from("journal_lines").insert(linesToInsert);
  if (linesErr) {
    await supabase.from("journals").delete().eq("id", journal.id);
    throw new Error(linesErr.message || "Failed to post manual journal lines");
  }

  return journal.id;
}
