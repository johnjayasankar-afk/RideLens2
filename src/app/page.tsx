import { CompareForm } from "@/components/compare-form";
import { getEnv, isProductionLiveCapable } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const env = getEnv();
  return (
    <div className="shell home">
      <CompareForm liveCapable={isProductionLiveCapable(env)} />
    </div>
  );
}
