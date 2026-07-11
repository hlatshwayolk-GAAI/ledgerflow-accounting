import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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
};

export function useCompanies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("companies")
      .select("id,name,currency,tax_number,industry")
      .order("created_at", { ascending: true });
    const list = (data ?? []) as Company[];
    setCompanies(list);
    let current = getActiveCompanyId();
    if (!current || !list.find((c) => c.id === current)) {
      current = list[0]?.id ?? null;
      setActiveCompanyId(current);
    }
    setActiveId(current);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const onChange = () => setActiveId(getActiveCompanyId());
    window.addEventListener("ledgerflow:company-changed", onChange);
    return () => window.removeEventListener("ledgerflow:company-changed", onChange);
  }, []);

  const active = companies.find((c) => c.id === activeId) ?? null;
  return { companies, active, activeId, loading, reload: load };
}
