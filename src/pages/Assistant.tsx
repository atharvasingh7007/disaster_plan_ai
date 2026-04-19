import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Send, Sparkles, Save } from "lucide-react";
import { toast } from "sonner";
import ChatMessage from "@/components/ChatMessage";
import { getGuestMessages, setGuestMessages } from "@/lib/guest";
import { cn } from "@/lib/utils";

type Source = { title: string; source: string; hazard: string | null };
type Msg = { role: "user" | "assistant"; content: string; sources?: Source[] };
type Session = { id: string; title: string; plan_mode: boolean; updated_at: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

export default function Assistant() {
  const { user, isGuest } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [planMode, setPlanMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load sessions for authed users
  useEffect(() => {
    if (!user) {
      setMessages(getGuestMessages());
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("sessions")
        .select("id,title,plan_mode,updated_at")
        .order("updated_at", { ascending: false });
      setSessions(data ?? []);
    })();
  }, [user]);

  // Load messages when switching sessions
  useEffect(() => {
    if (!user || !activeSession) return;
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("role,content")
        .eq("session_id", activeSession)
        .order("created_at", { ascending: true });
      setMessages((data ?? []) as Msg[]);
      const s = sessions.find((s) => s.id === activeSession);
      if (s) setPlanMode(s.plan_mode);
    })();
  }, [activeSession, user, sessions]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const newChat = async () => {
    setActiveSession(null);
    setMessages([]);
    if (isGuest) setGuestMessages([]);
  };

  const ensureSession = async (): Promise<string | null> => {
    if (!user) return null;
    if (activeSession) return activeSession;
    const { data, error } = await supabase
      .from("sessions")
      .insert({ user_id: user.id, title: "New conversation", plan_mode: planMode })
      .select("id,title,plan_mode,updated_at")
      .single();
    if (error) { toast.error(error.message); return null; }
    setSessions((prev) => [data as Session, ...prev]);
    setActiveSession(data.id);
    return data.id;
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setLoading(true);

    const userMsg: Msg = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);

    let sessionId: string | null = null;
    if (user) {
      sessionId = await ensureSession();
      if (sessionId) {
        await supabase.from("messages").insert({
          session_id: sessionId, user_id: user.id, role: "user", content: text,
        });
        // Auto-title from first user message
        if (messages.length === 0) {
          const title = text.slice(0, 60);
          await supabase.from("sessions").update({ title }).eq("id", sessionId);
          setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, title } : s));
        }
      }
    } else if (isGuest) {
      setGuestMessages(next);
    }

    let assistantSoFar = "";
    let capturedSources: Source[] = [];
    const upsert = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar, sources: capturedSources } : m);
        }
        return [...prev, { role: "assistant", content: assistantSoFar, sources: capturedSources }];
      });
    };

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const { data: { session } } = await supabase.auth.getSession();
      if (session) headers.Authorization = `Bearer ${session.access_token}`;
      else headers.Authorization = `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`;

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ messages: next, planMode }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        if (resp.status === 429) toast.error("Rate limit — try again in a moment.");
        else if (resp.status === 402) toast.error("AI credits exhausted. Add credits in workspace settings.");
        else toast.error(err.error || "Chat failed");
        setLoading(false);
        return;
      }
      if (!resp.body) throw new Error("no body");

      // Parse RAG sources from response header
      let parsedSources: Source[] = [];
      try {
        const raw = resp.headers.get("X-Sources");
        if (raw) parsedSources = JSON.parse(decodeURIComponent(raw));
      } catch { /* ignore */ }
      capturedSources = parsedSources;

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        if (d) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line || line.startsWith(":")) continue;
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") { done = true; break; }
          try {
            const parsed = JSON.parse(payload);
            const c = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (c) upsert(c);
          } catch {
            buf = line + "\n" + buf; break;
          }
        }
      }

      // persist assistant message
      if (user && sessionId && assistantSoFar) {
        await supabase.from("messages").insert({
          session_id: sessionId, user_id: user.id, role: "assistant", content: assistantSoFar,
        });
        await supabase.from("sessions").update({ updated_at: new Date().toISOString() }).eq("id", sessionId);
      } else if (isGuest) {
        setGuestMessages([...next, { role: "assistant", content: assistantSoFar }]);
      }
    } catch (e: any) {
      toast.error(e.message || "Stream error");
    } finally {
      setLoading(false);
    }
  };

  const saveAsPlan = async () => {
    if (!user) return toast.error("Sign in to save plans.");
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return toast.error("No assistant reply to save yet.");
    const title = (messages.find((m) => m.role === "user")?.content || "Preparedness plan").slice(0, 80);
    const { error } = await supabase.from("plans").insert({
      user_id: user.id, session_id: activeSession, title, content: lastAssistant.content,
    });
    if (error) return toast.error(error.message);
    toast.success("Plan saved");
  };

  return (
    <div className="flex h-full">
      {/* Session list (auth only) */}
      {user && (
        <div className="hidden lg:flex w-72 flex-col border-r bg-card">
          <div className="p-3 border-b">
            <Button onClick={newChat} variant="default" className="w-full"><Plus className="h-4 w-4 mr-2" />New chat</Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {sessions.map((s) => (
                <button key={s.id} onClick={() => setActiveSession(s.id)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md text-sm truncate hover:bg-muted transition",
                    activeSession === s.id && "bg-muted font-medium"
                  )}>
                  {s.title}
                </button>
              ))}
              {sessions.length === 0 && (
                <p className="text-xs text-muted-foreground p-3">No conversations yet. Start one!</p>
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Main chat */}
      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-card/50 backdrop-blur">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-secondary" />
            <h1 className="font-semibold">Assistant</h1>
            {isGuest && <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Guest</span>}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch id="plan" checked={planMode} onCheckedChange={setPlanMode} />
              <Label htmlFor="plan" className="text-sm">Plan mode</Label>
            </div>
            {user && (
              <Button size="sm" variant="outline" onClick={saveAsPlan}>
                <Save className="h-4 w-4 mr-2" /> Save as plan
              </Button>
            )}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-16 space-y-3">
                <div className="inline-flex h-12 w-12 rounded-2xl items-center justify-center" style={{ background: "var(--gradient-hero)" }}>
                  <Sparkles className="h-6 w-6 text-primary-foreground" />
                </div>
                <h2 className="text-xl font-semibold">How can I help you prepare?</h2>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Ask anything — from "what should be in my earthquake kit" to "build a wildfire plan for my family with a grandmother who can't walk."
                </p>
                <div className="grid sm:grid-cols-2 gap-2 max-w-xl mx-auto pt-4">
                  {[
                    "Build a hurricane plan for a family of 4 with a baby",
                    "What do I do if I smell gas right now?",
                    "Earthquake go-bag for a small apartment",
                    "Wildfire evacuation checklist with two cats",
                  ].map((p) => (
                    <button key={p} onClick={() => setInput(p)}
                      className="text-left text-sm p-3 rounded-lg border bg-card hover:bg-muted transition">
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => <ChatMessage key={i} role={m.role} content={m.content} sources={m.sources} />)}
            {loading && messages[messages.length - 1]?.role === "user" && (
              <ChatMessage role="assistant" content="" />
            )}
          </div>
        </div>

        <div className="border-t bg-card/50 backdrop-blur p-3">
          <div className="max-w-3xl mx-auto flex gap-2 items-end">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              placeholder={planMode ? "Describe your household and location for a personalized plan…" : "Ask DisasterReady AI…"}
              rows={1}
              className="resize-none min-h-[44px] max-h-40"
            />
            <Button onClick={send} disabled={loading || !input.trim()} size="icon" className="h-11 w-11 shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground text-center mt-2">
            DisasterReady AI offers guidance, not professional emergency advice. Call local emergency services for active danger.
          </p>
        </div>
      </div>
    </div>
  );
}
