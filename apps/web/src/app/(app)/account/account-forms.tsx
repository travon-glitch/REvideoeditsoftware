"use client";
import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Field, FormMessage, SubmitButton, errorFor } from "@/components/form";
import { saveProfile, setPassword } from "./actions";

export function ProfileForm({ firstName, lastName }: { firstName: string; lastName: string }) {
  const [state, action] = useActionState(saveProfile, null);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="First name" htmlFor="first_name" error={errorFor(state, "first_name")}>
          <Input name="first_name" defaultValue={firstName} autoComplete="given-name" required />
        </Field>
        <Field label="Last name" htmlFor="last_name" error={errorFor(state, "last_name")}>
          <Input name="last_name" defaultValue={lastName} autoComplete="family-name" required />
        </Field>
      </div>
      <SubmitButton size="lg" className="self-start">Save</SubmitButton>
    </form>
  );
}

export function PasswordForm({ submitLabel = "Save new password" }: { submitLabel?: string }) {
  const [state, action] = useActionState(setPassword, null);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <Field label="New password" htmlFor="password" hint="At least 12 characters, with upper- and lowercase letters and a number." error={errorFor(state, "password")}>
        <Input name="password" type="password" autoComplete="new-password" required />
      </Field>
      <Field label="Type it again" htmlFor="confirm" error={errorFor(state, "confirm")}>
        <Input name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <SubmitButton size="lg" className="self-start" pendingText="Saving…">{submitLabel}</SubmitButton>
    </form>
  );
}
