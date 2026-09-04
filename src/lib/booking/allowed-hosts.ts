const ALLOWED_HOSTS = new Set([
  "m.uber.com",
  "uber.com",
  "www.uber.com",
  "lyft.com",
  "www.lyft.com",
  "ride.lyft.com",
  "gocurb.com",
  "www.gocurb.com",
  "app.gocurb.com",
  "curb.app.link",
  "rideempower.com",
  "www.rideempower.com",
  "apps.apple.com",
  "play.google.com",
]);

export function isAllowedBookingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export function assertAllowlistedUrl(url: string): string {
  if (!isAllowedBookingUrl(url)) {
    throw new Error(`Booking URL host not allowlisted: ${url}`);
  }
  return url;
}
