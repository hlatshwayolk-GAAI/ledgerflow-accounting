import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Building2, Upload, Camera, Trash2, Save, Globe, Phone, Mail, MapPin, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompanies, setActiveCompanyId, type Company } from "@/hooks/use-company";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { isDemoMode } from "@/lib/demo-workspace";

export const Route = createFileRoute("/app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { companies, active, reload, deleteCompany } = useCompanies();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [loading, setLoading] = useState(false);
  const [companyToDelete, setCompanyToDelete] = useState<Company | null>(null);
  const [deleting, setDeleting] = useState(false);
  
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [industry, setIndustry] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");

  useEffect(() => {
    if (active) {
      setName(active.name || "");
      setCurrency(active.currency || "ZAR");
      setTaxNumber(active.tax_number || "");
      setIndustry(active.industry || "");
      setLogoUrl(active.logo_url || null);
      setAddress(active.address || "");
      setPhone(active.phone || "");
      setEmail(active.email || "");
      setWebsite(active.website || "");
    }
  }, [active]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size exceeds 10MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const MAX_WIDTH = 600;
        const MAX_HEIGHT = 600;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL("image/png");
          setLogoUrl(dataUrl);
        } else {
          setLogoUrl(event.target?.result as string);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Company Name is required");
      return;
    }

    setLoading(true);

    try {
      if (isDemoMode()) {
        const stored = JSON.parse(localStorage.getItem("ledgerflow.demo_company") || "{}");
        Object.assign(stored, {
          name,
          currency,
          tax_number: taxNumber,
          industry,
          logo_url: logoUrl,
          address,
          phone,
          email,
          website,
        });
        localStorage.setItem("ledgerflow.demo_company", JSON.stringify(stored));
      } else {
        if (!active) throw new Error("No active company");
        const { error } = await supabase
          .from("companies")
          .update({
            name,
            currency,
            tax_number: taxNumber,
            industry,
            logo_url: logoUrl,
            address,
            phone,
            email,
            website,
          })
          .eq("id", active.id);
        
        if (error) {
          console.warn("Could not save full company profile, retrying core fields:", error.message);
          const coreRes = await supabase
            .from("companies")
            .update({
              name,
              currency,
              tax_number: taxNumber,
              industry,
            })
            .eq("id", active.id);
          
          if (coreRes.error) throw coreRes.error;
          toast.info("Saved basic info. Note: To save logo & contact details, please execute the SQL migration in Supabase.");
        } else {
          toast.success("Settings saved successfully");
        }
      }
      
      await reload();
      window.dispatchEvent(new Event("ledgerflow:company-changed"));
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || "Failed to save settings");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCompany = async () => {
    if (!companyToDelete) return;
    setDeleting(true);
    try {
      await deleteCompany(companyToDelete.id);
      toast.success(`Company "${companyToDelete.name}" has been deleted.`);
      setCompanyToDelete(null);
      await reload();
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete company");
    } finally {
      setDeleting(false);
    }
  };

  if (!active) {
    return <div className="p-6">Loading company data...</div>;
  }

  return (
    <div className="container max-w-4xl py-8 space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Building2 className="h-8 w-8 text-primary" />
          Company Settings
        </h1>
        <p className="text-muted-foreground mt-2">
          Manage your organization's profile, contact details, and branding.
        </p>
      </div>

      <Card className="p-6 bg-card/50 backdrop-blur-sm border-muted/50">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Camera className="w-5 h-5 text-muted-foreground" />
          Company Logo
        </h2>
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="group relative w-32 h-32 rounded-2xl border-2 border-dashed border-muted-foreground/30 flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary/50 transition-colors bg-muted/20"
          >
            {logoUrl ? (
              <>
                <img src={logoUrl} alt="Company Logo" className="w-full h-full object-contain" />
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera className="w-6 h-6 text-white" />
                </div>
              </>
            ) : (
              <div className="text-center">
                <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2 group-hover:text-primary transition-colors" />
                <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors">Upload</span>
              </div>
            )}
          </div>
          
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept="image/*" 
            className="hidden" 
          />

          <div className="space-y-2 text-center sm:text-left">
            <p className="text-sm text-muted-foreground">
              Upload a logo to display on invoices and reports.
            </p>
            <p className="text-xs text-muted-foreground/80">
              Supports high resolution PNG/JPEG up to 10MB (automatically optimized for PDF rendering).
            </p>
            {logoUrl && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={(e) => {
                  e.stopPropagation();
                  setLogoUrl(null);
                }}
                className="mt-2 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Remove logo
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-6 bg-card/50 backdrop-blur-sm border-muted/50">
        <h2 className="text-lg font-semibold mb-6">General Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="name">Company Name <span className="text-destructive">*</span></Label>
            <Input 
              id="name" 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
              placeholder="e.g. Acme Corp" 
            />
          </div>

          <div className="space-y-2">
            <Label>Currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger>
                <SelectValue placeholder="Select currency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ZAR">ZAR - South African Rand</SelectItem>
                <SelectItem value="USD">USD - US Dollar</SelectItem>
                <SelectItem value="EUR">EUR - Euro</SelectItem>
                <SelectItem value="GBP">GBP - British Pound</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="taxNumber">Tax / VAT Number</Label>
            <Input 
              id="taxNumber" 
              value={taxNumber} 
              onChange={(e) => setTaxNumber(e.target.value)} 
              placeholder="e.g. 123456789" 
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="industry">Industry</Label>
            <Input 
              id="industry" 
              value={industry} 
              onChange={(e) => setIndustry(e.target.value)} 
              placeholder="e.g. Software Development" 
            />
          </div>

          <div className="col-span-1 md:col-span-2 space-y-2 mt-4 pt-4 border-t border-border/50">
            <h2 className="text-lg font-semibold mb-4">Contact & Location</h2>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email" className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-muted-foreground" /> Email
            </Label>
            <Input 
              id="email" 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              placeholder="hello@company.com" 
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone" className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-muted-foreground" /> Phone
            </Label>
            <Input 
              id="phone" 
              type="tel" 
              value={phone} 
              onChange={(e) => setPhone(e.target.value)} 
              placeholder="+1 234 567 8900" 
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="website" className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-muted-foreground" /> Website
            </Label>
            <Input 
              id="website" 
              type="url" 
              value={website} 
              onChange={(e) => setWebsite(e.target.value)} 
              placeholder="https://www.company.com" 
            />
          </div>

          <div className="space-y-2 col-span-1 md:col-span-2">
            <Label htmlFor="address" className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground" /> Address
            </Label>
            <textarea
              id="address"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-y"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Business Rd, Tech City..."
            />
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={loading} size="lg" className="min-w-[120px]">
          {loading ? (
            <span className="flex items-center gap-2">
              <div className="h-4 w-4 rounded-full border-2 border-background border-t-transparent animate-spin" />
              Saving...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Save className="w-4 h-4" />
              Save Settings
            </span>
          )}
        </Button>
      </div>

      {/* Organization & Companies Management (Delete Companies) */}
      <Card className="p-6 border-destructive/30 bg-destructive/5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-destructive flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            Manage & Delete Companies
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Review your registered organizations. You can delete companies you no longer need. Deleting a company permanently removes its general ledgers, invoices, bills, and tax records.
          </p>
        </div>

        <div className="space-y-3 pt-2">
          {companies.map((c) => {
            const isCurrentActive = c.id === active.id;
            return (
              <div
                key={c.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg border bg-card transition-all hover:border-muted-foreground/30 shadow-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{c.name}</span>
                    {isCurrentActive && (
                      <Badge variant="outline" className="border-primary/40 text-primary bg-primary/10 text-[10px]">
                        Active Workspace
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                    <span>Currency: <strong className="text-foreground">{c.currency}</strong></span>
                    {c.tax_number && <span>Tax #: <strong className="text-foreground">{c.tax_number}</strong></span>}
                    {c.industry && <span>Industry: {c.industry}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto">
                  {!isCurrentActive && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-8"
                      onClick={() => {
                        setActiveCompanyId(c.id);
                        reload();
                        toast.success(`Switched active workspace to ${c.name}`);
                      }}
                    >
                      Switch to
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive text-xs h-8"
                    onClick={() => setCompanyToDelete(c)}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    Delete Company
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!companyToDelete} onOpenChange={(open) => !open && setCompanyToDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Delete Company: {companyToDelete?.name}
            </DialogTitle>
            <DialogDescription className="text-sm pt-2">
              Are you sure you want to delete <strong>{companyToDelete?.name}</strong>?
              This will permanently delete all associated customer invoices, bills, payments, journal records, and tax calculations.
              <span className="block mt-2 font-medium text-destructive">
                This action cannot be undone.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setCompanyToDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteCompany}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Yes, Delete Company"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
