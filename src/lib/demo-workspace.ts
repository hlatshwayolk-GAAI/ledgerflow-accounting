// Demo Workspace and local persistence for offline/trial testing

export interface DemoCompany {
  id: string;
  name: string;
  currency: string;
  tax_number: string | null;
  industry: string | null;
  logo_url?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
}

export const DEMO_USER = {
  id: "demo-user-id-001",
  email: "demo@ledgerflow.co.za",
  app_metadata: {},
  user_metadata: { full_name: "Demo Admin" },
  aud: "authenticated",
  created_at: new Date().toISOString(),
};

export const DEMO_COMPANY: DemoCompany = {
  id: "demo-company-id-001",
  name: "Apex Logistics Pty Ltd",
  currency: "ZAR",
  tax_number: "4920192840",
  industry: "Freight & Supply Chain",
  logo_url: null,
  address: "142 Logistics Blvd, Industrial Park, Sandton, 2196",
  phone: "+27 11 555 0192",
  email: "billing@apexlogistics.co.za",
  website: "https://apexlogistics.co.za",
};

export const STANDARD_ACCOUNTS = [
  { code: "1000", name: "Standard Bank Business Account", type: "asset" },
  { code: "1100", name: "Accounts Receivable (Debtors)", type: "asset" },
  { code: "1200", name: "Inventory & Warehousing", type: "asset" },
  { code: "1500", name: "Vehicles & Transport Equipment", type: "asset" },
  { code: "2000", name: "Accounts Payable (Creditors)", type: "liability" },
  { code: "2100", name: "VAT Payable (SARS)", type: "liability" },
  { code: "3000", name: "Owner / Shareholder Equity", type: "equity" },
  { code: "4000", name: "Freight Services Revenue", type: "revenue" },
  { code: "4100", name: "Warehousing & Logistics Fees", type: "revenue" },
  { code: "5000", name: "Fuel & Direct Fleet Costs (COGS)", type: "expense" },
  { code: "6000", name: "Depot & Office Rent", type: "expense" },
  { code: "6100", name: "Drivers & Staff Salaries", type: "expense" },
  { code: "6200", name: "Fleet Telematics & Utilities", type: "expense" },
  { code: "1510", name: "Manufacturing Plant & Machinery", type: "asset" },
  { code: "1550", name: "Accumulated Depreciation - Plant & Machinery", type: "asset" },
  { code: "2150", name: "SARS Corporate Income Tax Payable", type: "liability" },
  { code: "6500", name: "Depreciation Expense (SARS Sec 12C / 11e)", type: "expense" },
  { code: "8000", name: "Corporate Income Tax Expense (SARS)", type: "expense" },
];

export function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("ledgerflow.demo_mode") === "true";
}

export function enableDemoMode(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("ledgerflow.demo_mode", "true");
  localStorage.setItem("ledgerflow.active_company_id", DEMO_COMPANY.id);
  initDemoData();
  window.dispatchEvent(new Event("ledgerflow:company-changed"));
  window.dispatchEvent(new Event("ledgerflow:auth-changed"));
}

export function disableDemoMode(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("ledgerflow.demo_mode");
  window.dispatchEvent(new Event("ledgerflow:company-changed"));
  window.dispatchEvent(new Event("ledgerflow:auth-changed"));
}

export function initDemoData(force = false): void {
  if (typeof window === "undefined") return;

  const initialised = localStorage.getItem("ledgerflow.demo_seeded");
  if (initialised && !force) return;

  // 1. Seed Accounts with deterministic IDs
  const accounts = STANDARD_ACCOUNTS.map((a) => ({
    id: `demo-acc-${a.code}`,
    company_id: DEMO_COMPANY.id,
    code: a.code,
    name: a.name,
    type: a.type,
    created_at: new Date(Date.now() - 60 * 86400000).toISOString(),
  }));
  localStorage.setItem("ledgerflow.demo_accounts", JSON.stringify(accounts));

  // 2. Seed Customers
  const customers = [
    {
      id: "demo-cust-1",
      company_id: DEMO_COMPANY.id,
      name: "Transnet Logistics Corp",
      email: "finance@transnet-mock.co.za",
      phone: "+27 11 555 0192",
      address: "Carlton Centre, Johannesburg",
    },
    {
      id: "demo-cust-2",
      company_id: DEMO_COMPANY.id,
      name: "Pick n Pay Distribution",
      email: "accounts@pnp-dist.co.za",
      phone: "+27 21 444 8920",
      address: "Kenilworth Office Park, Cape Town",
    },
    {
      id: "demo-cust-3",
      company_id: DEMO_COMPANY.id,
      name: "Sasol Chemicals Division",
      email: "procurement@sasol-chem.co.za",
      phone: "+27 16 960 1111",
      address: "Rosebank, Gauteng",
    },
  ];
  localStorage.setItem("ledgerflow.demo_customers", JSON.stringify(customers));

  // 3. Seed Suppliers
  const suppliers = [
    {
      id: "demo-supp-1",
      company_id: DEMO_COMPANY.id,
      name: "Engen Petroleum SA",
      email: "bulk@engen.co.za",
      phone: "+27 21 403 4911",
    },
    {
      id: "demo-supp-2",
      company_id: DEMO_COMPANY.id,
      name: "Scania Commercial Vehicles",
      email: "service@scania.co.za",
      phone: "+27 11 249 7000",
    },
    {
      id: "demo-supp-3",
      company_id: DEMO_COMPANY.id,
      name: "Growthpoint Industrial Properties",
      email: "leasing@growthpoint.co.za",
      phone: "+27 11 944 6000",
    },
  ];
  localStorage.setItem("ledgerflow.demo_suppliers", JSON.stringify(suppliers));

  // 4. Seed Invoices & Lines
  const today = new Date();
  const d1 = new Date(today.getTime() - 15 * 86400000).toISOString().slice(0, 10);
  const d2 = new Date(today.getTime() - 5 * 86400000).toISOString().slice(0, 10);

  const invoices = [
    {
      id: "demo-inv-1",
      company_id: DEMO_COMPANY.id,
      customer_id: customers[0].id,
      customer: { name: customers[0].name, email: customers[0].email },
      invoice_number: "INV-0001",
      issue_date: d1,
      due_date: new Date(today.getTime() + 15 * 86400000).toISOString().slice(0, 10),
      notes: "Route JHB to Durban bulk container haulage",
      status: "paid",
      subtotal: 45000,
      tax_total: 6750,
      total: 51750,
      amount_paid: 51750,
      lines: [
        {
          description: "Long-haul freight (JHB - DBN)",
          quantity: 3,
          unit_price: 15000,
          tax_rate: 15,
          line_total: 45000,
        },
      ],
    },
    {
      id: "demo-inv-2",
      company_id: DEMO_COMPANY.id,
      customer_id: customers[1].id,
      customer: { name: customers[1].name, email: customers[1].email },
      invoice_number: "INV-0002",
      issue_date: d2,
      due_date: new Date(today.getTime() + 25 * 86400000).toISOString().slice(0, 10),
      notes: "Temperature-controlled distribution services",
      status: "sent",
      subtotal: 68000,
      tax_total: 10200,
      total: 78200,
      amount_paid: 0,
      lines: [
        {
          description: "Refrigerated cross-dock distribution",
          quantity: 2,
          unit_price: 34000,
          tax_rate: 15,
          line_total: 68000,
        },
      ],
    },
  ];
  localStorage.setItem("ledgerflow.demo_invoices", JSON.stringify(invoices));

  // 5. Seed Bills
  const bills = [
    {
      id: "demo-bill-1",
      company_id: DEMO_COMPANY.id,
      supplier_id: suppliers[0].id,
      supplier: { name: suppliers[0].name },
      bill_number: "BILL-0001",
      issue_date: d1,
      due_date: new Date(today.getTime() + 10 * 86400000).toISOString().slice(0, 10),
      notes: "Monthly diesel fleet account",
      status: "paid",
      subtotal: 24000,
      tax_total: 3600,
      total: 27600,
      amount_paid: 27600,
      lines: [
        {
          description: "Bulk Low-Sulphur Diesel 50ppm",
          account_id: "demo-acc-5000",
          quantity: 1200,
          unit_price: 20,
          tax_rate: 15,
          line_total: 24000,
        },
      ],
    },
    {
      id: "demo-bill-2",
      company_id: DEMO_COMPANY.id,
      supplier_id: suppliers[2].id,
      supplier: { name: suppliers[2].name },
      bill_number: "BILL-0002",
      issue_date: d2,
      due_date: new Date(today.getTime() + 14 * 86400000).toISOString().slice(0, 10),
      notes: "Depot bay rental - Isando logistics park",
      status: "sent",
      subtotal: 18000,
      tax_total: 2700,
      total: 20700,
      amount_paid: 0,
      lines: [
        {
          description: "Industrial warehouse & staging yard",
          account_id: "demo-acc-6000",
          quantity: 1,
          unit_price: 18000,
          tax_rate: 15,
          line_total: 18000,
        },
      ],
    },
  ];
  localStorage.setItem("ledgerflow.demo_bills", JSON.stringify(bills));

  // 6. Seed Double-Entry Journals for balanced books
  const journals = [
    // Initial Owner Capital (Dr Bank R150,000, Cr Equity R150,000)
    {
      id: "demo-jrn-1",
      company_id: DEMO_COMPANY.id,
      entry_date: new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10),
      description: "Initial Capital Contribution [Ref: CAP-001]",
      source_type: "manual",
      created_at: new Date(today.getTime() - 30 * 86400000).toISOString(),
      journal_lines: [
        { account_id: "demo-acc-1000", debit: 150000, credit: 0, account: { code: "1000", name: "Standard Bank Business Account" } },
        { account_id: "demo-acc-3000", debit: 0, credit: 150000, account: { code: "3000", name: "Owner / Shareholder Equity" } },
      ],
    },
    // Invoice 1 posted (Dr AR R51,750, Cr Revenue R45,000, Cr VAT R6,750)
    {
      id: "demo-jrn-2",
      company_id: DEMO_COMPANY.id,
      entry_date: d1,
      description: "Invoice INV-0001",
      source_type: "invoice",
      source_id: "demo-inv-1",
      created_at: d1,
      journal_lines: [
        { account_id: "demo-acc-1100", debit: 51750, credit: 0, account: { code: "1100", name: "Accounts Receivable (Debtors)" } },
        { account_id: "demo-acc-4000", debit: 0, credit: 45000, account: { code: "4000", name: "Freight Services Revenue" } },
        { account_id: "demo-acc-2100", debit: 0, credit: 6750, account: { code: "2100", name: "VAT Payable (SARS)" } },
      ],
    },
    // Payment received for Invoice 1 (Dr Bank R51,750, Cr AR R51,750)
    {
      id: "demo-jrn-3",
      company_id: DEMO_COMPANY.id,
      entry_date: d2,
      description: "Payment for INV-0001 — EFT settlement",
      source_type: "invoice_payment",
      source_id: "demo-inv-1",
      created_at: d2,
      journal_lines: [
        { account_id: "demo-acc-1000", debit: 51750, credit: 0, account: { code: "1000", name: "Standard Bank Business Account" } },
        { account_id: "demo-acc-1100", debit: 0, credit: 51750, account: { code: "1100", name: "Accounts Receivable (Debtors)" } },
      ],
    },
    // Invoice 2 posted (Dr AR R78,200, Cr Revenue R68,000, Cr VAT R10,200)
    {
      id: "demo-jrn-4",
      company_id: DEMO_COMPANY.id,
      entry_date: d2,
      description: "Invoice INV-0002",
      source_type: "invoice",
      source_id: "demo-inv-2",
      created_at: d2,
      journal_lines: [
        { account_id: "demo-acc-1100", debit: 78200, credit: 0, account: { code: "1100", name: "Accounts Receivable (Debtors)" } },
        { account_id: "demo-acc-4000", debit: 0, credit: 68000, account: { code: "4000", name: "Freight Services Revenue" } },
        { account_id: "demo-acc-2100", debit: 0, credit: 10200, account: { code: "2100", name: "VAT Payable (SARS)" } },
      ],
    },
    // Bill 1 posted (Dr Diesel Expense R24,000, Dr VAT R3,600, Cr AP R27,600)
    {
      id: "demo-jrn-5",
      company_id: DEMO_COMPANY.id,
      entry_date: d1,
      description: "Supplier Bill BILL-0001",
      source_type: "bill",
      source_id: "demo-bill-1",
      created_at: d1,
      journal_lines: [
        { account_id: "demo-acc-5000", debit: 24000, credit: 0, account: { code: "5000", name: "Fuel & Direct Fleet Costs (COGS)" } },
        { account_id: "demo-acc-2100", debit: 3600, credit: 0, account: { code: "2100", name: "VAT Payable (SARS)" } },
        { account_id: "demo-acc-2000", debit: 0, credit: 27600, account: { code: "2000", name: "Accounts Payable (Creditors)" } },
      ],
    },
    // Payment for Bill 1 (Dr AP R27,600, Cr Bank R27,600)
    {
      id: "demo-jrn-6",
      company_id: DEMO_COMPANY.id,
      entry_date: d2,
      description: "Payment for Bill BILL-0001",
      source_type: "bill_payment",
      source_id: "demo-bill-1",
      created_at: d2,
      journal_lines: [
        { account_id: "demo-acc-2000", debit: 27600, credit: 0, account: { code: "2000", name: "Accounts Payable (Creditors)" } },
        { account_id: "demo-acc-1000", debit: 0, credit: 27600, account: { code: "1000", name: "Standard Bank Business Account" } },
      ],
    },
    // Bill 2 posted (Dr Rent Expense R18,000, Dr VAT R2,700, Cr AP R20,700)
    {
      id: "demo-jrn-7",
      company_id: DEMO_COMPANY.id,
      entry_date: d2,
      description: "Supplier Bill BILL-0002",
      source_type: "bill",
      source_id: "demo-bill-2",
      created_at: d2,
      journal_lines: [
        { account_id: "demo-acc-6000", debit: 18000, credit: 0, account: { code: "6000", name: "Depot & Office Rent" } },
        { account_id: "demo-acc-2100", debit: 2700, credit: 0, account: { code: "2100", name: "VAT Payable (SARS)" } },
        { account_id: "demo-acc-2000", debit: 0, credit: 20700, account: { code: "2000", name: "Accounts Payable (Creditors)" } },
      ],
    },
  ];
  localStorage.setItem("ledgerflow.demo_journals", JSON.stringify(journals));

  // 7. Seed Bank Account & Transactions
  const bankAccounts = [
    {
      id: "demo-bank-1",
      company_id: DEMO_COMPANY.id,
      name: "Primary Operations Account",
      bank_name: "Standard Bank",
      account_number: "002938475",
      account_id: "demo-acc-1000",
      account: { code: "1000", name: "Standard Bank Business Account" },
    },
  ];
  localStorage.setItem("ledgerflow.demo_bank_accounts", JSON.stringify(bankAccounts));

  const bankTransactions = [
    {
      id: "demo-tx-1",
      company_id: DEMO_COMPANY.id,
      bank_account_id: "demo-bank-1",
      date: d2,
      description: "EFT DEP TRANSNET FREIGHT 51750",
      reference: "INV-0001",
      amount: 51750,
      status: "reconciled",
      reconciled_to_type: "invoice",
      reconciled_to_id: "demo-inv-1",
    },
    {
      id: "demo-tx-2",
      company_id: DEMO_COMPANY.id,
      bank_account_id: "demo-bank-1",
      date: d2,
      description: "DEBIT ORDER ENGEN DIESEL",
      reference: "BILL-0001",
      amount: -27600,
      status: "reconciled",
      reconciled_to_type: "bill",
      reconciled_to_id: "demo-bill-1",
    },
    {
      id: "demo-tx-3",
      company_id: DEMO_COMPANY.id,
      bank_account_id: "demo-bank-1",
      date: today.toISOString().slice(0, 10),
      description: "INTEREST RECEIVED - 32 DAY NOTICE",
      reference: "INT-883",
      amount: 1450,
      status: "unreconciled",
      reconciled_to_type: null,
      reconciled_to_id: null,
    },
  ];
  localStorage.setItem("ledgerflow.demo_bank_transactions", JSON.stringify(bankTransactions));

  localStorage.setItem("ledgerflow.demo_seeded", "true");
}
