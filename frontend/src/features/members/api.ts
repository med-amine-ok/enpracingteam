import { api } from "@/lib/api/client";
import { dataOf, send } from "@/lib/api/errors";
import { fetchAllPages } from "@/lib/api/pagination";
import type { components } from "@/lib/api/schema";
import { withSessionRefresh } from "@/lib/api/session";

export type Member = components["schemas"]["MemberDetail"];
export type Membership = components["schemas"]["Membership"];
export type OrgUnit = components["schemas"]["OrgUnit"];
export type MemberStatus = components["schemas"]["MemberStatusEnum"];
export type UnitType = components["schemas"]["TypeEnum"];
export type Role = components["schemas"]["Role"];
export type MemberAdding = components["schemas"]["MemberAdding"];
export type MemberAdd = components["schemas"]["MemberAddRequest"];
export type Position = components["schemas"]["Position"];
export type ProjectChoice = components["schemas"]["ProjectChoice"];
export type MemberManage = components["schemas"]["MemberManage"];
export type MemberManageChange = components["schemas"]["PatchedMemberManageRequest"];
export type MembershipAdd = components["schemas"]["MembershipAddRequest"];

/**
 * Every member with their memberships. The club has under 200 members: loading them once, then
 * searching in the browser, is instant. Phone and Facebook are null unless the viewer may see them.
 */
export function fetchMembers() {
  return fetchAllPages(async (page) =>
    dataOf(await send(() => withSessionRefresh(() => api.GET("/api/members/", { params: { query: { page } } })))),
  );
}

/** Every unit of the organisation (club departments, Formula Student departments…). */
export function fetchOrgUnits() {
  return fetchAllPages(async (page) =>
    dataOf(await send(() => withSessionRefresh(() => api.GET("/api/org-units/", { params: { query: { page } } })))),
  );
}

/** Where the viewer may add members from the web app, and with which roles (decision D-024). */
export async function fetchMemberAdding() {
  return dataOf(await send(() => withSessionRefresh(() => api.GET("/api/members/add/"))));
}

/** Adds a member with their first membership; they are e-mailed how to sign in. */
export async function addMember(body: MemberAdd) {
  return dataOf(await send(() => withSessionRefresh(() => api.POST("/api/members/add/", { body }))));
}

/** A member as the Board and the Team Manager edit them (decision D-025). */
export async function fetchMemberManage(id: number) {
  return dataOf(
    await send(() => withSessionRefresh(() => api.GET("/api/members/{id}/manage/", { params: { path: { id } } }))),
  );
}

/** Changes who a member is, their status and their projects (the others end today). */
export async function changeMember(id: number, body: MemberManageChange) {
  return dataOf(
    await send(() =>
      withSessionRefresh(() => api.PATCH("/api/members/{id}/manage/", { params: { path: { id } }, body })),
    ),
  );
}

/** Gives a member a unit and a role, or a position in the club. */
export async function addMembership(id: number, body: MembershipAdd) {
  return dataOf(
    await send(() =>
      withSessionRefresh(() => api.POST("/api/members/{id}/manage/memberships/", { params: { path: { id } }, body })),
    ),
  );
}

/** Ends one of a member's memberships today. */
export async function endMembership(id: number, membership: number) {
  return dataOf(
    await send(() =>
      withSessionRefresh(() =>
        api.POST("/api/members/{id}/manage/memberships/{membership_pk}/end/", {
          params: { path: { id, membership_pk: membership } },
        }),
      ),
    ),
  );
}

/** The roles a unit takes: those of the Formula Student team for its units, the club's otherwise
 * (apps/members/access.py scope_of). */
export function scopeOfUnit(type: UnitType): Role["scope"] {
  return type === "fs_team" || type === "fs_department" ? "fs_team" : "club";
}
