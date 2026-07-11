import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Users,
  FileText,
  BookOpen,
  Building2,
  LogOut,
  ChevronDown,
  Truck,
  Plus,
  Receipt,
  Landmark,
  BarChart3,
  Menu,
  X,
  Scroll,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCompanies, setActiveCompanyId } from "@/hooks/use-company";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const navItems = [
  { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/invoices", label: "Invoices", icon: FileText },
  { to: "/app/bills", label: "Bills", icon: Receipt },
  { to: "/app/customers", label: "Customers", icon: Users },
  { to: "/app/suppliers", label: "Suppliers", icon: Truck },
  { to: "/app/bank", label: "Banking & Reconcile", icon: Landmark },
  { to: "/app/reports", label: "Financial Reports", icon: BarChart3 },
  { to: "/app/accounts", label: "Chart of Accounts", icon: BookOpen },
  { to: "/app/journals", label: "Journal Entries", icon: Scroll },
];

/* ─── Loading skeleton ──────────────────────────────────────────────── */
function ShellSkeleton() {
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden md:flex w-64 flex-col border-r bg-sidebar">
        <div className="px-6 py-5 border-b">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary/20 animate-pulse" />
            <div className="h-4 w-24 rounded bg-muted animate-pulse" />
          </div>
        </div>
        <div className="p-3 space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-9 rounded-md bg-muted/60 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
      </aside>
      <main className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground">Loading your workspace…</p>
        </div>
      </main>
    </div>
  );
}

/* ─── AppShell ──────────────────────────────────────────────────────── */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { companies, active, loading: companiesLoading, reload } = useCompanies();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [creating, setCreating] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Only redirect once we are SURE there is no session
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!companiesLoading && companies.length === 0 && !creating && pathname !== "/app/onboarding") {
      navigate({ to: "/app/onboarding" });
    }
  }, [companiesLoading, companies.length, creating, pathname, navigate]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  // Show skeleton while loading OR while we still don't have a user (prevents
  // the flash of redirect before the session resolves)
  if (loading || !user || companiesLoading) return <ShellSkeleton />;

  const SidebarContent = () => (
    <>
      {/* Logo */}
      <div className="px-6 py-5 border-b">
        <Link to="/app/dashboard" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
          <div className="h-8 w-8 rounded-lg bg-primary grid place-items-center text-primary-foreground font-semibold shadow-sm shadow-primary/20">
            L
          </div>
          <span className="font-semibold text-foreground tracking-tight">LedgerFlow</span>
        </Link>
      </div>

      {/* Company switcher */}
      <div className="p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-full justify-between font-normal">
              <span className="flex items-center gap-2 truncate">
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{active?.name ?? "Select company"}</span>
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Companies</DropdownMenuLabel>
            {companies.map((c) => (
              <DropdownMenuItem key={c.id} onClick={() => { setActiveCompanyId(c.id); reload(); }}>
                {c.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { setCreating(true); navigate({ to: "/app/onboarding" }); }}>
              <Plus className="h-4 w-4 mr-2" /> New company
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 space-y-0.5">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="border-t p-3">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-sidebar-accent/40 transition-colors">
          <div className="h-8 w-8 rounded-full bg-primary/15 grid place-items-center text-xs font-semibold text-primary shrink-0">
            {user.email?.[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate text-foreground">{user.email}</p>
            <p className="text-xs text-muted-foreground">My account</p>
          </div>
          <Button size="icon" variant="ghost" onClick={handleSignOut} aria-label="Sign out" className="shrink-0">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r bg-sidebar">
        <SidebarContent />
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 h-14 border-b bg-sidebar/95 backdrop-blur-sm">
        <Link to="/app/dashboard" className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-primary grid place-items-center text-primary-foreground font-semibold text-sm">L</div>
          <span className="font-semibold tracking-tight">LedgerFlow</span>
        </Link>
        <Button size="icon" variant="ghost" onClick={() => setMobileOpen((o) => !o)}>
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-72 flex flex-col bg-sidebar border-r h-full pt-14">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 min-w-0 md:ml-0 pt-14 md:pt-0">
        {children}
      </main>
    </div>
  );
}
