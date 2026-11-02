"use client";
import { useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, SubmitButton, errorFor } from "@/components/form";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type Role, type UserStatus } from "@/lib/auth/roles";
import type { ActionResult } from "@/lib/auth/session";
import {
  assignProject, createUser, resetUserAccess, setUserStatus, unassignProject, updateUser,
} from "../actions";
import { assignListing, unassignListing } from "../../listings/actions";

type State = ActionResult | null;

function Toggle({ name, label, hint, defaultChecked }: { name: string; label: string; hint: string; defaultChecked: boolean }) {
  return (
    <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-1 size-5 accent-[hsl(var(--primary))]" />
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="block text-sm text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

interface UserValues {
  first_name: string; last_name: string; job_title: string | null; role: Role;
  can_download: boolean; can_use_ai: boolean; max_videos_per_month: number | null; max_ai_generations_per_month: number | null;
}

function UserFields({
  state, roles, values, showLimits, onRoleChange, downloadDefault,
}: {
  state: State; roles: Role[]; values?: UserValues; showLimits: boolean;
  onRoleChange?: (role: Role) => void; downloadDefault?: boolean;
}) {
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="First name" htmlFor="first_name" error={errorFor(state, "first_name")}>
          <Input name="first_name" defaultValue={values?.first_name ?? ""} autoComplete="off" required />
        </Field>
        <Field label="Last name" htmlFor="last_name" error={errorFor(state, "last_name")}>
          <Input name="last_name" defaultValue={values?.last_name ?? ""} autoComplete="off" required />
        </Field>
        <Field label="Job title" htmlFor="job_title" optional error={errorFor(state, "job_title")}>
          <Input name="job_title" defaultValue={values?.job_title ?? ""} placeholder="e.g. Listing agent" />
        </Field>
        <Field label="Role" htmlFor="role" error={errorFor(state, "role")}>
          <NativeSelect name="role" defaultValue={values?.role ?? "editor"} onChange={(e) => onRoleChange?.(e.target.value as Role)}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]} — {ROLE_DESCRIPTIONS[r]}</option>)}
          </NativeSelect>
        </Field>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-base font-semibold">Permissions</legend>
        <Toggle
          key={`dl-${String(downloadDefault)}`}
          name="can_download" label="Can download videos" hint="Download finished videos of projects they can see."
          defaultChecked={values?.can_download ?? downloadDefault ?? true}
        />
        <Toggle name="can_use_ai" label="Can use AI features" hint="AI camera moves and AI photo effects (Editors only)." defaultChecked={values?.can_use_ai ?? true} />
      </fieldset>
      {showLimits ? (
        <fieldset className="grid gap-5 sm:grid-cols-2">
          <legend className="mb-2 text-base font-semibold">Monthly limits <span className="font-normal text-muted-foreground">(optional — empty means no limit)</span></legend>
          <Field label="Videos per month" htmlFor="max_videos_per_month" error={errorFor(state, "max_videos_per_month")}>
            <Input name="max_videos_per_month" inputMode="numeric" defaultValue={values?.max_videos_per_month ?? ""} />
          </Field>
          <Field label="AI generations per month" htmlFor="max_ai_generations_per_month" error={errorFor(state, "max_ai_generations_per_month")}>
            <Input name="max_ai_generations_per_month" inputMode="numeric" defaultValue={values?.max_ai_generations_per_month ?? ""} />
          </Field>
        </fieldset>
      ) : (
        <>
          <input type="hidden" name="max_videos_per_month" value={values?.max_videos_per_month ?? ""} />
          <input type="hidden" name="max_ai_generations_per_month" value={values?.max_ai_generations_per_month ?? ""} />
        </>
      )}
    </>
  );
}

export function CreateUserForm({ roles, advanced, viewersCanDownload }: { roles: Role[]; advanced: boolean; viewersCanDownload: boolean }) {
  const [state, action] = useActionState(createUser, null);
  const [role, setRole] = useState<Role>("editor");
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <FormMessage state={state} />
      <Field label="Work email" htmlFor="email" hint="They'll get a secure link to set their own password. We never email passwords." error={errorFor(state, "email")}>
        <Input name="email" type="email" autoComplete="off" required />
      </Field>
      <UserFields
        state={state} roles={roles} showLimits={advanced} onRoleChange={setRole}
        downloadDefault={role === "viewer" ? viewersCanDownload : true}
      />
      <SubmitButton size="lg" className="self-start" pendingText="Creating…">Create user and send invitation</SubmitButton>
    </form>
  );
}

export function EditUserForm({ userId, roles, values, advanced }: { userId: string; roles: Role[]; values: UserValues; advanced: boolean }) {
  const [state, action] = useActionState(updateUser, null);
  const options = roles.includes(values.role) ? roles : [values.role, ...roles];
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="user_id" value={userId} />
      <UserFields state={state} roles={options} values={values} showLimits={advanced || values.max_videos_per_month != null || values.max_ai_generations_per_month != null} />
      <SubmitButton size="lg" className="self-start">Save changes</SubmitButton>
    </form>
  );
}

const STATUS_BUTTON: Record<"active" | "suspended" | "deactivated", { label: string; confirm: string; variant: "default" | "outline" | "destructive" }> = {
  active: { label: "Activate", confirm: "Let this person sign in again?", variant: "default" },
  suspended: { label: "Suspend", confirm: "Suspend this account? They will lose access right away. You can activate them again later.", variant: "outline" },
  deactivated: { label: "Deactivate", confirm: "Deactivate this account? Use this when someone leaves. Only the Super Admin can restore it.", variant: "destructive" },
};

export function StatusButtons({ userId, options }: { userId: string; options: ("active" | "suspended" | "deactivated")[] }) {
  const [state, action] = useActionState(setUserStatus, null);
  return (
    <div className="flex flex-col gap-3">
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-3">
        {options.map((s) => (
          <form
            key={s}
            action={action}
            onSubmit={(e) => { if (!window.confirm(STATUS_BUTTON[s].confirm)) e.preventDefault(); }}
          >
            <input type="hidden" name="user_id" value={userId} />
            <input type="hidden" name="status" value={s} />
            <SubmitButton variant={STATUS_BUTTON[s].variant} pendingText="Saving…">{STATUS_BUTTON[s].label}</SubmitButton>
          </form>
        ))}
      </div>
    </div>
  );
}

export function ResetAccessButton({ userId, disabled }: { userId: string; disabled: boolean }) {
  const [state, action] = useActionState(resetUserAccess, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <input type="hidden" name="user_id" value={userId} />
      <SubmitButton variant="outline" className="self-start" disabled={disabled} pendingText="Sending…">Send a new password link</SubmitButton>
    </form>
  );
}

export function AssignProjectForm({ userId, projects, viewerOnly }: { userId: string; projects: { id: string; title: string }[]; viewerOnly: boolean }) {
  const [state, action] = useActionState(assignProject, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="user_id" value={userId} />
      <div className="grid gap-4 sm:grid-cols-[1fr_200px_auto] sm:items-end">
        <Field label="Project" htmlFor="project_id" error={errorFor(state, "project_id")}>
          <NativeSelect name="project_id" defaultValue="">
            <option value="" disabled>Choose a project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </NativeSelect>
        </Field>
        <Field label="They can" htmlFor="access">
          <NativeSelect name="access" defaultValue="viewer" disabled={viewerOnly}>
            <option value="viewer">View</option>
            {!viewerOnly ? <option value="editor">View and edit</option> : null}
          </NativeSelect>
        </Field>
        {viewerOnly ? <input type="hidden" name="access" value="viewer" /> : null}
        <SubmitButton pendingText="Assigning…">Assign project</SubmitButton>
      </div>
    </form>
  );
}

export function UnassignButton({ userId, projectId }: { userId: string; projectId: string }) {
  const [state, action] = useActionState(unassignProject, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="project_id" value={projectId} />
      <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:text-destructive">Remove</Button>
      {state && !state.ok ? <span className="text-sm text-destructive">{state.message}</span> : null}
    </form>
  );
}

export function AssignListingForm({ userId, listings, viewerOnly }: { userId: string; listings: { id: string; label: string }[]; viewerOnly: boolean }) {
  const [state, action] = useActionState(assignListing, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="user_id" value={userId} />
      <div className="grid gap-4 sm:grid-cols-[1fr_200px_auto] sm:items-end">
        <Field label="Listing" htmlFor="listing_id" error={errorFor(state, "listing_id")}>
          <NativeSelect name="listing_id" defaultValue="">
            <option value="" disabled>Choose a listing…</option>
            {listings.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </NativeSelect>
        </Field>
        <Field label="They can" htmlFor="listing_access">
          <NativeSelect id="listing_access" name="access" defaultValue="viewer" disabled={viewerOnly}>
            <option value="viewer">View</option>
            {!viewerOnly ? <option value="editor">View and edit</option> : null}
          </NativeSelect>
        </Field>
        {viewerOnly ? <input type="hidden" name="access" value="viewer" /> : null}
        <SubmitButton pendingText="Assigning…">Assign listing</SubmitButton>
      </div>
    </form>
  );
}

export function UnassignListingButton({ userId, listingId }: { userId: string; listingId: string }) {
  const [state, action] = useActionState(unassignListing, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="listing_id" value={listingId} />
      <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:text-destructive">Remove</Button>
      {state && !state.ok ? <span className="text-sm text-destructive">{state.message}</span> : null}
    </form>
  );
}

export type { UserStatus };
