"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Check, Loader2, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { confirmAssistantAction } from "@/lib/ai/actions";
import { cn } from "@/lib/utils";

type ToolStatus = "running" | "done" | "error";

interface ChatItem {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: { id: string; label: string; status: ToolStatus }[];
  confirms: { id: string; name: string; summary: string; input: unknown; state: "pending" | "done" | "dismissed" | "error"; error?: string }[];
  error?: string;
}

type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; id: string; name: string; label: string; status: ToolStatus }
  | { type: "confirm"; id: string; name: string; summary: string; input: unknown }
  | { type: "done"; stopReason: string | null }
  | { type: "error"; message: string };

const STORAGE_KEY = "crm.assistant.v1";

const SUGGESTIONS = [
  "Who haven't I followed up with?",
  "When did I last contact the Brooklyn Review?",
  "Show me all correspondence with Harbor Arts Foundation",
  "Draft a follow-up for Maya Chen based on our emails",
  "Which venues have I talked to about chamber concerts?",
  "Find people interested in Fundraising",
];

/** Markdown from Claude: no images (nothing loads from outside), only app-relative or https links. */
const markdownComponents: Components = {
  img: () => null,
  a: ({ href, children }) => {
    // A single leading slash only: "//host" and "/\host" point to other sites.
    if (href && /^\/(?![/\\])/.test(href)) return <Link href={href}>{children}</Link>;
    if (href?.startsWith("https://")) {
      return (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      );
    }
    return <span>{children}</span>;
  },
};

function newId() {
  return Math.random().toString(36).slice(2);
}

export function AssistantChat() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Restore the last conversation (this device only).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setItems(JSON.parse(saved) as ChatItem[]);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-40)));
    } catch {
      // ignore
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items]);

  const update = useCallback((id: string, fn: (item: ChatItem) => ChatItem) => {
    setItems((all) => all.map((item) => (item.id === id ? fn(item) : item)));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || running) return;
      setInput("");
      const userItem: ChatItem = { id: newId(), role: "user", text: question, tools: [], confirms: [] };
      const assistantItem: ChatItem = { id: newId(), role: "assistant", text: "", tools: [], confirms: [] };
      const history = [...items, userItem]
        .filter((m) => m.text.trim())
        .map((m) => ({ role: m.role, content: m.text }))
        .slice(-30);
      setItems((all) => [...all, userItem, assistantItem]);
      setRunning(true);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const response = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Request failed (${response.status})`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            const event = JSON.parse(line) as StreamEvent;
            if (event.type === "text") update(assistantItem.id, (m) => ({ ...m, text: m.text + event.delta }));
            else if (event.type === "tool")
              update(assistantItem.id, (m) => {
                const others = m.tools.filter((t) => t.id !== event.id);
                return { ...m, tools: [...others, { id: event.id, label: event.label, status: event.status }] };
              });
            else if (event.type === "confirm")
              update(assistantItem.id, (m) => ({
                ...m,
                confirms: [...m.confirms, { id: event.id, name: event.name, summary: event.summary, input: event.input, state: "pending" }],
              }));
            else if (event.type === "error") update(assistantItem.id, (m) => ({ ...m, error: event.message }));
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          update(assistantItem.id, (m) => ({ ...m, error: error instanceof Error ? error.message : String(error) }));
        }
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
    },
    [items, running, update],
  );

  const confirm = async (itemId: string, confirmId: string, name: string, payload: unknown) => {
    const result = await confirmAssistantAction(name, payload);
    update(itemId, (m) => ({
      ...m,
      confirms: m.confirms.map((c) =>
        c.id === confirmId ? { ...c, state: result.ok ? "done" : "error", error: result.ok ? undefined : result.error } : c,
      ),
    }));
  };

  const dismiss = (itemId: string, confirmId: string) =>
    update(itemId, (m) => ({ ...m, confirms: m.confirms.map((c) => (c.id === confirmId ? { ...c, state: "dismissed" } : c)) }));

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-9rem)] max-w-3xl flex-col md:min-h-[calc(100dvh-4rem)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-[28px] font-bold tracking-tight md:text-xl md:font-semibold">
          <Sparkles className="size-6 md:size-5" strokeWidth={1.75} /> Claude
        </h1>
        {items.length ? (
          <button
            type="button"
            onClick={() => {
              abortRef.current?.abort();
              setItems([]);
            }}
            className="flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm text-muted active:bg-surface-2 md:h-8 md:hover:bg-surface-2"
          >
            <RotateCcw className="size-4" /> New chat
          </button>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-5 pb-4">
        {items.length === 0 ? (
          <div className="flex flex-1 flex-col justify-center gap-4 py-6">
            <p className="text-[15px] text-muted md:text-sm">
              Ask about your contacts, organizations, projects and every synced email. Claude can prepare emails for your approval; it never
              sends anything on its own.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="min-h-12 rounded-xl border border-border bg-surface px-4 py-2.5 text-left text-[15px] text-fg active:bg-surface-2 md:min-h-0 md:rounded-lg md:text-sm md:hover:bg-surface-2"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          items.map((item) =>
            item.role === "user" ? (
              <div key={item.id} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[15px] text-accent-fg md:text-sm">
                <p className="prose-plain">{item.text}</p>
              </div>
            ) : (
              <div key={item.id} className="flex flex-col gap-2">
                {item.tools.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {item.tools.map((t) => (
                      <span
                        key={t.id}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs",
                          t.status === "error" ? "text-danger" : "text-muted",
                        )}
                      >
                        {t.status === "running" ? <Loader2 className="size-3 animate-spin" /> : t.status === "done" ? <Check className="size-3" /> : <X className="size-3" />}
                        {t.label}
                      </span>
                    ))}
                  </div>
                ) : null}
                {item.text ? (
                  <div className="prose-chat text-[15px] leading-relaxed text-fg md:text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {item.text}
                    </ReactMarkdown>
                  </div>
                ) : running && item === items.at(-1) && !item.tools.length ? (
                  <p className="flex items-center gap-2 text-sm text-muted">
                    <Loader2 className="size-4 animate-spin" /> Thinking…
                  </p>
                ) : null}
                {item.confirms.map((c) => (
                  <div key={c.id} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 md:flex-row md:items-center md:rounded-lg">
                    <p className="min-w-0 flex-1 text-sm">
                      <span className="text-muted">Proposed change: </span>
                      {c.summary}
                    </p>
                    {c.state === "pending" ? (
                      <div className="grid grid-cols-2 gap-2 md:flex">
                        <button
                          type="button"
                          onClick={() => dismiss(item.id, c.id)}
                          className="h-10 rounded-lg border border-border px-3 text-sm active:bg-surface-2 md:h-8"
                        >
                          Dismiss
                        </button>
                        <button
                          type="button"
                          onClick={() => confirm(item.id, c.id, c.name, c.input)}
                          className="h-10 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg active:opacity-70 md:h-8"
                        >
                          Confirm
                        </button>
                      </div>
                    ) : (
                      <span className={cn("text-sm", c.state === "done" ? "text-success" : c.state === "error" ? "text-danger" : "text-subtle")}>
                        {c.state === "done" ? "Applied" : c.state === "error" ? c.error : "Dismissed"}
                      </span>
                    )}
                  </div>
                ))}
                {item.error ? <p className="text-sm text-danger">{item.error}</p> : null}
              </div>
            ),
          )
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] flex items-end gap-2 rounded-2xl border border-border bg-surface p-2 shadow-sm md:bottom-4"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(min-width: 768px)").matches) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={Math.min(6, Math.max(1, input.split("\n").length))}
          placeholder="Message Claude"
          aria-label="Message"
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-base placeholder:text-subtle focus:outline-none md:text-sm"
        />
        {running ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            aria-label="Stop"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg"
          >
            <Square className="size-4" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Send"
            disabled={!input.trim()}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg disabled:opacity-30"
          >
            <ArrowUp className="size-5" />
          </button>
        )}
      </form>
    </div>
  );
}
