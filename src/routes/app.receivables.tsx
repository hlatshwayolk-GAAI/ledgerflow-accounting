import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  FileText,
  Search,
  Filter,
  Users,
  ArrowUpRight,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  TrendingUp,
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

export const Route = createFileRoute("/app/receivables")({
  component: ReceivablesPage,
});

type CustomerSummary = {
  id: string;
  name: string;
  email?: string | null;
  credit_limit?: number | null;
  total_invoiced: number;
  total_paid: number;
  outstanding: number;
  invoice_count: number;
};

type InvoiceLedgerItem = {
  id: string;
  customer_id?: string | null;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  total: number;
  amount_paid: number;
  status: string;
  notes?: string | null;
  customer?: { id: string; name: string } | null;
  payments?: { id: string; entry_date: string; description: string; amount: number }[];
};

function ReceivablesPage() {
  const { active } = useCompanies();
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<InvoiceLedgerItem[]>([]);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = async () => {
    if (!active) return;
    setLoading(true);

    if (isDemoMode()) {
      const demoInvs = JSON.parse(localStorage.getItem("ledgerflow.demo_invoices") || "[]");
      const demoCusts = JSON.parse(localStorage.getItem("ledgerflow.demo_customers") || "[]");
      const demoJournals = JSON.parse(localStorage.getItem("ledgerflow.demo_journals") || "[]");

      const companyInvs = demoInvs.filter((i: any) => i.company_id === active.id);
      const companyCusts = demoCusts.filter((c: any) => c.company_id === active.id);

      // Attach payments from journals
      const invList: InvoiceLedgerItem[] = companyInvs.map((inv: any) => {
        const pmtJournals = demoJournals.filter(
          (j: any) => j.source_type === "invoice_payment" && j.source_id === inv.id
        );
        const payments = pmtJournals.map((j: any) => ({
          id: j.id,
          entry_date: j.entry_date,
          description: j.description,
          amount: (j.journal_lines || []).reduce((s: number, l: any) => s + Number(l.debit || 0), 0),
        }));
        return {
          ...inv,
          total: Number(inv.total),
          amount_paid: Number(inv.amount_paid),
          payments,
        };
      });

      // Calculate customer summaries
      const custSummaries: CustomerSummary[] = companyCusts.map((cust: any) => {
        const cInvs = invList.filter((i) => i.customer_id === cust.id || i.customer?.name === cust.name);
        const totInvoiced = cInvs.reduce((s, i) => s + i.total, 0);
        const totPaid = cInvs.reduce((s, i) => s + i.amount_paid, 0);
        return {
          id: cust.id,
          name: cust.name,
          email: cust.email,
          credit_limit: cust.credit_limit,
          total_invoiced: totInvoiced,
          total_paid: totPaid,
          outstanding: Math.max(0, totInvoiced - totPaid),
          invoice_count: cInvs.length,
        };
      });

      setInvoices(invList);
      setCustomers(custSummaries);
      setLoading(false);
      return;
    }

    try {
      // 1. Fetch invoices with customer detail
      const { data: invData, error: invErr } = await supabase
        .from("invoices")
        .select("id,customer_id,invoice_number,issue_date,due_date,total,amount_paid,status,notes,customer:customers(id,name,email)")
        .eq("company_id", active.id)
        .order("issue_date", { ascending: false });

      if (invErr) throw invErr;

      // 2. Fetch payment journals for these invoices
      const invIds = (invData ?? []).map((i) => i.id);
      let pmtJournals: any[] = [];
      if (invIds.length > 0) {
        const { data: jData } = await supabase
          .from("journals")
          .select("id,entry_date,description,source_id,journal_lines(debit)")
          .eq("company_id", active.id)
          .eq("source_type", "invoice_payment")
          .in("source_id", invIds);
        pmtJournals = jData ?? [];
      }

      const parsedInvoices: InvoiceLedgerItem[] = (invData ?? []).map((inv: any) => {
        const matchedJournals = pmtJournals.filter((j) => j.source_id === inv.id);
        const payments = matchedJournals.map((j) => ({
          id: j.id,
          entry_date: j.entry_date,
          description: j.description,
          amount: (j.journal_lines || []).reduce((s: number, l: any) => s + Number(l.debit || 0), 0),
        }));
        return {
          ...inv,
          total: Number(inv.total),
          amount_paid: Number(inv.amount_paid),
          payments,
        };
      });

      // 3. Fetch customers and summarize
      const { data: custData } = await supabase
        .from("customers")
        .select("id,name,email,credit_limit")
        .eq("company_id", active.id)
        .order("name");

      const custSummaries: CustomerSummary[] = (custData ?? []).map((cust: any) => {
        const cInvs = parsedInvoices.filter((i) => i.customer_id === cust.id || (i.customer as any)?.id === cust.id);
        const totInvoiced = cInvs.reduce((s, i) => s + i.total, 0);
        const totPaid = cInvs.reduce((s, i) => s + i.amount_paid, 0);
        return {
          id: cust.id,
          name: cust.name,
          email: cust.email,
          credit_limit: cust.credit_limit,
          total_invoiced: totInvoiced,
          total_paid: totPaid,
          outstanding: Math.max(0, totInvoiced - totPaid),
          invoice_count: cInvs.length,
        };
      });

      setInvoices(parsedInvoices);
      setCustomers(custSummaries);
    } catch (err) {
      console.warn("Could not load AR ledger:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [active?.id]);

  // Overall Receivables Metrics
  const totalInvoiced = invoices.reduce((s, i) => s + i.total, 0);
  const totalCollected = invoices.reduce((s, i) => s + i.amount_paid, 0);
  const totalOutstanding = Math.max(0, totalInvoiced - totalCollected);

  const today = new Date().toISOString().slice(0, 10);
  const totalOverdue = invoices
    .filter((i) => i.due_date < today && i.total - i.amount_paid > 0.005)
    .reduce((s, i) => s + (i.total - i.amount_paid), 0);

  // Filtered Invoices
  const filteredInvoices = invoices.filter((i) => {
    const matchesSearch =
      i.invoice_number.toLowerCase().includes(search.toLowerCase()) ||
      (i.customer?.name ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesCustomer = customerFilter === "all" || i.customer_id === customerFilter || (i.customer as any)?.id === customerFilter;
    const matchesStatus =
      statusFilter === "all"
        ? true
        : statusFilter === "overdue"
        ? i.due_date < today && i.total - i.amount_paid > 0.005
        : i.status === statusFilter;
    return matchesSearch && matchesCustomer && matchesStatus;
  });

  if (!active) return null;

  return (
    <div className="px-6 md:px-10 py-8 max-w-7xl mx-auto space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Accounts Receivable (A/R) History</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Historical ledger of customer invoices, payments received, and open balances.
        </p>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-5 border bg-card">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Invoiced</span>
            <FileText className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold tracking-tight">{formatMoney(totalInvoiced, active.currency)}</div>
          <p className="text-xs text-muted-foreground mt-1">{invoices.length} lifetime invoices</p>
        </Card>

        <Card className="p-5 border bg-card">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Collected</span>
            <CheckCircle2 className="h-4 w-4 text-success" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-success">
            {formatMoney(totalCollected, active.currency)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {totalInvoiced > 0 ? `${((totalCollected / totalInvoiced) * 100).toFixed(1)}% recovery rate` : "No billing yet"}
          </p>
        </Card>

        <Card className="p-5 border bg-card">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Current Outstanding</span>
            <TrendingUp className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold tracking-tight">{formatMoney(totalOutstanding, active.currency)}</div>
          <p className="text-xs text-muted-foreground mt-1">Active unpaid receivables</p>
        </Card>

        <Card className={`p-5 border ${totalOverdue > 0 ? "bg-destructive/5 border-destructive/30" : "bg-card"}`}>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Overdue Receivables</span>
            <AlertTriangle className={`h-4 w-4 ${totalOverdue > 0 ? "text-destructive" : "text-muted-foreground"}`} />
          </div>
          <div className={`text-2xl font-bold tracking-tight ${totalOverdue > 0 ? "text-destructive" : "text-foreground"}`}>
            {formatMoney(totalOverdue, active.currency)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Requires follow-up</p>
        </Card>
      </div>

      {/* Customer Balances Overview */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" /> Customer Receivables Ledger
        </h2>

        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-left">
              <tr>
                <th className="font-medium px-6 py-3">Customer Name</th>
                <th className="font-medium px-6 py-3">Invoices</th>
                <th className="font-medium px-6 py-3 text-right">Total Invoiced</th>
                <th className="font-medium px-6 py-3 text-right">Total Collected</th>
                <th className="font-medium px-6 py-3 text-right">Outstanding Balance</th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                    No customer receivables recorded.
                  </td>
                </tr>
              ) : (
                customers.map((c) => (
                  <tr key={c.id} className="border-t hover:bg-muted/20 transition-colors">
                    <td className="px-6 py-3 font-medium">
                      {c.name}
                      {c.email && <div className="text-xs text-muted-foreground font-normal">{c.email}</div>}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">{c.invoice_count} invoices</td>
                    <td className="px-6 py-3 text-right tabular-nums font-mono">{formatMoney(c.total_invoiced, active.currency)}</td>
                    <td className="px-6 py-3 text-right tabular-nums font-mono text-success">{formatMoney(c.total_paid, active.currency)}</td>
                    <td className="px-6 py-3 text-right tabular-nums font-mono">
                      <span className={c.outstanding > 0 ? "font-bold text-foreground" : "text-muted-foreground"}>
                        {formatMoney(c.outstanding, active.currency)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Comprehensive Historical Invoices & Payment Ledger */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight">Invoice & Payment History Log</h2>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-48">
              <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Search invoice or customer..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 text-xs h-9"
              />
            </div>

            <Select value={customerFilter} onValueChange={setCustomerFilter}>
              <SelectTrigger className="h-9 w-[160px] text-xs">
                <SelectValue placeholder="All customers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All customers</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[140px] text-xs">
                <SelectValue placeholder="All status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status</SelectItem>
                <SelectItem value="sent">Sent / Unpaid</SelectItem>
                <SelectItem value="partially_paid">Partially Paid</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card className="p-0 overflow-hidden">
          {filteredInvoices.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No matching invoices found in history.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-left">
                <tr>
                  <th className="font-medium px-4 py-3 w-8"></th>
                  <th className="font-medium px-4 py-3">Invoice #</th>
                  <th className="font-medium px-4 py-3">Customer</th>
                  <th className="font-medium px-4 py-3">Issued Date</th>
                  <th className="font-medium px-4 py-3">Due Date</th>
                  <th className="font-medium px-4 py-3">Status</th>
                  <th className="font-medium px-4 py-3 text-right">Invoiced Amount</th>
                  <th className="font-medium px-4 py-3 text-right">Collected</th>
                  <th className="font-medium px-4 py-3 text-right">Balance Due</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((inv) => {
                  const isExpanded = expandedId === inv.id;
                  const balanceDue = Math.max(0, inv.total - inv.amount_paid);

                  return (
                    <React.Fragment key={inv.id}>
                      <tr
                        className="border-t hover:bg-muted/20 transition-colors cursor-pointer"
                        onClick={() => setExpandedId(isExpanded ? null : inv.id)}
                      >
                        <td className="px-4 py-3 text-muted-foreground">
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </td>
                        <td className="px-4 py-3 font-semibold">{inv.invoice_number}</td>
                        <td className="px-4 py-3">{inv.customer?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDate(inv.issue_date)}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDate(inv.due_date)}</td>
                        <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">{formatMoney(inv.total, active.currency)}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-success">{formatMoney(inv.amount_paid, active.currency)}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold">
                          {formatMoney(balanceDue, active.currency)}
                        </td>
                      </tr>

                      {/* Expanded History Timeline */}
                      {isExpanded && (
                        <tr className="bg-muted/10 border-t border-b">
                          <td colSpan={9} className="p-4 pl-12 space-y-3">
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Payment Timeline & Journal Trail
                            </div>

                            <div className="space-y-2 border-l-2 border-primary/30 pl-4">
                              <div className="flex items-center justify-between text-xs">
                                <div>
                                  <span className="font-medium text-foreground">Invoice Issued</span>
                                  <span className="text-muted-foreground ml-2">({formatDate(inv.issue_date)})</span>
                                </div>
                                <span className="font-mono text-muted-foreground">{formatMoney(inv.total, active.currency)}</span>
                              </div>

                              {inv.payments && inv.payments.length > 0 ? (
                                inv.payments.map((pmt, pIdx) => (
                                  <div key={pIdx} className="flex items-center justify-between text-xs bg-card p-2 rounded border">
                                    <div className="flex items-center gap-2">
                                      <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/30">
                                        Payment Received
                                      </Badge>
                                      <span>{pmt.description}</span>
                                      <span className="text-muted-foreground">({formatDate(pmt.entry_date)})</span>
                                    </div>
                                    <span className="font-mono font-medium text-success">
                                      +{formatMoney(pmt.amount, active.currency)}
                                    </span>
                                  </div>
                                ))
                              ) : (
                                <div className="text-xs text-muted-foreground italic">No payments recorded yet for this invoice.</div>
                              )}

                              <div className="flex justify-between items-center text-xs pt-1 font-medium border-t">
                                <span>Remaining Balance Due:</span>
                                <span className="font-mono font-bold text-foreground">
                                  {formatMoney(balanceDue, active.currency)}
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
import React from "react";
