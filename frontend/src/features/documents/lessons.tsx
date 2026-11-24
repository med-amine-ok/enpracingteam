"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, Pencil, Search, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useDeferredValue, useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useOrgUnits } from "@/features/members/use-members";
import { Link, useRouter } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { CATEGORIES, createLesson, deleteLesson, updateLesson, type KnowledgeCategory, type Lesson } from "./api";
import { KnowledgeTabs, textareaClass } from "./document-parts";
import { documentKeys, refreshDocuments, useLesson, useLessons } from "./queries";

/** The texts of a lesson learned, in the order of Team Manager – ERP Requirements §10. */
const TEXTS = ["problem", "context", "root_cause", "solution", "result", "next_time"] as const;
type Text = (typeof TEXTS)[number];

/** The lessons learned: what a problem taught the team, so that it is not repeated. */
export function LessonsPage() {
  const t = useTranslations("Documents");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<KnowledgeCategory | "">("");
  const words = useDeferredValue(query.trim());
  const lessons = useLessons({ ...(words ? { q: words } : {}), ...(category ? { category } : {}) });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow={tShell("groups.execution")} title={t("title")} description={t("intro")}>
        <Link href="/documents/lessons/new" className={buttonClassName("primary", "sm")}>
          <Lightbulb className="size-4" aria-hidden="true" />
          {t("newLesson")}
        </Link>
      </PageHeader>
      <KnowledgeTabs current="lessons" />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <TextField
            label={t("search")}
            type="search"
            icon={<Search />}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="w-48">
          <SelectField
            label={t("categoryLabel")}
            value={category}
            onChange={(event) => setCategory(event.target.value as KnowledgeCategory | "")}
          >
            <option value="">{t("allCategories")}</option>
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(`category.${value}`)}
              </option>
            ))}
          </SelectField>
        </div>
      </div>
      {lessons.isError ? (
        <Alert tone="error">{errorText(lessons.error, tErrors)}</Alert>
      ) : !lessons.data ? (
        <LinesPlaceholder lines={4} />
      ) : lessons.data.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-6 py-14 text-center text-sm text-muted">
          {t("noLessons")}
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {lessons.data.map((lesson) => (
            <li key={lesson.id}>
              <Link
                href={`/documents/lessons/${lesson.id}`}
                className="block h-full space-y-2 rounded-xl border border-line bg-surface p-4 shadow-xs hover:border-navy/30"
              >
                <span dir="auto" className="block font-medium text-ink">
                  {lesson.title}
                </span>
                <span dir="auto" className="line-clamp-2 block text-sm text-muted">
                  {lesson.problem}
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  {lesson.category ? <Badge tone="neutral">{t(`category.${lesson.category}`)}</Badge> : null}
                  {lesson.org_unit ? <bdi>{lesson.org_unit.name}</bdi> : null}
                  <span>
                    {lesson.author.first_name} {lesson.author.last_name} ·{" "}
                    {format.dateTime(new Date(lesson.created_at), { dateStyle: "medium", numberingSystem: "latn" })}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Write a lesson learned (any member), or correct one (its author, its unit's leaders, the bureau). */
export function LessonForm({
  lesson,
  onSaved,
  onCancel,
}: {
  lesson?: Lesson;
  onSaved: (lesson: Lesson) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("Documents");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const units = useOrgUnits();
  const ids = useId();
  const [title, setTitle] = useState(lesson?.title ?? "");
  const [texts, setTexts] = useState<Record<Text, string>>(
    Object.fromEntries(TEXTS.map((key) => [key, lesson?.[key] ?? ""])) as Record<Text, string>,
  );
  const [unit, setUnit] = useState(lesson?.org_unit ? String(lesson.org_unit.id) : "");
  const [category, setCategory] = useState<KnowledgeCategory | "">(lesson?.category ?? "");
  const save = useMutation({
    mutationFn: () => {
      const body = { title: title.trim(), ...texts, org_unit_id: unit ? Number(unit) : null, category };
      return lesson ? updateLesson(lesson.id, body) : createLesson(body);
    },
    onSuccess: async (saved) => {
      await refreshDocuments(queryClient);
      onSaved(saved);
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (title.trim() && texts.problem.trim()) {
          save.mutate();
        }
      }}
    >
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      <TextField label={t("titleLabel")} required value={title} onChange={(event) => setTitle(event.target.value)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label={t("responsibleUnit")} value={unit} onChange={(event) => setUnit(event.target.value)}>
          <option value="">{t("wholeTeam")}</option>
          {(units.data ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t("categoryLabel")}
          value={category}
          onChange={(event) => setCategory(event.target.value as KnowledgeCategory | "")}
        >
          <option value="">{t("noCategory")}</option>
          {CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {t(`category.${value}`)}
            </option>
          ))}
        </SelectField>
      </div>
      {TEXTS.map((key) => (
        <div key={key} className="space-y-1.5">
          <label htmlFor={`${ids}-${key}`} className="block text-xs font-semibold tracking-widest text-muted uppercase">
            {t(`lesson.${key}`)}
          </label>
          <textarea
            id={`${ids}-${key}`}
            rows={key === "problem" ? 3 : 2}
            required={key === "problem"}
            value={texts[key]}
            onChange={(event) => setTexts((current) => ({ ...current, [key]: event.target.value }))}
            className={textareaClass}
          />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={save.isPending} disabled={!title.trim() || !texts.problem.trim()}>
          {lesson ? t("save") : t("createLesson")}
        </Button>
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel}>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function NewLesson() {
  const t = useTranslations("Documents");
  const tShell = useTranslations("Shell");
  const router = useRouter();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href="/documents/lessons">{t("lessonsTab")}</BackLink>
      <PageHeader eyebrow={tShell("groups.execution")} title={t("newLessonTitle")} description={t("newLessonIntro")} />
      <Card>
        <LessonForm onSaved={(lesson) => router.replace(`/documents/lessons/${lesson.id}`)} />
      </Card>
    </div>
  );
}

export function LessonView() {
  const t = useTranslations("Documents");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const lesson = useLesson(Number(id));
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteLesson(Number(id)),
    onSuccess: async () => {
      router.replace("/documents/lessons");
      await refreshDocuments(queryClient);
    },
  });

  if (lesson.isError) {
    return (
      <div className="mx-auto max-w-4xl">
        <Alert tone="error">{errorText(lesson.error, tErrors)}</Alert>
      </div>
    );
  }
  if (!lesson.data) {
    return (
      <div className="mx-auto max-w-4xl" aria-hidden="true">
        <Card>
          <LinesPlaceholder lines={5} />
        </Card>
      </div>
    );
  }
  const data = lesson.data;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/documents/lessons">{t("lessonsTab")}</BackLink>
      {editing ? (
        <Card title={t("editLesson")}>
          <LessonForm
            lesson={data}
            onSaved={(saved) => {
              queryClient.setQueryData(documentKeys.lesson(data.id), saved);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </Card>
      ) : (
        <section className="space-y-5 rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <span className="flex flex-wrap items-center gap-1.5">
                {data.category ? <Badge tone="neutral">{t(`category.${data.category}`)}</Badge> : null}
                {data.org_unit ? <Badge tone="info">{data.org_unit.name}</Badge> : null}
              </span>
              <h1 dir="auto" className="text-2xl font-semibold tracking-tight text-ink rtl:text-right">
                {data.title}
              </h1>
              <p className="text-sm text-muted">
                {data.author.first_name} {data.author.last_name} ·{" "}
                {format.dateTime(new Date(data.created_at), { dateStyle: "medium", numberingSystem: "latn" })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {data.permissions.edit ? (
                <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" aria-hidden="true" />
                  {t("edit")}
                </Button>
              ) : null}
              {data.permissions.delete ? (
                confirmDelete ? (
                  <>
                    <Button size="sm" onClick={() => remove.mutate()} loading={remove.isPending} autoFocus>
                      {t("confirmDelete")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                      {t("cancel")}
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="size-4" aria-hidden="true" />
                    {t("delete")}
                  </Button>
                )
              ) : null}
            </div>
          </div>
          {remove.isError ? <Alert tone="error">{errorText(remove.error, tErrors)}</Alert> : null}
          <dl className="space-y-4">
            {TEXTS.filter((key) => data[key]).map((key) => (
              <div key={key} className="space-y-1">
                <dt className="text-sm font-semibold text-ink">{t(`lesson.${key}`)}</dt>
                <dd dir="auto" className="text-sm whitespace-pre-line text-ink">
                  {data[key]}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
