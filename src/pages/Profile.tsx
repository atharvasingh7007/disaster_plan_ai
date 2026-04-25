import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { User, MapPin, Loader2, Plus, Trash2, Users, LogIn } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Tables } from "@/integrations/supabase/types";

type ProfileData = Partial<Tables<"profiles">>;

interface Member {
  id: string;
  name: string;
  age: number | null;
  relationship: string | null;
  vulnerabilities: string | null;
  notes: string | null;
}

export default function Profile() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [p, setP] = useState<ProfileData>({});
  const [busy, setBusy] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [newMember, setNewMember] = useState<Partial<Member>>({});

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: prof }, { data: mems }] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("household_members").select("*").eq("user_id", user.id).order("created_at"),
      ]);
      setP(prof ?? {});
      setMembers((mems as Member[]) ?? []);
    })();
  }, [user]);

  if (!user)
    return (
      <div className="h-full overflow-y-auto">
        <div className="p-8 max-w-2xl mx-auto text-center space-y-4 py-20">
          <div className="inline-flex h-14 w-14 rounded-2xl items-center justify-center bg-secondary/10">
            <User className="h-7 w-7 text-secondary" />
          </div>
          <h1 className="text-2xl font-semibold">Household Profile</h1>
          <p className="text-muted-foreground max-w-md mx-auto">
            Sign in to set up your household profile. The assistant uses this to give specific, personalized guidance for your family.
          </p>
          <Button onClick={() => navigate("/auth")} className="mt-2">
            <LogIn className="h-4 w-4 mr-2" /> Sign in to get started
          </Button>
        </div>
      </div>
    );

  const save = async () => {
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: p.display_name,
        home_location: p.home_location,
        home_lat: p.home_lat,
        home_lon: p.home_lon,
        resources: p.resources,
        important_documents: p.important_documents,
        emergency_contacts: p.emergency_contacts,
        transport: p.transport,
        pets: p.pets,
        special_notes: p.special_notes,
      })
      .eq("user_id", user.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Profile saved");
  };

  const geocodeHome = async () => {
    if (!p.home_location?.trim()) return toast.error("Enter a location first");
    setGeocoding(true);
    try {
      const r = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(p.home_location)}&count=1`
      ).then((x) => x.json());
      const hit = r?.results?.[0];
      if (!hit) {
        toast.error("Location not found");
      } else {
        const name = `${hit.name}${hit.admin1 ? ", " + hit.admin1 : ""}${hit.country ? ", " + hit.country : ""}`;
        setP({ ...p, home_location: name, home_lat: hit.latitude, home_lon: hit.longitude });
        toast.success("Coordinates set");
      }
    } catch {
      toast.error("Geocoding failed");
    } finally {
      setGeocoding(false);
    }
  };

  const addMember = async () => {
    if (!newMember.name?.trim()) return toast.error("Name is required");
    if (newMember.name.length > 100) return toast.error("Name too long");
    const { data, error } = await supabase
      .from("household_members")
      .insert({
        user_id: user.id,
        name: newMember.name.trim(),
        age: newMember.age ? Number(newMember.age) : null,
        relationship: newMember.relationship?.trim() || null,
        vulnerabilities: newMember.vulnerabilities?.trim() || null,
        notes: newMember.notes?.trim() || null,
      })
      .select()
      .single();
    if (error) return toast.error(error.message);
    setMembers([...members, data as Member]);
    setNewMember({});
  };

  const removeMember = async (id: string) => {
    const { error } = await supabase.from("household_members").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setMembers(members.filter((m) => m.id !== id));
  };

  const field = (k: string, label: string, area = false) => (
    <div className="space-y-1.5">
      <Label htmlFor={k}>{label}</Label>
      {area ? (
        <Textarea id={k} value={p[k] ?? ""} onChange={(e) => setP({ ...p, [k]: e.target.value })} rows={2} />
      ) : (
        <Input id={k} value={p[k] ?? ""} onChange={(e) => setP({ ...p, [k]: e.target.value })} />
      )}
    </div>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2 mb-1">
            <User className="h-5 w-5 text-secondary" />
            Profile
          </h1>
          <p className="text-sm text-muted-foreground">
            The assistant uses this context automatically. The more you tell it, the more specific it gets.
          </p>
        </div>

        <Card className="p-5 space-y-4">
          {field("display_name", "Display name")}

          <div className="space-y-1.5">
            <Label htmlFor="home_location">Home location</Label>
            <div className="flex gap-2">
              <Input
                id="home_location"
                value={p.home_location ?? ""}
                onChange={(e) => setP({ ...p, home_location: e.target.value })}
                placeholder="City, region, country"
              />
              <Button type="button" variant="outline" onClick={geocodeHome} disabled={geocoding}>
                {geocoding ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
              </Button>
            </div>
            {p.home_lat != null && p.home_lon != null && (
              <p className="text-xs text-muted-foreground">
                📍 {Number(p.home_lat).toFixed(3)}, {Number(p.home_lon).toFixed(3)} — used for Forecast Watch
              </p>
            )}
          </div>

          {field("resources", "Resources on hand (water, food days, generator, meds…)", true)}
          {field("transport", "Transport (car, none, bicycle…)")}
          {field("pets", "Pets")}
          {field("important_documents", "Important documents", true)}
          {field("emergency_contacts", "Emergency contacts", true)}
          {field("special_notes", "Special notes (allergies, mobility, language…)", true)}
          <Button onClick={save} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save profile
          </Button>
        </Card>

        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-secondary" />
            <h2 className="text-lg font-semibold">Household members</h2>
            <Badge variant="secondary">{members.length}</Badge>
          </div>

          {members.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Add the people who live with you. The assistant tailors plans for ages and vulnerabilities.
            </p>
          )}

          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-start justify-between gap-3 p-3 rounded-md border border-border bg-muted/30">
                <div className="min-w-0 text-sm">
                  <div className="font-medium">
                    {m.name}
                    {m.age != null && <span className="text-muted-foreground font-normal"> · {m.age}y</span>}
                    {m.relationship && <span className="text-muted-foreground font-normal"> · {m.relationship}</span>}
                  </div>
                  {m.vulnerabilities && (
                    <div className="text-muted-foreground text-xs mt-1">⚠ {m.vulnerabilities}</div>
                  )}
                  {m.notes && <div className="text-muted-foreground text-xs mt-0.5">{m.notes}</div>}
                </div>
                <Button size="sm" variant="ghost" onClick={() => removeMember(m.id)} aria-label={`Remove ${m.name}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="border-t border-border pt-4 space-y-2">
            <Label className="text-sm font-medium">Add a member</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Name"
                value={newMember.name ?? ""}
                onChange={(e) => setNewMember({ ...newMember, name: e.target.value })}
                maxLength={100}
              />
              <Input
                placeholder="Age"
                type="number"
                min={0}
                max={130}
                value={newMember.age ?? ""}
                onChange={(e) => setNewMember({ ...newMember, age: e.target.value ? Number(e.target.value) : null })}
              />
              <Input
                placeholder="Relationship (e.g. child, parent)"
                value={newMember.relationship ?? ""}
                onChange={(e) => setNewMember({ ...newMember, relationship: e.target.value })}
                maxLength={100}
              />
              <Input
                placeholder="Vulnerabilities (e.g. asthma)"
                value={newMember.vulnerabilities ?? ""}
                onChange={(e) => setNewMember({ ...newMember, vulnerabilities: e.target.value })}
                maxLength={300}
              />
            </div>
            <Textarea
              placeholder="Notes (optional)"
              value={newMember.notes ?? ""}
              onChange={(e) => setNewMember({ ...newMember, notes: e.target.value })}
              maxLength={500}
              rows={2}
            />
            <Button size="sm" onClick={addMember}>
              <Plus className="h-4 w-4 mr-1" /> Add member
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
