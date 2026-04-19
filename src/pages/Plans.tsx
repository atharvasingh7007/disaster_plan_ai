import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Download, Trash2, FileDown } from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";

type Plan = { id: string; title: string; content: string; created_at: string; location: string | null };

export default function Plans() {
  const { user, isGuest } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("plans")
        .select("id,title,content,created_at,location")
        .order("created_at", { ascending: false });
      setPlans(data ?? []);
    })();
  }, [user]);

  const downloadMd = (p: Plan) => {
    const blob = new Blob([`# ${p.title}\n\n${p.content}`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${p.title.replace(/[^a-z0-9]+/gi, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = (p: Plan) => {
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const margin = 56;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxWidth = pageWidth - margin * 2;
    let y = margin;

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    const titleLines = doc.splitTextToSize(p.title, maxWidth);
    doc.text(titleLines, margin, y);
    y += titleLines.length * 22 + 4;

    // Meta
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(120);
    const meta = `${new Date(p.created_at).toLocaleString()}${p.location ? " · " + p.location : ""}`;
    doc.text(meta, margin, y);
    y += 18;
    doc.setDrawColor(220);
    doc.line(margin, y, pageWidth - margin, y);
    y += 14;
    doc.setTextColor(30);

    // Body — render markdown-ish: headings (#), bullets (-,*), plain
    const lines = p.content.split("\n");
    for (const raw of lines) {
      const line = raw.replace(/\r$/, "");
      const trimmed = line.trim();
      let text = trimmed;
      let size = 11;
      let weight: "normal" | "bold" = "normal";
      let indent = 0;
      let lh = 15;

      if (/^#{1,2}\s/.test(trimmed)) {
        text = trimmed.replace(/^#{1,2}\s/, "");
        size = 14;
        weight = "bold";
        lh = 18;
      } else if (/^#{3,6}\s/.test(trimmed)) {
        text = trimmed.replace(/^#{3,6}\s/, "");
        size = 12;
        weight = "bold";
        lh = 16;
      } else if (/^[-*]\s/.test(trimmed)) {
        text = "• " + trimmed.replace(/^[-*]\s/, "");
        indent = 12;
      } else if (/^\d+\.\s/.test(trimmed)) {
        indent = 12;
      }

      // Strip simple markdown emphasis
      text = text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");

      if (text === "") {
        y += lh / 2;
        continue;
      }

      doc.setFont("helvetica", weight);
      doc.setFontSize(size);
      const wrapped = doc.splitTextToSize(text, maxWidth - indent);
      for (const w of wrapped) {
        if (y > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(w, margin + indent, y);
        y += lh;
      }
    }

    doc.save(`${p.title.replace(/[^a-z0-9]+/gi, "_")}.pdf`);
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("plans").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setPlans((p) => p.filter((x) => x.id !== id));
  };

  if (!user) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <FileText className="h-5 w-5 text-secondary" />
          Plans
        </h1>
        <p className="text-muted-foreground mt-2">
          {isGuest
            ? "Guest mode doesn't save plans. Sign in to save and download them."
            : "Sign in to view your saved plans."}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold flex items-center gap-2 mb-4">
          <FileText className="h-5 w-5 text-secondary" />
          Your Plans
        </h1>
        {plans.length === 0 ? (
          <p className="text-muted-foreground">No plans yet. Generate one in Assistant and click "Save as plan".</p>
        ) : (
          <div className="grid gap-3">
            {plans.map((p) => (
              <Card key={p.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate">{p.title}</h3>
                    <p className="text-xs text-muted-foreground">
                      {new Date(p.created_at).toLocaleString()}
                      {p.location ? ` · ${p.location}` : ""}
                    </p>
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-2">{p.content.slice(0, 200)}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="default" onClick={() => downloadPdf(p)} title="Download PDF">
                      <FileDown className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => downloadMd(p)} title="Download Markdown">
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(p.id)} title="Delete">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
