"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

function FieldGroup({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn("flex flex-col divide-y divide-border rounded-lg border border-border bg-background", className)}
      {...props}
    />
  );
}

function Field({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field"
      className={cn("flex items-center justify-between gap-4 px-4 py-4", className)}
      {...props}
    />
  );
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="field-label"
      className={cn("text-sm font-medium leading-none", className)}
      {...props}
    />
  );
}

function FieldDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn("text-xs text-muted-foreground mt-1", className)}
      {...props}
    />
  );
}

function FieldContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-content"
      className={cn("flex-1 min-w-0", className)}
      {...props}
    />
  );
}

export { FieldGroup, Field, FieldLabel, FieldDescription, FieldContent };
