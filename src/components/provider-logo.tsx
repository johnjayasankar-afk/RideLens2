import type { ProviderId } from "@/lib/domain/types";

const KNOWN = new Set<ProviderId>(["uber", "lyft", "empower", "curb"]);

function slugFor(provider: ProviderId): string {
  return KNOWN.has(provider) ? provider : "other";
}

export function ProviderLogo({
  provider,
  size = 40,
  className,
}: {
  provider: ProviderId;
  size?: 40 | 32 | 24;
  className?: string;
}) {
  const slug = slugFor(provider);
  const label = slug.charAt(0).toUpperCase() + slug.slice(1);
  const src128 = `/providers/${slug}-128.png`;
  const src256 = `/providers/${slug}-256.png`;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- static App Store marks
    <img
      className={`provider-mark-img${className ? ` ${className}` : ""}`}
      style={{ ["--mark-size" as string]: `${size}px` }}
      src={size <= 32 ? src128 : src256}
      srcSet={`${src128} 128w, ${src256} 256w`}
      sizes={`${size}px`}
      alt={`${label} logo`}
      width={size}
      height={size}
      decoding="async"
      loading="lazy"
    />
  );
}
