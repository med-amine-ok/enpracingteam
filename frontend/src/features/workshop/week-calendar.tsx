"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useFormatter, useTranslations, type DateTimeFormatOptions } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { buttonClassName } from "@/components/ui/button";
import { LinesPlaceholder } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import { Link, useRouter } from "@/i18n/navigation";
import { clubDateTime, clubToday } from "@/lib/dates";
import { errorText } from "@/lib/error-text";
import type { Reservation } from "./api";
import { useEquipmentList, useWeekReservations } from "./queries";
import { WorkshopTabs, personName } from "./workshop-parts";

const FIRST_HOUR = 7;
const LAST_HOUR = 23;
const HOUR_HEIGHT = 40; // pixels
// The equipment's colours on the calendar, by their place in the week's list (names of globals.css).
const COLOURS = [
  "var(--color-navy)",
  "var(--color-racing)",
  "var(--color-info)",
  "var(--color-green)",
  "var(--color-amber)",
];

/** "2026-10-19" plus `days`. */
function addDays(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The Monday of a day's week. */
function mondayOf(day: string) {
  const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  return addDays(day, -weekday);
}

/** A moment of the API in the club's time: its day ("YYYY-MM-DD") and its minutes since midnight. */
function clubMoment(value: string) {
  const text = clubDateTime(new Date(value)); // "YYYY-MM-DDTHH:mm"
  return { day: text.slice(0, 10), minutes: Number(text.slice(11, 13)) * 60 + Number(text.slice(14, 16)) };
}

type Segment = { reservation: Reservation; top: number; height: number };

/** The part of each slot shown on a day, between FIRST_HOUR and LAST_HOUR (a slot over midnight on two days). */
function segmentsOf(reservations: Reservation[], day: string): Segment[] {
  const segments: Segment[] = [];
  for (const reservation of reservations) {
    const from = clubMoment(reservation.reserved_from);
    const to = clubMoment(reservation.reserved_to);
    if (from.day > day || to.day < day || (to.day === day && to.minutes === 0)) {
      continue;
    }
    const start = Math.max(from.day === day ? from.minutes : 0, FIRST_HOUR * 60);
    const end = Math.min(to.day === day ? to.minutes : 24 * 60, LAST_HOUR * 60);
    if (end <= start) {
      continue; // all of it before FIRST_HOUR or after LAST_HOUR: nothing to draw that day
    }
    const top = ((Math.min(start, LAST_HOUR * 60 - 30) - FIRST_HOUR * 60) / 60) * HOUR_HEIGHT;
    segments.push({ reservation, top, height: Math.max(((end - start) / 60) * HOUR_HEIGHT, 20) });
  }
  return segments;
}

/** The Figma's week calendar of the workshop: every equipment's slots, day by day (decision D-022). The week is in
 * the address (?week=2026-10-19, ?equipment=3): read inside Suspense. */
export function WeekCalendar() {
  const t = useTranslations("Workshop");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const router = useRouter();
  const params = useSearchParams();
  const asked = params.get("week") ?? "";
  const monday = mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : clubToday(new Date()));
  const equipment = params.get("equipment") ?? "";
  const slots = useWeekReservations(monday, equipment ? Number(equipment) : undefined);
  const items = useEquipmentList();
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  const order = [...new Set((slots.data ?? []).map((slot) => slot.equipment.id))];
  const colourOf = (id: number) => COLOURS[order.indexOf(id) % COLOURS.length];
  const date = (day: string, options: DateTimeFormatOptions) =>
    format.dateTime(new Date(`${day}T12:00:00Z`), { ...options, numberingSystem: "latn" });
  const time = (value: string) =>
    format.dateTime(new Date(value), { hour: "2-digit", minute: "2-digit", numberingSystem: "latn" });
  const href = (week: string, item = equipment) => `/workshop/calendar?week=${week}${item ? `&equipment=${item}` : ""}`;
  const today = clubToday(new Date());

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow={tShell("groups.logistics")} title={t("title")} description={t("calendarIntro")} />
      <WorkshopTabs current="calendar" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={href(addDays(monday, -7))} className={buttonClassName("secondary", "sm")}>
            <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
            {t("previousWeek")}
          </Link>
          <Link href={href(mondayOf(today))} className={buttonClassName("ghost", "sm")}>
            {t("thisWeek")}
          </Link>
          <Link href={href(addDays(monday, 7))} className={buttonClassName("secondary", "sm")}>
            {t("nextWeek")}
            <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
          </Link>
          <h2 className="ms-2 font-display text-lg font-bold tracking-wide text-navy uppercase">
            {t("weekOf", {
              start: date(monday, { day: "numeric", month: "long" }),
              end: date(addDays(monday, 6), { day: "numeric", month: "long", year: "numeric" }),
            })}
          </h2>
        </div>
        <div className="w-full sm:w-64">
          <SelectField
            label={t("calendarEquipment")}
            value={equipment}
            onChange={(event) => router.replace(href(monday, event.target.value))}
          >
            <option value="">{t("allEquipment")}</option>
            {(items.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </SelectField>
        </div>
      </div>
      {slots.isError ? (
        <Alert tone="error">{errorText(slots.error, tErrors)}</Alert>
      ) : !slots.data ? (
        <LinesPlaceholder lines={6} />
      ) : (
        <>
          {slots.data.length === 0 ? <p className="text-sm text-muted">{t("noSlots")}</p> : null}
          <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
            <div className="grid min-w-[760px] grid-cols-[3rem_repeat(7,minmax(0,1fr))]">
              <span className="border-b border-line bg-canvas" aria-hidden="true" />
              {days.map((day) => (
                <p
                  key={day}
                  className={`border-s border-b border-line bg-canvas px-2 py-2 text-center text-2xs font-semibold tracking-wider uppercase ${
                    day === today ? "text-racing" : "text-muted"
                  }`}
                >
                  {date(day, { weekday: "short", day: "numeric" })}
                </p>
              ))}
              <ol aria-hidden="true">
                {Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, index) => (
                  <li
                    key={index}
                    className="border-b border-line pe-1 pt-0.5 text-end text-2xs text-muted"
                    style={{ height: HOUR_HEIGHT }}
                  >
                    {String(FIRST_HOUR + index).padStart(2, "0")}h
                  </li>
                ))}
              </ol>
              {days.map((day) => (
                <ul
                  key={day}
                  aria-label={date(day, { weekday: "long", day: "numeric", month: "long" })}
                  className="relative border-s border-line"
                  style={{
                    height: (LAST_HOUR - FIRST_HOUR) * HOUR_HEIGHT,
                    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${HOUR_HEIGHT - 1}px, var(--color-line) ${HOUR_HEIGHT - 1}px ${HOUR_HEIGHT}px)`,
                  }}
                >
                  {segmentsOf(slots.data, day).map(({ reservation, top, height }) => (
                    <li
                      key={reservation.id}
                      className="absolute inset-x-0.5 overflow-hidden rounded-sm border-s-2 bg-surface px-1.5 py-0.5 text-2xs leading-tight text-ink shadow-xs"
                      style={{
                        top,
                        height,
                        borderInlineStartColor: colourOf(reservation.equipment.id),
                        background: `color-mix(in srgb, ${colourOf(reservation.equipment.id)} 12%, white)`,
                      }}
                    >
                      <Link
                        href={`/workshop/${reservation.equipment.id}`}
                        className="block font-semibold hover:underline"
                      >
                        <bdi>{reservation.equipment.name}</bdi>
                      </Link>
                      <span className="block" dir="ltr">
                        {time(reservation.reserved_from)}–{time(reservation.reserved_to)}
                      </span>
                      <span className="block truncate text-muted">{personName(reservation.reserved_by)}</span>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
