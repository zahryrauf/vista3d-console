export type SegmentMode = "all" | "classes";

export type JobStatus = "idle" | "running" | "done" | "error";

export interface LogLine {
  time: string;
  text: string;
  tone?: "muted" | "accent" | "warn" | "danger";
}
