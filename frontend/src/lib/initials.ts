/** "Amine Ouali" → "AO": shown in the avatar circle. */
export function initials(firstName: string, lastName: string) {
  return [firstName, lastName]
    .map((name) => Array.from(name.trim())[0] ?? "")
    .join("")
    .toUpperCase();
}
