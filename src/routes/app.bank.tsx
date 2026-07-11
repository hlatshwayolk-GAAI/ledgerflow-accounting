import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Landmark, FileSpreadsheet, CheckCircle, RefreshCcw, ArrowRight, ShieldAlert, ArrowDownLeft, ArrowUpRight, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompanies } from "@/hooks/use-company";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/app/bank")({
  component: BankReconciliationPage,
});

type BankAccount = { id: string; name: string; bank_name: string; account_number: string; account_id: string; account: { code: string; name: string } };

type BankTransaction = {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  amount: number;
  status: "unreconciled" | "reconciled";
  reconciled_to_type: string | null;
  reconciled_to_id: string | null;
  bank_account_id: string;
};

type Account = { id: string; code: string; name: string; type: string };

function BankReconciliationPage() {
  const { active } = useCompanies();
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [selectedTx, setSelectedTx] = useState<BankTransaction | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  
  // Suggested match states
  const [suggestedMatch, setSuggestedMatch] = useState<any | null>(null);
  const [directAccountId, setDirectAccountId] = useState("");

  // Modals
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Forms
  const [newAcc, setNewAcc] = useState({ name: "", bankName: "", accountNumber: "", accountId: "" });
  const [csvText, setCsvText] = useState("");

  const loadBankAccounts = async () => {
    if (!active) return;
    const { data } = await supabase
      .from("bank_accounts" as any)
      .select("id,name,bank_name,account_number,account_id,account:accounts(code,name)")
      .eq("company_id", active.id);
    setBankAccounts((data as any[]) ?? []);
  };

  const loadTransactions = async () => {
    if (!active) return;
    const { data } = await supabase
      .from("bank_transactions" as any)
      .select("id,date,description,reference,amount,status,reconciled_to_type,reconciled_to_id")
      .eq("company_id", active.id)
      .order("date", { ascending: false });
    const txs = (data as BankTransaction[]) ?? [];
    setTransactions(txs);
    if (txs.length > 0 && !selectedTx) {
      setSelectedTx(txs[0]);
    } else if (selectedTx) {
      const refreshed = txs.find(t => t.id === selectedTx.id);
      setSelectedTx(refreshed ?? (txs.length > 0 ? txs[0] : null));
    }
  };

  const loadAccounts = async () => {
    if (!active) return;
    const { data } = await supabase
      .from("accounts")
      .select("id,code,name,type")
      .eq("company_id", active.id)
      .order("code");
    setAccounts((data as Account[]) ?? []);
  };

  const load = async () => {
    await Promise.all([loadBankAccounts(), loadTransactions(), loadAccounts()]);
  };

  useEffect(() => { load(); }, [active?.id]);

  // Find suggested match for selected transaction
  useEffect(() => {
    if (!selectedTx || selectedTx.status === "reconciled" || !active) {
      setSuggestedMatch(null);
      return;
    }

    (async () => {
      const isDeposit = Number(selectedTx.amount) > 0;
      const targetAmount = Math.abs(Number(selectedTx.amount));

      if (isDeposit) {
        // Find matching outstanding Invoices
        const { data: invoices } = await supabase
          .from("invoices")
          .select("id,invoice_number,total,amount_paid,status,issue_date,customer:customers(name)")
          .eq("company_id", active.id)
          .neq("status", "paid");

        const matches = (invoices ?? []).filter(inv => {
          const remaining = Number(inv.total) - Number(inv.amount_paid);
          // Match by amount
          const amountMatch = Math.abs(remaining - targetAmount) < 0.01;
          // Match by proximity or reference
          const textMatch = selectedTx.description.toLowerCase().includes(inv.invoice_number.toLowerCase()) ||
                            selectedTx.description.toLowerCase().includes(inv.customer?.name.toLowerCase() ?? "");
          return amountMatch || textMatch;
        });

        if (matches.length > 0) {
          setSuggestedMatch({ type: "invoice", item: matches[0], label: `Invoice ${matches[0].invoice_number} — ${matches[0].customer?.name}` });
        } else {
          setSuggestedMatch(null);
        }
      } else {
        // Find matching outstanding Bills
        const { data: bills } = await supabase
          .from("bills" as any)
          .select("id,bill_number,total,amount_paid,status,issue_date,supplier:suppliers(name)")
          .eq("company_id", active.id)
          .neq("status", "paid");

        const matches = (bills ?? []).filter(bill => {
          const remaining = Number(bill.total) - Number(bill.amount_paid);
          const amountMatch = Math.abs(remaining - targetAmount) < 0.01;
          const textMatch = selectedTx.description.toLowerCase().includes(bill.bill_number.toLowerCase()) ||
                            selectedTx.description.toLowerCase().includes(bill.supplier?.name.toLowerCase() ?? "");
          return amountMatch || textMatch;
        });

        if (matches.length > 0) {
          setSuggestedMatch({ type: "bill", item: matches[0], label: `Supplier Bill ${matches[0].bill_number} — ${matches[0].supplier?.name}` });
        } else {
          setSuggestedMatch(null);
        }
      }
    })();
  }, [selectedTx, active]);

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active) return;
    if (!newAcc.accountId) return toast.error("Please select a Chart of Accounts bank account");

    const { error } = await supabase
      .from("bank_accounts" as any)
      .insert({
        company_id: active.id,
        name: newAcc.name,
        bank_name: newAcc.bankName,
        account_number: newAcc.accountNumber,
        account_id: newAcc.accountId,
      });

    if (error) return toast.error(error.message);
    toast.success("Bank account linked successfully");
    setAddAccountOpen(false);
    setNewAcc({ name: "", bankName: "", accountNumber: "", accountId: "" });
    loadBankAccounts();
  };

  const handleImportCSV = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active || bankAccounts.length === 0) return toast.error("Create a linked bank account first");
    if (!csvText.trim()) return toast.error("Paste statement CSV contents first");

    try {
      // Parse CSV: Date, Description, Reference, Amount
      // Example row: 2026-06-08,Rent Payment,REF-889,-5000.00
      const lines = csvText.split("\n").map(l => l.trim()).filter(Boolean);
      const rowsToInsert = [];
      const bankAccountId = bankAccounts[0].id; // Default to first account for simplicity

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (i === 0 && line.toLowerCase().includes("date") && line.toLowerCase().includes("amount")) {
          // Skip header row
          continue;
        }
        const cols = line.split(",").map(c => c.trim().replace(/^["']|["']$/g, ''));
        if (cols.length < 3) continue;

        const date = cols[0];
        const description = cols[1];
        const reference = cols[2] || null;
        const amount = Number(cols[3] || cols[2]); // fall back if no reference

        if (!date || isNaN(Date.parse(date)) || isNaN(amount)) {
          throw new Error(`Invalid data on row ${i + 1}: ${line}`);
        }

        rowsToInsert.push({
          company_id: active.id,
          bank_account_id: bankAccountId,
          date,
          description,
          reference,
          amount,
          status: "unreconciled",
        });
      }

      const { error } = await supabase.from("bank_transactions" as any).insert(rowsToInsert);
      if (error) throw error;

      toast.success(`Successfully imported ${rowsToInsert.length} transactions`);
      setImportOpen(false);
      setCsvText("");
      loadTransactions();
    } catch (err: any) {
      toast.error(err.message || "Failed to parse CSV");
    }
  };

  // Reconcile via suggested match (invoice/bill payment)
  const handleReconcileMatch = async () => {
    if (!selectedTx || !suggestedMatch || !active) return;
    try {
      const txAmount = Math.abs(Number(selectedTx.amount));
      const targetBankCode = bankAccounts.find(ba => ba.id === selectedTx.bank_account_id)?.account?.code || "1000";

      if (suggestedMatch.type === "invoice") {
        const { data: journalId, error } = await supabase.rpc("record_invoice_payment", {
          _invoice_id: suggestedMatch.item.id,
          _amount: txAmount,
          _payment_date: selectedTx.date,
          _bank_account_code: targetBankCode,
          _notes: `Reconciled via Bank Statement: ${selectedTx.description}`,
        });
        if (error) throw error;

        // Mark txn reconciled
        await supabase
          .from("bank_transactions" as any)
          .update({ status: "reconciled", reconciled_to_type: "invoice", reconciled_to_id: suggestedMatch.item.id })
          .eq("id", selectedTx.id);
      } else {
        const { data: journalId, error } = await supabase.rpc("record_bill_payment" as any, {
          _bill_id: suggestedMatch.item.id,
          _amount: txAmount,
          _payment_date: selectedTx.date,
          _bank_account_code: targetBankCode,
          _notes: `Reconciled via Bank Statement: ${selectedTx.description}`,
        });
        if (error) throw error;

        // Mark txn reconciled
        await supabase
          .from("bank_transactions" as any)
          .update({ status: "reconciled", reconciled_to_type: "bill", reconciled_to_id: suggestedMatch.item.id })
          .eq("id", selectedTx.id);
      }

      toast.success("Transaction reconciled!");
      loadTransactions();
    } catch (err: any) {
      toast.error(err.message || "Failed to reconcile");
    }
  };

  // Reconcile via Direct Categorization
  const handleReconcileDirect = async () => {
    if (!selectedTx || !directAccountId || !active) return;
    try {
      const txAmount = Math.abs(Number(selectedTx.amount));
      const targetBankAcc = bankAccounts.find(ba => ba.id === selectedTx.bank_account_id);
      const targetBankAccountId = targetBankAcc?.account_id;
      const targetBankCode = targetBankAcc?.account?.code || "1000";

      if (!targetBankAccountId) throw new Error("Linked bank account not configured properly");

      // Insert Journal Entry
      const { data: journal, error: jErr } = await supabase
        .from("journals")
        .insert({
          company_id: active.id,
          entry_date: selectedTx.date,
          description: `Direct Bank Reconciliation — ${selectedTx.description}`,
          source_type: "bank_direct",
          source_id: selectedTx.id,
        })
        .select("id")
        .single();
      if (jErr) throw jErr;

      // Create balancing journal lines
      const isDeposit = Number(selectedTx.amount) > 0;
      const lines = [];

      if (isDeposit) {
        // Deposit: Dr Bank (1000), Cr Revenue/Other Selected Account
        lines.push({ journal_id: journal.id, account_id: targetBankAccountId, debit: txAmount, credit: 0 });
        lines.push({ journal_id: journal.id, account_id: directAccountId, debit: 0, credit: txAmount });
      } else {
        // Withdrawal: Dr Expense/Other Selected Account, Cr Bank (1000)
        lines.push({ journal_id: journal.id, account_id: directAccountId, debit: txAmount, credit: 0 });
        lines.push({ journal_id: journal.id, account_id: targetBankAccountId, debit: 0, credit: txAmount });
      }

      const { error: jlErr } = await supabase.from("journal_lines").insert(lines);
      if (jlErr) throw jlErr;

      // Update bank transaction status
      await supabase
        .from("bank_transactions" as any)
        .update({ status: "reconciled", reconciled_to_type: "direct", reconciled_to_id: journal.id })
        .eq("id", selectedTx.id);

      toast.success("Transaction reconciled directly!");
      setDirectAccountId("");
      loadTransactions();
    } catch (err: any) {
      toast.error(err.message || "Failed to reconcile");
    }
  };

  if (!active) return null;

  return (
    <div className="px-6 md:px-10 py-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bank Reconciliation</h1>
          <p className="text-sm text-muted-foreground mt-1">Match bank transactions to ledger entries.</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={addAccountOpen} onOpenChange={setAddAccountOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><Plus className="h-4 w-4 mr-2" /> Link bank account</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Link bank account</DialogTitle></DialogHeader>
              <form onSubmit={handleAddAccount} className="space-y-4">
                <div>
                  <Label>Account name</Label>
                  <Input value={newAcc.name} onChange={e => setNewAcc({ ...newAcc, name: e.target.value })} className="mt-1" required placeholder="Primary Business Cheque" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Bank name</Label>
                    <Input value={newAcc.bankName} onChange={e => setNewAcc({ ...newAcc, bankName: e.target.value })} className="mt-1" required placeholder="FNB" />
                  </div>
                  <div>
                    <Label>Account number</Label>
                    <Input value={newAcc.accountNumber} onChange={e => setNewAcc({ ...newAcc, accountNumber: e.target.value })} className="mt-1" required placeholder="62012345678" />
                  </div>
                </div>
                <div>
                  <Label>Chart of Accounts mapping</Label>
                  <Select value={newAcc.accountId} onValueChange={val => setNewAcc({ ...newAcc, accountId: val })}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select bank asset account" /></SelectTrigger>
                    <SelectContent>
                      {accounts.filter(a => a.type === "asset" && a.code.startsWith("10")).map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter><Button type="submit">Link account</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger asChild>
              <Button disabled={bankAccounts.length === 0}><FileSpreadsheet className="h-4 w-4 mr-2" /> Import CSV Statement</Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader><DialogTitle>Import bank statement CSV</DialogTitle></DialogHeader>
              <form onSubmit={handleImportCSV} className="space-y-4">
                <div>
                  <Label>Select Bank Account to Import To</Label>
                  <div className="p-3 bg-muted/40 rounded-lg text-sm font-medium mt-1">
                    {bankAccounts[0]?.name} ({bankAccounts[0]?.bank_name})
                  </div>
                </div>
                <div>
                  <Label>Paste CSV statement contents</Label>
                  <p className="text-xs text-muted-foreground mb-2">Columns format: <code className="bg-muted p-0.5 rounded">Date,Description,Reference,Amount</code>. Withdrawals should have negative values.</p>
                  <Textarea
                    rows={8}
                    value={csvText}
                    onChange={e => setCsvText(e.target.value)}
                    className="font-mono text-xs mt-1"
                    placeholder="2026-06-08,FNB Fee,BANKCHARGE,-85.00&#10;2026-06-09,Direct Deposit Joe,INV-0001,5000.00"
                    required
                  />
                </div>
                <DialogFooter><Button type="submit">Import statement lines</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {bankAccounts.length === 0 && (
        <Card className="p-8 text-center max-w-xl mx-auto space-y-3 mb-8">
          <Landmark className="h-10 w-10 mx-auto text-primary" />
          <h2 className="font-semibold text-lg">No bank accounts linked</h2>
          <p className="text-sm text-muted-foreground">You must link a bank account map to your Chart of Accounts asset ledger before importing transactions.</p>
        </Card>
      )}

      {bankAccounts.length > 0 && (
        <div className="grid md:grid-cols-12 gap-6">
          {/* Left list of transactions */}
          <div className="md:col-span-5 space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Statement Transactions</h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent text-accent-foreground">
                {transactions.filter(t => t.status === "unreconciled").length} unreconciled
              </span>
            </div>

            <Card className="p-0 max-h-[600px] overflow-y-auto divide-y">
              {transactions.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No transactions imported. Import a CSV statement to begin reconciliation.</div>
              ) : (
                transactions.map((tx) => {
                  const isDeposit = Number(tx.amount) > 0;
                  const isSelected = selectedTx?.id === tx.id;
                  return (
                    <div
                      key={tx.id}
                      onClick={() => setSelectedTx(tx)}
                      className={`p-4 cursor-pointer transition-colors text-left flex items-center justify-between gap-3 ${
                        isSelected ? "bg-primary/5 border-l-2 border-primary" : "hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{formatDate(tx.date)}</span>
                          {tx.status === "reconciled" ? (
                            <span className="inline-flex items-center text-[10px] bg-success/15 text-success font-medium px-1.5 py-0.2 rounded-full">
                              Reconciled
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-[10px] bg-warning/15 text-warning-foreground font-medium px-1.5 py-0.2 rounded-full">
                              Unmatched
                            </span>
                          )}
                        </div>
                        <p className="font-medium text-sm mt-1 truncate text-foreground">{tx.description}</p>
                        {tx.reference && <p className="text-xs text-muted-foreground mt-0.5 truncate">Ref: {tx.reference}</p>}
                      </div>
                      <div className="text-right flex items-center gap-2">
                        <span className={`font-semibold tabular-nums ${isDeposit ? "text-success" : "text-foreground"}`}>
                          {isDeposit ? "+" : ""}{formatMoney(tx.amount, active.currency)}
                        </span>
                        {isDeposit ? (
                          <ArrowDownLeft className="h-4 w-4 text-success shrink-0" />
                        ) : (
                          <ArrowUpRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </Card>
          </div>

          {/* Right Matching Workspace */}
          <div className="md:col-span-7">
            {selectedTx ? (
              <div className="space-y-4">
                <Card className="p-6">
                  <h3 className="font-semibold text-lg border-b pb-3 mb-4">Reconciliation Workspace</h3>
                  
                  {/* Selected Transaction Summary */}
                  <div className="rounded-xl bg-muted/40 p-4 border space-y-3">
                    <div className="flex justify-between text-xs text-muted-foreground uppercase tracking-wide">
                      <span>Transaction Detail</span>
                      <span className="font-mono text-[10px]">{selectedTx.id.slice(0, 8)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs text-muted-foreground">Date</div>
                        <div className="font-medium">{formatDate(selectedTx.date)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Amount</div>
                        <div className={`font-semibold text-lg tabular-nums ${Number(selectedTx.amount) > 0 ? "text-success" : "text-foreground"}`}>
                          {formatMoney(selectedTx.amount, active.currency)}
                        </div>
                      </div>
                      <div className="col-span-2">
                        <div className="text-xs text-muted-foreground">Description / Payee</div>
                        <div className="font-medium">{selectedTx.description}</div>
                      </div>
                      {selectedTx.reference && (
                        <div className="col-span-2">
                          <div className="text-xs text-muted-foreground">Reference</div>
                          <div className="font-mono text-xs">{selectedTx.reference}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {selectedTx.status === "reconciled" ? (
                    <div className="mt-6 p-6 border border-success/30 rounded-xl bg-success/5 text-center space-y-2">
                      <CheckCircle className="h-10 w-10 mx-auto text-success" />
                      <h4 className="font-semibold text-success">This transaction is reconciled</h4>
                      <p className="text-sm text-muted-foreground">
                        Matched to a {selectedTx.reconciled_to_type === "direct" ? "directly categorized ledger entry" : `ledger ${selectedTx.reconciled_to_type}`} in double entry.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-6 space-y-6">
                      {/* 1. Suggested Match */}
                      {suggestedMatch ? (
                        <div className="p-5 border border-success/40 bg-success/5 rounded-xl space-y-4">
                          <div className="flex items-center gap-2 text-success">
                            <CheckCircle className="h-5 w-5" />
                            <span className="font-medium text-sm uppercase tracking-wide">Suggested Match Found</span>
                          </div>
                          <div className="text-sm">
                            <p className="font-medium">{suggestedMatch.label}</p>
                            <p className="text-muted-foreground text-xs mt-1">
                              Issued: {formatDate(suggestedMatch.item.issue_date)} · Total: {formatMoney(Number(suggestedMatch.item.total), active.currency)}
                            </p>
                          </div>
                          <Button onClick={handleReconcileMatch} className="w-full bg-success hover:bg-success/90 text-success-foreground">
                            Match & Reconcile <ArrowRight className="h-4 w-4 ml-2" />
                          </Button>
                        </div>
                      ) : (
                        <div className="p-4 border border-dashed rounded-xl text-center text-sm text-muted-foreground bg-muted/10 space-y-1">
                          <Search className="h-5 w-5 mx-auto text-muted-foreground/60 mb-1" />
                          <p className="font-medium">No direct invoice/bill matches found</p>
                          <p className="text-xs text-muted-foreground/85">Verify if the invoice or bill exists, or use direct categorization below.</p>
                        </div>
                      )}

                      {/* 2. Direct Categorization */}
                      <div className="border-t pt-5">
                        <h4 className="font-semibold text-sm text-foreground mb-3">Or: Categorize Directly</h4>
                        <div className="space-y-4">
                          <div>
                            <Label className="text-xs">Category Account</Label>
                            <Select value={directAccountId} onValueChange={setDirectAccountId}>
                              <SelectTrigger className="mt-1"><SelectValue placeholder="Choose account (e.g. Bank Charges, Rent)" /></SelectTrigger>
                              <SelectContent>
                                {accounts.map(a => (
                                  <SelectItem key={a.id} value={a.id}>{a.code} — {a.name} ({a.type})</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button onClick={handleReconcileDirect} disabled={!directAccountId} className="w-full">
                            Post Journal & Reconcile
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              </div>
            ) : (
              <Card className="p-12 text-center text-muted-foreground text-sm">
                Select a bank transaction from the left column to reconcile.
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
