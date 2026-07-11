import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, ChevronDown, ChevronRight, BookOpen, AlertTriangle } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/app/journals")({
  component: JournalsPage,
});

type JournalLine = { account_id: string; debit: string; credit: string; description: string };
type Account = { id: string; code: string; name: string; type: string };
type Journal = {
  id: string;
  entry_date: string;
  description: string;
  reference: string | null;
  source_type: string | null;
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

function JournalsPage() {
  const { active } = useCompanies();
  const [journals, setJournals] = useState<Journal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
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
    const { data: jData, error } = await supabase
      .from("journals")
      .select(`
        id, entry_date, description, reference, source_type, created_at,
        journal_lines (
          account_id, debit, credit,
          account:accounts(code, name)
        )
      `)
      .eq("company_id", active.id)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      toast.error("Failed to load journal entries");
    } else {
      setJournals((jData ?? []) as any);
    }

    const { data: aData } = await supabase
      .from("accounts")
      .select("id,code,name,type")
      .eq("company_id", active.id)
      .order("code");
    setAccounts((aData as Account[]) ?? []);
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active) return;
    if (!description.trim()) return toast.error("Enter a description");
    if (lines.some(l => !l.account_id)) return toast.error("Select an account for every line");
    if (!isBalanced) return toast.error(`Journal must balance. Difference: ${formatMoney(Math.abs(totalDebits - totalCredits), active.currency)}`);
    if (lines.every(l => (parseFloat(l.debit) || 0) === 0 && (parseFloat(l.credit) || 0) === 0)) return toast.error("At least one line must have a debit or credit amount");

    setSubmitting(true);
    const { error } = await supabase.rpc("create_manual_journal" as any, {
      _company_id: active.id,
      _entry_date: entryDate,
      _description: description.trim(),
      _reference: reference.trim() || null,
      _lines: lines.map(l => ({
        account_id: l.account_id,
        debit: parseFloat(l.debit) || 0,
        credit: parseFloat(l.credit) || 0,
        description: l.description || null,
      })),
    });
    setSubmitting(false);

    if (error) return toast.error(error.message);
    toast.success("Journal entry posted");
    setOpen(false);
    resetForm();
    load();
  };

  if (!active) return null;

  return (
    <div className="px-6 md:px-10 py-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Journal Entries</h1>
          <p className="text-sm text-muted-foreground mt-1">
            All double-entry transactions · {journals.length} entries
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
                    placeholder="e.g. Monthly depreciation"
                    required
                  />
                </div>
                <div>
                  <Label>Reference (optional)</Label>
                  <Input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="mt-1"
                    placeholder="e.g. JNL-001"
                  />
                </div>
              </div>

              {/* Line Items */}
              <div>
                <Label className="mb-2 block">Journal lines (debits = credits)</Label>

                {/* Column Headers */}
                <div className="grid grid-cols-12 gap-2 mb-1 px-1 text-xs font-medium text-muted-foreground">
                  <span className="col-span-4">Account</span>
                  <span className="col-span-3">Line description</span>
                  <span className="col-span-2 text-right">Debit</span>
                  <span className="col-span-2 text-right">Credit</span>
                  <span className="col-span-1" />
                </div>

                <div className="space-y-2">
                  {lines.map((l, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-4">
                        <Select value={l.account_id} onValueChange={(v) => updateLine(i, "account_id", v)}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select account" />
                          </SelectTrigger>
                          <SelectContent>
                            {accounts.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                <span className="font-mono text-xs mr-1">{a.code}</span> {a.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Input
                        className="col-span-3"
                        placeholder="Optional note"
                        value={l.description}
                        onChange={(e) => updateLine(i, "description", e.target.value)}
                      />
                      <Input
                        className="col-span-2 text-right"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={l.debit}
                        onChange={(e) => updateLine(i, "debit", e.target.value)}
                      />
                      <Input
                        className="col-span-2 text-right"
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
                        className="col-span-1"
                        onClick={() => removeLine(i)}
                        disabled={lines.length <= 2}
                      >
                        <Trash2 className="h-4 w-4 text-destructive/70" />
                      </Button>
                    </div>
                  ))}
                </div>

                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={addLine}>
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
                <div className="flex gap-6 tabular-nums text-xs">
                  <span>Debits: <strong>{formatMoney(totalDebits, active.currency)}</strong></span>
                  <span>Credits: <strong>{formatMoney(totalCredits, active.currency)}</strong></span>
                  {!isBalanced && (
                    <span className="text-destructive">Diff: {formatMoney(Math.abs(totalDebits - totalCredits), active.currency)}</span>
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
            No journal entries yet. They are automatically created when you create invoices or bills.
            <br />You can also create manual entries above.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-left">
              <tr>
                <th className="font-medium px-4 py-3 w-8"></th>
                <th className="font-medium px-4 py-3">Date</th>
                <th className="font-medium px-4 py-3">Description</th>
                <th className="font-medium px-4 py-3">Reference</th>
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

                return (
                  <>
                    <tr
                      key={j.id}
                      className="border-t hover:bg-muted/20 transition-colors cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : j.id)}
                    >
                      <td className="px-4 py-3 text-muted-foreground">
                        {isExpanded
                          ? <ChevronDown className="h-4 w-4" />
                          : <ChevronRight className="h-4 w-4" />}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">{formatDate(j.entry_date)}</td>
                      <td className="px-4 py-3 font-medium">{j.description}</td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{j.reference ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="border-0 bg-muted/60 text-muted-foreground text-xs capitalize">
                          {SOURCE_LABEL[j.source_type ?? "manual"] ?? j.source_type ?? "Manual"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-mono">
                        {formatMoney(totalDr, active.currency)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-mono">
                        {formatMoney(totalCr, active.currency)}
                      </td>
                    </tr>

                    {/* Expanded lines */}
                    {isExpanded && j.journal_lines.map((line, idx) => (
                      <tr key={`${j.id}-line-${idx}`} className="bg-muted/10 border-t border-dashed">
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2 pl-8 text-muted-foreground text-xs">
                          <span className="font-mono mr-2 text-foreground">{line.account?.code}</span>
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
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
