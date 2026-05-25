import { cookies } from "next/headers";
import ClientApp from "@/components/ClientApp";
import { DemoBanner } from "@/components/DemoBanner";
import Landing from "@/components/Landing";
import { DEMO_COOKIE } from "@/lib/api/with-db";
import { getSessionUser, isAuthRequired } from "@/lib/auth/session";

export default async function Home() {
  const store = await cookies();
  const isDemo = !!store.get(DEMO_COOKIE)?.value;

  // Four modes:
  //  - AUTH_DISABLED=1: open access (single-user / dev). Render directly.
  //  - auth required + valid session cookie: render as the owner.
  //  - auth required + valid demo cookie: render as a demo session.
  //  - auth required + neither: show the public landing page.
  if (isAuthRequired() && !isDemo) {
    const user = await getSessionUser();
    if (!user) return <Landing />;
  }

  return (
    <>
      {isDemo && <DemoBanner />}
      <ClientApp />
    </>
  );
}
