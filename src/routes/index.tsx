import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, BarChart3, FileText, Building2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LedgerFlow — Effortless accounting for modern businesses" },
      { name: "description", content: "Cloud accounting with automatic double-entry bookkeeping, invoicing, reconciliation and real-time financial reports." },
      { property: "og:title", content: "LedgerFlow — Effortless accounting for modern businesses" },
      { property: "og:description", content: "Run your books without the headache. Invoicing, reconciliation, VAT and reports — built for SMBs." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary grid place-items-center text-primary-foreground font-semibold">L</div>
            <span className="font-semibold tracking-tight">LedgerFlow</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/auth"><Button variant="ghost">Sign in</Button></Link>
            <Link to="/auth"><Button>Get started</Button></Link>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 pt-20 pb-24 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border bg-accent/40 px-3 py-1 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-success" /> Built for SMBs and accountants
        </div>
        <h1 className="mt-6 text-5xl md:text-6xl font-semibold tracking-tight text-foreground max-w-3xl mx-auto">
          Accounting that runs itself.
        </h1>
        <p className="mt-5 text-lg text-muted-foreground max-w-xl mx-auto">
          LedgerFlow handles invoicing, double-entry bookkeeping, reconciliation, and reporting — so you can focus on the business, not the books.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link to="/auth">
            <Button size="lg">Start free <ArrowRight className="h-4 w-4 ml-2" /></Button>
          </Link>
          <Button size="lg" variant="outline">See how it works</Button>
        </div>

        <div className="mt-16 grid sm:grid-cols-3 gap-3 max-w-2xl mx-auto text-sm text-muted-foreground">
          {["No card required","Multi-company support","SARS-ready VAT"].map((t) => (
            <div key={t} className="flex items-center justify-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" /> {t}
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-24">
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: FileText, title: "Invoicing", body: "Send polished invoices, track payments, automate reminders." },
            { icon: BarChart3, title: "Real-time reports", body: "P&L, balance sheet, cash flow — always up to date." },
            { icon: Building2, title: "Multi-company", body: "Manage multiple businesses from one account." },
            { icon: Shield, title: "Audit trail", body: "Every change is logged. Always reconcile to the cent." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border bg-card p-5">
              <div className="h-9 w-9 rounded-lg bg-accent grid place-items-center mb-3">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <div className="font-medium text-foreground">{title}</div>
              <p className="text-sm text-muted-foreground mt-1">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t">
        <div className="max-w-6xl mx-auto px-6 py-6 text-sm text-muted-foreground flex justify-between">
          <span>© {new Date().getFullYear()} LedgerFlow</span>
          <Link to="/auth" className="hover:text-foreground">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
