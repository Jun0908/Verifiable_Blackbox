import {SampleDashboard} from "@/components/sample-dashboard";
import {DemoDashboard} from "@/components/demo-dashboard";
import {publicPreview} from "@/lib/public-preview";
export default function Home() {
  return publicPreview || process.env.NEXT_PUBLIC_PRIVY_APP_ID || process.env.NEXT_PUBLIC_LOCAL_DEMO === "true"
    ? <DemoDashboard />
    : <SampleDashboard />;
}
