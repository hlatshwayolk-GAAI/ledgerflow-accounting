import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { TrendingUp, FileText, Wallet, AlertCircle, Receipt, TrendingDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompanies } from "@/hooks/use-company";
import { Card } from "@/components/ui/card";
import { formatMoney, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/app/dashboard")({
  component: Dashboard,
});

type Stats = {
  invoicesOutstanding: number;
  collected30: number;
  invoiceCount: number;
  overdueInvoices: number;
  billsOutstanding: number;
  overdueBills: number;
  billCount: number;
};

function Dashboard() {
  const { active } = useCompanies();
  const [stats, setStats] = useState<Stats>({
    invoicesOutstanding: 0,
    collected30: 0,
    invoiceCount: 0,
    overdueInvoices: 0,
    billsOutstanding: 0,
    overdueBills: 0,
    billCount: 0,
  });
  const [recentInvoices, setRecentInvoices] = useState<any[]>([]);
  const [recentBills, setRecentBills] = useState<any[]>([]);

  useEffect(() => {
    if (!active) return;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

      // Load invoices
      const { data: invoices } = await supabase
        .from("invoices")
        .select("id,invoice_number,issue_date,due_date,total,amount_paid,status,customer:customers(name)")
        .eq("company_id", active.id)
        .order("issue_date", { ascending: false });
      const invList = invoices ?? [];

      // Load bills
      const { data: bills } = await supabase
        .from("bills" as any)
        .select("id,bill_number,issue_date,due_date,total,amount_paid,status,supplier:suppliers(name)")
        .eq("company_id", active.id)
        .order("issue_date", { ascending: false });
      const billList = (bills ?? []) as any[];

      const invoicesOutstanding = invList.reduce((s, i: any) => s + Math.max(0, Number(i.total) - Number(i.amount_paid)), 0);
      const collected30 = invList.filter((i: any) => i.issue_date >= thirtyAgo).reduce((s, i: any) => s + Number(i.amount_paid), 0);
      const overdueInvoices = invList.filter((i: any) => i.status !== "paid" && i.due_date < today).length;

      const billsOutstanding = billList.reduce((s, b) => s + Math.max(0, Number(b.total) - Number(b.amount_paid)), 0);
      const overdueBills = billList.filter((b) => b.status !== "paid" && b.due_date < today).length;

      setStats({
        invoicesOutstanding,
        collected30,
        invoiceCount: invList.length,
        overdueInvoices,
        billsOutstanding,
        overdueBills,
        billCount: billList.length,
      });
      setRecentInvoices(invList.slice(0, 5));
      setRecentBills(billList.slice(0, 5));
    })();
  }, [active]);

  if (!active) return null;

  return (
    <div className="px-6 md:px-10 py-8 max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">{active.name} · {active.currency}</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label="Invoices Outstanding" value={formatMoney(stats.invoicesOutstanding, active.currency)} icon={Wallet} accent="text-primary" />
        <Stat label="Collected (30d)" value={formatMoney(stats.collected30, active.currency)} icon={TrendingUp} accent="text-success" />
        <Stat label="Bills Payable" value={formatMoney(stats.billsOutstanding, active.currency)} icon={TrendingDown} accent="text-warning-foreground" />
        <Stat label="Overdue" value={`${stats.overdueInvoices} inv · ${stats.overdueBills} bills`} icon={AlertCircle} accent={stats.overdueInvoices + stats.overdueBills > 0 ? "text-destructive" : "text-muted-foreground"} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Invoices */}
        <Card className="p-0 overflow-hidden">
          <div className="px-6 py-4 border-b flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <h2 className="font-medium">Recent Invoices</h2>
            <span className="ml-auto text-xs text-muted-foreground">{stats.invoiceCount} total</span>
          </div>
          {recentInvoices.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No invoices yet. Create your first invoice to see it here.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr className="text-left">
                  <th className="font-medium px-4 py-2.5">Number</th>
                  <th className="font-medium px-4 py-2.5">Customer</th>
                  <th className="font-medium px-4 py-2.5">Status</th>
                  <th className="font-medium px-4 py-2.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {recentInvoices.map((i: any) => (
                  <tr key={i.id} className="border-t hover:bg-muted/10">
                    <td className="px-4 py-2.5 font-medium">{i.invoice_number}</td>
                    <td className="px-4 py-2.5 truncate max-w-[120px]">{i.customer?.name ?? "—"}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={i.status} /></td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(i.total, active.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Recent Bills */}
        <Card className="p-0 overflow-hidden">
          <div className="px-6 py-4 border-b flex items-center gap-2">
            <Receipt className="h-4 w-4 text-warning-foreground" />
            <h2 className="font-medium">Recent Bills</h2>
            <span className="ml-auto text-xs text-muted-foreground">{stats.billCount} total</span>
          </div>
          {recentBills.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No supplier bills yet. Add bills to track accounts payable.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr className="text-left">
                  <th className="font-medium px-4 py-2.5">Number</th>
                  <th className="font-medium px-4 py-2.5">Supplier</th>
                  <th className="font-medium px-4 py-2.5">Status</th>
                  <th className="font-medium px-4 py-2.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {recentBills.map((b: any) => (
                  <tr key={b.id} className="border-t hover:bg-muted/10">
                    <td className="px-4 py-2.5 font-medium">{b.bill_number}</td>
                    <td className="px-4 py-2.5 truncate max-w-[120px]">{b.supplier?.name ?? "—"}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={b.status} /></td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(b.total, active.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon, accent }: { label: string; value: string; icon: any; accent: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">{label}</span>
        <Icon className={`h-4 w-4 ${accent}`} />
      </div>
      <div className="mt-2 text-xl font-semibold tabular-nums leading-tight">{value}</div>
    </Card>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    sent: "bg-accent text-accent-foreground",
    partially_paid: "bg-warning/20 text-warning-foreground",
    paid: "bg-success/20 text-success",
    overdue: "bg-destructive/15 text-destructive",
    archived: "bg-muted text-muted-foreground",
  };
  return <Badge variant="outline" className={`border-0 capitalize ${map[status] ?? "bg-muted"}`}>{status.replace("_", " ")}</Badge>;
}
