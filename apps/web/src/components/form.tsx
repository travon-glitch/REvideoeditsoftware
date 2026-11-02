"use client";
import * as React from "react";
import { useFormStatus } from "react-dom";
import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ActionResult } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

/** Submit button that shows a spinner while the form is sending. */
export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
      {pending ? pendingText ?? "Saving…" : children}
    </Button>
  );
}

/** Label + control + help text + error message. */
export function Field({
  label, htmlFor, hint, error, children, className, optional,
}: {
  label: string; htmlFor: string; hint?: string; error?: string; children: React.ReactNode; className?: string; optional?: boolean;
}) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {optional ? <span className="ml-1 font-normal text-muted-foreground">(optional)</span> : null}
      </Label>
      {React.isValidElement<Record<string, unknown>>(children)
        ? React.cloneElement(children, {
            id: htmlFor,
            "aria-invalid": error ? true : undefined,
            "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined,
          })
        : children}
      {hint ? <p id={hintId} className="text-sm text-muted-foreground">{hint}</p> : null}
      {error ? <p id={errorId} className="text-sm font-medium text-destructive">{error}</p> : null}
    </div>
  );
}

/** Success or error banner for an action result. */
export function FormMessage({ state }: { state: ActionResult<unknown> | null | undefined }) {
  if (!state || (state.ok && !state.message)) return null;
  return (
    <Alert variant={state.ok ? "success" : "destructive"} aria-live="polite">
      {state.ok ? <CircleCheck aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
      <AlertDescription className="text-base">{state.message}</AlertDescription>
    </Alert>
  );
}

export function errorFor(state: ActionResult<unknown> | null | undefined, field: string): string | undefined {
  return state && !state.ok ? state.fieldErrors?.[field] : undefined;
}
