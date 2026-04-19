// Generate 768-dim deterministic embeddings for any kb_documents missing them.
// Idempotent: only embeds rows where embedding IS NULL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { embedText } from "../_shared/embed.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";

    let q = supa.from("kb_documents").select("id,title,hazard,content");
    if (!force) q = q.is("embedding", null);
    const { data: rows, error } = await q;

    if (error) return j({ error: error.message }, 500);
    if (!rows?.length) return j({ embedded: 0, message: "All up to date." });

    let embedded = 0;
    const failures: string[] = [];

    for (const row of rows) {
      const text = `${row.title}\n\n${row.content}`;
      const embedding = embedText(text);
      // pgvector expects a string like "[0.1,0.2,...]"
      const literal = "[" + embedding.join(",") + "]";
      const { error: upErr } = await supa
        .from("kb_documents")
        .update({ embedding: literal as any })
        .eq("id", row.id);
      if (upErr) { console.error("update err", upErr); failures.push(row.id); }
      else embedded++;
    }

    return j({ embedded, failed: failures.length });
  } catch (e) {
    console.error("embed-kb error", e);
    return j({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function j(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
