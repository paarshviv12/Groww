import { DashboardClient } from "@/components/DashboardClient";
import { Shell } from "@/components/Shell";
export const metadata = { title: "Dashboard · GROWW" };
export default function DashboardPage() { return <Shell active="dashboard"><DashboardClient /></Shell>; }
