"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  fetchLifecycleSteps,
  fetchProject,
  fetchProjectCreating,
  fetchProjects,
  fetchSubsystems,
  fetchTask,
  fetchTasks,
  type ProjectFilters,
  type TaskFilters,
} from "./api";

/** Cache keys of the work data. A change invalidates what it may affect (see refreshWork). */
export const workKeys = {
  projects: (filters: Omit<ProjectFilters, "page"> = {}) => ["projects", filters] as const,
  project: (id: number) => ["project", id] as const,
  projectCreating: ["project-creating"] as const,
  subsystems: (project: number) => ["subsystems", project] as const,
  lifecycleSteps: ["lifecycle-steps"] as const,
  tasks: (filters: Omit<TaskFilters, "page"> = {}) => ["tasks", filters] as const,
  task: (id: number) => ["task", id] as const,
};

export function useProjects(filters: Omit<ProjectFilters, "page"> = {}) {
  return useQuery({ queryKey: workKeys.projects(filters), queryFn: () => fetchProjects(filters) });
}

/** Whether the viewer creates projects (no "New project" button otherwise). */
export function useProjectCreating() {
  return useQuery({ queryKey: workKeys.projectCreating, queryFn: fetchProjectCreating, staleTime: 5 * 60_000 });
}

export function useProject(id: number) {
  return useQuery({ queryKey: workKeys.project(id), queryFn: () => fetchProject(id), enabled: id > 0 });
}

export function useSubsystems(project: number | null) {
  return useQuery({
    queryKey: workKeys.subsystems(project ?? 0),
    queryFn: () => fetchSubsystems(project ?? 0),
    enabled: !!project,
  });
}

export function useLifecycleSteps() {
  return useQuery({ queryKey: workKeys.lifecycleSteps, queryFn: fetchLifecycleSteps, staleTime: 60 * 60_000 });
}

export function useTasks(filters: Omit<TaskFilters, "page">, enabled = true) {
  return useQuery({ queryKey: workKeys.tasks(filters), queryFn: () => fetchTasks(filters), enabled });
}

export function useTask(id: number) {
  return useQuery({ queryKey: workKeys.task(id), queryFn: () => fetchTask(id), enabled: id > 0 });
}

/**
 * After a change: everything listed again when next shown (projects' counts, task lists, the
 * subsystems' progress, the task itself). The lists are small; being exact matters more.
 * `deletedTask` is not loaded again: it no longer exists, and its page would show an error
 * while the next page opens.
 */
export function refreshWork(queryClient: QueryClient, { deletedTask }: { deletedTask?: number } = {}) {
  return Promise.all(
    ["projects", "project", "subsystems", "tasks", "task"].map((key) =>
      queryClient.invalidateQueries({
        queryKey: [key],
        predicate: ({ queryKey }) => !(queryKey[0] === "task" && queryKey[1] === deletedTask),
      }),
    ),
  );
}
