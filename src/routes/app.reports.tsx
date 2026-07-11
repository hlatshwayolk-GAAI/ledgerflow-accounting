import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BarChart3, FileText, CheckCircle2, AlertTriangle, Printer, RotateCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompanies } from "@/hooks/use-company";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/app/reports")({
  component: ReportsPage,
});

type ReportItem = {
  id: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  netDebit: number;
  netCredit: number;
  balance: number;
};

function ReportsPage() {
  const { active } = useCompanies();
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  
  const [periodReportData, setPeriodReportData] = useState<ReportItem[]>([]);
  const [cumulativeReportData, setCumulativeReportData] = useState<ReportItem[]>([]);
  const [hasTransactions, setHasTransactions] = useState(true);

  const isCogs = (a: { code: string; name: string; type: string }) => {
    if (a.type !== "expense") return false;
    const codeStr = a.code.trim();
    const nameLower = a.name.toLowerCase();
    return (
      codeStr.startsWith("5") ||
      nameLower.includes("cost of goods sold") ||
      nameLower.includes("cogs") ||
      nameLower.includes("cost of sales") ||
      nameLower.includes("cost of revenue")
    );
  };

  const generateReport = async () => {
    if (!active) return;
    setLoading(true);
    try {
      // Fetch all accounts
      const { data: accs, error: accsErr } = await supabase
        .from("accounts")
        .select("id,code,name,type")
        .eq("company_id", active.id);
      
      if (accsErr) throw accsErr;

      // Fetch all journals for active company up to endDate with lines
      const { data: journals, error: journalsErr } = await supabase
        .from("journals")
        .select(`
          id,
          entry_date,
          journal_lines (
            account_id,
            debit,
            credit
          )
        `)
        .eq("company_id", active.id)
        .lte("entry_date", endDate);

      if (journalsErr) throw journalsErr;

      const hasAnyJournals = journals && journals.length > 0;
      setHasTransactions(hasAnyJournals);

      // Group and calculate sums
      const periodMap: Record<string, { debit: number; credit: number }> = {};
      const cumulativeMap: Record<string, { debit: number; credit: number }> = {};
      
      // Initialize maps
      accs.forEach(a => {
        periodMap[a.id] = { debit: 0, credit: 0 };
        cumulativeMap[a.id] = { debit: 0, credit: 0 };
      });

      // Sum journal lines
      journals?.forEach((j: any) => {
        const entryDate = j.entry_date;
        const isWithinPeriod = entryDate >= startDate; // and <= endDate is already guaranteed by db query
        
        j.journal_lines?.forEach((jl: any) => {
          const accId = jl.account_id;
          if (cumulativeMap[accId]) {
            cumulativeMap[accId].debit += Number(jl.debit || 0);
            cumulativeMap[accId].credit += Number(jl.credit || 0);
          }
          if (isWithinPeriod && periodMap[accId]) {
            periodMap[accId].debit += Number(jl.debit || 0);
            periodMap[accId].credit += Number(jl.credit || 0);
          }
        });
      });

      // Formulate report items
      const buildReportItems = (accsList: typeof accs, sumMap: typeof periodMap) => {
        return accsList.map(a => {
          const d = sumMap[a.id].debit;
          const c = sumMap[a.id].credit;
          
          let netDebit = 0;
          let netCredit = 0;
          if (d > c) netDebit = d - c;
          else if (c > d) netCredit = c - d;

          // signed balance:
          // Assets & Expenses are normally Debit
          // Liabilities, Equity, Revenue are normally Credit
          let balance = 0;
          if (a.type === "asset" || a.type === "expense") {
            balance = d - c;
          } else {
            balance = c - d;
          }

          return {
            id: a.id,
            code: a.code,
            name: a.name,
            type: a.type,
            debit: d,
            credit: c,
            netDebit,
            netCredit,
            balance
          };
        });
      };

      setPeriodReportData(buildReportItems(accs, periodMap));
      setCumulativeReportData(buildReportItems(accs, cumulativeMap));
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to generate report");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    generateReport();
  }, [active?.id]);

  // Real-time subscription to journals and accounts
  useEffect(() => {
    if (!active?.id) return;

    const channel = supabase
      .channel(`reports-realtime-${active.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "journals", filter: `company_id=eq.${active.id}` },
        () => {
          generateReport();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "journal_lines" },
        () => {
          generateReport();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "accounts", filter: `company_id=eq.${active.id}` },
        () => {
          generateReport();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [active?.id, startDate, endDate]);

  if (!active) return null;

  // Compute reports from reportData
  // 1. Trial Balance sums (cumulative)
  const tbDebits = cumulativeReportData.reduce((s, x) => s + x.netDebit, 0);
  const tbCredits = cumulativeReportData.reduce((s, x) => s + x.netCredit, 0);
  const tbBalanced = Math.abs(tbDebits - tbCredits) < 0.01;

  // 2. Profit & Loss items (period-specific)
  const revenueItems = periodReportData.filter(x => x.type === "revenue");
  const cogsItems = periodReportData.filter(x => isCogs(x));
  const expenseItems = periodReportData.filter(x => x.type === "expense" && !isCogs(x));

  const totalRevenue = revenueItems.reduce((s, x) => s + x.balance, 0);
  const totalCogs = cogsItems.reduce((s, x) => s + x.balance, 0);
  const grossProfit = totalRevenue - totalCogs;
  const totalExpenses = expenseItems.reduce((s, x) => s + x.balance, 0);
  const netProfit = grossProfit - totalExpenses;

  // 3. Balance Sheet items (cumulative)
  const assetItems = cumulativeReportData.filter(x => x.type === "asset");
  const liabilityItems = cumulativeReportData.filter(x => x.type === "liability");
  const equityItems = cumulativeReportData.filter(x => x.type === "equity");

  const totalAssets = assetItems.reduce((s, x) => s + x.balance, 0);
  const totalLiabilities = liabilityItems.reduce((s, x) => s + x.balance, 0);
  const totalEquityBase = equityItems.reduce((s, x) => s + x.balance, 0);
  // Net Profit is rolled into Equity as Retained Earnings
  const totalEquity = totalEquityBase + netProfit;
  const totalEquityAndLiabilities = totalLiabilities + totalEquity;
  
  const bsBalanced = Math.abs(totalAssets - totalEquityAndLiabilities) < 0.01;

  // Check if ANY account has any activity — bills, invoices, or manual journals all create journal lines
  const anyActivity = cumulativeReportData.some(x => x.debit > 0 || x.credit > 0);
  const isPeriodEmpty = !hasTransactions || !anyActivity;
  const isBsEmpty = !hasTransactions || !anyActivity || (assetItems.length === 0 && liabilityItems.length === 0 && equityItems.length === 0);
  const isTbEmpty = !hasTransactions || cumulativeReportData.length === 0;

  const handlePrint = () => {
    window.print();
  };

  const renderEmptyState = (reportName: string) => (
    <Card className="p-12 text-center max-w-3xl mx-auto border-dashed border-2 flex flex-col items-center justify-center space-y-4 bg-card shadow-sm transition-all duration-300">
      <div className="p-4 bg-muted rounded-full text-muted-foreground animate-pulse">
        <FileText className="h-10 w-10 text-primary" />
      </div>
      <div className="space-y-1">
        <h3 className="text-lg font-semibold tracking-tight text-foreground">No transaction data found</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          We couldn't find any journal entries or transactions for {active.name} in this period. Run a bank reconciliation or record manual journals to populate your {reportName}.
        </p>
      </div>
      <div className="flex gap-3 pt-2">
        <Link to="/app/bank">
          <Button size="sm" className="font-medium shadow-sm transition-all hover:scale-[1.02]">
            Reconcile Bank
          </Button>
        </Link>
      </div>
    </Card>
  );

  return (
    <div className="px-6 md:px-10 py-8 max-w-7xl mx-auto print:p-0">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" /> Financial Reports
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time statements generated from your double-entry ledger.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={generateReport} disabled={loading} className="h-9 w-9" title="Refresh Report">
            <RotateCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="outline" onClick={handlePrint}><Printer className="h-4 w-4 mr-2" /> Print</Button>
        </div>
      </div>

      {/* Date Filters Card */}
      <Card className="p-4 mb-6 print:hidden">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs font-semibold">Start date</Label>
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="mt-1" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs font-semibold">End date</Label>
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="mt-1" />
          </div>
          <Button onClick={generateReport} disabled={loading} className="shrink-0">
            {loading ? "Calculating..." : "Update Report"}
          </Button>
        </div>
      </Card>

      <Tabs defaultValue="pl" className="space-y-6">
        <TabsList className="print:hidden">
          <TabsTrigger value="pl">Profit & Loss</TabsTrigger>
          <TabsTrigger value="bs">Balance Sheet</TabsTrigger>
          <TabsTrigger value="tb">Trial Balance</TabsTrigger>
        </TabsList>

        {/* 1. Profit & Loss Tab */}
        <TabsContent value="pl">
          {isPeriodEmpty ? (
            renderEmptyState("Profit & Loss Statement")
          ) : (
            <Card className="p-8 space-y-6 max-w-3xl mx-auto border-none shadow-md print:shadow-none transition-all duration-300">
              <div className="text-center space-y-1">
                <h2 className="text-2xl font-bold tracking-tight text-foreground">{active.name}</h2>
                <h3 className="font-semibold text-muted-foreground">Profit & Loss Statement</h3>
                <p className="text-xs text-muted-foreground">
                  For the period {formatDate(startDate)} to {formatDate(endDate)} · {active.currency}
                </p>
              </div>

              <div className="space-y-4">
                {/* Revenue */}
                <div>
                  <h4 className="font-semibold text-sm border-b pb-1 text-muted-foreground uppercase tracking-wide">Revenue</h4>
                  <div className="mt-2 space-y-1.5 text-sm">
                    {revenueItems.map(x => (
                      <div key={x.id} className="flex justify-between pl-4">
                        <span>{x.name}</span>
                        <span className="tabular-nums font-mono">{formatMoney(x.balance, active.currency)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between font-semibold border-t pt-1.5 mt-2">
                      <span>Total Revenue</span>
                      <span className="tabular-nums font-mono">{formatMoney(totalRevenue, active.currency)}</span>
                    </div>
                  </div>
                </div>

                {/* COGS */}
                <div>
                  <h4 className="font-semibold text-sm border-b pb-1 text-muted-foreground uppercase tracking-wide">Cost of Sales</h4>
                  <div className="mt-2 space-y-1.5 text-sm">
                    {cogsItems.length === 0 ? (
                      <p className="pl-4 text-xs text-muted-foreground italic">No cost of sales recorded.</p>
                    ) : (
                      cogsItems.map(x => (
                        <div key={x.id} className="flex justify-between pl-4">
                          <span>{x.name}</span>
                          <span className="tabular-nums font-mono">{formatMoney(x.balance, active.currency)}</span>
                        </div>
                      ))
                    )}
                    <div className="flex justify-between font-semibold border-t pt-1.5 mt-2">
                      <span>Total Cost of Sales</span>
                      <span className="tabular-nums font-mono">{formatMoney(totalCogs, active.currency)}</span>
                    </div>
                  </div>
                </div>

                {/* Gross Profit */}
                <div className="flex justify-between font-bold text-base bg-muted/50 p-2 rounded-lg border-y">
                  <span>Gross Profit</span>
                  <span className="tabular-nums font-mono">{formatMoney(grossProfit, active.currency)}</span>
                </div>

                {/* Expenses */}
                <div>
                  <h4 className="font-semibold text-sm border-b pb-1 text-muted-foreground uppercase tracking-wide">Operating Expenses</h4>
                  <div className="mt-2 space-y-1.5 text-sm">
                    {expenseItems.map(x => (
                      <div key={x.id} className="flex justify-between pl-4">
                        <span>{x.name}</span>
                        <span className="tabular-nums font-mono">{formatMoney(x.balance, active.currency)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between font-semibold border-t pt-1.5 mt-2">
                      <span>Total Operating Expenses</span>
                      <span className="tabular-nums font-mono">{formatMoney(totalExpenses, active.currency)}</span>
                    </div>
                  </div>
                </div>

                {/* Net Profit */}
                <div className={`flex justify-between font-bold text-lg p-3 rounded-lg border-y ${netProfit >= 0 ? "bg-success/10 border-success/30 text-success" : "bg-destructive/10 border-destructive/30 text-destructive"}`}>
                  <span>Net Profit / (Loss)</span>
                  <span className="tabular-nums font-mono">{formatMoney(netProfit, active.currency)}</span>
                </div>
              </div>
            </Card>
          )}
        </TabsContent>

        {/* 2. Balance Sheet Tab */}
        <TabsContent value="bs">
          {isBsEmpty ? (
            renderEmptyState("Balance Sheet")
          ) : (
            <Card className="p-8 space-y-6 max-w-3xl mx-auto border-none shadow-md print:shadow-none transition-all duration-300">
              <div className="text-center space-y-1">
                <h2 className="text-2xl font-bold tracking-tight text-foreground">{active.name}</h2>
                <h3 className="font-semibold text-muted-foreground">Balance Sheet</h3>
                <p className="text-xs text-muted-foreground">
                  As at {formatDate(endDate)} · {active.currency}
                </p>
              </div>

              <div className="space-y-4">
                {/* Assets */}
                <div>
                  <h4 className="font-semibold text-sm border-b pb-1 text-muted-foreground uppercase tracking-wide">Assets</h4>
                  <div className="mt-2 space-y-1.5 text-sm">
                    {assetItems.map(x => (
                      <div key={x.id} className="flex justify-between pl-4">
                        <span>{x.name}</span>
                        <span className="tabular-nums font-mono">{formatMoney(x.balance, active.currency)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between font-semibold border-t pt-1.5 mt-2">
                      <span>Total Assets</span>
                      <span className="tabular-nums font-mono">{formatMoney(totalAssets, active.currency)}</span>
                    </div>
                  </div>
                </div>

                {/* Liabilities */}
                <div>
                  <h4 className="font-semibold text-sm border-b pb-1 text-muted-foreground uppercase tracking-wide">Liabilities</h4>
                  <div className="mt-2 space-y-1.5 text-sm">
                    {liabilityItems.map(x => (
                      <div key={x.id} className="flex justify-between pl-4">
                        <span>{x.name}</span>
                        <span className="tabular-nums font-mono">{formatMoney(x.balance, active.currency)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between font-semibold border-t pt-1.5 mt-2">
                      <span>Total Liabilities</span>
                      <span className="tabular-nums font-mono">{formatMoney(totalLiabilities, active.currency)}</span>
                    </div>
                  </div>
                </div>

                {/* Equity */}
                <div>
                  <h4 className="font-semibold text-sm border-b pb-1 text-muted-foreground uppercase tracking-wide">Equity</h4>
                  <div className="mt-2 space-y-1.5 text-sm">
                    {equityItems.map(x => (
                      <div key={x.id} className="flex justify-between pl-4">
                        <span>{x.name}</span>
                        <span className="tabular-nums font-mono">{formatMoney(x.balance, active.currency)}</span>
                      </div>
                    ))}
                    {/* Current Period Retained Earnings */}
                    <div className="flex justify-between pl-4 text-muted-foreground italic">
                      <span>Current Period Net Earnings</span>
                      <span className="tabular-nums font-mono">{formatMoney(netProfit, active.currency)}</span>
                    </div>
                    <div className="flex justify-between font-semibold border-t pt-1.5 mt-2">
                      <span>Total Equity</span>
                      <span className="tabular-nums font-mono">{formatMoney(totalEquity, active.currency)}</span>
                    </div>
                  </div>
                </div>

                {/* Total Equity and Liabilities */}
                <div className="flex justify-between font-bold text-base bg-muted/50 p-2 rounded-lg border-y">
                  <span>Total Equity & Liabilities</span>
                  <span className="tabular-nums font-mono">{formatMoney(totalEquityAndLiabilities, active.currency)}</span>
                </div>

                {/* Balance Validation Check */}
                <div className="flex items-center justify-between border-t pt-4 print:hidden">
                  <span className="text-xs text-muted-foreground">Accounting Equation: Assets = Liabilities + Equity</span>
                  {bsBalanced ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-success font-medium bg-success/10 px-2.5 py-0.5 rounded-full">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Balanced
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-destructive font-medium bg-destructive/10 px-2.5 py-0.5 rounded-full">
                      <AlertTriangle className="h-3.5 w-3.5" /> Out of Balance (Diff: {formatMoney(Math.abs(totalAssets - totalEquityAndLiabilities), active.currency)})
                    </span>
                  )}
                </div>
              </div>
            </Card>
          )}
        </TabsContent>

        {/* 3. Trial Balance Tab */}
        <TabsContent value="tb">
          {isTbEmpty ? (
            renderEmptyState("Trial Balance")
          ) : (
            <Card className="p-8 space-y-6 max-w-3xl mx-auto border-none shadow-md print:shadow-none transition-all duration-300">
              <div className="text-center space-y-1">
                <h2 className="text-2xl font-bold tracking-tight text-foreground">{active.name}</h2>
                <h3 className="font-semibold text-muted-foreground">Trial Balance</h3>
                <p className="text-xs text-muted-foreground">
                  As at {formatDate(endDate)} · {active.currency}
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground text-xs uppercase tracking-wider">
                      <th className="font-semibold py-2">Code</th>
                      <th className="font-semibold py-2">Account Name</th>
                      <th className="font-semibold py-2">Account Type</th>
                      <th className="font-semibold py-2 text-right">Debit</th>
                      <th className="font-semibold py-2 text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {cumulativeReportData.map(x => (
                      <tr key={x.id} className="hover:bg-muted/10">
                        <td className="py-2.5 font-mono text-xs text-muted-foreground">{x.code}</td>
                        <td className="py-2.5 font-medium">{x.name}</td>
                        <td className="py-2.5 capitalize text-xs text-muted-foreground">{x.type}</td>
                        <td className="py-2.5 text-right tabular-nums text-foreground font-mono">
                          {x.netDebit > 0 ? formatMoney(x.netDebit, active.currency) : "—"}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-foreground font-mono">
                          {x.netCredit > 0 ? formatMoney(x.netCredit, active.currency) : "—"}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-double font-semibold bg-muted/20">
                      <td className="py-3" colSpan={3}>Total</td>
                      <td className="py-3 text-right tabular-nums font-mono">{formatMoney(tbDebits, active.currency)}</td>
                      <td className="py-3 text-right tabular-nums font-mono">{formatMoney(tbCredits, active.currency)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between border-t pt-4 print:hidden">
                <span className="text-xs text-muted-foreground">Double Entry Ledger Status</span>
                {tbBalanced ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-success font-medium bg-success/10 px-2.5 py-0.5 rounded-full">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Balanced
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs text-destructive font-medium bg-destructive/10 px-2.5 py-0.5 rounded-full">
                    <AlertTriangle className="h-3.5 w-3.5" /> Out of Balance (Diff: {formatMoney(Math.abs(tbDebits - tbCredits), active.currency)})
                  </span>
                )}
              </div>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
