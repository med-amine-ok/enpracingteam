"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMe } from "@/features/auth/use-me";
import {
  fetchBlockers,
  fetchDeliverable,
  fetchDeliverableActivity,
  fetchDeliverables,
  fetchDependencies,
  fetchOperationalReport,
  fetchProjectOverview,
  fetchProposals,
  fetchSeasonOverview,
  fetchSeasons,
  fetchWorkDashboard,
  fetchWorkMe,
  fetchWorkOrder,
  fetchWorkOrderActivity,
  fetchWorkOrders,
  fetchWorkProjects,
  type DeliverableFilters,
  type WorkOrderFilters,
} from "./api";

/** Cache keys of the work module; every change refreshes them all (refreshWorkflow): the backend recomputes
 * states, progress and deadlines across the hierarchy, so a local update would be guesswork. */
export const workflowKeys = {
  all: ["workflow"] as const,
  me: ["workflow", "me"] as const,
  seasons: ["workflow", "seasons"] as const,
  seasonOverview: (season: number) => ["workflow", "season", season] as const,
  projects: (season?: number) => ["workflow", "projects", season ?? 0] as const,
  project: (project: number) => ["workflow", "project", project] as const,
  workOrders: (filters: Omit<WorkOrderFilters, "page"> = {}) => ["workflow", "work-orders", filters] as const,
  workOrder: (id: number) => ["workflow", "work-order", id] as const,
  workOrderActivity: (id: number) => ["workflow", "work-order-activity", id] as const,
  deliverables: (filters: Omit<DeliverableFilters, "page"> = {}) => ["workflow", "deliverables", filters] as const,
  deliverable: (id: number) => ["workflow", "deliverable", id] as const,
  deliverableActivity: (id: number) => ["workflow", "deliverable-activity", id] as const,
  dependencies: (filters: Record<string, unknown> = {}) => ["workflow", "dependencies", filters] as const,
  blockers: (filters: Record<string, unknown> = {}) => ["workflow", "blockers", filters] as const,
  proposals: ["workflow", "proposals"] as const,
  dashboard: (department?: number) => ["workflow", "dashboard", department ?? 0] as const,
  report: (filters: Record<string, unknown> = {}) => ["workflow", "report", filters] as const,
};

/** After any change: everything of the work module is read again. */
export function refreshWorkflow(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: workflowKeys.all });
}

/** What the viewer may do in the work module (and whether the scoring workspace exists for them). */
export function useWorkMe() {
  const me = useMe();
  return useQuery({ queryKey: workflowKeys.me, queryFn: fetchWorkMe, staleTime: 60_000, enabled: Boolean(me.data) });
}

export function useSeasons() {
  return useQuery({ queryKey: workflowKeys.seasons, queryFn: fetchSeasons, staleTime: 5 * 60_000 });
}

export function useSeasonOverview(season: number | null | undefined) {
  return useQuery({
    queryKey: workflowKeys.seasonOverview(season ?? 0),
    queryFn: () => fetchSeasonOverview(season ?? 0),
    enabled: !!season,
  });
}

export function useWorkProjects(season?: number) {
  return useQuery({ queryKey: workflowKeys.projects(season), queryFn: () => fetchWorkProjects(season) });
}

export function useProjectOverview(project: number) {
  return useQuery({
    queryKey: workflowKeys.project(project),
    queryFn: () => fetchProjectOverview(project),
    enabled: project > 0,
  });
}

export function useWorkOrders(filters: Omit<WorkOrderFilters, "page"> = {}, enabled = true) {
  return useQuery({ queryKey: workflowKeys.workOrders(filters), queryFn: () => fetchWorkOrders(filters), enabled });
}

export function useWorkOrder(id: number) {
  return useQuery({ queryKey: workflowKeys.workOrder(id), queryFn: () => fetchWorkOrder(id), enabled: id > 0 });
}

export function useWorkOrderActivity(id: number) {
  return useQuery({
    queryKey: workflowKeys.workOrderActivity(id),
    queryFn: () => fetchWorkOrderActivity(id),
    enabled: id > 0,
  });
}

export function useDeliverables(filters: Omit<DeliverableFilters, "page"> = {}, enabled = true) {
  return useQuery({
    queryKey: workflowKeys.deliverables(filters),
    queryFn: () => fetchDeliverables(filters),
    enabled,
  });
}

export function useDeliverable(id: number) {
  return useQuery({ queryKey: workflowKeys.deliverable(id), queryFn: () => fetchDeliverable(id), enabled: id > 0 });
}

export function useDeliverableActivity(id: number) {
  return useQuery({
    queryKey: workflowKeys.deliverableActivity(id),
    queryFn: () => fetchDeliverableActivity(id),
    enabled: id > 0,
  });
}

export function useDependencies(filters: Parameters<typeof fetchDependencies>[0] = {}) {
  return useQuery({ queryKey: workflowKeys.dependencies(filters), queryFn: () => fetchDependencies(filters) });
}

export function useBlockers(filters: Parameters<typeof fetchBlockers>[0] = {}) {
  return useQuery({ queryKey: workflowKeys.blockers(filters), queryFn: () => fetchBlockers(filters) });
}

export function useProposals() {
  return useQuery({ queryKey: workflowKeys.proposals, queryFn: fetchProposals });
}

export function useWorkDashboard(department?: number) {
  return useQuery({ queryKey: workflowKeys.dashboard(department), queryFn: () => fetchWorkDashboard(department) });
}

export function useOperationalReport(filters: { season?: number; department?: number; project?: number } = {}) {
  return useQuery({ queryKey: workflowKeys.report(filters), queryFn: () => fetchOperationalReport(filters) });
}
