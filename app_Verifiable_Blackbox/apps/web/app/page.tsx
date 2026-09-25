import {SampleDashboard} from "@/components/sample-dashboard";
import {DemoDashboard} from "@/components/demo-dashboard";
export default function Home() {
  return process.env.NEXT_PUBLIC_PRIVY_APP_ID || process.env.NEXT_PUBLIC_LOCAL_DEMO === "true"
    ? <DemoDashboard />
    : <SampleDashboard />;
}
