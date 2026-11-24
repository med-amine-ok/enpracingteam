import { initials } from "@/lib/initials";
import { cn } from "@/lib/utils";

const sizes = {
  sm: "size-8 text-2xs",
  md: "size-10 text-xs",
  lg: "size-16 text-lg",
};

// Colours that go with the brand; each member keeps the same one (chosen from their id).
const tones = ["bg-navy", "bg-navy-700", "bg-racing", "bg-[#2f6f8f]", "bg-[#5b4a8a]", "bg-success"];

type AvatarProps = {
  firstName: string;
  lastName: string;
  /** A stable number (the member's id) to pick the colour. */
  seed?: number;
  size?: keyof typeof sizes;
  className?: string;
};

/** Initials in a circle. Decorative: the name is always written next to it. */
export function Avatar({ firstName, lastName, seed = 0, size = "md", className }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold text-white",
        tones[Math.abs(seed) % tones.length],
        sizes[size],
        className,
      )}
    >
      {initials(firstName, lastName)}
    </span>
  );
}
