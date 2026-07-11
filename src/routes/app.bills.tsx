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
      console.error(err);
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
    const { error } = await supabase.rpc("create_bill_with_journal" as any, {
      _company_id: active.id,
      _supplier_id: supplierId,
      _bill_number: number,
      _issue_date: issueDate,
      _due_date: dueDate,
      _notes: notes || "",
      _lines: lines.map(l => ({
        description: l.description,
        account_id: l.account_id,
        quantity: Number(l.quantity) || 0,
        unit_price: Number(l.unit_price) || 0,
        tax_rate: Number(l.tax_rate) || 0
      })),
    });
    setSubmitting(false);

    if (error) return toast.error(error.message);
    toast.success("Bill created and journal posted");
    setOpen(false);
    setSupplierId(""); setNotes("");
    setLines([{ description: "", quantity: "1", unit_price: "0", tax_rate: "15", account_id: "" }]);
    load();
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
    const { error } = await supabase.rpc("record_bill_payment" as any, {
      _bill_id: payBill.id,
      _amount: amount,
      _payment_date: payDate,
      _bank_account_code: "1000",
      _notes: "",
    });
    setPaying(false);

    if (error) return toast.error(error.message);
    toast.success("Payment recorded");
    setPayBill(null);
    load();
  };

  const reversePayment = async (bill: any) => {
    if (!confirm(`Reverse the latest payment on ${bill.bill_number}? This will undo the payment journal entry and update the bill status.`)) return;
    setReversingId(bill.id);
    const { error } = await supabase.rpc("reverse_bill_payment" as any, { _bill_id: bill.id });
    setReversingId(null);
    if (error) return toast.error(error.message);
    toast.success("Payment reversed successfully");
    load();
  };

  const removeBill = async (bill: any) => {
    if (!confirm(`Delete bill ${bill.bill_number}? This also removes its journal entry.`)) return;
    const { error } = await supabase.rpc("delete_draft_bill" as any, { _bill_id: bill.id });
    if (error) return toast.error(error.message);
    toast.success("Bill deleted");
    load();
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
        <DialogContent>
          <DialogHeader><DialogTitle>Record supplier payment</DialogTitle></DialogHeader>
          {payBill && (
            <form onSubmit={submitPayment} className="space-y-4">
              <div className="rounded-lg bg-muted/40 p-3 text-sm flex justify-between">
                <div>
                  <div className="font-medium">{payBill.bill_number}</div>
                  <div className="text-muted-foreground">{payBill.supplier?.name ?? "—"}</div>
                </div>
                <div className="text-right">
                  <div className="text-muted-foreground text-xs">Outstanding</div>
                  <div className="font-medium tabular-nums">
                    {formatMoney(Number(payBill.total) - Number(payBill.amount_paid), active.currency)}
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
                Posts a balanced journal: <span className="font-mono">Dr Accounts Payable · Cr Bank</span>.
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
