import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isDemoMode, DEMO_COMPANY } from "@/lib/demo-workspace";

const STORAGE_KEY = "ledgerflow.active_company_id";

export function getActiveCompanyId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function setActiveCompanyId(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) localStorage.setItem(STORAGE_KEY, id);
  else localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("ledgerflow:company-changed"));
}

export type Company = {
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
};

export function useCompanies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);

    if (isDemoMode()) {
      let demoList: Company[] = [];
      try {
        const storedCompanies = localStorage.getItem("ledgerflow.demo_companies");
        if (storedCompanies) {
          demoList = JSON.parse(storedCompanies);
        }
      } catch (e) {
        console.error("Failed to parse demo companies from localStorage", e);
      }

      if (!demoList || demoList.length === 0) {
        let demoCompany = { ...DEMO_COMPANY };
        const singleStored = localStorage.getItem("ledgerflow.demo_company");
        if (singleStored) {
          try {
            const parsed = JSON.parse(singleStored);
            demoCompany = { ...demoCompany, ...parsed };
          } catch (e) {
            console.error("Failed to parse single demo company", e);
          }
        }
        demoList = [demoCompany];
        localStorage.setItem("ledgerflow.demo_companies", JSON.stringify(demoList));
      }

      setCompanies(demoList);
      let current = getActiveCompanyId();
      if (!current || !demoList.find((c) => c.id === current)) {
        current = demoList[0]?.id ?? null;
        setActiveCompanyId(current);
      }
      setActiveId(current);
      setLoading(false);
      return;
    }

    try {
      let list: Company[] = [];
      const res = await supabase
        .from("companies")
        .select("id,name,currency,tax_number,industry,logo_url,address,phone,email,website")
        .order("created_at", { ascending: true });

      if (res.error) {
        console.warn("Could not fetch profile fields from companies table, falling back to core columns:", res.error.message);
        const fallbackRes = await supabase
          .from("companies")
          .select("id,name,currency,tax_number,industry")
          .order("created_at", { ascending: true });
        
        if (fallbackRes.error) throw fallbackRes.error;
        list = (fallbackRes.data ?? []) as Company[];
      } else {
        list = (res.data ?? []) as Company[];
      }

      setCompanies(list);
      let current = getActiveCompanyId();
      if (!current || !list.find((c) => c.id === current)) {
        current = list[0]?.id ?? null;
        setActiveCompanyId(current);
      }
      setActiveId(current);
    } catch (err) {
      console.warn("Could not load companies from Supabase:", err);
      setCompanies([]);
      setActiveId(null);
    } finally {
      setLoading(false);
    }
  };

  const deleteCompany = async (companyId: string): Promise<void> => {
    if (isDemoMode()) {
      let demoList: Company[] = [];
      try {
        demoList = JSON.parse(localStorage.getItem("ledgerflow.demo_companies") || "[]");
      } catch {
        demoList = [];
      }
      if (demoList.length === 0) {
        demoList = [{ ...DEMO_COMPANY }];
      }

      const updatedList = demoList.filter((c) => c.id !== companyId);

      // Clean up demo documents belonging to this company
      const cleanupStorage = (key: string) => {
        try {
          const items = JSON.parse(localStorage.getItem(key) || "[]");
          const filtered = items.filter((item: any) => item.company_id !== companyId);
          localStorage.setItem(key, JSON.stringify(filtered));
        } catch (e) {
          console.warn(`Failed to cleanup ${key}:`, e);
        }
      };

      cleanupStorage("ledgerflow.demo_invoices");
      cleanupStorage("ledgerflow.demo_bills");
      cleanupStorage("ledgerflow.demo_customers");
      cleanupStorage("ledgerflow.demo_suppliers");
      cleanupStorage("ledgerflow.demo_journals");
      cleanupStorage("ledgerflow.demo_accounts");
      cleanupStorage("ledgerflow.demo_assets");

      if (updatedList.length === 0) {
        // If user deleted the last company in demo mode, create a fresh company
        const freshCompany: Company = {
          id: `demo-company-${Date.now()}`,
          name: "Fresh Workspace Pty Ltd",
          currency: "ZAR",
          tax_number: null,
          industry: "Services",
        };
        updatedList.push(freshCompany);
      }

      localStorage.setItem("ledgerflow.demo_companies", JSON.stringify(updatedList));

      const currentActiveId = getActiveCompanyId();
      if (currentActiveId === companyId) {
        setActiveCompanyId(updatedList[0]?.id || null);
      } else {
        window.dispatchEvent(new Event("ledgerflow:company-changed"));
      }
      await load();
      return;
    }

    // Live Supabase mode
    try {
      // First clean up related rows to ensure foreign key safety
      const { data: invs } = await supabase.from("invoices").select("id").eq("company_id", companyId);
      if (invs && invs.length > 0) {
        const invIds = invs.map((i) => i.id);
        await supabase.from("invoice_lines").delete().in("invoice_id", invIds);
      }

      const { data: blls } = await supabase.from("bills" as any).select("id").eq("company_id", companyId);
      if (blls && blls.length > 0) {
        const billIds = blls.map((b: any) => b.id);
        await supabase.from("bill_lines" as any).delete().in("bill_id", billIds);
      }

      const { data: jrns } = await supabase.from("journals").select("id").eq("company_id", companyId);
      if (jrns && jrns.length > 0) {
        const jrnIds = jrns.map((j) => j.id);
        await supabase.from("journal_lines").delete().in("journal_id", jrnIds);
      }

      await supabase.from("invoices").delete().eq("company_id", companyId);
      await supabase.from("bills" as any).delete().eq("company_id", companyId);
      await supabase.from("journals").delete().eq("company_id", companyId);
      await supabase.from("bank_transactions" as any).delete().eq("company_id", companyId);
      await supabase.from("bank_accounts" as any).delete().eq("company_id", companyId);
      await supabase.from("customers").delete().eq("company_id", companyId);
      await supabase.from("suppliers" as any).delete().eq("company_id", companyId);
      await supabase.from("accounts").delete().eq("company_id", companyId);
      await supabase.from("company_members").delete().eq("company_id", companyId);

      const { error } = await supabase.from("companies").delete().eq("id", companyId);
      if (error) throw error;

      const currentActiveId = getActiveCompanyId();
      if (currentActiveId === companyId) {
        const remaining = companies.filter((c) => c.id !== companyId);
        setActiveCompanyId(remaining[0]?.id || null);
      } else {
        window.dispatchEvent(new Event("ledgerflow:company-changed"));
      }
      await load();
    } catch (err: any) {
      console.error("Failed to delete company:", err);
      throw err;
    }
  };

  useEffect(() => {
    load();
    const onChange = () => {
      setActiveId(getActiveCompanyId());
      load();
    };
    window.addEventListener("ledgerflow:company-changed", onChange);
    return () => window.removeEventListener("ledgerflow:company-changed", onChange);
  }, []);

  const active = companies.find((c) => c.id === activeId) ?? null;
  return { companies, active, activeId, loading, reload: load, deleteCompany };
}
