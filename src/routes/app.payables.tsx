import React, { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Receipt,
  Search,
  Truck,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  TrendingDown,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompanies } from "@/hooks/use-company";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatDate } from "@/lib/format";
import { StatusBadge } from "./app.dashboard";
import { isDemoMode } from "@/lib/demo-workspace";

export const Route = createFileRoute("/app/payables")({
  component: PayablesPage,
});

type SupplierSummary = {
  id: string;
  name: string;
  total_billed: number;
  total_paid: number;
  outstanding: number;
  bill_count: number;
};

type BillLedgerItem = {
  id: string;
  supplier_id?: string | null;
  bill_number: string;
  issue_date: string;
  due_date: string;
  total: number;
  amount_paid: number;
  status: string;
  notes?: string | null;
  supplier?: { id: string; name: string } | null;
  payments?: { id: string; entry_date: string; description: string; amount: number }[];
};

function PayablesPage() {
  const { active } = useCompanies();
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState<BillLedgerItem[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([]);
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = async () => {
    if (!active) return;
    setLoading(true);

    if (isDemoMode()) {
      const demoBills = JSON.parse(localStorage.getItem("ledgerflow.demo_bills") || "[]");
      const demoSupps = JSON.parse(localStorage.getItem("ledgerflow.demo_suppliers") || "[]");
      const demoJournals = JSON.parse(localStorage.getItem("ledgerflow.demo_journals") || "[]");

      const companyBills = demoBills.filter((b: any) => b.company_id === active.id);
      const companySupps = demoSupps.filter((s: any) => s.company_id === active.id);

      const billList: BillLedgerItem[] = companyBills.map((bill: any) => {
        const pmtJournals = demoJournals.filter(
          (j: any) => j.source_type === "bill_payment" && j.source_id === bill.id
        );
        const payments = pmtJournals.map((j: any) => ({
          id: j.id,
          entry_date: j.entry_date,
          description: j.description,
          amount: (j.journal_lines || []).reduce((s: number, l: any) => s + Number(l.debit || 0), 0),
        }));
        return {
          ...bill,
          total: Number(bill.total),
          amount_paid: Number(bill.amount_paid),
          payments,
        };
      });

      const suppSummaries: SupplierSummary[] = companySupps.map((supp: any) => {
        const sBills = billList.filter((b) => b.supplier_id === supp.id || b.supplier?.name === supp.name);
        const totBilled = sBills.reduce((s, b) => s + b.total, 0);
        const totPaid = sBills.reduce((s, b) => s + b.amount_paid, 0);
        return {
          id: supp.id,
          name: supp.name,
          total_billed: totBilled,
          total_paid: totPaid,
          outstanding: Math.max(0, totBilled - totPaid),
          bill_count: sBills.length,
        };
      });

      setBills(billList);
      setSuppliers(suppSummaries);
      setLoading(false);
      return;
    }

    try {
      // 1. Fetch bills
      const { data: bData, error: bErr } = await (supabase
        .from("bills" as any)
        .select("id,supplier_id,bill_number,issue_date,due_date,total,amount_paid,status,notes,supplier:suppliers(id,name)")
        .eq("company_id", active.id)
        .order("issue_date", { ascending: false }) as any);

      if (bErr) throw bErr;

      // 2. Fetch payments
      const bIds = ((bData as any[]) ?? []).map((b) => b.id);
      let pmtJournals: any[] = [];
      if (bIds.length > 0) {
        const { data: jData } = await supabase
          .from("journals")
          .select("id,entry_date,description,source_id,journal_lines(debit)")
          .eq("company_id", active.id)
          .eq("source_type", "bill_payment")
          .in("source_id", bIds);
        pmtJournals = jData ?? [];
      }

      const parsedBills: BillLedgerItem[] = (bData ?? []).map((bill: any) => {
        const matchedJournals = pmtJournals.filter((j) => j.source_id === bill.id);
        const payments = matchedJournals.map((j) => ({
          id: j.id,
          entry_date: j.entry_date,
          description: j.description,
          amount: (j.journal_lines || []).reduce((s: number, l: any) => s + Number(l.debit || 0), 0),
        }));
        return {
          ...bill,
          total: Number(bill.total),
          amount_paid: Number(bill.amount_paid),
          payments,
        };
      });

      // 3. Fetch suppliers & summarize
      const { data: suppData } = await supabase
        .from("suppliers")
        .select("id,name")
        .eq("company_id", active.id)
        .order("name");

      const suppSummaries: SupplierSummary[] = (suppData ?? []).map((supp: any) => {
        const sBills = parsedBills.filter((b) => b.supplier_id === supp.id || (b.supplier as any)?.id === supp.id);
        const totBilled = sBills.reduce((s, b) => s + b.total, 0);
        const totPaid = sBills.reduce((s, b) => s + b.amount_paid, 0);
        return {
          id: supp.id,
          name: supp.name,
          total_billed: totBilled,
          total_paid: totPaid,
          outstanding: Math.max(0, totBilled - totPaid),
          bill_count: sBills.length,
        };
      });

      setBills(parsedBills);
      setSuppliers(suppSummaries);
    } catch (err) {
      console.warn("Could not load AP ledger:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [active?.id]);

  // Overall Payables Metrics
  const totalBilled = bills.reduce((s, b) => s + b.total, 0);
  const totalPaid = bills.reduce((s, b) => s + b.amount_paid, 0);
  const totalOutstanding = Math.max(0, totalBilled - totalPaid);

  const today = new Date().toISOString().slice(0, 10);
  const totalOverdue = bills
    .filter((b) => b.due_date < today && b.total - b.amount_paid > 0.005)
    .reduce((s, b) => s + (b.total - b.amount_paid), 0);

  // Filtered Bills
  const filteredBills = bills.filter((b) => {
    const matchesSearch =
      b.bill_number.toLowerCase().includes(search.toLowerCase()) ||
      (b.supplier?.name ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesSupplier = supplierFilter === "all" || b.supplier_id === supplierFilter || (b.supplier as any)?.id === supplierFilter;
    const matchesStatus =
      statusFilter === "all"
        ? true
        : statusFilter === "overdue"
        ? b.due_date < today && b.total - b.amount_paid > 0.005
        : b.status === statusFilter;
    return matchesSearch && matchesSupplier && matchesStatus;
  });

  if (!active) return null;

  return (
    <div className="px-6 md:px-10 py-8 max-w-7xl mx-auto space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Accounts Payable (A/P) History</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Historical ledger of supplier bills, disbursements, and liabilities.
        </p>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-5 border bg-card">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Billed</span>
            <Receipt className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold tracking-tight">{formatMoney(totalBilled, active.currency)}</div>
          <p className="text-xs text-muted-foreground mt-1">{bills.length} total supplier bills</p>
        </Card>

        <Card className="p-5 border bg-card">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Settled</span>
            <CheckCircle2 className="h-4 w-4 text-success" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-success">
            {formatMoney(totalPaid, active.currency)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {totalBilled > 0 ? `${((totalPaid / totalBilled) * 100).toFixed(1)}% paid off` : "No bills recorded"}
          </p>
        </Card>

        <Card className="p-5 border bg-card">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Current Liabilities</span>
            <TrendingDown className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold tracking-tight">{formatMoney(totalOutstanding, active.currency)}</div>
          <p className="text-xs text-muted-foreground mt-1">Outstanding payables owed</p>
        </Card>

        <Card className={`p-5 border ${totalOverdue > 0 ? "bg-destructive/5 border-destructive/30" : "bg-card"}`}>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Overdue Liabilities</span>
            <AlertTriangle className={`h-4 w-4 ${totalOverdue > 0 ? "text-destructive" : "text-muted-foreground"}`} />
          </div>
          <div className={`text-2xl font-bold tracking-tight ${totalOverdue > 0 ? "text-destructive" : "text-foreground"}`}>
            {formatMoney(totalOverdue, active.currency)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Past due payment obligations</p>
        </Card>
      </div>

      {/* Supplier Balances Overview */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
          <Truck className="h-5 w-5 text-primary" /> Supplier Payables Ledger
        </h2>

        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-left">
              <tr>
                <th className="font-medium px-6 py-3">Supplier Name</th>
                <th className="font-medium px-6 py-3">Bills</th>
                <th className="font-medium px-6 py-3 text-right">Total Billed</th>
                <th className="font-medium px-6 py-3 text-right">Total Paid</th>
                <th className="font-medium px-6 py-3 text-right">Outstanding Payable</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                    No supplier payables recorded.
                  </td>
                </tr>
              ) : (
                suppliers.map((s) => (
                  <tr key={s.id} className="border-t hover:bg-muted/20 transition-colors">
                    <td className="px-6 py-3 font-medium">{s.name}</td>
                    <td className="px-6 py-3 text-muted-foreground">{s.bill_count} bills</td>
                    <td className="px-6 py-3 text-right tabular-nums font-mono">{formatMoney(s.total_billed, active.currency)}</td>
                    <td className="px-6 py-3 text-right tabular-nums font-mono text-success">{formatMoney(s.total_paid, active.currency)}</td>
                    <td className="px-6 py-3 text-right tabular-nums font-mono">
                      <span className={s.outstanding > 0 ? "font-bold text-foreground" : "text-muted-foreground"}>
                        {formatMoney(s.outstanding, active.currency)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Comprehensive Historical Bills & Payment Ledger */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight">Supplier Bill & Disbursement Log</h2>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-48">
              <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Search bill or supplier..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 text-xs h-9"
              />
            </div>

            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger className="h-9 w-[160px] text-xs">
                <SelectValue placeholder="All suppliers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All suppliers</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[140px] text-xs">
                <SelectValue placeholder="All status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status</SelectItem>
                <SelectItem value="sent">Received / Unpaid</SelectItem>
                <SelectItem value="partially_paid">Partially Paid</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card className="p-0 overflow-hidden">
          {filteredBills.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No matching bills found in history.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-left">
                <tr>
                  <th className="font-medium px-4 py-3 w-8"></th>
                  <th className="font-medium px-4 py-3">Bill #</th>
                  <th className="font-medium px-4 py-3">Supplier</th>
                  <th className="font-medium px-4 py-3">Issue Date</th>
                  <th className="font-medium px-4 py-3">Due Date</th>
                  <th className="font-medium px-4 py-3">Status</th>
                  <th className="font-medium px-4 py-3 text-right">Billed Amount</th>
                  <th className="font-medium px-4 py-3 text-right">Paid</th>
                  <th className="font-medium px-4 py-3 text-right">Balance Owed</th>
                </tr>
              </thead>
              <tbody>
                {filteredBills.map((bill) => {
                  const isExpanded = expandedId === bill.id;
                  const balanceOwed = Math.max(0, bill.total - bill.amount_paid);

                  return (
                    <React.Fragment key={bill.id}>
                      <tr
                        className="border-t hover:bg-muted/20 transition-colors cursor-pointer"
                        onClick={() => setExpandedId(isExpanded ? null : bill.id)}
                      >
                        <td className="px-4 py-3 text-muted-foreground">
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </td>
                        <td className="px-4 py-3 font-semibold">{bill.bill_number}</td>
                        <td className="px-4 py-3">{bill.supplier?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDate(bill.issue_date)}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDate(bill.due_date)}</td>
                        <td className="px-4 py-3"><StatusBadge status={bill.status} /></td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">{formatMoney(bill.total, active.currency)}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-success">{formatMoney(bill.amount_paid, active.currency)}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold">
                          {formatMoney(balanceOwed, active.currency)}
                        </td>
                      </tr>

                      {/* Expanded History Timeline */}
                      {isExpanded && (
                        <tr className="bg-muted/10 border-t border-b">
                          <td colSpan={9} className="p-4 pl-12 space-y-3">
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Disbursement Timeline & Journal Trail
                            </div>

                            <div className="space-y-2 border-l-2 border-primary/30 pl-4">
                              <div className="flex items-center justify-between text-xs">
                                <div>
                                  <span className="font-medium text-foreground">Bill Recorded</span>
                                  <span className="text-muted-foreground ml-2">({formatDate(bill.issue_date)})</span>
                                </div>
                                <span className="font-mono text-muted-foreground">{formatMoney(bill.total, active.currency)}</span>
                              </div>

                              {bill.payments && bill.payments.length > 0 ? (
                                bill.payments.map((pmt, pIdx) => (
                                  <div key={pIdx} className="flex items-center justify-between text-xs bg-card p-2 rounded border">
                                    <div className="flex items-center gap-2">
                                      <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/30">
                                        Disbursement Made
                                      </Badge>
                                      <span>{pmt.description}</span>
                                      <span className="text-muted-foreground">({formatDate(pmt.entry_date)})</span>
                                    </div>
                                    <span className="font-mono font-medium text-success">
                                      -{formatMoney(pmt.amount, active.currency)}
                                    </span>
                                  </div>
                                ))
                              ) : (
                                <div className="text-xs text-muted-foreground italic">No payments recorded yet for this bill.</div>
                              )}

                              <div className="flex justify-between items-center text-xs pt-1 font-medium border-t">
                                <span>Remaining Outstanding Balance:</span>
                                <span className="font-mono font-bold text-foreground">
                                  {formatMoney(balanceOwed, active.currency)}
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
