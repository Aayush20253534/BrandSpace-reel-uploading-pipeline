"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "../lib/auth-client";

export function SignOutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const router = useRouter();
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          try {
            setError(false);
            const result = await authClient.signOut();
            if (result.error) throw new Error("Sign out failed");
            router.replace("/sign-in");
            router.refresh();
          } catch {
            setError(true);
          } finally {
            setPending(false);
          }
        }}
        className="cursor-pointer border-0 bg-transparent p-0 text-left text-[12px] font-semibold text-[#b9cbca] hover:text-white disabled:opacity-60"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-[#f4b6ae]">
          Sign out failed. Try again.
        </p>
      )}
    </div>
  );
}
