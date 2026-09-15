import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, MoreHorizontal, Wallet, Receipt, Undo2 } from "lucide-react";
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
import {
  createBillWithJournal,
  deleteDraftBill,
  recordBillPayment,
  reverseBillPayment,
} from "@/lib/accounting";
import { isDemoMode } from "@/lib/demo-workspace";

export const Route = createFileRoute("/app/bills")({
  component: BillsPage,
});

type BillLine = { description: string; quantity: string; unit_price: string; tax_rate: string; account_id: string };
type Account = { id: string; code: string; name: string; type: string };

function BillsPage() {
  const { active } = useCompanies();
  const [bills, setBills] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [supplierId, setSupplierId] = useState("");
  const [number, setNumber] = useState("");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<BillLine[]>([{ description: "", quantity: "1", unit_price: "0", tax_rate: "15", account_id: "" }]);

  // Payment states
  const [payBill, setPayBill] = useState<any | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [paying, setPaying] = useState(false);

  // Reverse state
  const [reversingId, setReversingId] = useState<string | null>(null);

  const load = async () => {
    if (!active) return;
    if (isDemoMode()) {
      const demoBills = JSON.parse(localStorage.getItem("ledgerflow.demo_bills") || "[]");
      const demoSupps = JSON.parse(localStorage.getItem("ledgerflow.demo_suppliers") || "[]");
      const demoAccs = JSON.parse(localStorage.getItem("ledgerflow.demo_accounts") || "[]");
      setBills(demoBills.filter((b: any) => b.company_id === active.id));
      setSuppliers(demoSupps.filter((s: any) => s.company_id === active.id));
      setAccounts(demoAccs.filter((a: any) => a.company_id === active.id && (a.type === "expense" || a.type === "asset")));
      return;
    }

    try {
      const { data: bData, error: bErr } = await supabase
        .from("bills" as any)
        .select("id,bill_number,issue_date,due_date,total,amount_paid,status,supplier:suppliers(name)")
        .eq("company_id", active.id)
        .order("issue_date", { ascending: false });

      if (bErr) {
        console.error("Error loading bills:", bErr);
      } else {
        setBills(bData ?? []);
      }

      const { data: sData } = await supabase.from("suppliers").select("id,name").eq("company_id", active.id).order("name");
      setSuppliers(sData ?? []);

      const { data: aData } = await supabase
        .from("accounts")
        .select("id,code,name,type")
        .eq("company_id", active.id)
        .in("type", ["expense", "asset"])
        .order("code");
      setAccounts((aData as Account[]) ?? []);
    } catch (err) {
      console.warn("Could not load bills from Supabase:", err);
      const demoBills = JSON.parse(localStorage.getItem("ledgerflow.demo_bills") || "[]");
      const demoSupps = JSON.parse(localStorage.getItem("ledgerflow.demo_suppliers") || "[]");
      const demoAccs = JSON.parse(localStorage.getItem("ledgerflow.demo_accounts") || "[]");
      setBills(demoBills.filter((b: any) => b.company_id === active.id));
      setSuppliers(demoSupps.filter((s: any) => s.company_id === active.id));
      setAccounts(demoAccs.filter((a: any) => a.company_id === active.id && (a.type === "expense" || a.type === "asset")));
    }
  };

  useEffect(() => { load(); }, [active?.id]);

  useEffect(() => {
    if (!open) return;
    const next = `BILL-${String(bills.length + 1).padStart(4, "0")}`;
    setNumber(next);
  }, [open, bills.length]);

  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);
  const taxTotal = lines.reduce((s, l) => s + ((Number(l.quantity) || 0) * (Number(l.unit_price) || 0) * (Number(l.tax_rate) || 0)) / 100, 0);
  const total = subtotal + taxTotal;

  const updateLine = (i: number, field: keyof BillLine, value: any) =>
    setLines(lines.map((x, j) => (j === i ? { ...x, [field]: value } : x)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active) return;
    if (!supplierId) return toast.error("Pick a supplier");
    if (lines.length === 0) return toast.error("Add at least one line");
    if (lines.some(l => !l.account_id)) return toast.error("Select an account for every line");

    setSubmitting(true);
    try {
      await createBillWithJournal({
        company_id: active.id,
        supplier_id: supplierId,
        bill_number: number,
        issue_date: issueDate,
        due_date: dueDate,
        notes: notes || "",
        lines: lines.map((l) => ({
          description: l.description,
          account_id: l.account_id,
          quantity: Number(l.quantity) || 0,
          unit_price: Number(l.unit_price) || 0,
          tax_rate: Number(l.tax_rate) || 0,
        })),
      });
      toast.success("Bill created and journal posted");
      setOpen(false);
      setSupplierId("");
      setNotes("");
      setLines([{ description: "", quantity: "1", unit_price: "0", tax_rate: "15", account_id: "" }]);
      load();
    } catch (err: any) {
      toast.error(err?.message || "Failed to create bill");
    } finally {
      setSubmitting(false);
    }
  };

  const openPayment = (bill: any) => {
    setPayBill(bill);
    setPayAmount(String(Math.max(0, Number(bill.total) - Number(bill.amount_paid)).toFixed(2)));
    setPayDate(new Date().toISOString().slice(0, 10));
  };

  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payBill) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) return toast.error("Enter a valid amount");

    setPaying(true);
    try {
      await recordBillPayment(payBill.id, amount, payDate, "1000", "");
      toast.success("Payment recorded");
      setPayBill(null);
      load();
    } catch (err: any) {
      toast.error(err?.message || "Failed to record payment");
    } finally {
      setPaying(false);
    }
  };

  const reversePayment = async (bill: any) => {
    if (!confirm(`Reverse the latest payment on ${bill.bill_number}? This will undo the payment journal entry and update the bill status.`)) return;
    setReversingId(bill.id);
    try {
      await reverseBillPayment(bill.id);
      toast.success("Payment reversed successfully");
      load();
    } catch (err: any) {
      toast.error(err?.message || "Failed to reverse payment");
    } finally {
      setReversingId(null);
    }
  };

  const removeBill = async (bill: any) => {
    if (!confirm(`Delete bill ${bill.bill_number}? This also removes its journal entry.`)) return;
    try {
      await deleteDraftBill(bill.id);
      toast.success("Bill deleted");
      load();
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete bill");
    }
  };

  if (!active) return null;

  return (
    <div className="px-6 md:px-10 py-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Supplier Bills</h1>
          <p className="text-sm text-muted-foreground mt-1">{bills.length} total bills</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button disabled={suppliers.length === 0}><Plus className="h-4 w-4 mr-2" /> New bill</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>New supplier bill</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Supplier</Label>
                  <Select value={supplierId} onValueChange={setSupplierId}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select supplier" /></SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Bill #</Label>
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
                <div className="space-y-3">
                  {lines.map((l, i) => (
                    <div key={i} className="border p-3 rounded-lg bg-card space-y-2 relative">
                      {/* Description row */}
                      <div className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-11 space-y-1">
                          <Label className="text-xs text-muted-foreground">Description</Label>
                          <Input
                            placeholder="e.g. Office supplies"
                            value={l.description}
                            onChange={(e) => updateLine(i, "description", e.target.value)}
                            required
                          />
                        </div>
                        <Button type="button" size="icon" variant="ghost" className="col-span-1 mt-5" onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>

                      {/* Account + numerics row */}
                      <div className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-6 space-y-1">
                          <Label className="text-xs text-muted-foreground">Expense / Asset Account</Label>
                          <Select value={l.account_id} onValueChange={(val) => updateLine(i, "account_id", val)}>
                            <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                            <SelectContent>
                              {accounts.map((a) => (
                                <SelectItem key={a.id} value={a.id}>
                                  {a.code} — {a.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs text-muted-foreground">Quantity</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="1"
                            value={l.quantity}
                            onChange={(e) => updateLine(i, "quantity", e.target.value)}
                          />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs text-muted-foreground">Unit Price</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={l.unit_price}
                            onChange={(e) => updateLine(i, "unit_price", e.target.value)}
                          />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs text-muted-foreground">VAT %</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="15"
                            value={l.tax_rate}
                            onChange={(e) => updateLine(i, "tax_rate", e.target.value)}
                          />
                        </div>
                      </div>

                      {/* Line subtotal */}
                      <div className="text-xs text-right text-muted-foreground">
                        Line total: <span className="font-medium text-foreground tabular-nums">
                          {formatMoney((Number(l.quantity) || 0) * (Number(l.unit_price) || 0) * (1 + (Number(l.tax_rate) || 0) / 100), active.currency)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setLines([...lines, { description: "", quantity: "1", unit_price: "0", tax_rate: "15", account_id: "" }])}>
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
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
              </div>

              <DialogFooter>
                <Button type="submit" disabled={submitting}>{submitting ? "Posting…" : "Create & post journal"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {suppliers.length === 0 && (
        <Card className="p-4 mb-4 bg-warning/10 text-sm text-warning-foreground border-warning/30">
          Add at least one supplier before creating bills.
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        {bills.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Receipt className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
            No supplier bills yet. Create your first supplier bill to track accounts payable.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-left">
              <tr>
                <th className="font-medium px-6 py-3">Number</th>
                <th className="font-medium px-6 py-3">Supplier</th>
                <th className="font-medium px-6 py-3">Issued</th>
                <th className="font-medium px-6 py-3">Due</th>
                <th className="font-medium px-6 py-3">Status</th>
                <th className="font-medium px-6 py-3 text-right">Paid / Total</th>
                <th className="px-2 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => {
                const remaining = Number(b.total) - Number(b.amount_paid);
                const canPay = remaining > 0.005;
                const hasPaid = Number(b.amount_paid) > 0;
                const canDelete = !hasPaid;
                const isReversing = reversingId === b.id;
                return (
                  <tr key={b.id} className="border-t hover:bg-muted/20 transition-colors">
                    <td className="px-6 py-3 font-medium">{b.bill_number}</td>
                    <td className="px-6 py-3">{b.supplier?.name ?? "—"}</td>
                    <td className="px-6 py-3 text-muted-foreground">{formatDate(b.issue_date)}</td>
                    <td className="px-6 py-3 text-muted-foreground">{formatDate(b.due_date)}</td>
                    <td className="px-6 py-3"><StatusBadge status={b.status} /></td>
                    <td className="px-6 py-3 text-right tabular-nums">
                      <span className="text-muted-foreground">{formatMoney(Number(b.amount_paid), active.currency)}</span>
                      <span className="text-muted-foreground mx-1">/</span>
                      <span>{formatMoney(Number(b.total), active.currency)}</span>
                    </td>
                    <td className="px-2 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={!canPay}
                            onSelect={() => {
                              setTimeout(() => openPayment(b), 10);
                            }}
                          >
                            <Wallet className="h-4 w-4 mr-2" /> Record payment
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!hasPaid || isReversing}
                            onSelect={() => {
                              setTimeout(() => reversePayment(b), 10);
                            }}
                            className="text-warning-foreground focus:text-warning-foreground"
                          >
                            <Undo2 className="h-4 w-4 mr-2" /> {isReversing ? "Reversing…" : "Reverse payment"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={!canDelete}
                            onSelect={() => {
                              setTimeout(() => removeBill(b), 10);
                            }}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* Payment Dialog */}
      <Dialog open={!!payBill} onOpenChange={(o) => !o && setPayBill(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record Payment for {payBill?.bill_number}</DialogTitle></DialogHeader>
          {payBill && (() => {
            const outstanding = Math.max(0, Number(payBill.total) - Number(payBill.amount_paid));
            const currentAmount = Number(payAmount) || 0;
            const remainingAfterPayment = Math.max(0, outstanding - currentAmount);
            const willFullyPay = currentAmount >= outstanding - 0.005;

            return (
              <form onSubmit={submitPayment} className="space-y-4 pt-1">
                <div className="rounded-lg bg-muted/40 p-3.5 text-sm flex justify-between items-center border">
                  <div>
                    <div className="font-semibold text-foreground">{payBill.bill_number}</div>
                    <div className="text-xs text-muted-foreground">{payBill.supplier?.name ?? "Supplier"}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Current Outstanding</div>
                    <div className="font-semibold tabular-nums text-foreground">
                      {formatMoney(outstanding, active.currency)}
                    </div>
                  </div>
                </div>

                {/* Quick Payment Preset Buttons */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Payment Type</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={willFullyPay ? "default" : "outline"}
                      size="sm"
                      onClick={() => setPayAmount(outstanding.toFixed(2))}
                      className="w-full text-xs font-medium"
                    >
                      Pay Full ({formatMoney(outstanding, active.currency)})
                    </Button>
                    <Button
                      type="button"
                      variant={!willFullyPay ? "default" : "outline"}
                      size="sm"
                      onClick={() => setPayAmount((outstanding / 2).toFixed(2))}
                      className="w-full text-xs font-medium"
                    >
                      Partial (50%)
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Amount to Pay</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={outstanding}
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      className="mt-1 font-mono font-medium"
                      required
                    />
                  </div>
                  <div>
                    <Label>Payment Date</Label>
                    <Input
                      type="date"
                      value={payDate}
                      onChange={(e) => setPayDate(e.target.value)}
                      className="mt-1"
                      required
                    />
                  </div>
                </div>

                {/* Dynamic Remaining Balance calculation card */}
                <div className="rounded-lg border bg-card p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Balance after payment:</span>
                    <span className={`font-semibold tabular-nums ${remainingAfterPayment <= 0.005 ? "text-success" : "text-foreground"}`}>
                      {formatMoney(remainingAfterPayment, active.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-1 border-t">
                    <span className="text-muted-foreground">Updated Status:</span>
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${willFullyPay ? "bg-success/15 text-success border border-success/30" : "bg-warning/15 text-warning border border-warning/30"}`}>
                      {willFullyPay ? "PAID IN FULL" : "PARTIALLY PAID"}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Posts a double-entry journal: <span className="font-mono">Dr Accounts Payable (2000) · Cr Bank (1000)</span>.
                </p>

                <DialogFooter className="pt-2">
                  <Button type="button" variant="ghost" onClick={() => setPayBill(null)}>Cancel</Button>
                  <Button type="submit" disabled={paying}>{paying ? "Recording…" : "Confirm Payment"}</Button>
                </DialogFooter>
              </form>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
