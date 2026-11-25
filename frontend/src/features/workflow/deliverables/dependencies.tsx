"use client";

import { Plus, Unlock, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDeferredValue, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { Link } from "@/i18n/navigation";
import { DeliverableStatusBadge } from "../badges";
import {
  DEPENDENCY_TYPES,
  RELEASE_CONDITIONS,
  cancelDependency,
  createDependency,
  manualRelease,
  proposeDependency,
  type DeliverableDetail,
  type DependencyBody,
  type DependencyLink,
  type DependencyType,
  type ReleaseCondition,
} from "../api";
import { useDeliverable, useDeliverables } from "../queries";
import {
  ConfirmDialog,
  MutationError,
  Panel,
  PanelButtons,
  TextArea,
  memberName,
  useDates,
  useWorkMutation,
} from "./shared";

type LinkEnd = DependencyLink["prerequisite"];

const STATE_TONES: Record<DependencyLink["state"], BadgeTone> = {
  waiting: "warning",
  released: "success",
  informational: "neutral",
  cancelled: "neutral",
};

/** "WO-3 · Châssis": a Deliverable at the end of a link. */
export function endName(end: Pick<LinkEnd, "code" | "title">) {
  return end.code ? `${end.code} · ${end.title}` : end.title;
}

/** The prerequisites and dependents of this Deliverable, with their state (guide §9). */
export function Dependencies({ deliverable }: { deliverable: DeliverableDetail }) {
  const t = useTranslations("Deliverables");
  const [adding, setAdding] = useState(false);
  const { prerequisites, dependents } = deliverable.dependencies;
  const mode = deliverable.rights.add_dependency ? "create" : deliverable.rights.propose_dependency ? "propose" : null;
  return (
    <Card
      title={t("dependenciesTitle")}
      action={
        mode && !adding ? (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t(mode === "create" ? "dependencyAdd" : "dependencyPropose")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        {adding && mode ? (
          <DependencyForm deliverable={deliverable} mode={mode} onClose={() => setAdding(false)} />
        ) : null}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold tracking-widest text-muted uppercase">{t("prerequisites")}</h3>
          {prerequisites.length === 0 ? <p className="text-sm text-muted">{t("prerequisitesNone")}</p> : null}
          <ul className="space-y-2">
            {prerequisites.map((link) => (
              <LinkItem key={link.id} link={link} other={link.prerequisite} />
            ))}
          </ul>
        </section>
        <section className="space-y-2">
          <h3 className="text-xs font-semibold tracking-widest text-muted uppercase">{t("dependents")}</h3>
          {dependents.length === 0 ? <p className="text-sm text-muted">{t("dependentsNone")}</p> : null}
          <ul className="space-y-2">
            {dependents.map((link) => (
              <LinkItem key={link.id} link={link} other={link.dependent} />
            ))}
          </ul>
        </section>
      </div>
    </Card>
  );
}

function LinkItem({ link, other }: { link: DependencyLink; other: LinkEnd }) {
  const t = useTranslations("Deliverables");
  const tWorkflow = useTranslations("Workflow");
  const { moment } = useDates();
  const [mode, setMode] = useState<"release" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const close = () => setMode(null);
  const release = useWorkMutation(() => manualRelease(link.id, reason.trim()), close);
  const cancel = useWorkMutation(() => cancelDependency(link.id, reason.trim()), close);
  const condition = link.release_condition ?? "validated";
  function open(next: "release" | "cancel") {
    setReason("");
    release.reset();
    cancel.reset();
    setMode(next);
  }
  return (
    <li className="space-y-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/work/deliverables/${other.id}`} className="min-w-0 text-sm font-medium text-navy hover:underline">
          <bdi dir="auto">{endName(other)}</bdi>
        </Link>
        {other.status ? <DeliverableStatusBadge status={other.status} /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Badge tone="neutral">{tWorkflow(`dependencyType.${link.link_type}`)}</Badge>
        {link.link_type === "blocks" ? (
          <span>
            {t("releaseWhen", { condition: tWorkflow(`releaseCondition.${condition}`) })}
            {condition === "milestone_completed" && link.release_milestone ? (
              <>
                {" · "}
                <bdi dir="auto">{link.release_milestone.title}</bdi>
              </>
            ) : null}
          </span>
        ) : null}
        <Badge tone={STATE_TONES[link.state]}>{tWorkflow(`linkState.${link.state}`)}</Badge>
      </div>
      {link.manually_released ? (
        <p className="text-xs text-muted">
          {t("manuallyReleasedBy", {
            name: memberName(link.manual_release_by) || t("someone"),
            date: moment(link.manual_release_at),
          })}
          {link.manual_release_reason ? (
            <span dir="auto" className="block italic">
              {link.manual_release_reason}
            </span>
          ) : null}
        </p>
      ) : link.released_at ? (
        <p className="text-xs text-muted">{t("releasedAt", { date: moment(link.released_at) })}</p>
      ) : null}
      {link.state === "waiting" && (link.rights.manual_release || link.rights.cancel) ? (
        <div className="flex flex-wrap gap-2">
          {link.rights.manual_release ? (
            <Button variant="secondary" size="sm" onClick={() => open("release")}>
              <Unlock className="size-4" aria-hidden="true" />
              {t("manualRelease")}
            </Button>
          ) : null}
          {link.rights.cancel ? (
            <Button variant="ghost" size="sm" onClick={() => open("cancel")}>
              <X className="size-4" aria-hidden="true" />
              {t("dependencyCancel")}
            </Button>
          ) : null}
        </div>
      ) : link.state !== "cancelled" && link.rights.cancel ? (
        <Button variant="ghost" size="sm" onClick={() => open("cancel")}>
          <X className="size-4" aria-hidden="true" />
          {t("dependencyCancel")}
        </Button>
      ) : null}
      {mode === "release" ? (
        <ConfirmDialog
          title={t("manualReleaseTitle")}
          confirm={t("manualReleaseConfirm")}
          pending={release.isPending}
          error={release.error}
          disabled={!reason.trim()}
          onConfirm={() => release.mutate()}
          onClose={close}
        >
          <p>
            {t("unmetCondition", {
              prerequisite: endName(link.prerequisite),
              condition: tWorkflow(`releaseCondition.${condition}`),
            })}
            {condition === "milestone_completed" && link.release_milestone ? (
              <>
                {" "}
                <bdi dir="auto">({link.release_milestone.title})</bdi>
              </>
            ) : null}
          </p>
          <Alert tone="warning">{t("manualReleasePermanent")}</Alert>
          <TextArea label={t("reason")} value={reason} onChange={setReason} required rows={2} />
        </ConfirmDialog>
      ) : null}
      {mode === "cancel" ? (
        <ConfirmDialog
          title={t("dependencyCancelTitle")}
          confirm={t("dependencyCancel")}
          pending={cancel.isPending}
          error={cancel.error}
          disabled={!reason.trim()}
          onConfirm={() => cancel.mutate()}
          onClose={close}
        >
          <p>{t("dependencyCancelHint")}</p>
          <TextArea label={t("reason")} value={reason} onChange={setReason} required rows={2} />
        </ConfirmDialog>
      ) : null}
    </li>
  );
}

type Side = "prerequisite" | "dependent";

/** A Head adds a link directly; anybody else proposes it to a Head (guide §9.4). */
function DependencyForm({
  deliverable,
  mode,
  onClose,
}: {
  deliverable: DeliverableDetail;
  mode: "create" | "propose";
  onClose: () => void;
}) {
  const t = useTranslations("Deliverables");
  const tWorkflow = useTranslations("Workflow");
  const [side, setSide] = useState<Side>("prerequisite");
  const [search, setSearch] = useState("");
  const [other, setOther] = useState("");
  const [type, setType] = useState<DependencyType>("blocks");
  const [condition, setCondition] = useState<ReleaseCondition>("validated");
  const [milestone, setMilestone] = useState("");
  const [reason, setReason] = useState("");
  const words = useDeferredValue(search.trim());
  const found = useDeliverables({ search: words } as Parameters<typeof useDeliverables>[0], words.length >= 2);
  const candidates = (found.data ?? []).filter((item) => item.id !== deliverable.id);
  const otherId = Number(other) || 0;
  // The milestone is the prerequisite's: this Deliverable's own when it is the prerequisite.
  const otherDetail = useDeliverable(side === "prerequisite" && condition === "milestone_completed" ? otherId : 0);
  const milestones = (side === "dependent" ? deliverable.milestones : (otherDetail.data?.milestones ?? [])).filter(
    (item) => !item.is_cancelled,
  );
  const needsMilestone = type === "blocks" && condition === "milestone_completed";
  const valid = otherId > 0 && (!needsMilestone || !!milestone);

  const save = useWorkMutation((): Promise<unknown> => {
    const body: DependencyBody = {
      prerequisite: side === "prerequisite" ? otherId : deliverable.id,
      dependent: side === "prerequisite" ? deliverable.id : otherId,
      link_type: type,
      release_condition: type === "blocks" ? condition : "validated",
      release_milestone: needsMilestone ? Number(milestone) : null,
      reason: reason.trim(),
    };
    return mode === "create" ? createDependency(body) : proposeDependency(body);
  }, onClose);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid && !save.isPending) {
      save.mutate();
    }
  }

  return (
    <Panel
      title={t(mode === "create" ? "dependencyAddTitle" : "dependencyProposeTitle")}
      description={t(mode === "create" ? "dependencyAddHint" : "dependencyProposeHint")}
      onSubmit={submit}
    >
      <MutationError error={save.error} />
      <SelectField
        label={t("dependencySide")}
        value={side}
        onChange={(event) => {
          setSide(event.target.value as Side);
          setMilestone("");
        }}
      >
        <option value="prerequisite">{t("sidePrerequisite")}</option>
        <option value="dependent">{t("sideDependent")}</option>
      </SelectField>
      <TextField
        label={t("searchDeliverable")}
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <SelectField
        label={t(side === "prerequisite" ? "prerequisite" : "dependent")}
        value={other}
        onChange={(event) => {
          setOther(event.target.value);
          setMilestone("");
        }}
      >
        <option value="">{words.length < 2 ? t("searchFirst") : t("choose")}</option>
        {candidates.map((item) => (
          <option key={item.id} value={item.id}>
            {endName(item)}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label={t("dependencyType")}
          value={type}
          onChange={(event) => setType(event.target.value as DependencyType)}
        >
          {DEPENDENCY_TYPES.map((value) => (
            <option key={value} value={value}>
              {tWorkflow(`dependencyType.${value}`)}
            </option>
          ))}
        </SelectField>
        {type === "blocks" ? (
          <SelectField
            label={t("releaseCondition")}
            value={condition}
            onChange={(event) => {
              setCondition(event.target.value as ReleaseCondition);
              setMilestone("");
            }}
          >
            {RELEASE_CONDITIONS.map((value) => (
              <option key={value} value={value}>
                {tWorkflow(`releaseCondition.${value}`)}
              </option>
            ))}
          </SelectField>
        ) : null}
      </div>
      {needsMilestone ? (
        <SelectField
          label={t("releaseMilestone")}
          value={milestone}
          onChange={(event) => setMilestone(event.target.value)}
        >
          <option value="">{otherId || side === "dependent" ? t("choose") : t("choosePrerequisiteFirst")}</option>
          {milestones.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </SelectField>
      ) : null}
      <TextArea label={t("dependencyReason")} value={reason} onChange={setReason} rows={2} />
      <PanelButtons
        confirm={t(mode === "create" ? "dependencyAdd" : "dependencyPropose")}
        pending={save.isPending}
        disabled={!valid}
        onClose={onClose}
      />
    </Panel>
  );
}
