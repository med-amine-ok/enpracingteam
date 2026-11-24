import { api } from "@/lib/api/client";
import { dataOf, ensureOk, send } from "@/lib/api/errors";
import { fetchAllPages } from "@/lib/api/pagination";
import type { components, operations } from "@/lib/api/schema";
import { withSessionRefresh } from "@/lib/api/session";
import { saveBlob } from "@/lib/csv";

type Schemas = components["schemas"];

export type DocumentItem = Schemas["Document"];
export type DocumentDetail = Schemas["DocumentDetail"];
export type DocumentVersion = Schemas["DocumentVersion"];
export type DocumentType = Schemas["DocumentTypeEnum"];
export type Folder = Schemas["Folder"];
export type KnowledgeCategory = Schemas["KnowledgeCategoryEnum"];
export type DocumentChange = Schemas["PatchedDocumentWriteRequest"];
export type Lesson = Schemas["Lesson"];
export type LessonWrite = Schemas["LessonRequest"];
export type LessonChange = Schemas["PatchedLessonRequest"];
export type DocumentFilters = Omit<NonNullable<operations["documents_list"]["parameters"]["query"]>, "page">;
export type LessonFilters = Omit<NonNullable<operations["lessons_list"]["parameters"]["query"]>, "page">;

export const DOCUMENT_TYPES: DocumentType[] = [
  "technical_doc",
  "report",
  "procedure",
  "tutorial",
  "cad",
  "drawing",
  "admin",
  "faq",
  "media",
  "other",
];
export const CATEGORIES: KnowledgeCategory[] = [
  "team_management",
  "mechanical",
  "electronics",
  "aerodynamics",
  "software",
  "manufacturing",
  "sponsoring",
  "competition",
  "administration",
  "previous_projects",
];
/** What the API accepts (backend/apps/documents/workflow.py ALLOWED_EXTENSIONS). */
export const ACCEPTED_FILES =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.csv,.md,.png,.jpg,.jpeg,.gif,.webp,.heic,.mp4,.mov," +
  ".sldprt,.sldasm,.slddrw,.step,.stp,.iges,.igs,.stl,.dxf,.dwg,.f3d,.ipt,.iam,.zip,.7z,.rar";

/** An API call with the session renewed if needed, a network failure becoming ApiError(0). */
function call<T extends { response: Response }>(request: () => Promise<T>) {
  return send(() => withSessionRefresh(request));
}

// --- Documents ---

export function fetchDocuments(query: DocumentFilters = {}) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/documents/", { params: { query: { ...query, page } } }))),
  );
}

/** The folders of the files the viewer sees: department, project, season, with how many files. */
export async function fetchFolders() {
  return dataOf(await call(() => api.GET("/api/documents/folders/")));
}

export async function fetchDocument(id: number) {
  return dataOf(await call(() => api.GET("/api/documents/{id}/", { params: { path: { id } } })));
}

export type NewDocument = {
  title: string;
  description: string;
  type: DocumentType;
  category: KnowledgeCategory | "";
  org_unit_id: number | null;
  project_id: number | null;
  subsystem_id: number | null;
  season: number;
  file: File;
  note: string;
};

/** A document with its first file, sent as a form (multipart): the browser sets its boundary. */
export async function createDocument(fields: NewDocument) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) {
      continue;
    }
    form.append(key, value instanceof File ? value : String(value));
  }
  return dataOf(await call(() => api.POST("/api/documents/", { body: form as never })));
}

export async function updateDocument(id: number, body: DocumentChange) {
  return dataOf(await call(() => api.PATCH("/api/documents/{id}/", { params: { path: { id } }, body })));
}

export async function deleteDocument(id: number) {
  ensureOk(await call(() => api.DELETE("/api/documents/{id}/", { params: { path: { id } } })));
}

/** A new version: it becomes the current one at once (nothing is reviewed since decision D-020). */
export async function uploadVersion(id: number, file: File, note: string) {
  const form = new FormData();
  form.append("file", file);
  form.append("note", note);
  return dataOf(
    await call(() => api.POST("/api/documents/{id}/versions/", { params: { path: { id } }, body: form as never })),
  );
}

/** A version's file, fetched with the session, then saved by the browser under its own name. */
export async function downloadVersion(id: number, version: DocumentVersion) {
  const blob = dataOf(
    await call(() =>
      api.GET("/api/documents/{id}/versions/{version_id}/download/", {
        params: { path: { id, version_id: version.id } },
        parseAs: "blob",
      }),
    ),
  ) as unknown as Blob;
  saveBlob(blob, version.file_name);
}

// --- Lessons learned ---

export function fetchLessons(query: LessonFilters = {}) {
  return fetchAllPages(async (page) =>
    dataOf(await call(() => api.GET("/api/lessons/", { params: { query: { ...query, page } } }))),
  );
}

export async function fetchLesson(id: number) {
  return dataOf(await call(() => api.GET("/api/lessons/{id}/", { params: { path: { id } } })));
}

export async function createLesson(body: LessonWrite) {
  return dataOf(await call(() => api.POST("/api/lessons/", { body })));
}

export async function updateLesson(id: number, body: LessonChange) {
  return dataOf(await call(() => api.PATCH("/api/lessons/{id}/", { params: { path: { id } }, body })));
}

export async function deleteLesson(id: number) {
  ensureOk(await call(() => api.DELETE("/api/lessons/{id}/", { params: { path: { id } } })));
}
