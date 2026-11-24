import { api } from "@/lib/api/client";
import { ensureOk, send } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import { withSessionRefresh } from "@/lib/api/session";

export type Me = components["schemas"]["Me"];
export type Language = components["schemas"]["LanguageEnum"];
/** A language, or "" to follow the browser. */
export type LanguageChoice = Language | "";

/** Asks for a login code. The API answers the same whether the address is a member's or not. */
export async function requestCode(email: string) {
  const { data } = ensureOk(await send(() => api.POST("/api/auth/otp/request/", { body: { email } })));
  return data?.detail ?? "";
}

/** Logs in with the code: the API sets the session cookies. */
export async function verifyCode(email: string, code: string) {
  ensureOk(await send(() => api.POST("/api/auth/otp/verify/", { body: { email, code } })));
}

export async function logout() {
  ensureOk(await send(() => api.POST("/api/auth/logout/")));
}

/**
 * The logged-in member, or null without a valid session (the API refused to renew it). When the API
 * could not answer (unreachable, restarting), fails with ApiError: the member is not logged out.
 */
export async function fetchMe(): Promise<Me | null> {
  const result = await send(() => withSessionRefresh(() => api.GET("/api/auth/me/")));
  if (result.response.status === 401) {
    return null;
  }
  return ensureOk(result).data ?? null;
}

/** Saves the member's language: the API (messages, e-mails) and their other devices follow it. */
export async function updateLanguage(language: LanguageChoice) {
  ensureOk(await send(() => withSessionRefresh(() => api.PATCH("/api/auth/me/", { body: { language } }))));
}

export type StudyLevel = components["schemas"]["StudyLevelEnum"];
export const STUDY_LEVELS: StudyLevel[] = ["prep_1", "prep_2", "year_3", "year_4", "year_5", "postgraduate", "other"];

/** Saves the member's year and field of study (charter art. 13: the preparatory classes go to Media). */
export async function updateStudies(body: { study_level: StudyLevel | ""; study_field: string }) {
  ensureOk(await send(() => withSessionRefresh(() => api.PATCH("/api/auth/me/", { body }))));
}

export type EmailTopic = components["schemas"]["EmailTopicEnum"];
/** The subjects of the ERP's e-mails, in the order of the profile (decision D-023). */
export const EMAIL_TOPICS: EmailTopic[] = [
  "tasks",
  "purchases",
  "sessions",
  "workshop",
  "ranking",
  "volunteering",
  "discipline",
];
/** Always e-mailed: the charter has the warnings and exclusions notified in writing. */
export const ALWAYS_EMAILED: EmailTopic[] = ["discipline"];

/** Saves the subjects of the e-mails the member turns off (the ERP still shows those notifications). */
export async function updateMutedEmailTopics(muted_email_topics: EmailTopic[]) {
  ensureOk(await send(() => withSessionRefresh(() => api.PATCH("/api/auth/me/", { body: { muted_email_topics } }))));
}

/** Saves the member's race number (1 to 99), or null to give it up; one already in the team is refused. */
export async function updateRaceNumber(race_number: number | null) {
  ensureOk(await send(() => withSessionRefresh(() => api.PATCH("/api/auth/me/", { body: { race_number } }))));
}

export type AlumniProfile = components["schemas"]["AlumniProfile"];

/** Saves what an alumni tells the team about their life after it; the API answers with the saved profile. */
export async function updateAlumniProfile(body: AlumniProfile): Promise<AlumniProfile> {
  const { data } = ensureOk(await send(() => withSessionRefresh(() => api.PATCH("/api/auth/me/alumni/", { body }))));
  return data ?? body;
}
