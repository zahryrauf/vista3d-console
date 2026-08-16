"use client";

import {
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Viewer, { ViewerHandle } from "@/components/Viewer";
import { JobStatus, LogLine, SegmentMode } from "@/lib/types";

const SAMPLE_IMAGE_URL = "https://assets.ngc.nvidia.com/products/api-catalog/vista3d/example-1.nii.gz";

function timestamp() {
  return new Date().toLocaleTimeString([], { hour12: false });
}

function normalizeClientVolumeUrl(rawUrl: string): string {
  const url = rawUrl.trim();
  const githubBlobMatch = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/,
  );
  if (githubBlobMatch) {
    const [, user, repo, branch, path] = githubBlobMatch;
    return `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${path}`;
  }
  const gitlabBlobMatch = url.match(
    /^https?:\/\/gitlab\.com\/([^/]+)\/([^/]+)\/-\/blob\/([^/]+)\/(.+)$/,
  );
  if (gitlabBlobMatch) {
    const [, user, repo, branch, path] = gitlabBlobMatch;
    return `https://gitlab.com/${user}/${repo}/-/raw/${branch}/${path}`;
  }
  return url;
}

function isAllowedDomain(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    return (
      host === "assets.ngc.nvidia.com" ||
      host.endsWith(".blob.vercel-storage.com") ||
      host.endsWith(".blob.core.windows.net") ||
      host.endsWith(".amazonaws.com") ||
      host.endsWith(".googleapis.com")
    );
  } catch {
    return false;
  }
}

export default function HomeClient() {
  const [mounted, setMounted] = useState(false);
  const [keyStatus, setKeyStatus] = useState<"checking" | "ready" | "missing">("checking");
  const [imageUrl, setImageUrl] = useState("");
  const [mode, setMode] = useState<SegmentMode>("all");
  const [allLabels, setAllLabels] = useState<string[]>([]);
  const [labelSource, setLabelSource] = useState<"static">("static");
  const [classFilter, setClassFilter] = useState("");
  const [selectedClasses, setSelectedClasses] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<JobStatus>("idle");
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([
    {
      time: "--:--:--",
      text: "Console ready. Add your NVIDIA API key to start segmenting volumes.",
      tone: "muted",
    },
  ]);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const resultUrlRef = useRef<string | null>(null);
  const overlayUrlRef = useRef<string | null>(null);
  const viewerRef = useRef<ViewerHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function log(text: string, tone?: LogLine["tone"]) {
    setLogs((prev) => [...prev.slice(-199), { time: timestamp(), text, tone }]);
  }

  function revokeUrl(ref: MutableRefObject<string | null>) {
    if (ref.current) {
      URL.revokeObjectURL(ref.current);
      ref.current = null;
    }
  }

  const checkConnection = useCallback(async () => {
    setKeyStatus("checking");
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      setKeyStatus(data.ready ? "ready" : "missing");
      log(data.ready ? "NVIDIA API key detected." : data.error || "NVIDIA API key missing.", data.ready ? "accent" : "warn");
    } catch {
      setKeyStatus("missing");
      log("Could not check NVIDIA API key status.", "danger");
    }
  }, []);

  const loadLabels = useCallback(async () => {
    try {
      const res = await fetch("/api/labels");
      const data = await res.json();
      setAllLabels(data.labels || []);
      setLabelSource(data.source);
      log(`Loaded ${data.labels.length} supported labels.`, "accent");
    } catch {
      log("Could not load the label list.", "warn");
    }
  }, []);

  useEffect(() => {
    const mountTimer = window.setTimeout(() => {
      setMounted(true);
    }, 0);
    const timer = window.setTimeout(() => {
      void checkConnection();
      void loadLabels();
    }, 250);
    return () => {
      window.clearTimeout(mountTimer);
      window.clearTimeout(timer);
    };
  }, [checkConnection, loadLabels]);

  useEffect(
    () => () => {
      revokeUrl(resultUrlRef);
      revokeUrl(overlayUrlRef);
    },
    [],
  );

  const filteredLabels = useMemo(() => {
    const q = classFilter.trim().toLowerCase();
    if (!q) return allLabels;
    return allLabels.filter((l) => l.toLowerCase().includes(q));
  }, [allLabels, classFilter]);

  function toggleClass(label: string) {
    setSelectedClasses((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  async function handleUploadFile(file: File) {
    setUploadStatus("uploading");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/blob/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Upload failed (${res.status})`);
      }
      const data = await res.json();
      setImageUrl(data.url);
      setUploadedName(file.name);
      setUploadStatus("done");
      log(`Uploaded ${file.name} (${data.provider === "s3" ? "AWS S3" : "Storage"}).`, "accent");
    } catch (err) {
      setUploadStatus("error");
      log(err instanceof Error ? err.message : "Upload failed.", "danger");
    }
  }

  async function importExternalUrl(targetUrl: string): Promise<string> {
    log(`Detected external URL domain. Auto-importing and uploading to AWS S3 / Cloud storage...`, "muted");
    const res = await fetch("/api/blob/import-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: targetUrl }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Failed to auto-import volume from URL (${res.status})`);
    }

    const data = await res.json();
    setImageUrl(data.url);
    if (data.filename) {
      setUploadedName(data.filename);
    }
    log(`Auto-imported remote volume to ${data.provider === "s3" ? "AWS S3" : "Storage"} (${(data.size / (1024 * 1024)).toFixed(2)} MB).`, "accent");
    return data.url;
  }

  async function handleRun() {
    let activeUrl = normalizeClientVolumeUrl(imageUrl);
    if (!activeUrl) {
      log("Provide a URL to a NIfTI (.nii/.nii.gz) or NRRD volume first.", "warn");
      return;
    }
    if (mode === "classes" && selectedClasses.size === 0) {
      log("Select at least one anatomy class, or switch to \u201cAll labels\u201d.", "warn");
      return;
    }

    setStatus("running");
    revokeUrl(resultUrlRef);
    revokeUrl(overlayUrlRef);
    setResultUrl(null);
    viewerRef.current?.clear();

    // If URL is from an external domain, auto-import to Cloud storage first
    if (!isAllowedDomain(activeUrl)) {
      try {
        activeUrl = await importExternalUrl(activeUrl);
      } catch (err) {
        log(`Auto-import notice: ${err instanceof Error ? err.message : "Could not relay URL via S3"}. Proceeding directly...`, "warn");
      }
    }

    log(`Submitting inference request for ${activeUrl}`, "accent");
    if (mode === "classes") {
      log(`Class prompts: ${Array.from(selectedClasses).join(", ")}`, "muted");
    } else {
      log("Mode: segment all supported labels.", "muted");
    }

    try {
      const body = {
        image: activeUrl,
        ...(mode === "classes"
          ? { prompts: { classes: Array.from(selectedClasses) } }
          : {}),
      };

      const res = await fetch("/api/segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Inference failed (${res.status})`);
      }

      const resContentType = res.headers.get("content-type") || "";
      if (resContentType.includes("application/json")) {
        const jsonData = await res.json();
        log(`NVIDIA response: ${jsonData.message || "Inference success"}`, "accent");
        if (jsonData.note) {
          log(jsonData.note, "muted");
        }
        log("Rendering volume in 3D multiplanar viewer...", "muted");
        await viewerRef.current?.loadVolumes(activeUrl);
      } else {
        const niiBlob = await res.blob();
        const sizeStr =
          niiBlob.size < 1024 * 1024
            ? `${(niiBlob.size / 1024).toFixed(1)} KB`
            : `${(niiBlob.size / (1024 * 1024)).toFixed(2)} MB`;
        log(`Received segmentation mask (${sizeStr} gzip).`, "accent");

        const downloadUrl = URL.createObjectURL(niiBlob);
        const overlayBuffer = await niiBlob.arrayBuffer();
        resultUrlRef.current = downloadUrl;
        overlayUrlRef.current = null;
        setResultUrl(downloadUrl);

        log("Rendering segmentation overlay over the source volume...", "muted");
        await viewerRef.current?.loadVolumes(
          activeUrl,
          overlayBuffer,
          "vista3d-segmentation.nii.gz",
        );
      }

      setStatus("done");
      log("Done.", "accent");
    } catch (err) {
      setStatus("error");
      const message = err instanceof Error ? err.message : "Unknown error.";
      log(message, "danger");
    }
  }

  const toneClass: Record<NonNullable<LogLine["tone"]>, string> = {
    muted: "text-[var(--color-text-muted)]",
    accent: "text-[var(--color-accent)]",
    warn: "text-[var(--color-warn)]",
    danger: "text-[var(--color-danger)]",
  };

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center border-t border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-faint)]">
        <div className="font-[family-name:var(--font-mono)] text-xs tracking-wider">
          LOADING VISTA-3D CONSOLE
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="font-[family-name:var(--font-mono)] text-sm font-semibold tracking-[0.15em] text-[var(--color-text)]">
            VISTA&#8209;3D
          </h1>
          <span className="text-xs text-[var(--color-text-faint)]">
            interactive console &middot; NVIDIA NIM
          </span>
        </div>
        <div className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-xs">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              keyStatus === "ready"
                ? "bg-[var(--color-accent)]"
                : keyStatus === "checking"
                  ? "bg-[var(--color-warn)] pulse-dot"
                  : "bg-[var(--color-danger)]"
            }`}
          />
          <span className="text-[var(--color-text-muted)]">
            {keyStatus === "ready"
              ? "api key configured"
              : keyStatus === "checking"
                ? "checking\u2026"
                : "api key missing"}
          </span>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[380px_1fr]">
        <div className="flex flex-col gap-4 overflow-y-auto">
          {keyStatus === "missing" && (
            <Panel title="API key required">
              <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
                Add this to <span className="font-[family-name:var(--font-mono)]">.env.local</span> and restart the dev server:
              </p>
              <pre className="overflow-x-auto rounded-md border border-[var(--color-border)] bg-[var(--color-panel-raised)] px-3 py-2 font-[family-name:var(--font-mono)] text-xs text-[var(--color-accent)]">
{`NVIDIA_API_KEY=nvapi-...`}
              </pre>
              <p className="text-[11px] leading-relaxed text-[var(--color-text-faint)]">
                The key needs AI Foundation Models and Endpoints enabled in your NVIDIA API settings.
              </p>
            </Panel>
          )}

          <Panel title="Volume">
            <label className="text-xs text-[var(--color-text-muted)]">
              Image URL (NIfTI / NRRD or GitHub link)
            </label>
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://github.com/.../scan.nii.gz or https://.../scan.nii.gz"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-panel-raised)] px-2.5 py-1.5 font-[family-name:var(--font-mono)] text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            />
            <button
              onClick={() => setImageUrl(SAMPLE_IMAGE_URL)}
              className="self-start text-[11px] text-[var(--color-accent)] hover:underline"
            >
              use NVIDIA sample volume
            </button>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".nii,.nii.gz,.nrrd,application/gzip,application/octet-stream"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void handleUploadFile(file);
                  }
                  e.currentTarget.value = "";
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadStatus === "uploading"}
                className="self-start rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploadStatus === "uploading" ? "Uploading…" : "Upload local file"}
              </button>
              {uploadedName && (
                <span className="text-[11px] text-[var(--color-text-faint)]">
                  {uploadedName}
                </span>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--color-text-faint)]">
              External URLs (like GitHub links) and local uploads are automatically relayed via Blob storage to NVIDIA NIM.
            </p>
          </Panel>

          <Panel title="Segmentation mode">
            <div className="flex rounded-md border border-[var(--color-border)] p-0.5">
              {(["all", "classes"] as SegmentMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded px-2 py-1.5 text-xs transition-colors ${
                    mode === m
                      ? "bg-[var(--color-accent)] text-[#06110f] font-medium"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {m === "all" ? "All labels" : "Specific classes"}
                </button>
              ))}
            </div>

            {mode === "classes" && (
              <div className="flex flex-col gap-2">
                <input
                  value={classFilter}
                  onChange={(e) => setClassFilter(e.target.value)}
                  placeholder="Filter anatomy\u2026"
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-panel-raised)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                />
                <div className="flex max-h-52 flex-wrap gap-1.5 overflow-y-auto pr-1">
                  {filteredLabels.map((label) => {
                    const active = selectedClasses.has(label);
                    return (
                      <button
                        key={label}
                        onClick={() => toggleClass(label)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] capitalize transition-colors ${
                          active
                            ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                            : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                  {filteredLabels.length === 0 && (
                    <span className="text-[11px] text-[var(--color-text-faint)]">No matches.</span>
                  )}
                </div>
                <div className="flex items-center justify-between text-[11px] text-[var(--color-text-faint)]">
                  <span>
                    {selectedClasses.size} selected &middot; {labelSource}
                  </span>
                  {selectedClasses.size > 0 && (
                    <button
                      onClick={() => setSelectedClasses(new Set())}
                      className="hover:text-[var(--color-text-muted)]"
                    >
                      clear
                    </button>
                  )}
                </div>
              </div>
            )}
          </Panel>

          <button
            onClick={handleRun}
            disabled={status === "running" || keyStatus !== "ready"}
            className="rounded-md bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-[#06110f] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status === "running" ? "Running inference\u2026" : "Run segmentation"}
          </button>

          {resultUrl && (
            <a
              href={resultUrl}
              download="vista3d-segmentation.nii.gz"
              className="rounded-md border border-[var(--color-border-strong)] px-4 py-2 text-center text-xs text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            >
              Download segmentation
            </a>
          )}

          <Panel title="Log">
            <div className="flex max-h-56 flex-col gap-1 overflow-y-auto font-[family-name:var(--font-mono)] text-[11px] leading-relaxed">
              {logs.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <span className="shrink-0 text-[var(--color-text-faint)]">{l.time}</span>
                  <span className={l.tone ? toneClass[l.tone] : "text-[var(--color-text-muted)]"}>
                    {l.text}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="flex min-h-[420px] flex-col gap-3">
          <div className="flex-1">
            <Viewer ref={viewerRef} processing={status === "running"} />
          </div>
          <p className="text-[11px] text-[var(--color-text-faint)]">
            The overlay renders entirely in your browser via WebGL. If the source volume fails to
            load here, it&rsquo;s usually because its host doesn&rsquo;t allow cross-origin
            requests &mdash; the download link above always works regardless.
          </p>
        </div>
      </main>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-3.5">
      <h2 className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">
        {title}
      </h2>
      {children}
    </section>
  );
}
