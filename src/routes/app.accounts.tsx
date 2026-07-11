import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCompanies } from "@/hooks/use-company";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { formatMoney, formatDate } from "@/lib/format";

export const Route = createFileRoute("/app/accounts")({
  component: AccountsPage,
});

type Account = {
  id: string;
  code: string;
  name: string;
  type: string;
  balance?: number;
  totalDebit?: number;
  totalCredit?: number;
};

type LedgerEntry = {
  journal_id: string;
  entry_date: string;
  description: string;
  reference: string | null;
  debit: number;
  credit: number;
  running_balance: number;
};

const TYPE_COLOR: Record<string, string> = {
  asset: "bg-primary/10 text-primary",
  liability: "bg-warning/20 text-warning-foreground",
  equity: "bg-chart-5/15 text-chart-5",
  revenue: "bg-success/15 text-success",
  expense: "bg-destructive/10 text-destructive",
};

const TEMPLATES = [
  { code: "1500", name: "Buildings & Property", type: "asset", description: "Fixed Asset: Land and Buildings" },
  { code: "1550", name: "Accumulated Depreciation", type: "asset", description: "Contra Asset: Buildings wear & tear" },
  { code: "2200", name: "Corporate Tax Payable", type: "liability", description: "Tax Liability: Tax owed to receiver" },
  { code: "3010", name: "Capital Contribution", type: "equity", description: "Equity: Owner capital contributions" },
  { code: "6300", name: "Depreciation Expense", type: "expense", description: "Expense: Asset value reduction" },
  { code: "7000", name: "Income Tax Expense", type: "expense", description: "Expense: Company income taxation" },
];

function AccountsPage() {
  const { active } = useCompanies();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<Record<string, LedgerEntry[]>>({});
  const [ledgerLoading, setLedgerLoading] = useState<string | null>(null);

  // Form states
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<"asset" | "liability" | "equity" | "revenue" | "expense">("asset");

  const load = async () => {
    if (!active) return;
    setLoading(true);
    // Load accounts
    const { data: accs } = await supabase
      .from("accounts")
      .select("id,code,name,type")
      .eq("company_id", active.id)
      .order("code");

    if (!accs) { setLoading(false); return; }

    // Load all journal lines for this company to compute balances
    const { data: journals } = await supabase
      .from("journals")
      .select("id, entry_date, journal_lines(account_id, debit, credit)")
      .eq("company_id", active.id);

    // Aggregate balances per account
    const balanceMap: Record<string, { debit: number; credit: number }> = {};
    accs.forEach(a => { balanceMap[a.id] = { debit: 0, credit: 0 }; });

    (journals ?? []).forEach((j: any) => {
      (j.journal_lines ?? []).forEach((l: any) => {
        if (balanceMap[l.account_id]) {
          balanceMap[l.account_id].debit += Number(l.debit || 0);
          balanceMap[l.account_id].credit += Number(l.credit || 0);
        }
      });
    });

    const enriched = accs.map(a => {
      const { debit, credit } = balanceMap[a.id] ?? { debit: 0, credit: 0 };
      // Normal balance: assets/expenses debit-normal; liabilities/equity/revenue credit-normal
      const balance = (a.type === "asset" || a.type === "expense")
        ? debit - credit
        : credit - debit;
      return { ...a, balance, totalDebit: debit, totalCredit: credit } as Account;
    });

    setAccounts(enriched);
    setLoading(false);
  };

  // Subscribe to real-time changes
  useEffect(() => {
    if (!active?.id) return;
    load();
    const channel = supabase
      .channel(`accounts-ledger-${active.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "journal_lines" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "journals", filter: `company_id=eq.${active.id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "accounts", filter: `company_id=eq.${active.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [active?.id]);

  const loadLedger = async (accountId: string) => {
    if (ledger[accountId]) return; // already loaded
    setLedgerLoading(accountId);
    const { data, error } = await supabase
      .from("journals")
      .select(`
        id, entry_date, description, reference,
        journal_lines!inner(account_id, debit, credit)
      `)
      .eq("company_id", active!.id)
      .eq("journal_lines.account_id", accountId)
      .order("entry_date", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      toast.error("Failed to load ledger");
      setLedgerLoading(null);
      return;
    }

    const acc = accounts.find(a => a.id === accountId);
    const isDebitNormal = acc?.type === "asset" || acc?.type === "expense";
    let runningBalance = 0;

    const entries: LedgerEntry[] = (data ?? []).flatMap((j: any) =>
      (j.journal_lines ?? [])
        .filter((l: any) => l.account_id === accountId)
        .map((l: any) => {
          const dr = Number(l.debit || 0);
          const cr = Number(l.credit || 0);
          runningBalance += isDebitNormal ? (dr - cr) : (cr - dr);
          return {
            journal_id: j.id,
            entry_date: j.entry_date,
            description: j.description,
            reference: j.reference,
            debit: dr,
            credit: cr,
            running_balance: runningBalance,
          };
        })
    );

    setLedger(prev => ({ ...prev, [accountId]: entries }));
    setLedgerLoading(null);
  };

  const toggleExpand = async (accountId: string) => {
    if (expandedId === accountId) {
      setExpandedId(null);
    } else {
      setExpandedId(accountId);
      await loadLedger(accountId);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active) return;
    if (!code || !name) return toast.error("Please fill in code and name");

    setLoading(true);
    const { error } = await supabase.from("accounts").insert({
      company_id: active.id,
      code: code.trim(),
      name: name.trim(),
      type
    });
    setLoading(false);

    if (error) {
      toast.error(error.message || "Failed to create account");
    } else {
      toast.success("Account created successfully");
      setOpen(false);
      setCode("");
      setName("");
      // Invalidate cached ledger
      setLedger({});
      load();
    }
  };

  const addTemplate = async (tmpl: typeof TEMPLATES[0]) => {
    if (!active) return;
    if (accounts.some(a => a.code === tmpl.code)) {
      return toast.warning(`Account code ${tmpl.code} already exists.`);
    }

    setLoading(true);
    const { error } = await supabase.from("accounts").insert({
      company_id: active.id,
      code: tmpl.code,
      name: tmpl.name,
      type: tmpl.type as any
    });
    setLoading(false);

    if (error) {
      toast.error(error.message || "Failed to add template account");
    } else {
      toast.success(`Added ${tmpl.name} (${tmpl.code})`);
      setLedger({});
      load();
    }
  };

  if (!active) return null;

  // Group by type
  const grouped: Record<string, Account[]> = {};
  accounts.forEach(a => {
    if (!grouped[a.type]) grouped[a.type] = [];
    grouped[a.type].push(a);
  });
  const typeOrder = ["asset", "liability", "equity", "revenue", "expense"];

  return (
    <div className="px-6 md:px-10 py-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Chart of Accounts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ledger balances updated automatically from all transactions.
          </p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="shadow-sm">
              <Plus className="h-4 w-4 mr-2" /> Add Account
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add Account</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 pt-2">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <Label htmlFor="code">Code</Label>
                  <Input
                    id="code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="e.g. 1500"
                    className="mt-1.5"
                    required
                  />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="name">Account Name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Buildings"
                    className="mt-1.5"
                    required
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="type">Account Type</Label>
                <Select value={type} onValueChange={(val: any) => setType(val)}>
                  <SelectTrigger id="type" className="mt-1.5 w-full">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asset">Asset (e.g. Cash, Buildings)</SelectItem>
                    <SelectItem value="liability">Liability (e.g. Accounts Payable, VAT)</SelectItem>
                    <SelectItem value="equity">Equity (e.g. Capital, Earnings)</SelectItem>
                    <SelectItem value="revenue">Revenue (e.g. Sales, Service Income)</SelectItem>
                    <SelectItem value="expense">Expense (e.g. Rent, Depreciation)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="border-t pt-4 mt-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-2">
                  <Sparkles className="h-3 w-3 text-primary animate-pulse" /> Quick Add Common Accounts
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {TEMPLATES.map((tmpl) => {
                    const exists = accounts.some(a => a.code === tmpl.code);
                    return (
                      <Button
                        key={tmpl.code}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={exists || loading}
                        onClick={() => addTemplate(tmpl)}
                        className="justify-start text-left h-auto py-2 text-xs flex flex-col items-start gap-0.5 border bg-muted/20 hover:bg-muted/50 transition-colors"
                      >
                        <span className="font-semibold text-foreground flex items-center gap-1">
                          {tmpl.code} — {tmpl.name}
                          {exists && <Badge variant="outline" className="text-[9px] py-0 px-1 border-success text-success bg-success/5 h-4">Added</Badge>}
                        </span>
                        <span className="text-[10px] text-muted-foreground truncate max-w-full">{tmpl.description}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>

              <DialogFooter className="pt-2">
                <Button type="submit" disabled={loading}>
                  {loading ? "Adding..." : "Add Account"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Accounts grouped by type with ledger detail */}
      <div className="space-y-6">
        {typeOrder.map(typeKey => {
          const accs = grouped[typeKey];
          if (!accs || accs.length === 0) return null;
          const groupTotal = accs.reduce((s, a) => s + (a.balance ?? 0), 0);
          return (
            <Card key={typeKey} className="p-0 overflow-hidden shadow-sm">
              {/* Group header */}
              <div className="px-6 py-3 bg-muted/30 border-b flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={`border-0 capitalize font-semibold ${TYPE_COLOR[typeKey] ?? "bg-muted"}`}>
                    {typeKey}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{accs.length} account{accs.length !== 1 ? "s" : ""}</span>
                </div>
                <span className="text-sm font-semibold tabular-nums">
                  {formatMoney(groupTotal, active.currency)}
                </span>
              </div>

              {/* Accounts table */}
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-muted-foreground text-left border-b">
                  <tr>
                    <th className="font-medium px-6 py-2.5 w-8"></th>
                    <th className="font-medium px-4 py-2.5">Code</th>
                    <th className="font-medium px-4 py-2.5">Account Name</th>
                    <th className="font-medium px-4 py-2.5 text-right">Total Debits</th>
                    <th className="font-medium px-4 py-2.5 text-right">Total Credits</th>
                    <th className="font-medium px-4 py-2.5 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {accs.map((a) => {
                    const isExpanded = expandedId === a.id;
                    const isLoadingLedger = ledgerLoading === a.id;
                    const entries = ledger[a.id] ?? [];
                    const hasActivity = (a.totalDebit ?? 0) > 0 || (a.totalCredit ?? 0) > 0;

                    return (
                      <>
                        <tr
                          key={a.id}
                          className="border-t hover:bg-muted/10 transition-colors cursor-pointer"
                          onClick={() => toggleExpand(a.id)}
                        >
                          <td className="px-6 py-3 text-muted-foreground">
                            {isLoadingLedger
                              ? <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                              : isExpanded
                                ? <ChevronDown className="h-4 w-4" />
                                : <ChevronRight className="h-4 w-4" />}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs font-semibold">{a.code}</td>
                          <td className="px-4 py-3 font-medium text-foreground">{a.name}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                            {hasActivity ? formatMoney(a.totalDebit ?? 0, active.currency) : "—"}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                            {hasActivity ? formatMoney(a.totalCredit ?? 0, active.currency) : "—"}
                          </td>
                          <td className={`px-4 py-3 text-right tabular-nums font-semibold ${(a.balance ?? 0) < 0 ? "text-destructive" : (a.balance ?? 0) > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                            {hasActivity ? formatMoney(a.balance ?? 0, active.currency) : "—"}
                          </td>
                        </tr>

                        {/* Ledger detail rows */}
                        {isExpanded && (
                          <>
                            {entries.length === 0 ? (
                              <tr className="bg-muted/5 border-t border-dashed">
                                <td colSpan={6} className="px-8 py-4 text-xs text-muted-foreground italic text-center">
                                  No transactions on this account yet.
                                </td>
                              </tr>
                            ) : (
                              <>
                                {/* Ledger header */}
                                <tr className="bg-muted/10 border-t border-dashed">
                                  <td className="px-6 py-2" />
                                  <td className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</td>
                                  <td className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Description</td>
                                  <td className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">Debit</td>
                                  <td className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">Credit</td>
                                  <td className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">Running Balance</td>
                                </tr>
                                {entries.map((entry, idx) => (
                                  <tr key={`${a.id}-ledger-${idx}`} className="border-t border-dashed bg-muted/5">
                                    <td className="px-6 py-2" />
                                    <td className="px-4 py-2 text-xs text-muted-foreground tabular-nums">{formatDate(entry.entry_date)}</td>
                                    <td className="px-4 py-2 text-xs">{entry.description}</td>
                                    <td className="px-4 py-2 text-right tabular-nums text-xs font-mono">
                                      {entry.debit > 0 ? formatMoney(entry.debit, active.currency) : "—"}
                                    </td>
                                    <td className="px-4 py-2 text-right tabular-nums text-xs font-mono">
                                      {entry.credit > 0 ? formatMoney(entry.credit, active.currency) : "—"}
                                    </td>
                                    <td className={`px-4 py-2 text-right tabular-nums text-xs font-mono font-semibold ${entry.running_balance < 0 ? "text-destructive" : "text-foreground"}`}>
                                      {formatMoney(entry.running_balance, active.currency)}
                                    </td>
                                  </tr>
                                ))}
                              </>
                            )}
                          </>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
