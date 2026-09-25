/**
 * Home — the comparison surface.
 *
 * Server-rendered so the client knows, before it paints, whether this
 * deployment can produce live data at all. That fact shapes the copy rather
 * than being discovered after a rider submits a route.
 */
import { CompareApp } from '@/ui/CompareApp';
import { shellProps } from './_lib/shell';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  return <CompareApp {...shellProps()} />;
}
