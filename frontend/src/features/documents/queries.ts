"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  fetchDocument,
  fetchDocuments,
  fetchFolders,
  fetchLesson,
  fetchLessons,
  type DocumentFilters,
  type LessonFilters,
} from "./api";

export const documentKeys = {
  list: (filters: DocumentFilters = {}) => ["documents", filters] as const,
  folders: ["document-folders"] as const,
  detail: (id: number) => ["document", id] as const,
  lessons: (filters: LessonFilters = {}) => ["lessons", filters] as const,
  lesson: (id: number) => ["lesson", id] as const,
};

export function useDocuments(filters: DocumentFilters = {}) {
  return useQuery({ queryKey: documentKeys.list(filters), queryFn: () => fetchDocuments(filters) });
}

export function useFolders() {
  return useQuery({ queryKey: documentKeys.folders, queryFn: fetchFolders });
}

export function useDocument(id: number) {
  return useQuery({ queryKey: documentKeys.detail(id), queryFn: () => fetchDocument(id), enabled: id > 0 });
}

export function useLessons(filters: LessonFilters = {}) {
  return useQuery({ queryKey: documentKeys.lessons(filters), queryFn: () => fetchLessons(filters) });
}

export function useLesson(id: number) {
  return useQuery({ queryKey: documentKeys.lesson(id), queryFn: () => fetchLesson(id), enabled: id > 0 });
}

/** After a change: the documents and lessons listed again when next shown. */
export function refreshDocuments(queryClient: QueryClient) {
  return Promise.all(
    ["documents", "document-folders", "document", "lessons", "lesson"].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    ),
  );
}
