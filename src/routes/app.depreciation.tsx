import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import {
  Building2,
  Plus,
  Calculator,
  CheckCircle2,
  Trash2,
  FileSpreadsheet,
  AlertCircle,
  HelpCircle,
  ArrowRight,
  TrendingDown,
  Layers,
} from "lucide-react";
import { useCompanies } from "@/hooks/use-company";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { createManualJournal } from "@/lib/accounting";
import { isDemoMode } from "@/lib/demo-workspace";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/depreciation")({
  component: DepreciationPage,
});

export type DepreciationMethod = "sec_12c" | "straight_line" | "reducing_balance";

export interface AssetRecord {
  id: string;
  name: string;
  category: string;
  cost: number;
  salvage_value: number;
  acquisition_date: string;
  method: DepreciationMethod;
  useful_life_years: number;
  accumulated_depreciation: number;
}

const DEFAULT_ASSETS: AssetRecord[] = [
  {
    id: "ast-001",
    name: "CNC Milling Machine (Production Line A)",
    category: "Manufacturing Machinery",
    cost: 450000,
    salvage_value: 20000,
    acquisition_date: "2024-03-15",
    method: "sec_12c", // 40-20-20-20
    useful_life_years: 4,
    accumulated_depreciation: 180000, // 40% in year 1
  },
  {
    id: "ast-002",
    name: "Isuzu 4-Ton Delivery Truck",
    category: "Motor Vehicles",
    cost: 320000,
    salvage_value: 50000,
    acquisition_date: "2023-06-10",
    method: "straight_line", // 20% p.a (5 years)
    useful_life_years: 5,
    accumulated_depreciation: 128000,
  },
  {
    id: "ast-003",
    name: "Dell Server Rack & IT Infrastructure",
    category: "Computer Equipment",
    cost: 85000,
    salvage_value: 5000,
    acquisition_date: "2024-01-20",
    method: "straight_line", // 33.33% p.a (3 years)
    useful_life_years: 3,
    accumulated_depreciation: 28333.33,
  },
];

/**
 * Calculate SARS-compliant annual depreciation amount for an asset
 */
export function calculateAnnualDepreciation(asset: AssetRecord, currentYearNumber: number = 1): number {
  const { cost, salvage_value, method, useful_life_years, accumulated_depreciation } = asset;
  const depreciableCost = Math.max(0, cost - salvage_value);
  const currentNetBookValue = Math.max(0, cost - accumulated_depreciation);

  if (currentNetBookValue <= salvage_value) return 0;

  if (method === "sec_12c") {
    // SARS Section 12C Manufacturing Plant & Machinery: 40% Year 1, 20% Year 2, 20% Year 3, 20% Year 4
    if (currentYearNumber === 1) return cost * 0.40;
    if (currentYearNumber >= 2 && currentYearNumber <= 4) return cost * 0.20;
    return 0;
  }

  if (method === "straight_line") {
    // SARS Sec 11(e) Straight line wear and tear
    const annualRate = 1 / Math.max(1, useful_life_years);
    const annualAmount = depreciableCost * annualRate;
    return Math.min(annualAmount, currentNetBookValue - salvage_value);
  }

  if (method === "reducing_balance") {
    // Diminishing balance method
    const rate = 1 / Math.max(1, useful_life_years);
    const amount = currentNetBookValue * rate;
    return Math.min(amount, currentNetBookValue - salvage_value);
  }

  return 0;
}

function DepreciationPage() {
  const { active } = useCompanies();
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // New asset dialog
  const [openAdd, setOpenAdd] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Manufacturing Machinery");
  const [cost, setCost] = useState("");
  const [salvageValue, setSalvageValue] = useState("0");
  const [acquisitionDate, setAcquisitionDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<DepreciationMethod>("sec_12c");
  const [usefulLife, setUsefulLife] = useState("4");

  // Post journal modal state
  const [posting, setPosting] = useState(false);

  const loadAssets = () => {
    if (!active) return;
    setLoading(true);
    const storageKey = `ledgerflow.assets_${active.id}`;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        setAssets(JSON.parse(stored));
      } catch (e) {
        setAssets(DEFAULT_ASSETS);
      }
    } else {
      setAssets(DEFAULT_ASSETS);
      localStorage.setItem(storageKey, JSON.stringify(DEFAULT_ASSETS));
    }
    setLoading(false);
  };

  useEffect(() => {
    loadAssets();
  }, [active?.id]);

  const saveAssetsToStorage = (updated: AssetRecord[]) => {
    setAssets(updated);
    if (active) {
      localStorage.setItem(`ledgerflow.assets_${active.id}`, JSON.stringify(updated));
    }
  };

  const handleAddAsset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !cost || parseFloat(cost) <= 0) {
      toast.error("Please enter a valid asset name and cost price.");
      return;
    }

    const newAsset: AssetRecord = {
      id: `ast-${Date.now()}`,
      name: name.trim(),
      category,
      cost: parseFloat(cost),
      salvage_value: parseFloat(salvageValue) || 0,
      acquisition_date: acquisitionDate,
      method,
      useful_life_years: parseInt(usefulLife) || 4,
      accumulated_depreciation: 0,
    };

    const updated = [newAsset, ...assets];
    saveAssetsToStorage(updated);
    toast.success(`Asset "${newAsset.name}" added to Fixed Asset Register`);
    setOpenAdd(false);

    // Reset form
    setName("");
    setCost("");
    setSalvageValue("0");
  };

  const handleDeleteAsset = (id: string) => {
    if (!confirm("Are you sure you want to remove this asset from the register?")) return;
    const updated = assets.filter((a) => a.id !== id);
    saveAssetsToStorage(updated);
    toast.success("Asset removed");
  };

  // Calculations across all assets
  const totals = useMemo(() => {
    const totalCost = assets.reduce((s, a) => s + a.cost, 0);
    const totalAccumDep = assets.reduce((s, a) => s + a.accumulated_depreciation, 0);
    const totalNetBookValue = Math.max(0, totalCost - totalAccumDep);
    const currentYearDepreciation = assets.reduce((s, a) => s + calculateAnnualDepreciation(a, 2), 0);
    return { totalCost, totalAccumDep, totalNetBookValue, currentYearDepreciation };
  }, [assets]);

  // Post annual depreciation journal
  const handlePostDepreciationJournal = async () => {
    if (!active) return;
    if (totals.currentYearDepreciation <= 0) {
      toast.error("No depreciation amount to post for the selected period.");
      return;
    }

    setPosting(true);
    try {

      // Accounts lookup or fallback codes
      // Dr Depreciation Expense (6500)
      // Cr Accumulated Depreciation (1550)
      let depExpenseAccId = "demo-acc-6500";
      let accumDepAccId = "demo-acc-1550";

      if (!isDemoMode()) {
        const { data: accounts } = await supabase
          .from("accounts")
          .select("id,code,type")
          .eq("company_id", active.id);

        const expAcc = (accounts ?? []).find((a) => a.code === "6500" || a.type === "expense");
        const accumAcc = (accounts ?? []).find((a) => a.code === "1550" || a.type === "asset");

        if (expAcc) depExpenseAccId = expAcc.id;
        if (accumAcc) accumDepAccId = accumAcc.id;
      }

      const postDate = new Date().toISOString().slice(0, 10);
      const amount = Number(totals.currentYearDepreciation.toFixed(2));

      await createManualJournal(
        active.id,
        postDate,
        `SARS Fixed Asset Depreciation Provision (Sec 12C / 11e)`,
        `DEP-${new Date().getFullYear()}`,
        [
          { account_id: depExpenseAccId, debit: amount, credit: 0 },
          { account_id: accumDepAccId, debit: 0, credit: amount },
        ]
      );

      // Update accumulated depreciation on all asset records
      const updatedAssets = assets.map((a) => {
        const dep = calculateAnnualDepreciation(a, 2);
        return {
          ...a,
          accumulated_depreciation: Math.min(a.cost, a.accumulated_depreciation + dep),
        };
      });
      saveAssetsToStorage(updatedAssets);

      toast.success(`Depreciation journal of ${formatMoney(amount, active.currency)} posted to General Ledger!`);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to post depreciation journal");
    } finally {
      setPosting(false);
    }
  };

  if (!active) return null;

  return (
    <div className="px-6 md:px-10 py-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      {/* Page Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Calculator className="h-8 w-8 text-primary" />
            Fixed Asset Depreciation Register
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            SARS-compliant Depreciation & Wear-and-Tear Wear Engine (Section 12C Manufacturing & Section 11e).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={() => setOpenAdd(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Add New Asset
          </Button>

          <Button
            onClick={handlePostDepreciationJournal}
            disabled={posting || totals.currentYearDepreciation <= 0}
            variant="default"
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <CheckCircle2 className="h-4 w-4" />
            {posting ? "Posting..." : "Post Depreciation Journal"}
          </Button>
        </div>
      </div>

      {/* SARS Legal Banner */}
      <Card className="p-4 bg-primary/5 border-primary/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Layers className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <div className="font-semibold text-foreground">
              South African Revenue Service (SARS) Tax Compliance
            </div>
            <div className="text-muted-foreground">
              Supports <strong>Section 12C Accelerated Manufacturing Allowance</strong> (40% - 20% - 20% - 20%) for factory machinery & plant, plus <strong>Section 11(e) Wear & Tear</strong> straight-line write-offs.
            </div>
          </div>
        </div>
        <Badge variant="outline" className="border-primary/40 text-primary uppercase text-[10px] shrink-0 font-mono">
          SARS Act No. 58 of 1962
        </Badge>
      </Card>

      {/* KPI Overview Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 border bg-card">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Asset Cost</span>
            <Building2 className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold tracking-tight">{formatMoney(totals.totalCost, active.currency)}</div>
          <p className="text-xs text-muted-foreground mt-1">{assets.length} assets registered</p>
        </Card>

        <Card className="p-5 border bg-card">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Accumulated Depreciation</span>
            <TrendingDown className="h-4 w-4 text-warning-foreground" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-warning-foreground">
            {formatMoney(totals.totalAccumDep, active.currency)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Total written off to date</p>
        </Card>

        <Card className="p-5 border bg-card">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Net Book Value (Carrying)</span>
            <CheckCircle2 className="h-4 w-4 text-success" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-success">
            {formatMoney(totals.totalNetBookValue, active.currency)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Current balance sheet value</p>
        </Card>

        <Card className="p-5 border bg-card/80 bg-primary/5">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider text-primary">Est. Annual Depreciation</span>
            <Calculator className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-primary">
            {formatMoney(totals.currentYearDepreciation, active.currency)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Ready for Journal posting</p>
        </Card>
      </div>

      {/* Asset Register Table */}
      <Card className="p-0 overflow-hidden border">
        <div className="px-6 py-4 border-b flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Fixed Asset Register & Depreciation Schedule</h2>
          </div>
          <span className="text-xs text-muted-foreground">{assets.length} items</span>
        </div>

        {assets.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground space-y-2">
            <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto" />
            <p>No assets found in register. Click "Add New Asset" to begin tracking plant machinery & equipment.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-left">
                <tr>
                  <th className="font-medium px-4 py-3">Asset Name & Category</th>
                  <th className="font-medium px-4 py-3">Acquired</th>
                  <th className="font-medium px-4 py-3">SARS Tax Method</th>
                  <th className="font-medium px-4 py-3 text-right">Cost Price</th>
                  <th className="font-medium px-4 py-3 text-right">Accum. Dep.</th>
                  <th className="font-medium px-4 py-3 text-right">Net Book Value</th>
                  <th className="font-medium px-4 py-3 text-right">Next Dep. Amount</th>
                  <th className="w-12"></th>
                </tr>
              </thead>
              <tbody>
                {assets.map((ast) => {
                  const nbv = Math.max(0, ast.cost - ast.accumulated_depreciation);
                  const nextDep = calculateAnnualDepreciation(ast, 2);

                  const methodLabels: Record<DepreciationMethod, { label: string; badge: string }> = {
                    sec_12c: { label: "Sec 12C (40-20-20-20)", badge: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
                    straight_line: { label: `Sec 11(e) (${ast.useful_life_years} yrs Straight Line)`, badge: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
                    reducing_balance: { label: "Reducing Balance", badge: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
                  };

                  return (
                    <tr key={ast.id} className="border-t hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-foreground">{ast.name}</div>
                        <div className="text-xs text-muted-foreground">{ast.category}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{formatDate(ast.acquisition_date)}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={`text-[11px] ${methodLabels[ast.method].badge}`}>
                          {methodLabels[ast.method].label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{formatMoney(ast.cost, active.currency)}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-warning-foreground">
                        {formatMoney(ast.accumulated_depreciation, active.currency)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-bold text-success">
                        {formatMoney(nbv, active.currency)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-primary">
                        {formatMoney(nextDep, active.currency)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          onClick={() => handleDeleteAsset(ast.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Add New Asset Modal Dialog */}
      <Dialog open={openAdd} onOpenChange={setOpenAdd}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Add Asset to Register
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleAddAsset} className="space-y-4 py-2">
            <div>
              <Label htmlFor="asset-name">Asset Name <span className="text-destructive">*</span></Label>
              <Input
                id="asset-name"
                required
                placeholder="e.g. CNC Lathe Machine / Hino Truck"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="category">Asset Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="category" className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Manufacturing Machinery">Manufacturing Machinery</SelectItem>
                    <SelectItem value="Motor Vehicles">Motor Vehicles / Fleet</SelectItem>
                    <SelectItem value="Computer Equipment">Computer Hardware & IT</SelectItem>
                    <SelectItem value="Office Furniture">Office Furniture & Fittings</SelectItem>
                    <SelectItem value="Buildings & Improvements">Buildings & Factory Premises</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="method">SARS Tax Depreciation Method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as DepreciationMethod)}>
                  <SelectTrigger id="method" className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sec_12c">SARS Sec 12C Manufacturing (40-20-20-20)</SelectItem>
                    <SelectItem value="straight_line">SARS Sec 11(e) Straight Line</SelectItem>
                    <SelectItem value="reducing_balance">Reducing Balance Method</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="cost">Cost Price ({active.currency}) <span className="text-destructive">*</span></Label>
                <Input
                  id="cost"
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 250000"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  className="mt-1 font-mono"
                />
              </div>

              <div>
                <Label htmlFor="salvage">Residual / Salvage Value ({active.currency})</Label>
                <Input
                  id="salvage"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={salvageValue}
                  onChange={(e) => setSalvageValue(e.target.value)}
                  className="mt-1 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="acq-date">Acquisition Date</Label>
                <Input
                  id="acq-date"
                  type="date"
                  value={acquisitionDate}
                  onChange={(e) => setAcquisitionDate(e.target.value)}
                  className="mt-1 font-mono"
                />
              </div>

              <div>
                <Label htmlFor="life">Useful Life (Years)</Label>
                <Input
                  id="life"
                  type="number"
                  min="1"
                  max="50"
                  value={usefulLife}
                  onChange={(e) => setUsefulLife(e.target.value)}
                  className="mt-1 font-mono"
                />
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setOpenAdd(false)}>Cancel</Button>
              <Button type="submit">Add to Register</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
