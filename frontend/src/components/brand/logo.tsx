import Image from "next/image";
import { cn } from "@/lib/utils";

/** The team's red "R" (public/racing/logo-mark.webp, cut from its logo; decision D-022). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/racing/logo-mark.webp"
      alt=""
      aria-hidden="true"
      width={256}
      height={131}
      className={cn("h-auto w-10", className)}
    />
  );
}

type LogoProps = {
  /** "light" on a dark background. */
  tone?: "dark" | "light";
  className?: string;
};

/** The red "R" and the name, in a line: the side menu, small screens. */
export function Logo({ tone = "dark", className }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className="w-11 shrink-0" />
      <span className="leading-none" dir="ltr">
        <span
          className={cn(
            "block font-display text-lg font-extrabold tracking-wider uppercase",
            tone === "light" ? "text-white" : "text-navy",
          )}
        >
          ENP Racing
        </span>
        <span
          className={cn(
            "mt-0.5 block text-2xs font-semibold tracking-[0.3em] uppercase",
            tone === "light" ? "text-white/50" : "text-muted",
          )}
        >
          ERP
        </span>
      </span>
    </span>
  );
}

/** The team's whole logo, the "R" over "ENP Racing Team": the login page. */
export function LogoFull({ tone = "dark", className }: LogoProps) {
  return (
    <Image
      src={tone === "light" ? "/racing/logo-on-dark.webp" : "/racing/logo-on-light.webp"}
      alt="ENP Racing Team"
      width={600}
      height={tone === "light" ? 475 : 459}
      priority
      className={cn("h-auto w-36", className)}
    />
  );
}
