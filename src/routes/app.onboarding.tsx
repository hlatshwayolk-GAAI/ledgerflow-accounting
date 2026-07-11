import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { setActiveCompanyId, useCompanies } from "@/hooks/use-company";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";


export const Route = createFileRoute("/app/onboarding")({
  component: Onboarding,
});

function Onboarding() {
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("ZAR");
  const [industry, setIndustry] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { reload } = useCompanies();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) throw new Error(authErr?.message ?? "Not signed in");
      const { data, error } = await supabase
        .from("companies")
        .insert({ name, currency, industry: industry || null, tax_number: taxNumber || null, owner_id: user.id })
        .select("id")
        .single();
      if (error) throw error;
      setActiveCompanyId(data.id);
      await reload();
      toast.success("Company created");
      navigate({ to: "/app/dashboard" });
    } catch (err) {
      console.error("Onboarding error:", err);
      toast.error(err instanceof Error ? err.message : "Could not create company");
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="max-w-xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Create your first company</h1>
      <p className="text-sm text-muted-foreground mt-1">We'll set up your chart of accounts automatically.</p>

      <Card className="mt-8 p-6">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="name">Company name</Label>
            <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} className="mt-1" placeholder="Acme Pty Ltd" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="currency">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="currency" className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ZAR">ZAR — Rand</SelectItem>
                  <SelectItem value="USD">USD — Dollar</SelectItem>
                  <SelectItem value="EUR">EUR — Euro</SelectItem>
                  <SelectItem value="GBP">GBP — Pound</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="industry">Industry</Label>
              <Input id="industry" value={industry} onChange={(e) => setIndustry(e.target.value)} className="mt-1" placeholder="Services" />
            </div>
          </div>
          <div>
            <Label htmlFor="tax">Tax number (optional)</Label>
            <Input id="tax" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} className="mt-1" />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating…" : "Create company"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
