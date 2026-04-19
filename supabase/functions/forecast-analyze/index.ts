// Forecast Watch: fetch Open-Meteo forecast for given coords and ask Gemini
// to interpret hazards (heat, wind, precip, snow, thunder) for the next 7 days.
// Public function (no auth required) — verify_jwt is false in config.toml.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Body {
  lat?: number;
  lon?: number;
  location_name?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    let { lat, lon, location_name } = body;

    // Geocode if only a name was provided
    if ((lat == null || lon == null) && location_name) {
      const g = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location_name)}&count=1`
      ).then((r) => r.json());
      const hit = g?.results?.[0];
      if (!hit) return j({ error: "Location not found" }, 404);
      lat = hit.latitude;
      lon = hit.longitude;
      location_name = `${hit.name}${hit.admin1 ? ", " + hit.admin1 : ""}${hit.country ? ", " + hit.country : ""}`;
    }

    if (lat == null || lon == null) return j({ error: "lat/lon or location_name required" }, 400);

    // Open-Meteo forecast: 7d daily + current + alerts surrogate
    const fUrl = new URL("https://api.open-meteo.com/v1/forecast");
    fUrl.searchParams.set("latitude", String(lat));
    fUrl.searchParams.set("longitude", String(lon));
    fUrl.searchParams.set(
      "daily",
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max"
    );
    fUrl.searchParams.set(
      "current",
      "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_gusts_10m"
    );
    fUrl.searchParams.set("forecast_days", "7");
    fUrl.searchParams.set("timezone", "auto");
    fUrl.searchParams.set("wind_speed_unit", "kmh");

    const forecast = await fetch(fUrl.toString()).then((r) => r.json());
    if (!forecast?.daily) return j({ error: "Forecast unavailable" }, 502);

    // Build a compact summary for the model
    const daily = forecast.daily;
    const summaryLines: string[] = [];
    for (let i = 0; i < daily.time.length; i++) {
      summaryLines.push(
        `${daily.time[i]}: ${daily.temperature_2m_min[i]}–${daily.temperature_2m_max[i]}°C, precip ${daily.precipitation_sum[i]}mm (${daily.precipitation_probability_max[i] ?? 0}%), wind ${daily.wind_speed_10m_max[i]}kmh (gusts ${daily.wind_gusts_10m_max[i]}kmh), UV ${daily.uv_index_max[i] ?? 0}, code ${daily.weather_code[i]}`
      );
    }
    const promptSummary = summaryLines.join("\n");

    const AI_GATEWAY_API_KEY = Deno.env.get("AI_GATEWAY_API_KEY");
    const AI_GATEWAY_URL = Deno.env.get("AI_GATEWAY_URL");
    if (!AI_GATEWAY_API_KEY || !AI_GATEWAY_URL) return j({ error: "AI not configured" }, 500);

    const aiRes = await fetch(new URL("/v1/chat/completions", AI_GATEWAY_URL), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_GATEWAY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are a calm, practical disaster-preparedness meteorologist. Given a 7-day forecast, identify any concerning hazards (extreme heat/cold, heavy rain & flood risk, high wind, severe storms, high UV, wildfire weather: hot+dry+windy). Return STRICT JSON only matching this shape: {\"overall_risk\":\"low|moderate|high|severe\",\"summary\":\"1-2 sentence calm summary\",\"alerts\":[{\"day\":\"YYYY-MM-DD\",\"hazard\":\"...\",\"severity\":\"low|moderate|high|severe\",\"why\":\"...\",\"action\":\"one short imperative action\"}]}. No prose outside JSON.",
          },
          {
            role: "user",
            content: `Location: ${location_name ?? `${lat},${lon}`}\n\nDaily forecast:\n${promptSummary}`,
          },
        ],
        temperature: 0.3,
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("AI gateway error", aiRes.status, t);
      return j({ forecast, analysis: null, error: "AI analysis failed" }, 200);
    }

    const aiJson = await aiRes.json();
    let raw: string = aiJson.choices?.[0]?.message?.content ?? "";
    // Strip code fences if present
    raw = raw.replace(/```json\s*|\s*```/g, "").trim();
    let analysis: unknown = null;
    try {
      analysis = JSON.parse(raw);
    } catch {
      console.error("Could not parse AI JSON:", raw.slice(0, 300));
    }

    return j({
      location: { lat, lon, name: location_name ?? null },
      forecast: {
        current: forecast.current,
        daily: forecast.daily,
        timezone: forecast.timezone,
      },
      analysis,
    });
  } catch (e) {
    console.error("forecast-analyze error", e);
    return j({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function j(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
