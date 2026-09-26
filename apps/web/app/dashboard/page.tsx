import { redirect } from "next/navigation";
import { DashboardShell } from "../../components/dashboard-shell";
import { OperatorView } from "../../components/operator-view";
import {
  getOperatorContext,
  operatorHref,
  type Query,
} from "../../lib/operator-context";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const query = await searchParams;
  const context = await getOperatorContext(query);
  if (context.membership?.role === "ANALYST") {
    redirect(
      operatorHref(
        "analytics",
        context.membership.organization.id,
        context.client?.id ?? null,
      ),
    );
  }
  return (
    <DashboardShell context={context} section="overview">
      <OperatorView context={context} section="overview" page={1} />
    </DashboardShell>
  );
}
