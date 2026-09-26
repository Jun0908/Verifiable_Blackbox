import {SampleDashboard} from "@/components/sample-dashboard";
import {RoverPage} from "@/components/rover-page";
import {publicPreview} from "@/lib/public-preview";
export default async function Page({searchParams}: {searchParams: Promise<{job?:string|string[]}>}) {
 const {job}=await searchParams;
 return publicPreview || process.env.NEXT_PUBLIC_PRIVY_APP_ID || process.env.NEXT_PUBLIC_LOCAL_DEMO === "true"
  ? <RoverPage requestedJob={typeof job === "string" ? job : undefined} /> : <SampleDashboard rover />;
}
