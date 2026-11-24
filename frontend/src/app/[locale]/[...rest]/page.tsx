import { notFound } from "next/navigation";

// Any unknown address under a language (/fr/unknown) shows the translated "page not found".
export default function UnknownPage() {
  notFound();
}
