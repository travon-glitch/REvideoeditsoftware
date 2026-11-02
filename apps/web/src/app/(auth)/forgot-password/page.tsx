"use client";
import { useActionState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, FormMessage, SubmitButton, errorFor } from "@/components/form";
import { requestPasswordReset } from "./actions";

export default function ForgotPasswordPage() {
  const [state, action] = useActionState(requestPasswordReset, null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Reset your password</CardTitle>
        <CardDescription>We&apos;ll email you a link to choose a new password.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-5" noValidate>
          <FormMessage state={state} />
          <Field label="Work email" htmlFor="email" error={errorFor(state, "email")}>
            <Input name="email" type="email" autoComplete="email" required />
          </Field>
          <SubmitButton size="lg" className="w-full" pendingText="Sending…">Send reset link</SubmitButton>
          <Link href="/login" className="text-center text-base font-medium text-primary hover:underline">Back to sign in</Link>
        </form>
      </CardContent>
    </Card>
  );
}
