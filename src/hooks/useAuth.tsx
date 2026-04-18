import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isGuest: boolean;
  setGuest: (g: boolean) => void;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuestState] = useState<boolean>(
    () => localStorage.getItem("dr_guest") === "1"
  );

  useEffect(() => {
    // CRITICAL: subscribe BEFORE getSession
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const setGuest = (g: boolean) => {
    setIsGuestState(g);
    localStorage.setItem("dr_guest", g ? "1" : "0");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setGuest(false);
  };

  return (
    <Ctx.Provider value={{ user, session, loading, isGuest, setGuest, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
