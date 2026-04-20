"use client";

type ProcessingStatus = "pending" | "processing" | "ready" | "failed";

interface ProcessingBadgeProps {
  status: ProcessingStatus;
}

const statusConfig: Record<ProcessingStatus, { classes: string; label: string }> = {
  pending: {
    classes: "bg-gray-100 text-gray-600",
    label: "Pending",
  },
  processing: {
    classes: "bg-blue-100 text-blue-700 animate-pulse",
    label: "Processing",
  },
  ready: {
    classes: "bg-green-100 text-green-700",
    label: "Ready",
  },
  failed: {
    classes: "bg-red-100 text-red-700",
    label: "Failed",
  },
};

export function ProcessingBadge({ status }: ProcessingBadgeProps) {
  const { classes, label } = statusConfig[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${classes}`}>
      {label}
    </span>
  );
}
