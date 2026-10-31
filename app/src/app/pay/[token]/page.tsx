import { PayClient } from "@/components/PayClient";
import { Shell } from "@/components/Shell";

export const metadata = { title: "Pay · GROWW" };
export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Shell><PayClient token={token} /></Shell>;
}
