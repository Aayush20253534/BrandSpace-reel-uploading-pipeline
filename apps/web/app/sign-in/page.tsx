import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@forge/auth";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/dashboard");

  return (
    <main className="grid min-h-screen grid-cols-1 bg-[#f3f6f5] lg:grid-cols-[minmax(0,1.1fr)_minmax(400px,0.9fr)]">
      <div className="flex min-h-[260px] flex-col justify-between bg-[#14272d] p-8 text-white lg:p-12">
        <div className="forge-brand !p-0">
          <span className="forge-mark">F</span>
          BRANDSPACE FORGE
        </div>
        <div className="max-w-[560px] pb-3">
          <p className="mb-4 text-[11px] font-bold tracking-[0.2em] text-[#9acac3] uppercase">
            Content operations
          </p>
          <h1 className="m-0 text-[clamp(34px,4vw,58px)] leading-[1.05] font-semibold tracking-[-0.045em]">
            Every reel, from source to signal.
          </h1>
          <p className="mt-5 max-w-[470px] text-[14px] leading-7 text-[#b8cdca]">
            Review production, approvals, distribution and account health in one
            secure workspace.
          </p>
        </div>
        <p className="m-0 text-[11px] text-[#829d9a]">
          Internal operations · Authorized access only
        </p>
      </div>
      <div className="flex items-center justify-center px-6 py-12 lg:px-12">
        <section className="w-full max-w-[390px]">
          <p className="mb-3 text-[11px] font-bold tracking-[0.18em] text-[#0f6b64] uppercase">
            Secure workspace
          </p>
          <h2 className="m-0 text-[30px] font-semibold tracking-[-0.035em]">
            Welcome back
          </h2>
          <p className="mt-2 text-[13px] leading-6 text-[#607078]">
            Use your BrandSpace account to continue.
          </p>
          <SignInForm />
        </section>
      </div>
    </main>
  );
}
