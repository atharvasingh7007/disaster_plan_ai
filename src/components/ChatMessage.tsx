import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { BookOpen } from "lucide-react";

export type Source = { title: string; source: string; hazard: string | null };

export default function ChatMessage({
  role,
  content,
  sources,
}: {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}) {
  const isUser = role === "user";
  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div className={isUser ? "chat-bubble-user" : "chat-bubble-assistant prose-chat"}>
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <>
            <ReactMarkdown>{content || "…"}</ReactMarkdown>
            {sources && sources.length > 0 && (
              <div className="mt-3 pt-2 border-t border-border/60 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <BookOpen className="h-3 w-3" />
                <span className="font-medium">Sources:</span>
                {sources.map((s, i) => (
                  <span key={i} className="px-1.5 py-0.5 rounded bg-muted">
                    {s.source} — {s.title}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
