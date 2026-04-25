import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CloudSun,
  Loader2,
  MapPin,
  Locate,
  AlertTriangle,
  Wind,
  Droplets,
  Sun,
  Thermometer,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

type Severity = "low" | "moderate" | "high" | "severe";
interface Alert {
  day: string;
  hazard: string;
  severity: Severity;
  why: string;
  action: string;
}
interface Analysis {
  overall_risk: Severity;
  summary: string;
  alerts: Alert[];
}
interface ForecastData {
  location: { lat: number; lon: number; name: string | null };
  forecast: {
    current: Record<string, number>;
    daily: {
      time: string[];
      weather_code: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_sum: number[];
      precipitation_probability_max: (number | null)[];
      wind_speed_10m_max: number[];
      wind_gusts_10m_max: number[];
      uv_index_max: (number | null)[];
    };
    timezone: string;
  };
  analysis: Analysis | null;
}

const sevColor: Record<Severity, string> = {
  low: "bg-secondary text-secondary-foreground",
  moderate: "bg-accent text-accent-foreground",
  high: "bg-orange-500 text-white",
  severe: "bg-destructive text-destructive-foreground",
};

const wmoLabel = (c: number) => {
  if (c === 0) return "Clear";
  if (c <= 3) return "Partly cloudy";
  if (c <= 48) return "Fog";
  if (c <= 57) return "Drizzle";
  if (c <= 67) return "Rain";
  if (c <= 77) return "Snow";
  if (c <= 82) return "Showers";
  if (c <= 86) return "Snow showers";
  return "Thunderstorm";
};

export default function Forecast() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ForecastData | null>(null);

  // Pre-fill from profile home location
  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: p } = await supabase
        .from("profiles")
        .select("home_location,home_lat,home_lon")
        .eq("user_id", user.id)
        .maybeSingle();
      if (p?.home_lat && p?.home_lon) {
        runFetch({ lat: p.home_lat, lon: p.home_lon, name: p.home_location ?? undefined });
      } else if (p?.home_location) {
      setQuery(p.home_location);
      }
    })();
  }, [user]);

  async function runFetch(args: { lat?: number; lon?: number; name?: string }) {
    setLoading(true);
    try {
      let finalLat = args.lat;
      let finalLon = args.lon;
      let finalName = args.name;

      // 1. Detect if name is actually a coordinate string "lat, lon"
      if (finalName && finalLat == null && finalLon == null) {
        const coordMatch = finalName.match(/^(-?\d+(\.\d+)?)[,\s]+(-?\d+(\.\d+)?)$/);
        if (coordMatch) {
          finalLat = parseFloat(coordMatch[1]);
          finalLon = parseFloat(coordMatch[3]);
          finalName = undefined;
        }
      }

      // 2. Reverse geocode on frontend to bypass edge function limitations
      if (finalLat != null && finalLon != null && !finalName) {
        try {
          const rg = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${finalLat}&lon=${finalLon}`,
            { headers: { "User-Agent": "DisasterReady-AI-App" } }
          ).then((r) => r.json());
          if (rg?.address) {
            const a = rg.address;
            const city = a.city || a.town || a.village || a.county || a.state_district;
            const state = a.state;
            if (city && state) finalName = `${city}, ${state}`;
            else if (city) finalName = city;
          }
        } catch (e) {
          console.warn("Frontend reverse geocode failed", e);
        }
      }

      const { data: res, error } = await supabase.functions.invoke("forecast-analyze", {
        body: {
          lat: finalLat,
          lon: finalLon,
          location_name: finalName,
        },
      });
      if (error) throw error;
      const resData = res as Record<string, unknown> | null;
      if (resData?.error) throw new Error(String(resData.error));
      const castRes = res as ForecastData;
      setData(castRes);
      if (castRes.location?.name) {
        setQuery(castRes.location.name);
      } else if (args.name) {
        setQuery(args.name);
      }
    } catch (e: unknown) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Forecast failed");
    } finally {
      setLoading(false);
    }
  }

  function useDeviceLocation() {
    if (!navigator.geolocation) {
      toast.error("Geolocation not supported");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => runFetch({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      async () => {
        // IP fallback
        try {
          const ip = await fetch("https://ipapi.co/json/").then((r) => r.json());
          if (ip?.latitude && ip?.longitude) {
            runFetch({
              lat: ip.latitude,
              lon: ip.longitude,
              name: `${ip.city ?? ""}${ip.region ? ", " + ip.region : ""}`.trim(),
            });
          } else {
            setLoading(false);
            toast.error("Could not detect location");
          }
        } catch {
          setLoading(false);
          toast.error("Could not detect location");
        }
      },
      { timeout: 8000 }
    );
  }

  const days = useMemo(() => {
    if (!data) return [] as Array<{
      date: string; max: number; min: number; precip: number; pop: number; wind: number; gust: number; uv: number; code: number;
    }>;
    const d = data.forecast.daily;
    return d.time.map((t, i) => ({
      date: t,
      max: d.temperature_2m_max[i],
      min: d.temperature_2m_min[i],
      precip: d.precipitation_sum[i],
      pop: d.precipitation_probability_max[i] ?? 0,
      wind: d.wind_speed_10m_max[i],
      gust: d.wind_gusts_10m_max[i],
      uv: d.uv_index_max[i] ?? 0,
      code: d.weather_code[i],
    }));
  }, [data]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CloudSun className="h-5 w-5 text-accent" />
            <h1 className="text-2xl font-semibold">Forecast Watch</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            7-day forecast from Open-Meteo with AI hazard interpretation tailored for preparedness.
          </p>
        </div>

        <Card>
          <CardContent className="p-4 flex flex-col sm:flex-row gap-2">
            <div className="flex-1 flex gap-2">
              <Input
                placeholder="City, region, or postcode"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && query.trim()) runFetch({ name: query.trim() });
                }}
              />
              <Button onClick={() => query.trim() && runFetch({ name: query.trim() })} disabled={loading}>
                <MapPin className="h-4 w-4 mr-1" /> Search
              </Button>
            </div>
            <Button variant="outline" onClick={useDeviceLocation} disabled={loading}>
              <Locate className="h-4 w-4 mr-1" /> Use my location
            </Button>
          </CardContent>
        </Card>

        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Fetching forecast and analyzing hazards…
          </div>
        )}

        {data && (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  {data.location.name ?? `${data.location.lat.toFixed(2)}, ${data.location.lon.toFixed(2)}`}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <Stat icon={<Thermometer className="h-4 w-4" />} label="Now" value={`${Math.round(data.forecast.current.temperature_2m)}°C`} />
                <Stat icon={<Thermometer className="h-4 w-4" />} label="Feels like" value={`${Math.round(data.forecast.current.apparent_temperature)}°C`} />
                <Stat icon={<Wind className="h-4 w-4" />} label="Wind" value={`${Math.round(data.forecast.current.wind_speed_10m)} km/h`} />
                <Stat icon={<Droplets className="h-4 w-4" />} label="Humidity" value={`${Math.round(data.forecast.current.relative_humidity_2m)}%`} />
              </CardContent>
            </Card>

            {data.analysis && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-accent" />
                      Hazard analysis
                    </span>
                    <Badge className={sevColor[data.analysis.overall_risk]}>
                      {data.analysis.overall_risk} risk
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="text-foreground/90">{data.analysis.summary}</p>
                  {data.analysis.alerts?.length ? (
                    <ul className="space-y-2">
                      {data.analysis.alerts.map((a, i) => (
                        <li key={i} className="rounded-md border border-border p-3 bg-muted/30">
                          <div className="flex items-center justify-between mb-1">
                            <div className="font-medium">
                              {a.hazard} <span className="text-muted-foreground font-normal">· {a.day}</span>
                            </div>
                            <Badge className={sevColor[a.severity]}>{a.severity}</Badge>
                          </div>
                          <div className="text-muted-foreground">{a.why}</div>
                          <div className="mt-1"><span className="font-medium">Action:</span> {a.action}</div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">No notable hazards in the next 7 days.</p>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {days.map((d) => (
                <Card key={d.date} className="p-3 text-xs">
                  <div className="font-medium text-sm mb-1">
                    {new Date(d.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                  </div>
                  <div className="text-muted-foreground mb-2">{wmoLabel(d.code)}</div>
                  <div className="flex items-center gap-1"><Thermometer className="h-3 w-3" />{Math.round(d.min)}° / {Math.round(d.max)}°</div>
                  <div className="flex items-center gap-1"><Droplets className="h-3 w-3" />{d.precip} mm ({d.pop}%)</div>
                  <div className="flex items-center gap-1"><Wind className="h-3 w-3" />{Math.round(d.wind)}/{Math.round(d.gust)} km/h</div>
                  <div className="flex items-center gap-1"><Sun className="h-3 w-3" />UV {d.uv}</div>
                </Card>
              ))}
            </div>
          </>
        )}

        {!data && !loading && (
          <p className="text-sm text-muted-foreground">
            Enter a location or use your device GPS to see a 7-day forecast and AI-interpreted hazards.
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground">{icon}</div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="font-medium">{value}</div>
      </div>
    </div>
  );
}
