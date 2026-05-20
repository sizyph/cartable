import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import clsx from "clsx";

type ToolUse = { name: string; input?: string };

type ChatMessage =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; text: string; tools: ToolUse[]; streaming?: boolean }
  | { id: number; role: "tool"; text: string }
  | { id: number; role: "error"; text: string };

let nextId = 1;

export function ChatPanel() {
  const { t } = useTranslation();
  const starterPrompts = t("chat.starters", { returnObjects: true }) as string[];
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    if (!text.trim() || streaming) return;
    const userMsg: ChatMessage = { id: nextId++, role: "user", text };
    const assistantMsg: ChatMessage = { id: nextId++, role: "assistant", text: "", tools: [], streaming: true };
    setMessages((m) => [...m, userMsg, assistantMsg]);
    setInput("");
    setStreaming(true);
    try {
      const r = await fetch("http://127.0.0.1:7531/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sessionId }),
      });
      if (!r.ok || !r.body) throw new Error(`${r.status} ${r.statusText}`);
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          handleSse(chunk);
        }
      }
    } catch (e: any) {
      setMessages((m) => [...m, { id: nextId++, role: "error", text: String(e) }]);
    } finally {
      setStreaming(false);
      setMessages((m) =>
        m.map((x) => (x.role === "assistant" && x.streaming ? { ...x, streaming: false } : x)),
      );
    }
  }

  function handleSse(chunk: string) {
    // SSE chunk format: "event: <name>\ndata: <json>" (or no event line, default "message")
    let event = "message";
    let data = "";
    for (const line of chunk.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    let payload: any;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    if (event === "error") {
      setMessages((m) => [...m, { id: nextId++, role: "error", text: payload.error ?? "error" }]);
      return;
    }
    if (event === "done") return;

    if (payload.role === "assistant") {
      setMessages((m) => {
        const last = m[m.length - 1];
        if (last?.role !== "assistant") return m;
        return [
          ...m.slice(0, -1),
          {
            ...last,
            text: payload.text || last.text,
            tools: [...last.tools, ...(payload.tools ?? [])],
          },
        ];
      });
    } else if (payload.role === "tool_result") {
      setMessages((m) => [...m, { id: nextId++, role: "tool", text: payload.text }]);
    } else if (payload.role === "result" && payload.session_id) {
      setSessionId(payload.session_id);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="px-8 py-5 border-b border-pap-border">
        <h1 className="text-2xl font-semibold tracking-tight">{t("chat.title")}</h1>
        <p className="text-sm text-pap-muted">
          {t("chat.subtitle")}
          {sessionId && (
            <span className="ml-2 opacity-60">
              {t("chat.session_id", { id: sessionId.slice(0, 8) })}
            </span>
          )}
        </p>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-8 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="max-w-2xl mx-auto mt-12">
            <p className="text-pap-muted mb-4 text-sm">{t("chat.try_one")}</p>
            <div className="grid grid-cols-2 gap-2">
              {starterPrompts.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="text-left text-sm rounded-md border border-pap-border bg-pap-surface hover:bg-pap-surface-2 px-3 py-2.5 text-pap-text"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} msg={m} />
        ))}
      </div>

      <div className="px-8 py-4 border-t border-pap-border">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={streaming ? t("chat.thinking") : t("chat.placeholder")}
            disabled={streaming}
            ref={inputRef}
            className="flex-1 bg-pap-surface border border-pap-border rounded-md px-3 py-2 text-sm placeholder-pap-muted focus:outline-none focus:border-pap-accent disabled:opacity-50"
          />
          <MicButton
            disabled={streaming}
            onActivate={() => {
              inputRef.current?.focus();
            }}
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="px-4 py-2 rounded-md bg-pap-accent text-pap-bg text-sm font-medium disabled:opacity-40"
          >
            {t("chat.send")}
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * Microphone button — Tauri's WKWebView does NOT expose the Web Speech API
 * (SpeechRecognition is unimplemented on macOS WebKit). So we don't try to
 * record/transcribe ourselves. Instead, we focus the input field and offer
 * a one-line hint: any system-wide dictation tool — Superwhisper, Whisper
 * Flow, macOS Voice Control / Dictation — works as long as the input has
 * keyboard focus.
 */
function MicButton({ disabled, onActivate }: { disabled?: boolean; onActivate: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onActivate}
      disabled={disabled}
      title={t("chat.voice_button_title")}
      aria-label="Voice input"
      className="px-3 py-2 rounded-md bg-pap-surface border border-pap-border text-pap-muted hover:text-pap-text hover:bg-pap-surface-2 disabled:opacity-40"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
        <line x1="12" y1="18" x2="12" y2="22" />
        <line x1="8" y1="22" x2="16" y2="22" />
      </svg>
    </button>
  );
}


function Bubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-2xl rounded-lg bg-pap-accent/15 text-pap-text px-3 py-2 text-sm whitespace-pre-wrap">
          {msg.text}
        </div>
      </div>
    );
  }
  if (msg.role === "error") {
    return (
      <div className="max-w-2xl rounded-lg bg-pap-bad/15 text-pap-bad text-sm px-3 py-2">{msg.text}</div>
    );
  }
  if (msg.role === "tool") {
    return (
      <details className="max-w-2xl text-xs text-pap-muted">
        <summary className="cursor-pointer">tool result</summary>
        <pre className="whitespace-pre-wrap bg-pap-surface-2/40 rounded-md px-2 py-1 mt-1">{msg.text}</pre>
      </details>
    );
  }
  // assistant
  return (
    <div className="max-w-2xl">
      {msg.tools.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {msg.tools.map((t, i) => (
            <span
              key={i}
              className={clsx(
                "text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5",
                t.name === "thinking"
                  ? "bg-pap-surface-2 text-pap-muted"
                  : "bg-pap-surface-2 text-pap-accent",
              )}
              title={t.input}
            >
              {t.name}
            </span>
          ))}
        </div>
      )}
      <div
        className={clsx(
          "rounded-lg bg-pap-surface text-pap-text px-3 py-2 text-sm leading-relaxed prose-chat",
          msg.streaming && "after:content-['▍'] after:ml-1 after:animate-pulse after:text-pap-muted",
        )}
      >
        {msg.text ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="list-disc pl-5 space-y-0.5 mb-2 last:mb-0">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-5 space-y-0.5 mb-2 last:mb-0">{children}</ol>,
              code: ({ children, className }) =>
                className ? (
                  <code className="block bg-pap-surface-2 rounded px-2 py-1 text-xs my-1 overflow-x-auto">
                    {children}
                  </code>
                ) : (
                  <code className="bg-pap-surface-2 rounded px-1 text-[12px]">{children}</code>
                ),
              table: ({ children }) => <table className="text-xs my-2 border border-pap-border">{children}</table>,
              th: ({ children }) => <th className="border border-pap-border px-2 py-0.5 text-left">{children}</th>,
              td: ({ children }) => <td className="border border-pap-border px-2 py-0.5 tabular-nums">{children}</td>,
              a: ({ children, href }) => (
                <a href={href} className="text-pap-accent underline" target="_blank" rel="noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {msg.text}
          </ReactMarkdown>
        ) : msg.streaming ? (
          "…"
        ) : null}
      </div>
    </div>
  );
}
