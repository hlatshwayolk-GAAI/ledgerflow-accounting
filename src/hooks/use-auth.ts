import { useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { isDemoMode, DEMO_USER } from "@/lib/demo-workspace";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const initialised = useRef(false);

  useEffect(() => {
    // If running in demo mode, use demo user immediately
    if (isDemoMode()) {
      setUser(DEMO_USER as unknown as User);
      setSession({ user: DEMO_USER } as unknown as Session);
      setLoading(false);
      initialised.current = true;
    }

    const checkAuth = () => {
      if (isDemoMode()) {
        setUser(DEMO_USER as unknown as User);
        setSession({ user: DEMO_USER } as unknown as Session);
        setLoading(false);
        initialised.current = true;
      }
    };

    window.addEventListener("ledgerflow:auth-changed", checkAuth);

    // Timeout safety fallback: don't let broken network freeze the app indefinitely
    const safetyTimeout = setTimeout(() => {
      if (!initialised.current) {
        initialised.current = true;
        setLoading(false);
      }
    }, 2000);

    // Subscribe to Supabase auth events
    let unsubscribe: (() => void) | undefined;
    try {
      const { data } = supabase.auth.onAuthStateChange((_event, s) => {
        if (!isDemoMode()) {
          setSession(s);
          setUser(s?.user ?? null);
          if (!initialised.current) {
            initialised.current = true;
            setLoading(false);
          }
        }
      });
      unsubscribe = data.subscription.unsubscribe;
    } catch (e) {
      console.warn("Supabase auth subscription failed:", e);
    }

    // Direct session probe with catch
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!isDemoMode() && !initialised.current) {
          initialised.current = true;
          setSession(data.session);
          setUser(data.session?.user ?? null);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.warn("Supabase getSession network error:", err);
        if (!initialised.current) {
          initialised.current = true;
          setLoading(false);
        }
      });

    return () => {
      clearTimeout(safetyTimeout);
      window.removeEventListener("ledgerflow:auth-changed", checkAuth);
      if (unsubscribe) unsubscribe();
    };
  }, []);

  return { session, user, loading };
}
