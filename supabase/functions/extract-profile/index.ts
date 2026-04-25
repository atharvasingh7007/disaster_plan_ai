// Background job to extract profile details from conversation

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, householdContext } = await req.json();

    let profileBlock = householdContext || "";
    const authHeader = req.headers.get("Authorization");
    if (authHeader && !profileBlock) {
      try {
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.0");
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
          
          const lines: string[] = [];
          if (prof?.home_location) lines.push(`Home location: ${prof.home_location}`);
          if (prof?.resources) lines.push(`Resources: ${prof.resources}`);
          if (prof?.transport) lines.push(`Transport: ${prof.transport}`);
          if (prof?.pets) lines.push(`Pets: ${prof.pets}`);
          if (prof?.important_documents) lines.push(`Documents: ${prof.important_documents}`);
          if (prof?.emergency_contacts) lines.push(`Contacts: ${prof.emergency_contacts}`);
          if (prof?.special_notes) lines.push(`Notes: ${prof.special_notes}`);
          if (members && members.length) {
            lines.push("Household members:");
            for (const m of members) {
              lines.push(`- ${m.name}: rel=${m.relationship}, age=${m.age}, vuln=${m.vulnerabilities}`);
            }
          }
          profileBlock = lines.join("\n");
        }
      } catch (e) { console.warn("profile enrich failed", e); }
    }

    const AI_GATEWAY_API_KEY = Deno.env.get("AI_GATEWAY_API_KEY");
    const AI_GATEWAY_URL = Deno.env.get("AI_GATEWAY_URL");
    if (!AI_GATEWAY_API_KEY || !AI_GATEWAY_URL) return j({ error: "AI not configured" }, 500);

    const sys = `You are a background data extraction AI for DisasterReady.
Analyze the conversation and extract ONLY new, previously unknown household profile details.
Compare against the existing profile below. Do not output anything already in the existing profile.

EXISTING PROFILE:
${profileBlock || "None"}

Output strictly in this JSON format (leave fields empty or omit if nothing new):
{
  "has_new_details": boolean,
  "home_location": "string",
  "resources": "string",
  "transport": "string",
  "pets": "string",
  "important_documents": "string",
  "emergency_contacts": "string",
  "special_notes": "string",
  "household_members": [
    { "name": "string", "age": "string/number", "relationship": "string", "vulnerabilities": "string" }
  ]
}
If no new details are found, return {"has_new_details": false}.`;

    const resp = await fetch(new URL("/v1/chat/completions", AI_GATEWAY_URL), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_GATEWAY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: sys }, ...messages],
        temperature: 0.1,
      }),
    });

    if (!resp.ok) return j({ error: "AI extraction failed" }, 500);
    const aiJson = await resp.json();
    let raw: string = aiJson.choices?.[0]?.message?.content ?? "";
    raw = raw.replace(/```json\s*|\s*```/g, "").trim();
    
    let analysis = { has_new_details: false };
    try { analysis = JSON.parse(raw); } catch { /* ignore */ }

    return j(analysis);
  } catch (e) {
    console.error("extract error", e);
    return j({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
