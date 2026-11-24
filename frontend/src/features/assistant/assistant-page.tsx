"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, FileStack, LoaderCircle, MessageSquarePlus, MessagesSquare, Send, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LinesPlaceholder } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PageTabs } from "@/components/ui/page-tabs";
import { errorText } from "@/lib/error-text";
import { cn } from "@/lib/utils";
import { askAssistant, deleteConversation, type Citation, type Message } from "./api";
import { assistantKeys, refreshAssistant, useAssistantRights, useConversation, useConversations } from "./queries";

export const textareaClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none";

/** "2026-2027": a season, from the year it starts. */
export function seasonName(season: number) {
  return `${season}-${season + 1}`;
}

/** Discussion | Sources (the Executive Bureau only). */
export function AssistantTabs({ current }: { current: "chat" | "sources" }) {
  const t = useTranslations("Assistant");
  const rights = useAssistantRights();
  const tabs = [
    { key: "chat", href: "/assistant", icon: MessagesSquare, label: t("chatTab") },
    ...(rights.data?.manage_sources || current === "sources"
      ? [{ key: "sources", href: "/assistant/sources", icon: FileStack, label: t("sourcesTab") }]
      : []),
  ];
  return <PageTabs label={t("sections")} tabs={tabs} current={current} />;
}

/** Ask the assistant about the charter, the rules book and the competition's documents (decision D-021). */
export function AssistantPage() {
  const t = useTranslations("Assistant");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const rights = useAssistantRights();
  const conversations = useConversations();
  const [selected, setSelected] = useState<number | null>(null);
  const conversation = useConversation(selected);
  const remove = useMutation({
    mutationFn: (id: number) => deleteConversation(id),
    onSuccess: async (_, id) => {
      if (id === selected) {
        setSelected(null);
      }
      await refreshAssistant(queryClient);
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow={tShell("groups.execution")} title={t("title")} description={t("intro")} />
      <AssistantTabs current="chat" />
      {rights.data && !rights.data.ready ? <Alert tone="info">{t("noSourcesYet")}</Alert> : null}
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="space-y-3">
          <Button variant="secondary" className="w-full" onClick={() => setSelected(null)}>
            <MessageSquarePlus className="size-4" aria-hidden="true" />
            {t("newConversation")}
          </Button>
          <h2 className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">{t("history")}</h2>
          {conversations.isError ? (
            <Alert tone="error">{errorText(conversations.error, tErrors)}</Alert>
          ) : !conversations.data ? (
            <LinesPlaceholder lines={3} />
          ) : conversations.data.length === 0 ? (
            <p className="px-1 text-sm text-muted">{t("noConversations")}</p>
          ) : (
            <ul className="space-y-1">
              {conversations.data.map((item) => (
                <li key={item.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelected(item.id)}
                    aria-current={item.id === selected ? "true" : undefined}
                    className={cn(
                      "min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-start text-sm",
                      item.id === selected ? "bg-navy text-white" : "text-ink hover:bg-canvas",
                    )}
                  >
                    <bdi>{item.title}</bdi>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove.mutate(item.id)}
                    aria-label={t("deleteConversation", { title: item.title })}
                    className="rounded-lg p-2 text-muted hover:bg-canvas hover:text-racing"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className="flex min-h-[28rem] flex-col rounded-xl border border-line bg-surface shadow-card">
          <Chat
            key={selected ?? "new"}
            conversationId={selected}
            messages={selected !== null ? conversation.data?.messages : []}
            loading={selected !== null && !conversation.data && !conversation.error}
            error={selected !== null ? conversation.error : null}
            onStarted={async (id) => {
              setSelected(id);
              await queryClient.invalidateQueries({ queryKey: assistantKeys.conversations });
            }}
          />
        </section>
      </div>
    </div>
  );
}

function Chat({
  conversationId,
  messages,
  loading,
  error,
  onStarted,
}: {
  conversationId: number | null;
  messages: Message[] | undefined;
  loading: boolean;
  error: Error | null;
  onStarted: (id: number) => Promise<void>;
}) {
  const t = useTranslations("Assistant");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const questionId = useId();
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const ask = useMutation({
    mutationFn: (text: string) => askAssistant(text, conversationId),
    onMutate: (text) => setAsked(text),
    onSuccess: async (answer) => {
      setQuestion("");
      queryClient.setQueryData(
        assistantKeys.conversation(answer.conversation.id),
        (current?: { messages: Message[] }) =>
          current ? { ...current, messages: [...current.messages, answer.question, answer.answer] } : current,
      );
      if (conversationId === null) {
        await onStarted(answer.conversation.id);
      } else {
        await queryClient.invalidateQueries({ queryKey: assistantKeys.conversations });
      }
    },
  });

  function send(event?: FormEvent) {
    event?.preventDefault();
    const text = question.trim();
    if (text && !ask.isPending) {
      ask.mutate(text);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      send();
    }
  }

  const shown = messages ?? [];
  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5" aria-live="polite">
        {error ? (
          <Alert tone="error">{errorText(error, tErrors)}</Alert>
        ) : loading ? (
          <LinesPlaceholder lines={4} />
        ) : shown.length === 0 && !ask.isPending ? (
          <div className="grid h-full place-items-center gap-2 py-10 text-center">
            <Bot className="size-10 text-navy" aria-hidden="true" />
            <p className="max-w-md text-sm text-muted">{t("welcome")}</p>
          </div>
        ) : (
          shown.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
        {ask.isPending ? (
          <>
            <MessageBubble message={{ id: 0, role: "user", content: asked, citations: [], created_at: "" }} />
            <p className="flex items-center gap-2 text-sm text-muted">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              {t("thinking")}
            </p>
          </>
        ) : null}
        {ask.isError ? <Alert tone="error">{errorText(ask.error, tErrors)}</Alert> : null}
      </div>
      <form onSubmit={send} className="space-y-2 border-t border-line p-3 sm:p-4">
        <label htmlFor={questionId} className="sr-only">
          {t("questionLabel")}
        </label>
        <textarea
          id={questionId}
          rows={2}
          dir="auto"
          value={question}
          placeholder={t("questionPlaceholder")}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
          className={textareaClass}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">{t("questionHint")}</p>
          <Button type="submit" size="sm" disabled={!question.trim()} loading={ask.isPending}>
            <Send className="size-4 rtl:rotate-180" aria-hidden="true" />
            {t("send")}
          </Button>
        </div>
      </form>
    </>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const t = useTranslations("Assistant");
  const mine = message.role === "user";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] space-y-2 rounded-2xl px-4 py-2.5 text-sm",
          mine ? "bg-navy text-white" : "border border-line bg-canvas text-ink",
        )}
      >
        <p dir="auto" className="whitespace-pre-line">
          {message.content}
        </p>
        {!mine && message.citations.length > 0 ? (
          <ul aria-label={t("sources")} className="space-y-0.5 border-t border-line pt-2 text-xs text-muted">
            {message.citations.map((citation) => (
              <li key={`${citation.number}-${citation.source}-${citation.page}`}>{citationText(citation, t)}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function citationText(citation: Citation, t: ReturnType<typeof useTranslations<"Assistant">>) {
  const values = { number: String(citation.number), title: citation.title, season: seasonName(citation.season) };
  return citation.page ? t("citationPage", { ...values, page: String(citation.page) }) : t("citation", values);
}
