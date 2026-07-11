import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Mail, Lock, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — LedgerFlow" }] }),
  component: AuthPage,
});

/* ─── friendly error mapper ───────────────────────────────────────────── */
function friendlyError(msg: string): string {
  if (msg.includes("Invalid login credentials")) return "Incorrect email or password.";
  if (msg.includes("Email not confirmed")) return "Please confirm your email before signing in.";
  if (msg.includes("User already registered")) return "An account with this email already exists.";
  if (msg.includes("Password should be")) return "Password must be at least 8 characters.";
  if (msg.includes("rate limit")) return "Too many attempts — please wait a moment.";
  return msg;
}

/* ─── password-strength helper ──────────────────────────────────────── */
function passwordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: "Weak", color: "bg-destructive" };
  if (score <= 3) return { score, label: "Fair", color: "bg-warning" };
  return { score, label: "Strong", color: "bg-success" };
}

function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const navigate = useNavigate();

  const strength = mode === "signup" && password ? passwordStrength(password) : null;

  /* ── email/password auth ──────────────────────────────────────────── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/app/dashboard" },
        });
        if (error) throw error;
        if (data.session) {
          // Email confirmation disabled — user is immediately signed in
          toast.success("Account created — welcome to LedgerFlow!");
          navigate({ to: "/app/dashboard" });
        } else {
          // Email confirmation required
          setEmailSent(true);
          toast.success("Check your inbox to confirm your email.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/app/dashboard" });
      }
    } catch (err) {
      toast.error(friendlyError(err instanceof Error ? err.message : "Authentication failed"));
    } finally {
      setLoading(false);
    }
  };

  /* ── forgot password ──────────────────────────────────────────────── */
  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) { toast.error("Enter your email address first."); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/auth",
      });
      if (error) throw error;
      toast.success("Password reset link sent — check your inbox.");
      setMode("signin");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send reset email.");
    } finally {
      setLoading(false);
    }
  };

  /* ── Google OAuth — direct Supabase (works everywhere) ───────────── */
  const handleGoogle = async () => {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/auth",
    });
    if (result?.error) {
      toast.error(friendlyError(result.error.message));
      setLoading(false);
      return;
    }
    if (!result?.redirected) {
      navigate({ to: "/app/dashboard" });
    }
  };

  /* ── "email sent" confirmation screen ────────────────────────────── */
  if (emailSent) {
    return (
      <div className="auth-bg min-h-screen flex items-center justify-center px-4">
        <div className="auth-card w-full max-w-md p-10 text-center">
          <div className="mx-auto mb-6 h-16 w-16 rounded-full bg-success/15 grid place-items-center">
            <Mail className="h-8 w-8 text-success" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Check your inbox</h1>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            We sent a confirmation link to <strong>{email}</strong>. Click it to activate
            your account and get started.
          </p>
          <Button
            className="mt-8 w-full"
            variant="outline"
            onClick={() => { setEmailSent(false); setMode("signin"); }}
          >
            Back to sign in
          </Button>
        </div>
      </div>
    );
  }

  /* ── main auth form ───────────────────────────────────────────────── */
  return (
    <div className="auth-bg min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 justify-center mb-8 group">
          <div className="h-10 w-10 rounded-xl bg-primary grid place-items-center text-primary-foreground font-bold text-lg shadow-md shadow-primary/30 transition-transform group-hover:scale-105">
            L
          </div>
          <span className="font-semibold text-xl tracking-tight">LedgerFlow</span>
        </Link>

        <div className="auth-card p-8">
          <h1 className="text-xl font-semibold tracking-tight">
            {mode === "signin" && "Welcome back"}
            {mode === "signup" && "Create your account"}
            {mode === "forgot" && "Reset your password"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            {mode === "signin" && "Sign in to continue to LedgerFlow."}
            {mode === "signup" && "Start managing your books in minutes."}
            {mode === "forgot" && "Enter your email and we'll send a reset link."}
          </p>

          {/* Google button — only on signin/signup */}
          {mode !== "forgot" && (
            <>
              <Button
                type="button"
                variant="outline"
                className="w-full mt-6 h-11 auth-google-btn"
                onClick={handleGoogle}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <svg className="h-4 w-4 mr-2.5" viewBox="0 0 24 24">
                    <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#fbbc05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"/>
                    <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z"/>
                  </svg>
                )}
                Continue with Google
              </Button>

              <div className="my-6 flex items-center gap-3">
                <div className="h-px bg-border flex-1" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="h-px bg-border flex-1" />
              </div>
            </>
          )}

          {/* Email + Password form */}
          <form onSubmit={mode === "forgot" ? handleForgot : handleSubmit} className="space-y-4">
            {/* Email field */}
            <div className="auth-field">
              <Label htmlFor="email" className="auth-label">
                <Mail className="h-3.5 w-3.5" /> Email
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="auth-input mt-1"
                placeholder="you@example.com"
              />
            </div>

            {/* Password field */}
            {mode !== "forgot" && (
              <div className="auth-field">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="auth-label">
                    <Lock className="h-3.5 w-3.5" /> Password
                  </Label>
                  {mode === "signin" && (
                    <button
                      type="button"
                      onClick={() => setMode("forgot")}
                      className="text-xs text-primary hover:underline"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative mt-1">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="auth-input pr-10"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                {/* Password strength bar */}
                {strength && password.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="flex gap-1 h-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div
                          key={i}
                          className={`flex-1 rounded-full transition-all duration-300 ${
                            i <= strength.score ? strength.color : "bg-border"
                          }`}
                        />
                      ))}
                    </div>
                    <p className={`text-xs font-medium transition-colors ${
                      strength.score <= 1 ? "text-destructive" :
                      strength.score <= 3 ? "text-warning-foreground" : "text-success"
                    }`}>
                      {strength.label}
                    </p>
                  </div>
                )}
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 auth-submit-btn"
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4 mr-2" />
              )}
              {loading
                ? "Please wait…"
                : mode === "signin"
                ? "Sign in"
                : mode === "signup"
                ? "Create account"
                : "Send reset link"}
            </Button>
          </form>

          {/* Mode switcher */}
          <p className="mt-6 text-sm text-center text-muted-foreground">
            {mode === "forgot" ? (
              <>
                Remember it?{" "}
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className="text-primary font-medium hover:underline"
                >
                  Back to sign in
                </button>
              </>
            ) : mode === "signin" ? (
              <>
                New to LedgerFlow?{" "}
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className="text-primary font-medium hover:underline"
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className="text-primary font-medium hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By continuing you agree to our{" "}
          <span className="text-primary cursor-pointer hover:underline">Terms</span> &amp;{" "}
          <span className="text-primary cursor-pointer hover:underline">Privacy Policy</span>
        </p>
      </div>
    </div>
  );
}
