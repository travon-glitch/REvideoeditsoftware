"use client";
import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Field, FormMessage, SubmitButton, errorFor } from "@/components/form";
import { signIn } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signIn, null);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Work email" htmlFor="email" error={errorFor(state, "email")}>
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password" error={errorFor(state, "password")}>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton size="lg" className="w-full" pendingText="Signing in…">Sign in</SubmitButton>
      <Link href="/forgot-password" className="text-center text-base font-medium text-primary hover:underline">
        Forgot your password?
      </Link>
    </form>
  );
}
