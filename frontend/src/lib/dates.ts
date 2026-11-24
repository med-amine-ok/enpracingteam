/** The club's time zone (TIME_ZONE in backend/config/settings.py). */
export const CLUB_TIME_ZONE = "Africa/Algiers";

/** Today's date in Algiers as "YYYY-MM-DD", the format of the API's dates (like timezone.localdate()). */
export function clubToday(now: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE }).format(now);
}

const clubClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: CLUB_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The date and time in Algiers as "YYYY-MM-DDTHH:mm", the value of a date-time field. */
export function clubDateTime(date: Date) {
  const parts = Object.fromEntries(clubClock.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** The moment of a date and time read in Algiers ("YYYY-MM-DDTHH:mm"), whatever the device's time zone. */
export function fromClubDateTime(value: string) {
  const asUtc = (text: string) => Date.parse(`${text.slice(0, 16)}:00Z`);
  const wanted = asUtc(value);
  // Algiers' offset from UTC at that moment, from what its clock shows; read twice in case the
  // first guess fell on the other side of a change of time (Algeria has none today).
  let moment = wanted - (asUtc(clubDateTime(new Date(wanted))) - wanted);
  moment += wanted - asUtc(clubDateTime(new Date(moment)));
  return new Date(moment);
}
