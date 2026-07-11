import { useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const initialised = useRef(false);

  useEffect(() => {
    // Subscribe first — the very first event emitted by onAuthStateChange
    // carries the restored session (INITIAL_SESSION), so we can mark loading
    // done there rather than waiting for the separate getSession() round-trip.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (!initialised.current) {
        initialised.current = true;
        setLoading(false);
      }
    });

    // Belt-and-suspenders: if onAuthStateChange never fires (e.g. no network),
    // getSession() will still resolve and clear the loading state.
    supabase.auth.getSession().then(({ data }) => {
      if (!initialised.current) {
        initialised.current = true;
        setSession(data.session);
        setUser(data.session?.user ?? null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return { session, user, loading };
}
