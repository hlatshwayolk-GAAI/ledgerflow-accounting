import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, MoreHorizontal, Wallet, Download, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompanies } from "@/hooks/use-company";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { formatMoney, formatDate } from "@/lib/format";
import { StatusBadge } from "./app.dashboard";
import { toast } from "sonner";
import { generateInvoicePDF } from "@/lib/invoice-pdf";

export const Route = createFileRoute("/app/invoices")({
  component: InvoicesPage,
});

type Line = { description: string; quantity: string; unit_price: string; tax_rate: string };

function InvoicesPage() {
  const { active } = useCompanies();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string; email?: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState("");
  const [number, setNumber] = useState("");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "1", unit_price: "0", tax_rate: "15" }]);

  const load = async () => {
    if (!active) return;
    const { data } = await supabase
      .from("invoices")
      .select("id,invoice_number,issue_date,due_date,total,amount_paid,status,subtotal,tax_total,notes,customer:customers(name,email)")
      .eq("company_id", active.id)
      .order("issue_date", { ascending: false });
    setInvoices(data ?? []);
    const { data: cs } = await supabase.from("customers").select("id,name,email").eq("company_id", active.id).order("name");
    setCustomers(cs ?? []);
  };

  useEffect(() => { load(); }, [active?.id]);

  // ── Payment dialog ──────────────────────────────────────────────────
  const [payInv, setPayInv] = useState<any | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [paying, setPaying] = useState(false);

  const openPayment = (inv: any) => {
    setPayInv(inv);
    setPayAmount(String(Math.max(0, Number(inv.total) - Number(inv.amount_paid)).toFixed(2)));
    setPayDate(new Date().toISOString().slice(0, 10));
  };

  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payInv) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) return toast.error("Enter a valid amount");
    setPaying(true);
    const { error } = await supabase.rpc("record_invoice_payment", {
      _invoice_id: payInv.id,
      _amount: amount,
      _payment_date: payDate,
      _bank_account_code: "1000",
      _notes: "",
    });
    setPaying(false);
    if (error) return toast.error(error.message);
    toast.success("Payment recorded");
    setPayInv(null);
    load();
  };

  // ── Reverse Payment ─────────────────────────────────────────────────
  const [reversingId, setReversingId] = useState<string | null>(null);

  const reversePayment = async (inv: any) => {
    if (!confirm(`Reverse the latest payment on ${inv.invoice_number}? This will undo the payment journal entry and update the invoice status.`)) return;
    setReversingId(inv.id);
    const { error } = await supabase.rpc("reverse_invoice_payment" as any, { _invoice_id: inv.id });
    setReversingId(null);
    if (error) return toast.error(error.message);
    toast.success("Payment reversed successfully");
    load();
  };

  // ── Delete ──────────────────────────────────────────────────────────
  const removeInvoice = async (inv: any) => {
    if (!confirm(`Delete invoice ${inv.invoice_number}? This also removes its journal entry.`)) return;
    const { error } = await supabase.rpc("delete_draft_invoice", { _invoice_id: inv.id });
    if (error) return toast.error(error.message);
    toast.success("Invoice deleted");
    load();
  };

  // ── PDF Download ────────────────────────────────────────────────────
  const downloadPDF = async (inv: any) => {
    if (!active) return;
    setDownloadingId(inv.id);
    try {
      const { data: lineData, error } = await supabase
        .from("invoice_lines")
        .select("description,quantity,unit_price,tax_rate,line_total")
        .eq("invoice_id", inv.id)
        .order("position");
      if (error) throw error;
      const customer = customers.find((c) => c.name === inv.customer?.name) ?? null;
      generateInvoicePDF({
        invoice_number: inv.invoice_number,
        issue_date: inv.issue_date,
        due_date: inv.due_date,
        status: inv.status,
        notes: inv.notes ?? "",
        subtotal: Number(inv.subtotal ?? 0),
        tax_total: Number(inv.tax_total ?? 0),
        total: Number(inv.total),
        amount_paid: Number(inv.amount_paid),
        customer: customer
          ? { name: customer.name, email: customer.email }
          : inv.customer
            ? { name: inv.customer.name }
            : null,
        company: {
          name: active.name,
          currency: active.currency,
          tax_number: (active as any).tax_number ?? undefined,
        },
        lines: (lineData ?? []).map((l: any) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          tax_rate: Number(l.tax_rate),
          line_total: Number(l.line_total),
        })),
      });
      toast.success(`${inv.invoice_number}.pdf downloaded`);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to generate PDF");
    } finally {
      setDownloadingId(null);
    }
  };

  useEffect(() => {
    if (!open) return;
    const next = `INV-${String(invoices.length + 1).padStart(4, "0")}`;
    setNumber(next);
  }, [open, invoices.length]);

  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);
  const taxTotal = lines.reduce((s, l) => s + ((Number(l.quantity) || 0) * (Number(l.unit_price) || 0) * (Number(l.tax_rate) || 0)) / 100, 0);
  const total = subtotal + taxTotal;

  const updateLine = (i: number, field: keyof Line, value: any) =>
    setLines(lines.map((x, j) => (j === i ? { ...x, [field]: value } : x)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active || !customerId) return toast.error("Pick a customer");
    if (lines.length === 0) return toast.error("Add at least one line");
    setSubmitting(true);
    const { error } = await supabase.rpc("create_invoice_with_journal", {
      _company_id: active.id,
      _customer_id: customerId,
      _invoice_number: number,
      _issue_date: issueDate,
      _due_date: dueDate,
      _notes: notes || "",
      _lines: lines.map(l => ({
        description: l.description,
        quantity: Number(l.quantity) || 0,
        unit_price: Number(l.unit_price) || 0,
        tax_rate: Number(l.tax_rate) || 0
      })),
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success("Invoice created and journal posted");
    setOpen(false);
    setCustomerId(""); setNotes("");
    setLines([{ description: "", quantity: "1", unit_price: "0", tax_rate: "15" }]);
    load();
  };

  if (!active) return null;

  return (
    <div className="px-6 md:px-10 py-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-1">{invoices.length} total</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button disabled={customers.length === 0}><Plus className="h-4 w-4 mr-2" /> New invoice</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>New invoice</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Customer</Label>
                  <Select value={customerId} onValueChange={setCustomerId}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select customer" /></SelectTrigger>
                    <SelectContent>
                      {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Invoice #</Label>
                  <Input value={number} onChange={(e) => setNumber(e.target.value)} className="mt-1" required />
                </div>
                <div>
                  <Label>Issue date</Label>
                  <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="mt-1" required />
                </div>
                <div>
                  <Label>Due date</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1" required />
                </div>
              </div>

              <div>
                <Label className="mb-2 block">Line items</Label>

                {/* Column Headers */}
                <div className="grid grid-cols-12 gap-2 mb-1 px-1">
                  <span className="col-span-5 text-xs font-medium text-muted-foreground">Description</span>
                  <span className="col-span-2 text-xs font-medium text-muted-foreground">Quantity</span>
                  <span className="col-span-2 text-xs font-medium text-muted-foreground">Unit Price</span>
                  <span className="col-span-2 text-xs font-medium text-muted-foreground">VAT %</span>
                  <span className="col-span-1" />
                </div>

                <div className="space-y-2">
                  {lines.map((l, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <Input
                        className="col-span-5"
                        placeholder="e.g. Consulting services"
                        value={l.description}
                        onChange={(e) => updateLine(i, "description", e.target.value)}
                        required
                      />
                      <Input
                        className="col-span-2"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="1"
                        value={l.quantity}
                        onChange={(e) => updateLine(i, "quantity", e.target.value)}
                      />
                      <Input
                        className="col-span-2"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={l.unit_price}
                        onChange={(e) => updateLine(i, "unit_price", e.target.value)}
                      />
                      <Input
                        className="col-span-2"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="15"
                        value={l.tax_rate}
                        onChange={(e) => updateLine(i, "tax_rate", e.target.value)}
                      />
                      <Button type="button" size="icon" variant="ghost" className="col-span-1" onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setLines([...lines, { description: "", quantity: "1", unit_price: "0", tax_rate: "15" }])}>
                  <Plus className="h-4 w-4 mr-2" /> Add line
                </Button>
              </div>

              <div className="rounded-lg bg-muted/40 p-4 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatMoney(subtotal, active.currency)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">VAT / Tax</span><span className="tabular-nums">{formatMoney(taxTotal, active.currency)}</span></div>
                <div className="flex justify-between font-semibold border-t pt-1 mt-1"><span>Total</span><span className="tabular-nums">{formatMoney(total, active.currency)}</span></div>
              </div>

              <div>
                <Label>Notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" placeholder="Optional payment terms or message..." />
              </div>

              <DialogFooter><Button type="submit" disabled={submitting}>{submitting ? "Posting…" : "Create & post journal"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {customers.length === 0 && (
        <Card className="p-4 mb-4 bg-warning/10 text-sm text-warning-foreground border-warning/30">
          Add at least one customer before creating invoices.
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        {invoices.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">No invoices yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-left">
              <tr>
                <th className="font-medium px-6 py-3">Number</th>
                <th className="font-medium px-6 py-3">Customer</th>
                <th className="font-medium px-6 py-3">Issued</th>
                <th className="font-medium px-6 py-3">Due</th>
                <th className="font-medium px-6 py-3">Status</th>
                <th className="font-medium px-6 py-3 text-right">Paid / Total</th>
                <th className="px-2 py-3 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => {
                const remaining = Number(i.total) - Number(i.amount_paid);
                const canPay = remaining > 0.005;
                const hasPaid = Number(i.amount_paid) > 0;
                const canDelete = !hasPaid;
                const isDownloading = downloadingId === i.id;
                const isReversing = reversingId === i.id;
                return (
                  <tr key={i.id} className="border-t hover:bg-muted/20 transition-colors">
                    <td className="px-6 py-3 font-medium">{i.invoice_number}</td>
                    <td className="px-6 py-3">{i.customer?.name ?? "—"}</td>
                    <td className="px-6 py-3 text-muted-foreground">{formatDate(i.issue_date)}</td>
                    <td className="px-6 py-3 text-muted-foreground">{formatDate(i.due_date)}</td>
                    <td className="px-6 py-3"><StatusBadge status={i.status} /></td>
                    <td className="px-6 py-3 text-right tabular-nums">
                      <span className="text-muted-foreground">{formatMoney(Number(i.amount_paid), active.currency)}</span>
                      <span className="text-muted-foreground mx-1">/</span>
                      <span>{formatMoney(Number(i.total), active.currency)}</span>
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Download PDF"
                          disabled={isDownloading}
                          onClick={() => downloadPDF(i)}
                        >
                          <Download className={`h-4 w-4 ${isDownloading ? "animate-bounce text-primary" : ""}`} />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              disabled={!canPay}
                              onSelect={() => {
                                setTimeout(() => openPayment(i), 10);
                              }}
                            >
                              <Wallet className="h-4 w-4 mr-2" /> Record payment
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!hasPaid || isReversing}
                              onSelect={() => {
                                setTimeout(() => reversePayment(i), 10);
                              }}
                              className="text-warning-foreground focus:text-warning-foreground"
                            >
                              <Undo2 className="h-4 w-4 mr-2" /> {isReversing ? "Reversing…" : "Reverse payment"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              disabled={!canDelete}
                              onSelect={() => {
                                setTimeout(() => removeInvoice(i), 10);
                              }}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* Payment Dialog */}
      <Dialog open={!!payInv} onOpenChange={(o) => !o && setPayInv(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader>
          {payInv && (
            <form onSubmit={submitPayment} className="space-y-4">
              <div className="rounded-lg bg-muted/40 p-3 text-sm flex justify-between">
                <div>
                  <div className="font-medium">{payInv.invoice_number}</div>
                  <div className="text-muted-foreground">{payInv.customer?.name ?? "—"}</div>
                </div>
                <div className="text-right">
                  <div className="text-muted-foreground text-xs">Outstanding</div>
                  <div className="font-medium tabular-nums">
                    {formatMoney(Number(payInv.total) - Number(payInv.amount_paid), active.currency)}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Amount</Label>
                  <Input type="number" step="0.01" min="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="mt-1" required />
                </div>
                <div>
                  <Label>Payment date</Label>
                  <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="mt-1" required />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Posts a balanced journal: <span className="font-mono">Dr Bank · Cr Accounts Receivable</span>.
              </p>
              <DialogFooter>
                <Button type="submit" disabled={paying}>{paying ? "Posting…" : "Record payment"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
