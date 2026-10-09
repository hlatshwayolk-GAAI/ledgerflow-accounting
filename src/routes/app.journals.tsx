import React, { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  BookOpen,
  AlertTriangle,
  Check,
  FileText,
  Receipt,
  ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompanies } from "@/hooks/use-company";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { createManualJournal, seedCompanyAccounts } from "@/lib/accounting";
import { isDemoMode } from "@/lib/demo-workspace";

export const Route = createFileRoute("/app/journals")({
  component: JournalsPage,
});

type LinkedDocument = {
  type: "invoice" | "bill";
  id: string;
  number: string;
  entityName: string;
  outstanding: number;
};

type JournalLine = {
  account_id: string;
  debit: string;
  credit: string;
  description: string;
  linkedDocument?: LinkedDocument | null;
};

type Account = {
  id: string;
  code: string;
  name: string;
  type: string;
};

type InvoiceDoc = {
  id: string;
  invoice_number: string;
  total: number;
  amount_paid: number;
  customer_id?: string | null;
  customer?: { name: string } | null;
};

type BillDoc = {
  id: string;
  bill_number: string;
  total: number;
  amount_paid: number;
  supplier_id?: string | null;
  supplier?: { name: string } | null;
};

type Journal = {
  id: string;
  entry_date: string;
  description: string;
  reference: string | null;
  source_type: string | null;
  source_id: string | null;
  created_at: string;
  journal_lines: {
    account_id: string;
    debit: number;
    credit: number;
    account: { code: string; name: string } | null;
  }[];
};

const SOURCE_LABEL: Record<string, string> = {
  invoice: "Invoice",
  invoice_payment: "Invoice Payment",
  bill: "Bill",
  bill_payment: "Bill Payment",
  manual: "Manual",
  bank: "Bank",
};

const emptyLine = (): JournalLine => ({
  account_id: "",
  debit: "",
  credit: "",
  description: "",
  linkedDocument: null,
});

function AccountCombobox({
  value,
  onChange,
  accounts,
  invoices,
  bills,
  selectedDocument,
  onSelectDoc,
  onClearDoc,
  currency,
}: {
  value: string;
  onChange: (accountId: string) => void;
  accounts: Account[];
  invoices: InvoiceDoc[];
  bills: BillDoc[];
  selectedDocument?: LinkedDocument | null;
  onSelectDoc: (doc: LinkedDocument, accountId: string, amount: number) => void;
  onClearDoc: () => void;
  currency: string;
}) {
  const [open, setOpen] = useState(false);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === value),
    [accounts, value]
  );

  // These codes match the default accounts used by Ledgerflow.
  // If the company has different account codes, fall back by account type.
  const arAccount = useMemo(
    () =>
      accounts.find((a) => a.code === "1100") ??
      accounts.find((a) => a.type?.toLowerCase() === "asset"),
    [accounts]
  );

  const apAccount = useMemo(
    () =>
      accounts.find((a) => a.code === "2000") ??
      accounts.find((a) => a.type?.toLowerCase() === "liability"),
    [accounts]
  );

  const openInvoices = useMemo(
    () =>
      invoices.filter(
        (invoice) =>
          Math.max(
            0,
            Number(invoice.total || 0) - Number(invoice.amount_paid || 0)
          ) > 0.005
      ),
    [invoices]
  );

  const groupedAccounts = useMemo(() => {
    const groups: Record<string, Account[]> = {
      asset: [],
      liability: [],
      equity: [],
      revenue: [],
      expense: [],
    };

    for (const account of accounts) {
      const type = (account.type || "other").toLowerCase();
      if (!groups[type]) groups[type] = [];
      groups[type].push(account);
    }

    return groups;
  }, [accounts]);

  const accountTypeOrder = [
    "asset",
    "liability",
    "equity",
    "revenue",
    "expense",
  ];

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      modal={true}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full h-10 justify-between font-normal text-xs px-3 text-left"
        >
          <div className="min-w-0 flex items-center gap-2">
            {selectedDocument ? (
              <>
                {selectedDocument.type === "invoice" ? (
                  <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                ) : (
                  <Receipt className="h-3.5 w-3.5 text-primary shrink-0" />
                )}
                <span className="font-semibold shrink-0">
                  {selectedDocument.number}
                </span>
                <span className="truncate text-muted-foreground">
                  {selectedDocument.entityName}
                </span>
              </>
            ) : selectedAccount ? (
              <>
                <span className="font-mono font-semibold shrink-0">
                  {selectedAccount.code}
                </span>
                <span className="truncate">{selectedAccount.name}</span>
              </>
            ) : (
              <span className="text-muted-foreground">
                Select account, invoice or bill...
              </span>
            )}
          </div>

          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[430px] p-0 shadow-xl z-[300]"
      >
        <div className="border-b px-3 py-2 bg-muted/30">
          <div className="text-sm font-semibold">Select account or document</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Choose an account, open invoice, or outstanding bill.
          </div>
        </div>

        <div className="max-h-[420px] overflow-y-auto p-2">
          {/* Linked document currently selected */}
          {selectedDocument && (
            <div className="mb-3 rounded-md border bg-primary/5 p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wide font-semibold text-primary">
                    Selected document
                  </div>
                  <div className="text-xs font-semibold truncate">
                    {selectedDocument.number} · {selectedDocument.entityName}
                  </div>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    onClearDoc();
                    setOpen(false);
                  }}
                >
                  Clear
                </Button>
              </div>
            </div>
          )}

          {/* Invoices */}
          <div className="mb-3">
            <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/5 rounded">
              Invoices
            </div>

            {openInvoices.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                No open invoices. Fully paid receivables reflect in Receivables History.
              </div>
            ) : (
              <div className="mt-1 space-y-0.5">
                {openInvoices.map((invoice) => {
                  const outstanding = Math.max(
                    0,
                    Number(invoice.total || 0) -
                      Number(invoice.amount_paid || 0)
                  );
                  const customerName =
                    invoice.customer?.name ?? "Customer";

                  return (
                    <button
                      key={`invoice-${invoice.id}`}
                      type="button"
                      className="w-full flex items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left hover:bg-primary/10 transition-colors"
                      onClick={() => {
                        if (!arAccount) {
                          toast.error(
                            "No Accounts Receivable account is available."
                          );
                          return;
                        }

                        onSelectDoc(
                          {
                            type: "invoice",
                            id: invoice.id,
                            number: invoice.invoice_number,
                            entityName: customerName,
                            outstanding,
                          },
                          arAccount.id,
                          outstanding
                        );

                        setOpen(false);
                      }}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0">
                          <div className="font-semibold text-xs truncate">
                            {invoice.invoice_number}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {customerName}
                          </div>
                        </div>
                      </div>

                      <span className="font-mono text-[11px] shrink-0">
                        {formatMoney(outstanding, currency)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bills */}
          <div className="mb-3">
            <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/5 rounded">
              Bills
            </div>

            {bills.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                No bills available for this company.
              </div>
            ) : (
              <div className="mt-1 space-y-0.5">
                {bills.map((bill) => {
                  const outstanding = Math.max(
                    0,
                    Number(bill.total || 0) -
                      Number(bill.amount_paid || 0)
                  );
                  const supplierName =
                    bill.supplier?.name ?? "Supplier";

                  return (
                    <button
                      key={`bill-${bill.id}`}
                      type="button"
                      className="w-full flex items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left hover:bg-primary/10 transition-colors"
                      onClick={() => {
                        if (!apAccount) {
                          toast.error(
                            "No Accounts Payable account is available."
                          );
                          return;
                        }

                        onSelectDoc(
                          {
                            type: "bill",
                            id: bill.id,
                            number: bill.bill_number,
                            entityName: supplierName,
                            outstanding,
                          },
                          apAccount.id,
                          outstanding
                        );

                        setOpen(false);
                      }}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Receipt className="h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0">
                          <div className="font-semibold text-xs truncate">
                            {bill.bill_number}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {supplierName}
                          </div>
                        </div>
                      </div>

                      <span className="font-mono text-[11px] shrink-0">
                        {formatMoney(outstanding, currency)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Chart of accounts */}
          <div>
            <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/50 rounded">
              Chart of Accounts
            </div>

            {accounts.length === 0 ? (
              <div className="px-2 py-3 text-xs text-destructive">
                No accounts were loaded for this company.
              </div>
            ) : (
              <div className="mt-1">
                {accountTypeOrder.map((type) => {
                  const accountList = groupedAccounts[type] ?? [];
                  if (accountList.length === 0) return null;

                  return (
                    <div key={type} className="mb-2">
                      <div className="px-2 py-1 text-[10px] uppercase font-semibold text-muted-foreground">
                        {type}
                      </div>

                      {accountList.map((account) => (
                        <button
                          key={account.id}
                          type="button"
                          className={`w-full flex items-center justify-between rounded-md px-2.5 py-2 text-left text-xs hover:bg-muted transition-colors ${
                            value === account.id && !selectedDocument
                              ? "bg-muted font-medium"
                              : ""
                          }`}
                          onClick={() => {
                            onClearDoc();
                            onChange(account.id);
                            setOpen(false);
                          }}
                        >
                          <span className="min-w-0 truncate">
                            <span className="font-mono font-semibold mr-2">
                              {account.code}
                            </span>
                            {account.name}
                          </span>

                          {value === account.id && !selectedDocument && (
                            <Check className="h-4 w-4 shrink-0 text-primary" />
                          )}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function JournalsPage() {
  const { active } = useCompanies();

  const [journals, setJournals] = useState<Journal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDoc[]>([]);
  const [bills, setBills] = useState<BillDoc[]>([]);

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [entryDate, setEntryDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<JournalLine[]>([
    emptyLine(),
    emptyLine(),
  ]);

  const loadJournals = async (companyId: string) => {
    const { data, error } = await supabase
      .from("journals")
      .select(`
        id,
        entry_date,
        description,
        reference,
        source_type,
        source_id,
        created_at,
        journal_lines (
          account_id,
          debit,
          credit,
          account:accounts(code, name)
        )
      `)
      .eq("company_id", companyId)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw error;

    setJournals((data ?? []) as any);
  };

  const loadAccounts = async (companyId: string) => {
    // Seeding is kept separate from the other queries so a problem with
    // invoices/bills cannot cause the chart of accounts to disappear.
    try {
      await seedCompanyAccounts(companyId);
    } catch (error) {
      console.warn("Account seeding skipped:", error);
    }

    const { data, error } = await supabase
      .from("accounts")
      .select("id,code,name,type")
      .eq("company_id", companyId)
      .order("code");

    if (error) throw error;

    setAccounts((data ?? []) as Account[]);
  };

  const loadInvoices = async (companyId: string) => {
    /*
     * Do not use the nested customer:customers(name) relation here.
     * If the Supabase relationship is missing, that one query can fail and
     * make the entire journal selector look empty.
     */
    const { data, error } = await supabase
      .from("invoices" as any)
      .select("id,invoice_number,total,amount_paid,customer_id")
      .eq("company_id", companyId)
      .order("issue_date", { ascending: false });

    if (error) throw error;

    // Filter out completely paid receivables so they only reflect in Receivables History, not manual journal codes
    const invoiceRows = ((data ?? []) as InvoiceDoc[]).filter(
      (inv) =>
        Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0)) > 0.005
    );
    const customerIds = [
      ...new Set(
        invoiceRows
          .map((invoice) => invoice.customer_id)
          .filter(Boolean) as string[]
      ),
    ];

    if (customerIds.length === 0) {
      setInvoices(invoiceRows);
      return;
    }

    const { data: customers, error: customerError } = await supabase
      .from("customers")
      .select("id,name")
      .in("id", customerIds);

    if (customerError) {
      console.warn("Could not load invoice customer names:", customerError);
      setInvoices(invoiceRows);
      return;
    }

    const customerMap = new Map(
      ((customers ?? []) as { id: string; name: string }[]).map((c) => [
        c.id,
        c,
      ])
    );

    setInvoices(
      invoiceRows.map((invoice) => ({
        ...invoice,
        customer: invoice.customer_id
          ? customerMap.get(invoice.customer_id) ?? null
          : null,
      }))
    );
  };

  const loadBills = async (companyId: string) => {
    /*
     * Same approach as invoices: load bills independently so a supplier
     * relationship problem cannot wipe out the accounts/invoices.
     */
    const { data, error } = await supabase
      .from("bills" as any)
      .select("id,bill_number,total,amount_paid,supplier_id")
      .eq("company_id", companyId)
      .order("issue_date", { ascending: false });

    if (error) throw error;

    const billRows = (data ?? []) as BillDoc[];
    const supplierIds = [
      ...new Set(
        billRows
          .map((bill) => bill.supplier_id)
          .filter(Boolean) as string[]
      ),
    ];

    if (supplierIds.length === 0) {
      setBills(billRows);
      return;
    }

    const { data: suppliers, error: supplierError } = await supabase
      .from("suppliers")
      .select("id,name")
      .in("id", supplierIds);

    if (supplierError) {
      console.warn("Could not load bill supplier names:", supplierError);
      setBills(billRows);
      return;
    }

    const supplierMap = new Map(
      ((suppliers ?? []) as { id: string; name: string }[]).map((s) => [
        s.id,
        s,
      ])
    );

    setBills(
      billRows.map((bill) => ({
        ...bill,
        supplier: bill.supplier_id
          ? supplierMap.get(bill.supplier_id) ?? null
          : null,
      }))
    );
  };

  const load = async () => {
    if (!active) return;

    setLoadingData(true);

    try {
      if (isDemoMode()) {
        const demoJournals = JSON.parse(
          localStorage.getItem("ledgerflow.demo_journals") || "[]"
        );
        const demoAccounts = JSON.parse(
          localStorage.getItem("ledgerflow.demo_accounts") || "[]"
        );
        const demoInvoices = JSON.parse(
          localStorage.getItem("ledgerflow.demo_invoices") || "[]"
        );
        const demoBills = JSON.parse(
          localStorage.getItem("ledgerflow.demo_bills") || "[]"
        );

        setJournals(
          demoJournals.filter((j: any) => j.company_id === active.id)
        );
        setAccounts(
          demoAccounts.filter((a: any) => a.company_id === active.id)
        );
        setInvoices(
          demoInvoices.filter(
            (i: any) =>
              i.company_id === active.id &&
              Math.max(0, Number(i.total || 0) - Number(i.amount_paid || 0)) > 0.005
          )
        );
        setBills(
          demoBills.filter((b: any) => b.company_id === active.id)
        );

        return;
      }

      // Each dataset loads independently.
      // A failed bill query should NOT erase accounts and invoices.
      const results = await Promise.allSettled([
        loadJournals(active.id),
        loadAccounts(active.id),
        loadInvoices(active.id),
        loadBills(active.id),
      ]);

      const failures = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected"
      );

      if (failures.length > 0) {
        console.error("Journal page data loading errors:", failures);

        const messages = failures
          .map((failure) => failure.reason?.message)
          .filter(Boolean);

        toast.error(
          messages[0] ||
            "Some accounting data could not be loaded. Check the browser console."
        );
      }
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (active?.id) {
      load();
    }
  }, [active?.id]);

  const totalDebits = lines.reduce(
    (sum, line) => sum + (parseFloat(line.debit) || 0),
    0
  );

  const totalCredits = lines.reduce(
    (sum, line) => sum + (parseFloat(line.credit) || 0),
    0
  );

  const isBalanced =
    Math.abs(totalDebits - totalCredits) < 0.005;

  const updateLine = (
    index: number,
    field: keyof JournalLine,
    value: any
  ) => {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index
          ? { ...line, [field]: value }
          : line
      )
    );
  };

  const selectDocumentForLine = (
    index: number,
    document: LinkedDocument,
    accountId: string,
    amount: number
  ) => {
    setLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) return line;

        /*
         * Selecting an invoice (A/R) credits Accounts Receivable to reduce/clear outstanding balance.
         * Selecting a bill (A/P) debits Accounts Payable to reduce/clear outstanding balance.
         */
        const isInvoice = document.type === "invoice";

        return {
          ...line,
          account_id: accountId,
          linkedDocument: document,
          credit: isInvoice && amount > 0 ? amount.toFixed(2) : "",
          debit: !isInvoice && amount > 0 ? amount.toFixed(2) : "",
          description: `[${document.number}] ${document.entityName}`,
        };
      })
    );

    if (!reference.trim()) {
      setReference(document.number);
    }

    if (!description.trim()) {
      setDescription(
        `${document.type === "invoice" ? "Invoice" : "Bill"} ${document.number} - ${document.entityName}`
      );
    }
  };

  const clearDocumentForLine = (index: number) => {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index
          ? { ...line, linkedDocument: null }
          : line
      )
    );
  };

  const addLine = () => {
    setLines((current) => [...current, emptyLine()]);
  };

  const removeLine = (index: number) => {
    setLines((current) =>
      current.length <= 2
        ? current
        : current.filter((_, lineIndex) => lineIndex !== index)
    );
  };

  const resetForm = () => {
    setDescription("");
    setReference("");
    setEntryDate(new Date().toISOString().slice(0, 10));
    setLines([emptyLine(), emptyLine()]);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!active) return;

    if (!description.trim()) {
      toast.error("Enter a description");
      return;
    }

    if (lines.some((line) => !line.account_id)) {
      toast.error("Select an account for every journal line");
      return;
    }

    if (
      lines.some(
        (line) =>
          (parseFloat(line.debit) || 0) > 0 &&
          (parseFloat(line.credit) || 0) > 0
      )
    ) {
      toast.error(
        "A journal line cannot contain both a debit and a credit."
      );
      return;
    }

    if (!isBalanced) {
      toast.error(
        `Journal must balance. Difference: ${formatMoney(
          Math.abs(totalDebits - totalCredits),
          active.currency
        )}`
      );
      return;
    }

    if (
      lines.every(
        (line) =>
          (parseFloat(line.debit) || 0) === 0 &&
          (parseFloat(line.credit) || 0) === 0
      )
    ) {
      toast.error(
        "At least one line must have a debit or credit amount"
      );
      return;
    }

    setSubmitting(true);

    try {
      /*
       * Keep the payload compatible with the current createManualJournal()
       * implementation. The linked invoice/bill is used in the journal UI,
       * memo and reference. Persisting invoice_id/bill_id would require the
       * journal_lines schema/function to accept those fields as well.
       */
      await createManualJournal(
        active.id,
        entryDate,
        description.trim(),
        reference.trim() || null,
        lines.map((line) => ({
          account_id: line.account_id,
          debit: parseFloat(line.debit) || 0,
          credit: parseFloat(line.credit) || 0,
          linkedDocument: line.linkedDocument || null,
        }))
      );

      toast.success("Journal entry posted successfully");
      setOpen(false);
      resetForm();
      await load();
    } catch (error: any) {
      toast.error(
        error?.message || "Failed to post journal entry"
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!active) return null;

  return (
    <div className="px-6 md:px-10 py-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Journal Entries
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Double-entry financial audit trail · {journals.length} recorded
            entries
          </p>
        </div>

        <Dialog
          open={open}
          onOpenChange={(value) => {
            setOpen(value);
            if (!value) resetForm();
          }}
        >
          <Button
            onClick={() => setOpen(true)}
            disabled={loadingData}
          >
            <Plus className="h-4 w-4 mr-2" />
            New manual entry
          </Button>

          <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>New Journal Entry</DialogTitle>
            </DialogHeader>

            <form onSubmit={submit} className="space-y-5 pt-1">
              {/* Header */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>Entry date</Label>
                  <Input
                    type="date"
                    value={entryDate}
                    onChange={(event) =>
                      setEntryDate(event.target.value)
                    }
                    className="mt-1"
                    required
                  />
                </div>

                <div className="md:col-span-2">
                  <Label>Description / Memo</Label>
                  <Input
                    value={description}
                    onChange={(event) =>
                      setDescription(event.target.value)
                    }
                    className="mt-1"
                    placeholder="e.g. Customer payment, adjustment or write-off"
                    required
                  />
                </div>

                <div>
                  <Label>Reference (optional)</Label>
                  <Input
                    value={reference}
                    onChange={(event) =>
                      setReference(event.target.value)
                    }
                    className="mt-1 font-mono text-xs"
                    placeholder="e.g. INV-0001 or JNL-001"
                  />
                </div>
              </div>

              {/* Journal lines */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>
                    Journal lines
                  </Label>

                  <span className="text-xs text-muted-foreground">
                    Debits must equal credits
                  </span>
                </div>

                <div className="rounded-lg border overflow-visible">
                  <div className="hidden md:grid grid-cols-[minmax(250px,5fr)_minmax(160px,3fr)_minmax(100px,2fr)_minmax(100px,2fr)_36px] gap-2 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                    <span>Account / Invoice / Bill</span>
                    <span>Line Memo</span>
                    <span className="text-right">Debit</span>
                    <span className="text-right">Credit</span>
                    <span />
                  </div>

                  <div className="p-3 space-y-3">
                    {lines.map((line, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-1 md:grid-cols-[minmax(250px,5fr)_minmax(160px,3fr)_minmax(100px,2fr)_minmax(100px,2fr)_36px] gap-2 items-center"
                      >
                        <div className="min-w-0">
                          <AccountCombobox
                            value={line.account_id}
                            onChange={(accountId) =>
                              updateLine(
                                index,
                                "account_id",
                                accountId
                              )
                            }
                            accounts={accounts}
                            invoices={invoices}
                            bills={bills}
                            selectedDocument={line.linkedDocument}
                            onSelectDoc={(
                              document,
                              accountId,
                              amount
                            ) =>
                              selectDocumentForLine(
                                index,
                                document,
                                accountId,
                                amount
                              )
                            }
                            onClearDoc={() =>
                              clearDocumentForLine(index)
                            }
                            currency={active.currency}
                          />
                        </div>

                        <Input
                          className="text-xs"
                          placeholder="Optional note"
                          value={line.description}
                          onChange={(event) =>
                            updateLine(
                              index,
                              "description",
                              event.target.value
                            )
                          }
                        />

                        <Input
                          className="text-right font-mono text-xs"
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={line.debit}
                          onChange={(event) =>
                            updateLine(
                              index,
                              "debit",
                              event.target.value
                            )
                          }
                        />

                        <Input
                          className="text-right font-mono text-xs"
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={line.credit}
                          onChange={(event) =>
                            updateLine(
                              index,
                              "credit",
                              event.target.value
                            )
                          }
                        />

                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9"
                          onClick={() => removeLine(index)}
                          disabled={lines.length <= 2}
                        >
                          <Trash2 className="h-4 w-4 text-destructive/70" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={addLine}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add line
                </Button>
              </div>

              {/* Data status */}
              {(accounts.length === 0 ||
                invoices.length === 0 ||
                bills.length === 0) && (
                <div className="rounded-lg border bg-muted/30 p-3 text-xs">
                  <div className="font-medium mb-1">
                    Available data
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-muted-foreground">
                    <span>
                      Accounts:{" "}
                      <strong className="text-foreground">
                        {accounts.length}
                      </strong>
                    </span>
                    <span>
                      Invoices:{" "}
                      <strong className="text-foreground">
                        {invoices.length}
                      </strong>
                    </span>
                    <span>
                      Bills:{" "}
                      <strong className="text-foreground">
                        {bills.length}
                      </strong>
                    </span>
                  </div>
                </div>
              )}

              {/* Balance */}
              <div
                className={`rounded-lg p-3 text-sm flex flex-col md:flex-row md:items-center md:justify-between gap-3 ${
                  isBalanced
                    ? "bg-success/10 border border-success/20"
                    : "bg-destructive/10 border border-destructive/20"
                }`}
              >
                <div className="flex items-center gap-2">
                  {!isBalanced && (
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                  )}

                  <span
                    className={
                      isBalanced
                        ? "text-success font-medium"
                        : "text-destructive font-medium"
                    }
                  >
                    {isBalanced
                      ? "✓ Balanced"
                      : "Not balanced — debits must equal credits"}
                  </span>
                </div>

                <div className="flex gap-6 tabular-nums text-xs font-mono">
                  <span>
                    Debits:{" "}
                    <strong>
                      {formatMoney(
                        totalDebits,
                        active.currency
                      )}
                    </strong>
                  </span>

                  <span>
                    Credits:{" "}
                    <strong>
                      {formatMoney(
                        totalCredits,
                        active.currency
                      )}
                    </strong>
                  </span>

                  {!isBalanced && (
                    <span className="text-destructive font-bold">
                      Diff:{" "}
                      {formatMoney(
                        Math.abs(totalDebits - totalCredits),
                        active.currency
                      )}
                    </span>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="submit"
                  disabled={submitting || !isBalanced}
                >
                  {submitting
                    ? "Posting…"
                    : "Post journal entry"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Journal list */}
      <Card className="p-0 overflow-hidden">
        {journals.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <BookOpen className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
            No journal entries recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-left">
                <tr>
                  <th className="font-medium px-4 py-3 w-8" />
                  <th className="font-medium px-4 py-3">
                    Date
                  </th>
                  <th className="font-medium px-4 py-3">
                    Description / Memo
                  </th>
                  <th className="font-medium px-4 py-3">
                    Reference / Linked Doc
                  </th>
                  <th className="font-medium px-4 py-3">
                    Source
                  </th>
                  <th className="font-medium px-4 py-3 text-right">
                    Debit
                  </th>
                  <th className="font-medium px-4 py-3 text-right">
                    Credit
                  </th>
                </tr>
              </thead>

              <tbody>
                {journals.map((journal) => {
                  const totalDr =
                    journal.journal_lines.reduce(
                      (sum, line) =>
                        sum + Number(line.debit || 0),
                      0
                    );

                  const totalCr =
                    journal.journal_lines.reduce(
                      (sum, line) =>
                        sum + Number(line.credit || 0),
                      0
                    );

                  const isExpanded =
                    expandedId === journal.id;

                  const docRefMatch = (
                    journal.reference ||
                    journal.description ||
                    ""
                  ).match(/(INV-\d+|BILL-\d+)/i);

                  const linkedDoc = docRefMatch
                    ? docRefMatch[0].toUpperCase()
                    : null;

                  return (
                    <React.Fragment key={journal.id}>
                      <tr
                        className="border-t hover:bg-muted/20 transition-colors cursor-pointer"
                        onClick={() =>
                          setExpandedId(
                            isExpanded
                              ? null
                              : journal.id
                          )
                        }
                      >
                        <td className="px-4 py-3 text-muted-foreground">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </td>

                        <td className="px-4 py-3 tabular-nums text-muted-foreground">
                          {formatDate(journal.entry_date)}
                        </td>

                        <td className="px-4 py-3 font-medium">
                          {journal.description}
                        </td>

                        <td className="px-4 py-3 font-mono text-xs">
                          {linkedDoc ? (
                            <Link
                              to={
                                linkedDoc.startsWith("INV")
                                  ? "/app/receivables"
                                  : "/app/payables"
                              }
                              className="inline-flex items-center gap-1 hover:underline text-primary"
                              onClick={(event) =>
                                event.stopPropagation()
                              }
                            >
                              <Badge
                                variant="outline"
                                className="border-primary/40 text-primary bg-primary/5"
                              >
                                {linkedDoc.startsWith(
                                  "INV"
                                ) ? (
                                  <FileText className="h-3 w-3 mr-1" />
                                ) : (
                                  <Receipt className="h-3 w-3 mr-1" />
                                )}
                                {linkedDoc}
                                <ExternalLink className="h-3 w-3 ml-1" />
                              </Badge>
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">
                              {journal.reference ?? "—"}
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className="border-0 bg-muted/60 text-muted-foreground text-xs capitalize"
                          >
                            {SOURCE_LABEL[
                              journal.source_type ?? "manual"
                            ] ??
                              journal.source_type ??
                              "Manual"}
                          </Badge>
                        </td>

                        <td className="px-4 py-3 text-right tabular-nums font-mono font-medium">
                          {formatMoney(
                            totalDr,
                            active.currency
                          )}
                        </td>

                        <td className="px-4 py-3 text-right tabular-nums font-mono font-medium">
                          {formatMoney(
                            totalCr,
                            active.currency
                          )}
                        </td>
                      </tr>

                      {isExpanded &&
                        journal.journal_lines.map(
                          (line, index) => (
                            <tr
                              key={`${journal.id}-line-${index}`}
                              className="bg-muted/10 border-t border-dashed"
                            >
                              <td className="px-4 py-2" />
                              <td className="px-4 py-2" />
                              <td className="px-4 py-2 pl-8 text-muted-foreground text-xs">
                                <span className="font-mono mr-2 text-foreground font-semibold">
                                  {line.account?.code}
                                </span>
                                {line.account?.name}
                              </td>
                              <td
                                className="px-4 py-2"
                                colSpan={2}
                              />
                              <td className="px-4 py-2 text-right tabular-nums text-xs font-mono">
                                {Number(line.debit) > 0
                                  ? formatMoney(
                                      Number(
                                        line.debit
                                      ),
                                      active.currency
                                    )
                                  : "—"}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-xs font-mono">
                                {Number(line.credit) > 0
                                  ? formatMoney(
                                      Number(
                                        line.credit
                                      ),
                                      active.currency
                                    )
                                  : "—"}
                              </td>
                            </tr>
                          )
                        )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default JournalsPage;
