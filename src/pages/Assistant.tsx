import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Send, Sparkles, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import ChatMessage from "@/components/ChatMessage";
import { getGuestMessages, setGuestMessages, getGuestProfile, setGuestProfile } from "@/lib/guest";
import { cn } from "@/lib/utils";

type Source = { title: string; source: string; hazard: string | null };
type Msg = { id: string; role: "user" | "assistant"; content: string; sources?: Source[] };
type Session = { id: string; title: string; plan_mode: boolean; updated_at: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const MAX_MSG_LENGTH = 4000;

let msgIdCounter = 0;
function nextMsgId(): string {
  return `msg-${Date.now()}-${++msgIdCounter}`;
}

export default function Assistant() {
  const { user, isGuest } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [planMode, setPlanMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestedProfile, setSuggestedProfile] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load sessions for authed users
  useEffect(() => {
    if (!user) {
      const raw = getGuestMessages();
      setMessages(raw.map((m) => ({ ...m, id: nextMsgId() })));
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
      setMessages((data ?? []).map((m) => ({ ...m, id: nextMsgId() })) as Msg[]);
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

  const deleteSession = async (id: string) => {
    const { error } = await supabase.from("sessions").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSession === id) {
      setActiveSession(null);
      setMessages([]);
    }
    toast.success("Conversation deleted");
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
    if (text.length > MAX_MSG_LENGTH) {
      toast.error(`Message too long (max ${MAX_MSG_LENGTH} characters)`);
      return;
    }
    setInput("");
    setLoading(true);

    const userMsg: Msg = { id: nextMsgId(), role: "user", content: text };
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
      setGuestMessages(next.map(({ role, content }) => ({ role, content })));
    }

    let assistantSoFar = "";
    let capturedSources: Source[] = [];
    const assistantMsgId = nextMsgId();
    const upsert = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.id === assistantMsgId) {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar, sources: capturedSources } : m);
        }
        return [...prev, { id: assistantMsgId, role: "assistant", content: assistantSoFar, sources: capturedSources }];
      });
    };

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const { data: { session } } = await supabase.auth.getSession();
      if (session) headers.Authorization = `Bearer ${session.access_token}`;
      else headers.Authorization = `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`;

      // Strip internal IDs before sending to the API
      const apiMessages = next.map(({ role, content }) => ({ role, content }));

      const reqBody: any = { messages: apiMessages, planMode };
      if (isGuest) {
        reqBody.householdContext = JSON.stringify(getGuestProfile());
      }

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(reqBody),
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
      while (true) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        let shouldBreak = false;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line || line.startsWith(":")) continue;
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") { shouldBreak = true; break; }
          try {
            const parsed = JSON.parse(payload);
            const c = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (c) upsert(c);
          } catch {
            buf = line + "\n" + buf; break;
          }
        }
        if (shouldBreak) break;
      }

      // persist assistant message
      if (user && sessionId && assistantSoFar) {
        await supabase.from("messages").insert({
          session_id: sessionId, user_id: user.id, role: "assistant", content: assistantSoFar,
        });
        await supabase.from("sessions").update({ updated_at: new Date().toISOString() }).eq("id", sessionId);
      } else if (isGuest) {
        setGuestMessages([...next, { role: "assistant" as const, content: assistantSoFar }].map(({ role, content }) => ({ role, content })));
      }

      // Background profile extraction
      setTimeout(async () => {
        try {
          const extBody: any = { messages: [...apiMessages, { role: "assistant", content: assistantSoFar }] };
          if (isGuest) extBody.householdContext = JSON.stringify(getGuestProfile());
          
          const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-profile`, {
            method: "POST",
            headers,
            body: JSON.stringify(extBody),
          });
          const json = await res.json();
          if (json.has_new_details) {
            setSuggestedProfile(json);
          }
        } catch (e) { console.error("Extract failed", e); }
      }, 1000);

    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Stream error");
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

  const handleSaveProfile = async () => {
    if (!suggestedProfile) return;
    
    if (isGuest) {
      const current = getGuestProfile();
      const updated = { ...current, ...suggestedProfile };
      delete updated.has_new_details;
      // Also merge members if any
      if (suggestedProfile.household_members) {
        updated.household_members = [...(current.household_members || []), ...suggestedProfile.household_members];
      }
      setGuestProfile(updated);
      toast.success("Saved to browser memory");
    } else if (user) {
      const updates: any = {};
      ["home_location", "resources", "transport", "pets", "important_documents", "emergency_contacts", "special_notes"].forEach(k => {
        if (suggestedProfile[k]) updates[k] = suggestedProfile[k];
      });
      
      if (Object.keys(updates).length > 0) {
        // Fetch current profile to avoid overwriting entirely if we just want to merge? Actually we just update specific keys
        await supabase.from("profiles").update(updates).eq("user_id", user.id);
      }
      
      if (suggestedProfile.household_members?.length > 0) {
        const members = suggestedProfile.household_members.map((m: any) => ({
          user_id: user.id,
          name: m.name || "Member",
          age: m.age,
          relationship: m.relationship,
          vulnerabilities: m.vulnerabilities
        }));
        await supabase.from("household_members").insert(members);
      }
      toast.success("Saved to your profile");
    }
    
    setSuggestedProfile(null);
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
                <div key={s.id} className="group flex items-center gap-1">
                  <button onClick={() => setActiveSession(s.id)}
                    className={cn(
                      "flex-1 text-left px-3 py-2 rounded-md text-sm truncate hover:bg-muted transition",
                      activeSession === s.id && "bg-muted font-medium"
                    )}>
                    {s.title}
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100 shrink-0 h-7 w-7 p-0"
                    onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                    aria-label={`Delete conversation: ${s.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
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
              <Button size="sm" variant="outline" onClick={saveAsPlan} aria-label="Save last response as a plan">
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
            {messages.map((m) => <ChatMessage key={m.id} role={m.role} content={m.content} sources={m.sources} />)}
            {loading && messages[messages.length - 1]?.role === "user" && (
              <ChatMessage role="assistant" content="" />
            )}

            {suggestedProfile && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 my-4 animate-in fade-in slide-in-from-bottom-2">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-medium text-sm text-primary mb-1">I noticed some details that can improve future plans:</h3>
                    <ul className="text-sm text-muted-foreground list-disc list-inside mb-3 space-y-1">
                      {suggestedProfile.home_location && <li>Location: {suggestedProfile.home_location}</li>}
                      {suggestedProfile.pets && <li>Pets: {suggestedProfile.pets}</li>}
                      {suggestedProfile.resources && <li>Resources: {suggestedProfile.resources}</li>}
                      {suggestedProfile.special_notes && <li>Notes: {suggestedProfile.special_notes}</li>}
                      {suggestedProfile.household_members?.map((m: any, i: number) => (
                        <li key={i}>Member: {m.name || m.relationship} {m.vulnerabilities ? `(${m.vulnerabilities})` : ""}</li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground mb-3 font-medium">
                      {isGuest ? "Do you want me to remember these details in this browser for better answers? Sign in to save permanently." : "Do you want to save these details to your profile?"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={handleSaveProfile}>Yes, save details</Button>
                  <Button size="sm" variant="outline" onClick={() => setSuggestedProfile(null)}>No thanks</Button>
                </div>
              </div>
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
              maxLength={MAX_MSG_LENGTH}
              className="resize-none min-h-[44px] max-h-40"
            />
            <Button onClick={send} disabled={loading || !input.trim()} size="icon" className="h-11 w-11 shrink-0" aria-label="Send message">
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
