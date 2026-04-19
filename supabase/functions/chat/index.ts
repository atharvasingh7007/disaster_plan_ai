// DisasterReady AI — chat edge function (RAG-enabled)
// Streams Gemini responses via an AI gateway. Pulls household profile
// AND retrieves grounded knowledge-base context via pgvector.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { embedText } from "../_shared/embed.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_BASE = `You are DisasterReady AI — a calm, practical, household-aware disaster preparedness assistant.

Voice: calm, supportive, specific, never alarmist. No textbook lectures.

Behavior rules:
- For URGENT questions ("there's smoke", "earthquake just hit"), give the direct safety action FIRST in 1–3 short steps, then context.
- For PLAN requests, ask only the missing critical details (location, who lives there, vulnerabilities, supplies on hand). Do not re-ask what the user has already told you or what's in their household profile.
- Center vulnerable people (e.g. "grandmother cannot walk", "infant", "oxygen-dependent") in the response — adapt every recommendation to that constraint.
- If the user says "near me" without a saved location, ask for a city/region or offer approximate IP detection (warn it may be inaccurate).
- Never invent a location. Never assume a country.
- Use markdown: short paragraphs, bold key actions, bulleted checklists. Keep replies tight.
- When you produce a full preparedness PLAN, structure it with clear sections: Overview, Before, During, After, Go-bag, Household-specific notes.
- When KNOWLEDGE BASE context is provided below, prefer it over generic memory. Cite source names inline (e.g. "(FEMA)") when you use a fact from it.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, planMode, householdContext } = await req.json();
    if (!Array.isArray(messages)) return j({ error: "messages must be an array" }, 400);

    const AI_GATEWAY_API_KEY = Deno.env.get("AI_GATEWAY_API_KEY");
    const AI_GATEWAY_URL = Deno.env.get("AI_GATEWAY_URL");
    if (!AI_GATEWAY_API_KEY) return j({ error: "AI_GATEWAY_API_KEY missing" }, 500);
    if (!AI_GATEWAY_URL) return j({ error: "AI_GATEWAY_URL missing" }, 500);

    // ----- Profile enrichment (auth users) -----
    let profileBlock = householdContext || "";
    const authHeader = req.headers.get("Authorization");
    if (authHeader && !profileBlock) {
      try {
        const supa = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } }
        );
        const { data: { user } } = await supa.auth.getUser();
        if (user) {
          const [{ data: prof }, { data: members }] = await Promise.all([
            supa.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
            supa.from("household_members").select("*").eq("user_id", user.id),
          ]);
          profileBlock = buildProfileBlock(prof, members);
        }
      } catch (e) { console.warn("profile enrich failed", e); }
    }

    // ----- RAG retrieval on the latest user message -----
    const lastUser = [...messages].reverse().find((m: any) => m.role === "user")?.content || "";
    let ragBlock = "";
    let sources: { title: string; source: string; hazard: string | null }[] = [];
    if (lastUser && lastUser.length > 4) {
      try {
        const embedding = embedText(lastUser);
        const literal = "[" + embedding.join(",") + "]";
        const supaSr = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
        const { data: hits } = await supaSr.rpc("match_kb_documents", {
          query_embedding: literal as any,
          match_count: 4,
        });
        const filtered = (hits ?? []).filter((h: any) => h.similarity > 0.05).slice(0, 4);
        if (filtered.length) {
          sources = filtered.map((h: any) => ({ title: h.title, source: h.source, hazard: h.hazard }));
          ragBlock = filtered
            .map((h: any) => `[${h.source} — ${h.title}]\n${h.content}`)
            .join("\n\n---\n\n");
        }
      } catch (e) { console.warn("RAG failed", e); }
    }

    const sys =
      SYSTEM_BASE +
      (planMode
        ? "\n\nMODE: PLAN GENERATION. The user wants a personalized preparedness plan. Ask only for critical missing info, then produce a complete plan."
        : "") +
      (profileBlock ? `\n\nHOUSEHOLD CONTEXT (already known — do not re-ask):\n${profileBlock}` : "") +
      (ragBlock ? `\n\nKNOWLEDGE BASE CONTEXT (grounded; cite source names when used):\n${ragBlock}` : "");

    const resp = await fetch(new URL("/v1/chat/completions", AI_GATEWAY_URL), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_GATEWAY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        stream: true,
        messages: [{ role: "system", content: sys }, ...messages],
      }),
    });

    if (!resp.ok) {
      if (resp.status === 429) return j({ error: "Rate limit reached. Try again shortly." }, 429);
      if (resp.status === 402) return j({ error: "AI credits exhausted. Add credits in Settings → Workspace → Usage." }, 402);
      const t = await resp.text();
      console.error("AI gateway error", resp.status, t);
      return j({ error: "AI gateway error" }, 500);
    }

    // Stream response, with sources surfaced via custom header (URL-encoded JSON)
    const sourceHeader = sources.length ? encodeURIComponent(JSON.stringify(sources)) : "";

    return new Response(resp.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "X-Sources": sourceHeader,
        "Access-Control-Expose-Headers": "X-Sources",
      },
    });
  } catch (e) {
    console.error("chat error", e);
    return j({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildProfileBlock(prof: any, members: any[] | null): string {
  if (!prof && (!members || members.length === 0)) return "";
  const lines: string[] = [];
  if (prof?.display_name) lines.push(`Name: ${prof.display_name}`);
  if (prof?.home_location) lines.push(`Home location: ${prof.home_location}`);
  if (prof?.resources) lines.push(`Resources on hand: ${prof.resources}`);
  if (prof?.transport) lines.push(`Transport: ${prof.transport}`);
  if (prof?.pets) lines.push(`Pets: ${prof.pets}`);
  if (prof?.important_documents) lines.push(`Important documents: ${prof.important_documents}`);
  if (prof?.emergency_contacts) lines.push(`Emergency contacts: ${prof.emergency_contacts}`);
  if (prof?.special_notes) lines.push(`Notes: ${prof.special_notes}`);
  if (members && members.length) {
    lines.push("Household members:");
    for (const m of members) {
      const bits = [m.name];
      if (m.age != null) bits.push(`age ${m.age}`);
      if (m.relationship) bits.push(m.relationship);
      if (m.vulnerabilities) bits.push(`vulnerabilities: ${m.vulnerabilities}`);
      lines.push(`- ${bits.join(", ")}`);
    }
  }
  return lines.join("\n");
}
