import React, { useEffect, useState, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  BookOpen,
  AlertTriangle,
  Search,
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
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { createManualJournal, seedCompanyAccounts } from "@/lib/accounting";
import { isDemoMode } from "@/lib/demo-workspace";

export const Route = createFileRoute("/app/journals")({
  component: JournalsPage,
});

type JournalLine = { account_id: string; debit: string; credit: string; description: string };
type Account = { id: string; code: string; name: string; type: string };
type InvoiceDoc = { id: string; invoice_number: string; total: number; amount_paid: number; customer?: { name: string } | null };
type BillDoc = { id: string; bill_number: string; total: number; amount_paid: number; supplier?: { name: string } | null };

type Journal = {
  id: string;
  entry_date: string;
  description: string;
  reference: string | null;
  source_type: string | null;
  source_id: string | null;
  created_at: string;
  journal_lines: { account_id: string; debit: number; credit: number; account: { code: string; name: string } | null }[];
};

const SOURCE_LABEL: Record<string, string> = {
  invoice: "Invoice",
  invoice_payment: "Invoice Payment",
  bill: "Bill",
  bill_payment: "Bill Payment",
  manual: "Manual",
  bank: "Bank",
};

/**
 * Custom Searchable Auto-Roll Combobox for Account & Sub-Ledger (Invoices/Bills) Selection
 */
function AccountCombobox({
  value,
  onChange,
  accounts,
  invoices,
  bills,
  onSelectDoc,
  currency,
}: {
  value: string;
  onChange: (accountId: string) => void;
  accounts: Account[];
  invoices: InvoiceDoc[];
  bills: BillDoc[];
  onSelectDoc: (doc: { type: "invoice" | "bill"; number: string; entityName: string; accountId: string }) => void;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedAccount = useMemo(() => accounts.find((a) => a.id === value), [accounts, value]);

  // Find default AR and AP accounts
  const arAccount = useMemo(() => accounts.find((a) => a.code === "1100") || accounts.find((a) => a.type === "asset"), [accounts]);
  const apAccount = useMemo(() => accounts.find((a) => a.code === "2000") || accounts.find((a) => a.type === "liability"), [accounts]);

  // Filter accounts by query
  const filteredAccounts = useMemo(() => {
    if (!query.trim()) return accounts;
    const q = query.toLowerCase();
    return accounts.filter((a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.type.toLowerCase().includes(q));
  }, [accounts, query]);

  // Filter open invoices & bills
  const filteredInvoices = useMemo(() => {
    if (!query.trim()) return invoices;
    const q = query.toLowerCase();
    return invoices.filter(
      (i) => i.invoice_number.toLowerCase().includes(q) || (i.customer?.name ?? "").toLowerCase().includes(q)
    );
  }, [invoices, query]);

  const filteredBills = useMemo(() => {
    if (!query.trim()) return bills;
    const q = query.toLowerCase();
    return bills.filter(
      (b) => b.bill_number.toLowerCase().includes(q) || (b.supplier?.name ?? "").toLowerCase().includes(q)
    );
  }, [bills, query]);

  // Account Type Groups
  const groupedAccounts = useMemo(() => {
    const groups: Record<string, Account[]> = {
      asset: [],
      liability: [],
      equity: [],
      revenue: [],
      expense: [],
    };
    filteredAccounts.forEach((a) => {
      const t = (a.type || "asset").toLowerCase();
      if (!groups[t]) groups[t] = [];
      groups[t].push(a);
    });
    return groups;
  }, [filteredAccounts]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal text-xs h-9 px-3 truncate"
        >
          {selectedAccount ? (
            <span className="truncate">
              <span className="font-mono font-medium mr-1.5">{selectedAccount.code}</span>
              {selectedAccount.name}
            </span>
          ) : (
            <span className="text-muted-foreground">Select account or invoice/bill...</span>
          )}
          <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] p-0 shadow-lg z-50">
        {/* Search header */}
        <div className="flex items-center border-b px-3 py-2 bg-muted/20">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground mr-2" />
          <input
            type="text"
            placeholder="Search account #, name, or INV/BILL..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>

        {/* Scrollable List */}
        <div className="max-h-[300px] overflow-y-auto p-1.5 space-y-3 text-xs">
          {/* Section 1: Invoices & Bills Sub-ledger */}
          {(filteredInvoices.length > 0 || filteredBills.length > 0) && (
            <div className="space-y-1">
              <div className="px-2 py-1 text-[11px] font-semibold text-primary uppercase tracking-wider bg-primary/5 rounded">
                Invoices & Bills (Sub-ledger)
              </div>

              {/* Invoices */}
              {filteredInvoices.map((inv) => {
                const outstanding = Math.max(0, inv.total - inv.amount_paid);
                return (
                  <button
                    key={`doc-inv-${inv.id}`}
                    type="button"
                    onClick={() => {
                      if (arAccount) onChange(arAccount.id);
                      onSelectDoc({
                        type: "invoice",
                        number: inv.invoice_number,
                        entityName: inv.customer?.name ?? "Customer",
                        accountId: arAccount?.id ?? "",
                      });
                      setOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-primary/10 text-left transition-colors text-xs"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="font-semibold text-foreground">{inv.invoice_number}</span>
                      <span className="text-muted-foreground truncate">({inv.customer?.name ?? "Customer"})</span>
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground shrink-0 ml-2">
                      {formatMoney(outstanding, currency)}
                    </span>
                  </button>
                );
              })}

              {/* Bills */}
              {filteredBills.map((bill) => {
                const outstanding = Math.max(0, bill.total - bill.amount_paid);
                return (
                  <button
                    key={`doc-bill-${bill.id}`}
                    type="button"
                    onClick={() => {
                      if (apAccount) onChange(apAccount.id);
                      onSelectDoc({
                        type: "bill",
                        number: bill.bill_number,
                        entityName: bill.supplier?.name ?? "Supplier",
                        accountId: apAccount?.id ?? "",
                      });
                      setOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-primary/10 text-left transition-colors text-xs"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Receipt className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="font-semibold text-foreground">{bill.bill_number}</span>
                      <span className="text-muted-foreground truncate">({bill.supplier?.name ?? "Supplier"})</span>
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground shrink-0 ml-2">
                      {formatMoney(outstanding, currency)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Section 2: Standard Chart of Accounts */}
          {Object.entries(groupedAccounts).map(([type, accs]) => {
            if (accs.length === 0) return null;
            return (
              <div key={type} className="space-y-0.5">
                <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {type} Accounts
                </div>
                {accs.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      onChange(a.id);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-muted text-left transition-colors text-xs ${
                      value === a.id ? "bg-muted font-medium" : ""
                    }`}
                  >
                    <span className="truncate">
                      <span className="font-mono font-medium mr-2 text-foreground">{a.code}</span>
                      {a.name}
                    </span>
                    {value === a.id && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  </button>
                ))}
              </div>
            );
          })}

          {filteredAccounts.length === 0 && filteredInvoices.length === 0 && filteredBills.length === 0 && (
            <div className="p-4 text-center text-muted-foreground text-xs">No matching account or invoice found.</div>
          )}
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<JournalLine[]>([
    { account_id: "", debit: "", credit: "", description: "" },
    { account_id: "", debit: "", credit: "", description: "" },
  ]);

  const load = async () => {
    if (!active) return;
    if (isDemoMode()) {
      const demoJournals = JSON.parse(localStorage.getItem("ledgerflow.demo_journals") || "[]");
      const demoAccounts = JSON.parse(localStorage.getItem("ledgerflow.demo_accounts") || "[]");
      const demoInvoices = JSON.parse(localStorage.getItem("ledgerflow.demo_invoices") || "[]");
      const demoBills = JSON.parse(localStorage.getItem("ledgerflow.demo_bills") || "[]");

      setJournals(demoJournals.filter((j: any) => j.company_id === active.id));
      setAccounts(demoAccounts.filter((a: any) => a.company_id === active.id));
      setInvoices(demoInvoices.filter((i: any) => i.company_id === active.id));
      setBills(demoBills.filter((b: any) => b.company_id === active.id));
      return;
    }

    try {
      await seedCompanyAccounts(active.id);

      const { data: jData, error } = await supabase
        .from("journals")
        .select(`
          id, entry_date, description, reference, source_type, source_id, created_at,
          journal_lines (
            account_id, debit, credit,
            account:accounts(code, name)
          )
        `)
        .eq("company_id", active.id)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) throw error;
      setJournals((jData ?? []) as any);

      const { data: aData } = await supabase
        .from("accounts")
        .select("id,code,name,type")
        .eq("company_id", active.id)
        .order("code");
      setAccounts((aData as Account[]) ?? []);

      const { data: iData } = await supabase
        .from("invoices")
        .select("id,invoice_number,total,amount_paid,customer:customers(name)")
        .eq("company_id", active.id)
        .order("issue_date", { ascending: false });
      setInvoices((iData as any[]) ?? []);

      const { data: bData } = await supabase
        .from("bills" as any)
        .select("id,bill_number,total,amount_paid,supplier:suppliers(name)")
        .eq("company_id", active.id)
        .order("issue_date", { ascending: false });
      setBills((bData as any[]) ?? []);
    } catch (err) {
      console.warn("Could not load journals from Supabase:", err);
      const demoJournals = JSON.parse(localStorage.getItem("ledgerflow.demo_journals") || "[]");
      const demoAccounts = JSON.parse(localStorage.getItem("ledgerflow.demo_accounts") || "[]");
      const demoInvoices = JSON.parse(localStorage.getItem("ledgerflow.demo_invoices") || "[]");
      const demoBills = JSON.parse(localStorage.getItem("ledgerflow.demo_bills") || "[]");

      setJournals(demoJournals.filter((j: any) => j.company_id === active.id));
      setAccounts(demoAccounts.filter((a: any) => a.company_id === active.id));
      setInvoices(demoInvoices.filter((i: any) => i.company_id === active.id));
      setBills(demoBills.filter((b: any) => b.company_id === active.id));
    }
  };

  useEffect(() => { load(); }, [active?.id]);

  // Totals
  const totalDebits = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredits = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.005;

  const updateLine = (i: number, field: keyof JournalLine, value: any) =>
    setLines(lines.map((x, j) => (j === i ? { ...x, [field]: value } : x)));

  const addLine = () =>
    setLines([...lines, { account_id: "", debit: "", credit: "", description: "" }]);

  const removeLine = (i: number) =>
    setLines(lines.filter((_, j) => j !== i));

  const resetForm = () => {
    setDescription("");
    setReference("");
    setEntryDate(new Date().toISOString().slice(0, 10));
    setLines([
      { account_id: "", debit: "", credit: "", description: "" },
      { account_id: "", debit: "", credit: "", description: "" },
    ]);
  };

  const handleSelectDocForLine = (
    lineIdx: number,
    doc: { type: "invoice" | "bill"; number: string; entityName: string; accountId: string }
  ) => {
    // 1. Update line description
    const memo = `[${doc.number}] ${doc.entityName}`;
    updateLine(lineIdx, "description", memo);

    // 2. Set reference if blank
    if (!reference.trim()) {
      setReference(doc.number);
    }

    // 3. Set journal header description if blank
    if (!description.trim()) {
      setDescription(`Journal entry for ${doc.number} (${doc.entityName})`);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active) return;
    if (!description.trim()) return toast.error("Enter a description");
    if (lines.some((l) => !l.account_id)) return toast.error("Select an account for every line");
    if (!isBalanced) return toast.error(`Journal must balance. Difference: ${formatMoney(Math.abs(totalDebits - totalCredits), active.currency)}`);
    if (lines.every((l) => (parseFloat(l.debit) || 0) === 0 && (parseFloat(l.credit) || 0) === 0))
      return toast.error("At least one line must have a debit or credit amount");

    setSubmitting(true);
    try {
      await createManualJournal(
        active.id,
        entryDate,
        description.trim(),
        reference.trim() || null,
        lines.map((l) => ({
          account_id: l.account_id,
          debit: parseFloat(l.debit) || 0,
          credit: parseFloat(l.credit) || 0,
        }))
      );
      toast.success("Journal entry posted successfully");
      setOpen(false);
      resetForm();
      load();
    } catch (err: any) {
      toast.error(err?.message || "Failed to post journal entry");
    } finally {
      setSubmitting(false);
    }
  };

  if (!active) return null;

  return (
    <div className="px-6 md:px-10 py-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Journal Entries</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Double-entry financial audit trail · {journals.length} recorded entries
          </p>
        </div>

        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> New manual entry</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>New Journal Entry</DialogTitle>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-5 pt-1">
              {/* Header fields */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Entry date</Label>
                  <Input
                    type="date"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="mt-1"
                    required
                  />
                </div>
                <div className="col-span-2">
                  <Label>Description / Memo</Label>
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="mt-1"
                    placeholder="e.g. Monthly adjustment or write-off"
                    required
                  />
                </div>
                <div>
                  <Label>Reference (optional)</Label>
                  <Input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="mt-1 font-mono text-xs"
                    placeholder="e.g. INV-0001 or JNL-001"
                  />
                </div>
              </div>

              {/* Line Items */}
              <div>
                <Label className="mb-2 block">Journal lines (debits must equal credits)</Label>

                {/* Column Headers */}
                <div className="grid grid-cols-12 gap-2 mb-1 px-1 text-xs font-medium text-muted-foreground">
                  <span className="col-span-5">Account / Linked Invoice & Bill</span>
                  <span className="col-span-3">Line Memo</span>
                  <span className="col-span-2 text-right">Debit</span>
                  <span className="col-span-2 text-right">Credit</span>
                </div>

                <div className="space-y-2">
                  {lines.map((l, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-5">
                        <AccountCombobox
                          value={l.account_id}
                          onChange={(v) => updateLine(i, "account_id", v)}
                          accounts={accounts}
                          invoices={invoices}
                          bills={bills}
                          onSelectDoc={(doc) => handleSelectDocForLine(i, doc)}
                          currency={active.currency}
                        />
                      </div>
                      <Input
                        className="col-span-3 text-xs"
                        placeholder="Optional note"
                        value={l.description}
                        onChange={(e) => updateLine(i, "description", e.target.value)}
                      />
                      <Input
                        className="col-span-2 text-right font-mono text-xs"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={l.debit}
                        onChange={(e) => updateLine(i, "debit", e.target.value)}
                      />
                      <Input
                        className="col-span-[1.5] text-right font-mono text-xs"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={l.credit}
                        onChange={(e) => updateLine(i, "credit", e.target.value)}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="col-span-0.5"
                        onClick={() => removeLine(i)}
                        disabled={lines.length <= 2}
                      >
                        <Trash2 className="h-4 w-4 text-destructive/70" />
                      </Button>
                    </div>
                  ))}
                </div>

                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={addLine}>
                  <Plus className="h-4 w-4 mr-2" /> Add line
                </Button>
              </div>

              {/* Balance indicator */}
              <div className={`rounded-lg p-3 text-sm flex items-center justify-between ${isBalanced ? "bg-success/10 border border-success/20" : "bg-destructive/10 border border-destructive/20"}`}>
                <div className="flex items-center gap-2">
                  {!isBalanced && <AlertTriangle className="h-4 w-4 text-destructive" />}
                  <span className={isBalanced ? "text-success font-medium" : "text-destructive font-medium"}>
                    {isBalanced ? "✓ Balanced" : "Not balanced — debits must equal credits"}
                  </span>
                </div>
                <div className="flex gap-6 tabular-nums text-xs font-mono">
                  <span>Debits: <strong>{formatMoney(totalDebits, active.currency)}</strong></span>
                  <span>Credits: <strong>{formatMoney(totalCredits, active.currency)}</strong></span>
                  {!isBalanced && (
                    <span className="text-destructive font-bold">Diff: {formatMoney(Math.abs(totalDebits - totalCredits), active.currency)}</span>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button type="submit" disabled={submitting || !isBalanced}>
                  {submitting ? "Posting…" : "Post journal entry"}
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
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-left">
              <tr>
                <th className="font-medium px-4 py-3 w-8"></th>
                <th className="font-medium px-4 py-3">Date</th>
                <th className="font-medium px-4 py-3">Description / Memo</th>
                <th className="font-medium px-4 py-3">Reference / Linked Doc</th>
                <th className="font-medium px-4 py-3">Source</th>
                <th className="font-medium px-4 py-3 text-right">Debit</th>
                <th className="font-medium px-4 py-3 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {journals.map((j) => {
                const totalDr = j.journal_lines.reduce((s, l) => s + Number(l.debit || 0), 0);
                const totalCr = j.journal_lines.reduce((s, l) => s + Number(l.credit || 0), 0);
                const isExpanded = expandedId === j.id;

                // Check for linked document patterns
                const docRefMatch = (j.reference || j.description || "").match(/(INV-\d+|BILL-\d+)/i);
                const linkedDoc = docRefMatch ? docRefMatch[0].toUpperCase() : null;

                return (
                  <React.Fragment key={j.id}>
                    <tr
                      className="border-t hover:bg-muted/20 transition-colors cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : j.id)}
                    >
                      <td className="px-4 py-3 text-muted-foreground">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">{formatDate(j.entry_date)}</td>
                      <td className="px-4 py-3 font-medium">{j.description}</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {linkedDoc ? (
                          <Link
                            to={linkedDoc.startsWith("INV") ? "/app/receivables" : "/app/payables"}
                            className="inline-flex items-center gap-1 hover:underline text-primary"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Badge variant="outline" className="border-primary/40 text-primary bg-primary/5">
                              {linkedDoc.startsWith("INV") ? <FileText className="h-3 w-3 mr-1" /> : <Receipt className="h-3 w-3 mr-1" />}
                              {linkedDoc}
                            </Badge>
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{j.reference ?? "—"}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="border-0 bg-muted/60 text-muted-foreground text-xs capitalize">
                          {SOURCE_LABEL[j.source_type ?? "manual"] ?? j.source_type ?? "Manual"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-mono font-medium">
                        {formatMoney(totalDr, active.currency)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-mono font-medium">
                        {formatMoney(totalCr, active.currency)}
                      </td>
                    </tr>

                    {/* Expanded lines */}
                    {isExpanded &&
                      j.journal_lines.map((line, idx) => (
                        <tr key={`${j.id}-line-${idx}`} className="bg-muted/10 border-t border-dashed">
                          <td className="px-4 py-2" />
                          <td className="px-4 py-2" />
                          <td className="px-4 py-2 pl-8 text-muted-foreground text-xs">
                            <span className="font-mono mr-2 text-foreground font-semibold">{line.account?.code}</span>
                            {line.account?.name}
                          </td>
                          <td className="px-4 py-2" colSpan={2} />
                          <td className="px-4 py-2 text-right tabular-nums text-xs font-mono">
                            {Number(line.debit) > 0 ? formatMoney(Number(line.debit), active.currency) : "—"}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-xs font-mono">
                            {Number(line.credit) > 0 ? formatMoney(Number(line.credit), active.currency) : "—"}
                          </td>
                        </tr>
                      ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
