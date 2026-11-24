"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  fetchCharterIssues,
  fetchEngagementRights,
  fetchFollowedMembers,
  fetchGoals,
  fetchMemberSheet,
  fetchMissingVolunteering,
  fetchTrainings,
  fetchVolunteering,
  type GoalFilters,
  type TrainingFilters,
  type VolunteeringFilters,
} from "./api";

export const engagementKeys = {
  rights: ["engagement-rights"] as const,
  followed: ["engagement-followed"] as const,
  sheet: (id: number) => ["engagement-sheet", id] as const,
  charter: ["engagement-charter"] as const,
  goals: (filters: GoalFilters = {}) => ["engagement-goals", filters] as const,
  trainings: (filters: TrainingFilters = {}) => ["engagement-trainings", filters] as const,
  volunteering: (filters: VolunteeringFilters = {}) => ["engagement-volunteering", filters] as const,
  missing: ["engagement-missing"] as const,
};

export function useEngagementRights() {
  return useQuery({ queryKey: engagementKeys.rights, queryFn: fetchEngagementRights });
}

/** True for who heads members, the Team Manager and the Bureau. */
export function useLeads() {
  const rights = useEngagementRights();
  return Boolean(rights.data?.leads || rights.data?.sees_all);
}

export function useFollowedMembers(enabled = true) {
  return useQuery({ queryKey: engagementKeys.followed, queryFn: fetchFollowedMembers, enabled });
}

export function useMemberSheet(id: number) {
  return useQuery({ queryKey: engagementKeys.sheet(id), queryFn: () => fetchMemberSheet(id), enabled: id > 0 });
}

export function useCharterIssues(enabled = true) {
  return useQuery({ queryKey: engagementKeys.charter, queryFn: fetchCharterIssues, enabled });
}

export function useGoals(filters: GoalFilters = {}) {
  return useQuery({ queryKey: engagementKeys.goals(filters), queryFn: () => fetchGoals(filters) });
}

export function useTrainings(filters: TrainingFilters = {}) {
  return useQuery({ queryKey: engagementKeys.trainings(filters), queryFn: () => fetchTrainings(filters) });
}

export function useVolunteering(filters: VolunteeringFilters = {}) {
  return useQuery({ queryKey: engagementKeys.volunteering(filters), queryFn: () => fetchVolunteering(filters) });
}

export function useMissingVolunteering(enabled = true) {
  return useQuery({ queryKey: engagementKeys.missing, queryFn: () => fetchMissingVolunteering(), enabled });
}

/** After a change: goals, trainings, volunteering and sheets are fetched again when next shown. */
export function refreshEngagement(queryClient: QueryClient) {
  return Promise.all(
    [
      "engagement-followed",
      "engagement-sheet",
      "engagement-goals",
      "engagement-trainings",
      "engagement-volunteering",
      "engagement-missing",
    ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
  );
}
