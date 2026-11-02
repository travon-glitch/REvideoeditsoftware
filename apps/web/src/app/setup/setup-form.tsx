"use client";
import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Field, FormMessage, SubmitButton, errorFor } from "@/components/form";
import { completeSetup } from "./actions";

export function SetupForm() {
  const [state, action] = useActionState(completeSetup, null);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <Field label="One-time setup code" htmlFor="code" hint="Printed by the setup command on the server. It works once and expires after 60 minutes." error={errorFor(state, "code")}>
        <Input name="code" autoComplete="off" spellCheck={false} placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" className="font-mono uppercase" required />
      </Field>
      <Field label="Company name" htmlFor="companyName" error={errorFor(state, "companyName")}>
        <Input name="companyName" autoComplete="organization" required />
      </Field>
      <Field label="Your name" htmlFor="fullName" error={errorFor(state, "fullName")}>
        <Input name="fullName" autoComplete="name" required />
      </Field>
      <Field label="Your work email" htmlFor="email" error={errorFor(state, "email")}>
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Choose a password" htmlFor="password" hint="At least 12 characters, with upper- and lowercase letters and a number." error={errorFor(state, "password")}>
        <Input name="password" type="password" autoComplete="new-password" required />
      </Field>
      <Field label="Type the password again" htmlFor="confirm" error={errorFor(state, "confirm")}>
        <Input name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <SubmitButton size="lg" className="w-full" pendingText="Setting up…">Create Super Admin account</SubmitButton>
    </form>
  );
}
