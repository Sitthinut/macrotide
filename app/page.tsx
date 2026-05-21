import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ClientApp from "@/components/ClientApp";
import { DemoBanner } from "@/components/DemoBanner";
import { DEMO_COOKIE } from "@/lib/api/with-db";
import { getSessionUser, isAuthRequired } from "@/lib/auth/session";

export default async function Home() {
  const store = await cookies();
  const isDemo = !!store.get(DEMO_COOKIE)?.value;

  // Three modes:
  //  - AUTH_REQUIRED unset: open access (single-user / dev). Render directly.
  //  - AUTH_REQUIRED=1 + valid session cookie: render as the owner.
  //  - AUTH_REQUIRED=1 + valid demo cookie: render as a demo session.
  //  - AUTH_REQUIRED=1 + neither: bounce to /onboarding.
  if (isAuthRequired() && !isDemo) {
    const user = await getSessionUser();
    if (!user) redirect("/onboarding");
  }

  return (
    <>
      {isDemo && <DemoBanner />}
      <ClientApp />
    </>
  );
}
