/**
 * Shared comparison.
 *
 * Resolves an opaque share id back to its route on the server, then hands the
 * route to the app, which immediately runs a FRESH comparison. A shared link
 * never carries prices — replaying an hour-old fare as though it were current
 * is the one thing this product must not do.
 */
import { notFound } from 'next/navigation';
import { getShareStore } from '@/db/shareStore';
import { isValidShareId } from '@/domain/share';
import { CompareApp } from '@/ui/CompareApp';
import { shellProps } from '../../_lib/shell';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Shared route — RideLens',
  description: 'Compare live ride prices for a shared route.',
  // A share link points at someone's route; keep it out of search indexes.
  robots: { index: false, follow: false },
};

export default async function SharedRoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidShareId(id)) notFound();

  const shared = await getShareStore().resolve(id);
  if (!shared) notFound();

  return (
    <CompareApp
      {...shellProps()}
      initialRoute={{
        pickup: {
          label: shared.pickup.formattedAddress || shared.pickup.name,
          suggestionId: null,
          coords: { lat: shared.pickup.lat, lng: shared.pickup.lng },
        },
        destination: {
          label: shared.destination.formattedAddress || shared.destination.name,
          suggestionId: null,
          coords: { lat: shared.destination.lat, lng: shared.destination.lng },
        },
      }}
    />
  );
}
