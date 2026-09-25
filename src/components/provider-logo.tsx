import Image from "next/image";

import type { ProviderId } from "@/lib/domain/types";

const KNOWN = new Set<ProviderId>(["uber", "lyft", "empower", "curb"]);

function slugFor(provider: ProviderId): string {
  return KNOWN.has(provider) ? provider : "other";
}

/**
 * A provider's brand mark.
 *
 * One source file per provider, at 256px, resized and re-encoded by next/image
 * — these are 8–25KB PNGs rendered at 24–40px, and a page shows five or six of
 * them. The repo previously carried three variants each (`-128`, `-256` and a
 * bare `.png` that was a byte-identical copy of the 256), of which the bare one
 * was referenced nowhere.
 *
 * width/height are always set, so the box is reserved before the bytes land and
 * nothing shifts. No `sizes`: on a fixed-size image it makes Next emit the full
 * device-width srcset — fifteen candidates up to 3840w for a 32px mark, on six
 * marks a page. Without it the srcset is just 1x and 2x.
 */
export function ProviderLogo({
  provider,
  size = 40,
  className,
  priority = false,
}: {
  provider: ProviderId;
  size?: 40 | 32 | 24;
  className?: string;
  priority?: boolean;
}) {
  const slug = slugFor(provider);
  const label = slug.charAt(0).toUpperCase() + slug.slice(1);

  return (
    <Image
      className={`provider-mark-img${className ? ` ${className}` : ""}`}
      style={{ ["--mark-size" as string]: `${size}px` }}
      src={`/providers/${slug}-256.png`}
      alt={`${label} logo`}
      width={size}
      height={size}
      priority={priority}
    />
  );
}
