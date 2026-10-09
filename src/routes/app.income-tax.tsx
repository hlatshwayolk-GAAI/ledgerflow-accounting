import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import {
  Scale,
  Calculator,
  FileText,
  Receipt,
  Download,
  Printer,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Plus,
  Building2,
  Calendar,
  Landmark,
  Coins,
  Percent,
  Layers,
  Scroll,
  ExternalLink,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompanies } from "@/hooks/use-company";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { isDemoMode } from "@/lib/demo-workspace";
import { createManualJournal, seedCompanyAccounts } from "@/lib/accounting";
import { calculateAnnualDepreciation, AssetRecord } from "./app.depreciation";

export const Route = createFileRoute("/app/income-tax")({
  component: IncomeTaxPage,
});

interface InvoiceRecord {
  id: string;
  invoice_number: string;
  issue_date: string;
  subtotal: number;
  tax_total: number;
  total: number;
  status: string;
  customer?: { name: string } | null;
}

interface BillRecord {
  id: string;
  bill_number: string;
  issue_date: string;
  subtotal: number;
  tax_total: number;
  total: number;
  status: string;
  supplier?: { name: string } | null;
}

interface JournalTaxEntry {
  id: string;
  entry_date: string;
  description: string;
  reference: string | null;
  debit: number;
  credit: number;
  account_code: string;
  account_name: string;
}

const DEFAULT_TAX_ASSETS: AssetRecord[] = [
  {
    id: "ast-001",
    name: "CNC Milling Machine (Production Line A)",
    category: "Manufacturing Machinery",
    cost: 450000,
    salvage_value: 20000,
    acquisition_date: "2024-03-15",
    method: "sec_12c",
    useful_life_years: 4,
    accumulated_depreciation: 180000,
  },
  {
    id: "ast-002",
    name: "Isuzu 4-Ton Delivery Truck",
    category: "Motor Vehicles",
    cost: 320000,
    salvage_value: 50000,
    acquisition_date: "2023-06-10",
    method: "straight_line",
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
    method: "straight_line",
    useful_life_years: 3,
    accumulated_depreciation: 28333.33,
  },
];

function IncomeTaxPage() {
  const { active } = useCompanies();
  const currentYear = new Date().getFullYear();
  const [selectedTaxYear, setSelectedTaxYear] = useState<string>(String(currentYear));
  const [taxRateMode, setTaxRateMode] = useState<"standard" | "sbc" | "custom">("standard");
  const [customTaxRate, setCustomTaxRate] = useState<string>("27");
  const [additionalDeductions, setAdditionalDeductions] = useState<string>("0");
  const [nonDeductibleExpenses, setNonDeductibleExpenses] = useState<string>("0");
  const [loading, setLoading] = useState<boolean>(true);

  // Document datasets
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [bills, setBills] = useState<BillRecord[]>([]);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [taxJournals, setTaxJournals] = useState<JournalTaxEntry[]>([]);
  const [existingTaxProvision, setExistingTaxProvision] = useState<any | null>(null);

  // Dialog states
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [postingProvision, setPostingProvision] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentInstallment, setPaymentInstallment] = useState("IRP6-P1");
  const [postingPayment, setPostingPayment] = useState(false);

  // Load all underlying documents for this company
  const loadDocuments = async () => {
    if (!active) return;
    setLoading(true);

    try {
      if (isDemoMode()) {
        const demoInvs = JSON.parse(localStorage.getItem("ledgerflow.demo_invoices") || "[]");
        const demoBills = JSON.parse(localStorage.getItem("ledgerflow.demo_bills") || "[]");
        const demoJournals = JSON.parse(localStorage.getItem("ledgerflow.demo_journals") || "[]");
        const storedAssets = JSON.parse(localStorage.getItem("ledgerflow.demo_assets") || "null");

        const compInvs: InvoiceRecord[] = demoInvs
          .filter((i: any) => i.company_id === active.id)
          .map((i: any) => ({
            id: i.id,
            invoice_number: i.invoice_number,
            issue_date: i.issue_date,
            subtotal: Number(i.subtotal ?? (Number(i.total || 0) * 0.8695)),
            tax_total: Number(i.tax_total ?? 0),
            total: Number(i.total || 0),
            status: i.status,
            customer: i.customer,
          }));

        const compBills: BillRecord[] = demoBills
          .filter((b: any) => b.company_id === active.id)
          .map((b: any) => ({
            id: b.id,
            bill_number: b.bill_number,
            issue_date: b.issue_date,
            subtotal: Number(b.subtotal ?? (Number(b.total || 0) * 0.8695)),
            tax_total: Number(b.tax_total ?? 0),
            total: Number(b.total || 0),
            status: b.status,
            supplier: b.supplier,
          }));

        const compAssets: AssetRecord[] = storedAssets && storedAssets.length > 0 ? storedAssets : DEFAULT_TAX_ASSETS;

        // Find journals affecting CIT accounts (8000 or 2150)
        const compTaxJournals: JournalTaxEntry[] = [];
        let existingProv = null;

        demoJournals
          .filter((j: any) => j.company_id === active.id)
          .forEach((j: any) => {
            const hasTaxLines = (j.journal_lines || []).some(
              (l: any) => l.account?.code === "8000" || l.account?.code === "2150" || l.account_id?.includes("2150") || l.account_id?.includes("8000")
            );

            if (hasTaxLines) {
              if (j.reference?.includes(selectedTaxYear) || j.description?.includes(selectedTaxYear)) {
                existingProv = j;
              }
              (j.journal_lines || []).forEach((l: any) => {
                const code = l.account?.code || (l.account_id?.includes("8000") ? "8000" : l.account_id?.includes("2150") ? "2150" : "Other");
                const name = l.account?.name || (code === "8000" ? "Corporate Income Tax Expense" : "SARS CIT Payable");
                compTaxJournals.push({
                  id: `${j.id}-${l.account_id}`,
                  entry_date: j.entry_date,
                  description: j.description,
                  reference: j.reference,
                  debit: Number(l.debit || 0),
                  credit: Number(l.credit || 0),
                  account_code: code,
                  account_name: name,
                });
              });
            }
          });

        setInvoices(compInvs);
        setBills(compBills);
        setAssets(compAssets);
        setTaxJournals(compTaxJournals);
        setExistingTaxProvision(existingProv);
        setLoading(false);
        return;
      }

      // Live Supabase Mode
      // 1. Invoices
      const { data: invData } = await supabase
        .from("invoices")
        .select("id,invoice_number,issue_date,subtotal,tax_total,total,status,customer:customers(name)")
        .eq("company_id", active.id)
        .order("issue_date", { ascending: false });

      const parsedInvs: InvoiceRecord[] = (invData ?? []).map((i: any) => ({
        id: i.id,
        invoice_number: i.invoice_number,
        issue_date: i.issue_date,
        subtotal: Number(i.subtotal ?? (Number(i.total || 0) * 0.8695)),
        tax_total: Number(i.tax_total ?? 0),
        total: Number(i.total || 0),
        status: i.status,
        customer: i.customer,
      }));

      // 2. Bills
      const { data: billData } = await supabase
        .from("bills" as any)
        .select("id,bill_number,issue_date,subtotal,tax_total,total,status,supplier:suppliers(name)")
        .eq("company_id", active.id)
        .order("issue_date", { ascending: false });

      const parsedBills: BillRecord[] = (billData ?? []).map((b: any) => ({
        id: b.id,
        bill_number: b.bill_number,
        issue_date: b.issue_date,
        subtotal: Number(b.subtotal ?? (Number(b.total || 0) * 0.8695)),
        tax_total: Number(b.tax_total ?? 0),
        total: Number(b.total || 0),
        status: b.status,
        supplier: b.supplier,
      }));

      // 3. Assets from localStorage or defaults
      const storedAssets = JSON.parse(localStorage.getItem(`ledgerflow.assets.${active.id}`) || "null");
      const compAssets: AssetRecord[] = storedAssets && storedAssets.length > 0 ? storedAssets : DEFAULT_TAX_ASSETS;

      // 4. Journals for tax provision
      const { data: jData } = await supabase
        .from("journals")
        .select(`
          id,
          entry_date,
          description,
          reference,
          journal_lines (
            debit,
            credit,
            account:accounts (code, name)
          )
        `)
        .eq("company_id", active.id)
        .order("entry_date", { ascending: false });

      const compTaxJournals: JournalTaxEntry[] = [];
      let existingProv = null;

      (jData ?? []).forEach((j: any) => {
        const hasTax = (j.journal_lines || []).some(
          (l: any) => l.account?.code === "8000" || l.account?.code === "2150"
        );
        if (hasTax) {
          if (j.reference?.includes(selectedTaxYear) || j.description?.includes(selectedTaxYear)) {
            existingProv = j;
          }
          (j.journal_lines || []).forEach((l: any) => {
            if (l.account?.code === "8000" || l.account?.code === "2150") {
              compTaxJournals.push({
                id: `${j.id}-${l.account?.code}`,
                entry_date: j.entry_date,
                description: j.description,
                reference: j.reference,
                debit: Number(l.debit || 0),
                credit: Number(l.credit || 0),
                account_code: l.account?.code || "",
                account_name: l.account?.name || "",
              });
            }
          });
        }
      });

      setInvoices(parsedInvs);
      setBills(parsedBills);
      setAssets(compAssets);
      setTaxJournals(compTaxJournals);
      setExistingTaxProvision(existingProv);
    } catch (err) {
      console.warn("Could not load income tax documents:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [active?.id, selectedTaxYear]);

  // Filter documents by selected tax year
  const periodInvoices = useMemo(() => {
    return invoices.filter((i) => i.issue_date.startsWith(selectedTaxYear));
  }, [invoices, selectedTaxYear]);

  const periodBills = useMemo(() => {
    return bills.filter((b) => b.issue_date.startsWith(selectedTaxYear));
  }, [bills, selectedTaxYear]);

  // Calculate Gross Assessable Revenue (from Invoices subtotal excl VAT)
  const grossInvoiceRevenue = periodInvoices.reduce((s, i) => s + i.subtotal, 0);

  // Calculate Allowable Deductions (from Bills subtotal excl input VAT)
  const allowableBillExpenses = periodBills.reduce((s, b) => s + b.subtotal, 0);

  // Calculate Wear and Tear / Depreciation Allowance (Section 12C / 11e)
  const totalDepreciationAllowance = useMemo(() => {
    return assets.reduce((sum, asset) => {
      return sum + calculateAnnualDepreciation(asset, 1);
    }, 0);
  }, [assets]);

  // Adjustments
  const parsedNonDeductible = Math.max(0, Number(nonDeductibleExpenses) || 0);
  const parsedAdditionalDeductions = Math.max(0, Number(additionalDeductions) || 0);

  // Taxable Income Calculation
  // Gross Revenue - Allowable Bills - Wear and tear + Non-deductible add-backs - Additional tax incentives
  const accountingNetProfit = grossInvoiceRevenue - allowableBillExpenses;
  const taxableIncome = Math.max(
    0,
    grossInvoiceRevenue - allowableBillExpenses - totalDepreciationAllowance + parsedNonDeductible - parsedAdditionalDeductions
  );

  // Tax Rate Calculation (South Africa standard CIT is 27% from 2023 onwards)
  const effectiveTaxRate = useMemo(() => {
    if (taxRateMode === "standard") return 0.27;
    if (taxRateMode === "custom") return (Number(customTaxRate) || 0) / 100;
    // Small Business Corporation (SBC) Progressive Table approximation
    if (taxableIncome <= 95750) return 0;
    if (taxableIncome <= 365000) return 0.07;
    if (taxableIncome <= 550000) return 0.21;
    return 0.27;
  }, [taxRateMode, customTaxRate, taxableIncome]);

  const estimatedTaxLiability = Math.max(0, taxableIncome * effectiveTaxRate);

  // Provisional tax payments made (debits to Account 2150 or credits to Bank for IRP6)
  const provisionalTaxPaid = useMemo(() => {
    return taxJournals
      .filter((j) => j.account_code === "2150" && j.debit > 0 && j.entry_date.startsWith(selectedTaxYear))
      .reduce((s, j) => s + j.debit, 0);
  }, [taxJournals, selectedTaxYear]);

  const netTaxBalanceDue = Math.max(0, estimatedTaxLiability - provisionalTaxPaid);

  // Post Corporate Tax Provision Journal Entry (Dr 8000 Expense, Cr 2150 Liability)
  const handlePostProvision = async () => {
    if (!active) return;
    setPostingProvision(true);

    try {
      await seedCompanyAccounts(active.id);

      // Fetch or locate account IDs
      let expAccId = "demo-acc-8000";
      let payAccId = "demo-acc-2150";

      if (!isDemoMode()) {
        const { data: accs } = await supabase
          .from("accounts")
          .select("id,code")
          .eq("company_id", active.id)
          .in("code", ["8000", "2150"]);

        const expAcc = accs?.find((a) => a.code === "8000");
        const payAcc = accs?.find((a) => a.code === "2150");

        if (!expAcc || !payAcc) {
          throw new Error("Tax accounts (8000 Corporate Tax Expense or 2150 SARS CIT Payable) missing.");
        }
        expAccId = expAcc.id;
        payAccId = payAcc.id;
      }

      const provAmount = Number(estimatedTaxLiability.toFixed(2));
      const entryDate = `${selectedTaxYear}-12-31`;
      const description = `Corporate Income Tax Provision for Tax Year ${selectedTaxYear}`;
      const reference = `CIT-PROV-${selectedTaxYear}`;

      await createManualJournal(active.id, entryDate, description, reference, [
        {
          account_id: expAccId,
          debit: provAmount,
          credit: 0,
        },
        {
          account_id: payAccId,
          debit: 0,
          credit: provAmount,
        },
      ]);

      toast.success(
        `Tax provision of ${formatMoney(provAmount, active.currency)} posted to general ledger (Dr 8000 / Cr 2150).`
      );
      setProvisionOpen(false);
      await loadDocuments();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to post tax provision journal");
    } finally {
      setPostingProvision(false);
    }
  };

  // Record Tax Payment to SARS (Dr 2150 Liability, Cr 1000 Bank)
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active) return;

    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return toast.error("Enter a valid payment amount");
    }

    setPostingPayment(true);
    try {
      await seedCompanyAccounts(active.id);

      let payAccId = "demo-acc-2150";
      let bankAccId = "demo-acc-1000";

      if (!isDemoMode()) {
        const { data: accs } = await supabase
          .from("accounts")
          .select("id,code")
          .eq("company_id", active.id)
          .in("code", ["2150", "1000"]);

        const payAcc = accs?.find((a) => a.code === "2150");
        const bankAcc = accs?.find((a) => a.code === "1000");

        if (!payAcc || !bankAcc) {
          throw new Error("Missing SARS Tax Payable (2150) or Bank Account (1000)");
        }
        payAccId = payAcc.id;
        bankAccId = bankAcc.id;
      }

      const description = `SARS Corporate Income Tax Payment (${paymentInstallment}) for Tax Year ${selectedTaxYear}`;
      const reference = `SARS-${paymentInstallment}-${selectedTaxYear}`;

      await createManualJournal(active.id, paymentDate, description, reference, [
        {
          account_id: payAccId,
          debit: amount,
          credit: 0,
        },
        {
          account_id: bankAccId,
          debit: 0,
          credit: amount,
        },
      ]);

      toast.success(
        `SARS Tax payment of ${formatMoney(amount, active.currency)} recorded and reconciled in journals.`
      );
      setPaymentOpen(false);
      setPaymentAmount("");
      await loadDocuments();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to record tax payment");
    } finally {
      setPostingPayment(false);
    }
  };

  const handlePrintSchedule = () => {
    window.print();
  };

  if (!active) return null;

  return (
    <div className="px-6 md:px-10 py-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-300">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Scale className="h-6 w-6 text-primary" />
              Corporate Income Tax (CIT)
            </h1>
            <Badge variant="outline" className="border-primary/40 text-primary bg-primary/5">
              SARS ITR14 & IRP6
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Automated statutory tax reconciliation connecting customer invoices, supplier bills, wear & tear allowances, and double-entry journals.
          </p>
        </div>

        {/* Tax Year and Actions */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-card border rounded-md px-3 py-1.5 shadow-xs">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Tax Year:</span>
            <Select value={selectedTaxYear} onValueChange={setSelectedTaxYear}>
              <SelectTrigger className="h-7 w-24 border-0 font-semibold p-0 text-xs focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={String(currentYear + 1)}>{currentYear + 1}</SelectItem>
                <SelectItem value={String(currentYear)}>{currentYear}</SelectItem>
                <SelectItem value={String(currentYear - 1)}>{currentYear - 1}</SelectItem>
                <SelectItem value={String(currentYear - 2)}>{currentYear - 2}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="text-xs h-9"
            onClick={handlePrintSchedule}
          >
            <Printer className="h-3.5 w-3.5 mr-1.5" />
            Print ITR14 Schedule
          </Button>

          <Button
            size="sm"
            className="text-xs h-9"
            onClick={() => {
              setPaymentAmount(netTaxBalanceDue > 0 ? netTaxBalanceDue.toFixed(2) : "");
              setPaymentOpen(true);
            }}
          >
            <Coins className="h-3.5 w-3.5 mr-1.5" />
            Record SARS Payment
          </Button>
        </div>
      </div>

      {/* Provision Status Alert */}
      {existingTaxProvision ? (
        <div className="flex items-center justify-between p-4 rounded-lg border bg-success/5 border-success/30 text-xs">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
            <div>
              <p className="font-semibold text-foreground">
                Corporate Tax Provision is Posted in General Ledger
              </p>
              <p className="text-muted-foreground mt-0.5">
                Journal Reference: <span className="font-mono">{existingTaxProvision.reference || "CIT-PROV"}</span> · Posted on {formatDate(existingTaxProvision.entry_date)}
              </p>
            </div>
          </div>
          <Link to="/app/journals">
            <Button variant="outline" size="sm" className="h-7 text-xs">
              View in Journal Entries <ExternalLink className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg border bg-primary/5 border-primary/20 text-xs">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
            <div>
              <p className="font-semibold text-foreground">
                Tax Year {selectedTaxYear} Provision Ready for Accrual
              </p>
              <p className="text-muted-foreground mt-0.5">
                Accrue the estimated tax liability of <strong>{formatMoney(estimatedTaxLiability, active.currency)}</strong> to reflect in your Profit & Loss and Balance Sheet.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            className="h-8 text-xs shrink-0"
            onClick={() => setProvisionOpen(true)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Post Tax Provision Journal
          </Button>
        </div>
      )}

      {/* Primary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 border bg-card/80">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Gross Assessable Revenue</span>
            <FileText className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-foreground">
            {formatMoney(grossInvoiceRevenue, active.currency)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {periodInvoices.length} invoices issued in {selectedTaxYear}
          </p>
        </Card>

        <Card className="p-5 border bg-card/80">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Allowable Deductions</span>
            <Receipt className="h-4 w-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-foreground">
            {formatMoney(allowableBillExpenses, active.currency)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {periodBills.length} supplier bills & operating expenses
          </p>
        </Card>

        <Card className="p-5 border bg-card/80">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Wear & Tear Allowance</span>
            <Calculator className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-foreground">
            {formatMoney(totalDepreciationAllowance, active.currency)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            SARS Sec 12C / 11(e) wear & tear allowances
          </p>
        </Card>

        <Card className="p-5 border bg-primary/5 border-primary/20">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider text-primary">Assessed CIT Liability</span>
            <Scale className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-primary">
            {formatMoney(estimatedTaxLiability, active.currency)}
          </div>
          <div className="flex items-center justify-between text-xs mt-1 text-muted-foreground">
            <span>Rate: {(effectiveTaxRate * 100).toFixed(1)}%</span>
            <span>Paid: {formatMoney(provisionalTaxPaid, active.currency)}</span>
          </div>
        </Card>
      </div>

      {/* Main Tabs for Document Breakdown & Edge Integrations */}
      <Tabs defaultValue="computation" className="space-y-6">
        <TabsList className="grid grid-cols-2 md:grid-cols-5 h-auto p-1 bg-muted/60">
          <TabsTrigger value="computation" className="text-xs py-2">
            Tax Computation (ITR14)
          </TabsTrigger>
          <TabsTrigger value="invoices" className="text-xs py-2 flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Invoices ({periodInvoices.length})
          </TabsTrigger>
          <TabsTrigger value="bills" className="text-xs py-2 flex items-center gap-1.5">
            <Receipt className="h-3.5 w-3.5" />
            Bills & Expenses ({periodBills.length})
          </TabsTrigger>
          <TabsTrigger value="depreciation" className="text-xs py-2 flex items-center gap-1.5">
            <Calculator className="h-3.5 w-3.5" />
            Wear & Tear ({assets.length})
          </TabsTrigger>
          <TabsTrigger value="journals" className="text-xs py-2 flex items-center gap-1.5">
            <Scroll className="h-3.5 w-3.5" />
            Tax Ledger ({taxJournals.length})
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Tax Computation Breakdown */}
        <TabsContent value="computation" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Reconciliation Statement */}
            <Card className="p-6 lg:col-span-2 space-y-6">
              <div>
                <h3 className="text-base font-semibold">SARS ITR14 Statutory Tax Reconciliation</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Reconciliation of accounting net profit to taxable income for tax year {selectedTaxYear}.
                </p>
              </div>

              <div className="border rounded-lg overflow-hidden text-sm divide-y">
                <div className="flex justify-between items-center px-4 py-3 bg-muted/30 font-medium">
                  <span>Gross Assessable Turnover (Invoices Subtotal)</span>
                  <span className="font-mono">{formatMoney(grossInvoiceRevenue, active.currency)}</span>
                </div>

                <div className="flex justify-between items-center px-4 py-3 text-muted-foreground">
                  <span className="flex items-center gap-2">
                    <span className="text-destructive font-mono">-</span>
                    Allowable Cost of Sales & Direct Business Deductions (Bills)
                  </span>
                  <span className="font-mono text-destructive">
                    - {formatMoney(allowableBillExpenses, active.currency)}
                  </span>
                </div>

                <div className="flex justify-between items-center px-4 py-3 font-medium bg-muted/10">
                  <span>Accounting Net Profit before Tax</span>
                  <span className="font-mono">{formatMoney(accountingNetProfit, active.currency)}</span>
                </div>

                <div className="flex justify-between items-center px-4 py-3 text-muted-foreground">
                  <span className="flex items-center gap-2">
                    <span className="text-destructive font-mono">-</span>
                    Section 12C & 11(e) Wear & Tear Capital Allowances
                  </span>
                  <span className="font-mono text-destructive">
                    - {formatMoney(totalDepreciationAllowance, active.currency)}
                  </span>
                </div>

                {parsedNonDeductible > 0 && (
                  <div className="flex justify-between items-center px-4 py-3 text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <span className="text-primary font-mono">+</span>
                      Disallowable / Non-Deductible Expenses (Fines, Penalties, Entertainment)
                    </span>
                    <span className="font-mono text-primary">
                      + {formatMoney(parsedNonDeductible, active.currency)}
                    </span>
                  </div>
                )}

                {parsedAdditionalDeductions > 0 && (
                  <div className="flex justify-between items-center px-4 py-3 text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <span className="text-destructive font-mono">-</span>
                      Additional Statutory Tax Deductions & Incentives
                    </span>
                    <span className="font-mono text-destructive">
                      - {formatMoney(parsedAdditionalDeductions, active.currency)}
                    </span>
                  </div>
                )}

                <div className="flex justify-between items-center px-4 py-3 bg-primary/5 font-semibold text-foreground">
                  <span>Net Taxable Income (Tax Base)</span>
                  <span className="font-mono">{formatMoney(taxableIncome, active.currency)}</span>
                </div>

                <div className="flex justify-between items-center px-4 py-3 text-muted-foreground">
                  <span>Corporate Income Tax Rate Applied</span>
                  <span className="font-mono font-medium text-foreground">
                    {(effectiveTaxRate * 100).toFixed(1)}% {taxRateMode === "sbc" ? "(SBC Graduated)" : "(Standard CIT)"}
                  </span>
                </div>

                <div className="flex justify-between items-center px-4 py-3 font-bold bg-muted/40 text-base">
                  <span>Total Assessed Corporate Income Tax (CIT)</span>
                  <span className="font-mono text-primary">
                    {formatMoney(estimatedTaxLiability, active.currency)}
                  </span>
                </div>

                <div className="flex justify-between items-center px-4 py-3 text-muted-foreground">
                  <span>Less: Provisional Tax Payments Made (IRP6 Installments)</span>
                  <span className="font-mono text-emerald-600">
                    - {formatMoney(provisionalTaxPaid, active.currency)}
                  </span>
                </div>

                <div className="flex justify-between items-center px-4 py-3.5 bg-primary/10 font-bold text-foreground">
                  <span>Net Balance Due to SARS / (Refund)</span>
                  <span className="font-mono text-lg text-primary">
                    {formatMoney(netTaxBalanceDue, active.currency)}
                  </span>
                </div>
              </div>
            </Card>

            {/* Tax Configuration & Parameters Panel */}
            <Card className="p-6 space-y-6">
              <div>
                <h3 className="text-base font-semibold">Tax Settings & Add-Backs</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Configure corporate tax rates and manual statutory adjustments.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Tax Rate Regime</Label>
                  <Select value={taxRateMode} onValueChange={(v: any) => setTaxRateMode(v)}>
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard Corporate CIT (27%)</SelectItem>
                      <SelectItem value="sbc">Small Business Corporation (SBC)</SelectItem>
                      <SelectItem value="custom">Custom Tax Rate %</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {taxRateMode === "custom" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Custom Tax Rate (%)</Label>
                    <Input
                      type="number"
                      value={customTaxRate}
                      onChange={(e) => setCustomTaxRate(e.target.value)}
                      className="text-xs"
                      placeholder="27"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">Disallowable Expenses / Fines (+ Add-Back)</Label>
                  <Input
                    type="number"
                    value={nonDeductibleExpenses}
                    onChange={(e) => setNonDeductibleExpenses(e.target.value)}
                    className="text-xs"
                    placeholder="0.00"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Non-tax-deductible expenses (e.g. traffic fines, entertainment) added back to taxable income.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Other Allowable Deductions (- Tax Relief)</Label>
                  <Input
                    type="number"
                    value={additionalDeductions}
                    onChange={(e) => setAdditionalDeductions(e.target.value)}
                    className="text-xs"
                    placeholder="0.00"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Learnership agreements (s12H), energy efficiency incentives, or other statutory deductions.
                  </p>
                </div>

                <div className="pt-2 border-t space-y-2">
                  <Button
                    className="w-full text-xs"
                    onClick={() => setProvisionOpen(true)}
                    disabled={existingTaxProvision}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                    {existingTaxProvision ? "Provision Already Accrued" : "Post Tax Provision (Dr 8000 / Cr 2150)"}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full text-xs"
                    onClick={() => {
                      setPaymentAmount(netTaxBalanceDue > 0 ? netTaxBalanceDue.toFixed(2) : "");
                      setPaymentOpen(true);
                    }}
                  >
                    <Coins className="h-3.5 w-3.5 mr-1.5" />
                    Record Payment to SARS (Dr 2150 / Cr 1000)
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 2: Invoices & Revenue Breakdown */}
        <TabsContent value="invoices" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold">Contributing Sales Invoices ({periodInvoices.length})</h3>
              <p className="text-xs text-muted-foreground">
                Invoices issued in tax year {selectedTaxYear}. Revenue subtotal excludes VAT (output tax).
              </p>
            </div>
            <Link to="/app/invoices">
              <Button variant="outline" size="sm" className="text-xs">
                Manage Invoices <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </div>

          <Card className="p-0 overflow-hidden">
            {periodInvoices.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                No invoices found for tax year {selectedTaxYear}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-muted-foreground text-left">
                    <tr>
                      <th className="font-medium px-4 py-3">Invoice #</th>
                      <th className="font-medium px-4 py-3">Customer</th>
                      <th className="font-medium px-4 py-3">Issue Date</th>
                      <th className="font-medium px-4 py-3">Status</th>
                      <th className="font-medium px-4 py-3 text-right">Revenue (Excl. VAT)</th>
                      <th className="font-medium px-4 py-3 text-right">VAT (15%)</th>
                      <th className="font-medium px-4 py-3 text-right">Gross Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodInvoices.map((inv) => (
                      <tr key={inv.id} className="border-t hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 font-medium font-mono text-xs">{inv.invoice_number}</td>
                        <td className="px-4 py-3">{inv.customer?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDate(inv.issue_date)}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="text-[10px]">
                            {inv.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-medium">
                          {formatMoney(inv.subtotal, active.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                          {formatMoney(inv.tax_total, active.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {formatMoney(inv.total, active.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30 border-t font-semibold">
                    <tr>
                      <td colSpan={4} className="px-4 py-3 text-right">Total Assessable Revenue:</td>
                      <td className="px-4 py-3 text-right font-mono text-primary">
                        {formatMoney(grossInvoiceRevenue, active.currency)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {formatMoney(
                          periodInvoices.reduce((s, i) => s + i.tax_total, 0),
                          active.currency
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {formatMoney(
                          periodInvoices.reduce((s, i) => s + i.total, 0),
                          active.currency
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* Tab 3: Bills & Allowable Expenses Breakdown */}
        <TabsContent value="bills" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold">Contributing Supplier Bills & Operating Expenses ({periodBills.length})</h3>
              <p className="text-xs text-muted-foreground">
                Supplier bills recorded in tax year {selectedTaxYear} allowable under SARS Section 11(a).
              </p>
            </div>
            <Link to="/app/bills">
              <Button variant="outline" size="sm" className="text-xs">
                Manage Bills <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </div>

          <Card className="p-0 overflow-hidden">
            {periodBills.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                No supplier bills recorded for tax year {selectedTaxYear}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-muted-foreground text-left">
                    <tr>
                      <th className="font-medium px-4 py-3">Bill #</th>
                      <th className="font-medium px-4 py-3">Supplier</th>
                      <th className="font-medium px-4 py-3">Issue Date</th>
                      <th className="font-medium px-4 py-3">Deductibility</th>
                      <th className="font-medium px-4 py-3 text-right">Allowable Deduction (Excl. VAT)</th>
                      <th className="font-medium px-4 py-3 text-right">Input VAT</th>
                      <th className="font-medium px-4 py-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodBills.map((bill) => (
                      <tr key={bill.id} className="border-t hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 font-medium font-mono text-xs">{bill.bill_number}</td>
                        <td className="px-4 py-3">{bill.supplier?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDate(bill.issue_date)}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 bg-emerald-500/10 text-[10px]">
                            Allowable s11(a)
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-medium text-destructive">
                          {formatMoney(bill.subtotal, active.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                          {formatMoney(bill.tax_total, active.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {formatMoney(bill.total, active.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30 border-t font-semibold">
                    <tr>
                      <td colSpan={4} className="px-4 py-3 text-right">Total Deductions:</td>
                      <td className="px-4 py-3 text-right font-mono text-destructive">
                        {formatMoney(allowableBillExpenses, active.currency)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {formatMoney(
                          periodBills.reduce((s, b) => s + b.tax_total, 0),
                          active.currency
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {formatMoney(
                          periodBills.reduce((s, b) => s + b.total, 0),
                          active.currency
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* Tab 4: Depreciation & Wear-and-Tear Schedule */}
        <TabsContent value="depreciation" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold">Capital Allowances Schedule ({assets.length} Assets)</h3>
              <p className="text-xs text-muted-foreground">
                SARS Section 12C (Manufacturing 40-20-20-20) and Section 11(e) wear & tear allowances.
              </p>
            </div>
            <Link to="/app/depreciation">
              <Button variant="outline" size="sm" className="text-xs">
                Asset Depreciation Center <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </div>

          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground text-left">
                  <tr>
                    <th className="font-medium px-4 py-3">Asset Description</th>
                    <th className="font-medium px-4 py-3">Category</th>
                    <th className="font-medium px-4 py-3">Acquisition Date</th>
                    <th className="font-medium px-4 py-3">SARS Method</th>
                    <th className="font-medium px-4 py-3 text-right">Cost</th>
                    <th className="font-medium px-4 py-3 text-right">Annual Deduction</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((asset) => {
                    const annualDeduction = calculateAnnualDepreciation(asset, 1);
                    return (
                      <tr key={asset.id} className="border-t hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 font-medium">{asset.name}</td>
                        <td className="px-4 py-3 text-muted-foreground">{asset.category}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDate(asset.acquisition_date)}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="text-[10px]">
                            {asset.method === "sec_12c" ? "Sec 12C (40-20-20-20)" : "Sec 11(e) Wear & Tear"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {formatMoney(asset.cost, active.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-600">
                          {formatMoney(annualDeduction, active.currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-muted/30 border-t font-semibold">
                  <tr>
                    <td colSpan={5} className="px-4 py-3 text-right">Total Wear & Tear Deductions:</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-600">
                      {formatMoney(totalDepreciationAllowance, active.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* Tab 5: Tax Ledger Audit Trail */}
        <TabsContent value="journals" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold">Corporate Tax General Ledger Audit Trail</h3>
              <p className="text-xs text-muted-foreground">
                Double-entry journal records on Account 8000 (CIT Expense) and Account 2150 (SARS CIT Payable).
              </p>
            </div>
            <Link to="/app/journals">
              <Button variant="outline" size="sm" className="text-xs">
                Open General Journals <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </div>

          <Card className="p-0 overflow-hidden">
            {taxJournals.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                No corporate income tax entries recorded yet. Post a tax provision or record a payment to populate this audit trail.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-muted-foreground text-left">
                    <tr>
                      <th className="font-medium px-4 py-3">Entry Date</th>
                      <th className="font-medium px-4 py-3">Description</th>
                      <th className="font-medium px-4 py-3">Reference</th>
                      <th className="font-medium px-4 py-3">Account</th>
                      <th className="font-medium px-4 py-3 text-right">Debit (Dr)</th>
                      <th className="font-medium px-4 py-3 text-right">Credit (Cr)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxJournals.map((entry) => (
                      <tr key={entry.id} className="border-t hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground">{formatDate(entry.entry_date)}</td>
                        <td className="px-4 py-3 font-medium">{entry.description}</td>
                        <td className="px-4 py-3 font-mono text-xs">{entry.reference ?? "—"}</td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs font-semibold mr-1.5">{entry.account_code}</span>
                          <span className="text-xs text-muted-foreground">{entry.account_name}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {entry.debit > 0 ? formatMoney(entry.debit, active.currency) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {entry.credit > 0 ? formatMoney(entry.credit, active.currency) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Post Provision Confirmation Dialog */}
      <Dialog open={provisionOpen} onOpenChange={setProvisionOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-primary" />
              Post Tax Provision for {selectedTaxYear}
            </DialogTitle>
            <DialogDescription className="text-xs pt-1">
              This will create a double-entry journal entry to recognize the corporate tax expense and liability in the official accounting ledgers.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="rounded-lg bg-muted/40 p-3 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Taxable Income:</span>
                <span className="font-mono font-medium">{formatMoney(taxableIncome, active.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax Rate:</span>
                <span className="font-mono font-medium">{(effectiveTaxRate * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-semibold text-sm">
                <span>Provision Amount:</span>
                <span className="font-mono text-primary">{formatMoney(estimatedTaxLiability, active.currency)}</span>
              </div>
            </div>

            <div className="rounded-lg border p-3 space-y-1 text-muted-foreground">
              <p className="font-medium text-foreground">Accounting Journal Entry:</p>
              <p>• <strong>Dr 8000</strong> Corporate Income Tax Expense: <span className="font-mono">{formatMoney(estimatedTaxLiability, active.currency)}</span></p>
              <p>• <strong>Cr 2150</strong> SARS Corporate Income Tax Payable: <span className="font-mono">{formatMoney(estimatedTaxLiability, active.currency)}</span></p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setProvisionOpen(false)} disabled={postingProvision}>
              Cancel
            </Button>
            <Button onClick={handlePostProvision} disabled={postingProvision}>
              {postingProvision ? "Posting Entry…" : "Confirm & Post Journal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record SARS Payment Dialog */}
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-primary" />
              Record SARS Tax Payment
            </DialogTitle>
            <DialogDescription className="text-xs pt-1">
              Record a provisional or final corporate income tax settlement paid to SARS. This creates a Dr 2150 / Cr 1000 journal entry.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleRecordPayment} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Payment Stage / Installment</Label>
              <Select value={paymentInstallment} onValueChange={setPaymentInstallment}>
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IRP6-P1">1st Provisional Tax (IRP6 - 6 Months)</SelectItem>
                  <SelectItem value="IRP6-P2">2nd Provisional Tax (IRP6 - Year End)</SelectItem>
                  <SelectItem value="IRP6-P3">3rd Top-Up / Final Assessment Settlement</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Amount Paid ({active.currency})</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="0.00"
                  className="text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Payment Date</Label>
                <Input
                  type="date"
                  required
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>

            <div className="rounded-lg bg-muted/40 p-3 text-xs space-y-1 text-muted-foreground">
              <p className="font-medium text-foreground">Double-Entry Impact:</p>
              <p>• <strong>Dr 2150</strong> SARS CIT Payable (Reduces Liability)</p>
              <p>• <strong>Cr 1000</strong> Business Bank Account (Reduces Cash/Bank)</p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPaymentOpen(false)} disabled={postingPayment}>
                Cancel
              </Button>
              <Button type="submit" disabled={postingPayment}>
                {postingPayment ? "Recording…" : "Post SARS Payment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
