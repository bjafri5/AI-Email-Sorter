"use client";

import { signIn } from "next-auth/react";
import { GoogleButton } from "@/components/google-button";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="mx-auto max-w-md space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold">AI Email Sorter</h1>
          <p className="text-gray-500">
            Sign in with Google to organize your emails with AI
          </p>
        </div>
        <GoogleButton
          className="w-full"
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
        >
          Sign in with Google
        </GoogleButton>
      </div>
    </div>
  );
}
