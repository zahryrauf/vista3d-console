"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Niivue, SLICE_TYPE } from "@niivue/niivue";

export interface ViewerHandle {
  loadVolumes: (
    imageUrl: string,
    overlayBuffer?: ArrayBuffer,
    overlayName?: string,
  ) => Promise<void>;
  clear: () => void;
}

interface ViewerProps {
  processing?: boolean;
}

const Viewer = forwardRef<ViewerHandle, ViewerProps>(function Viewer({ processing }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nvRef = useRef<Niivue | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const nv = new Niivue({
      backColor: [0.039, 0.047, 0.055, 1],
      show3Dcrosshair: true,
      isColorbar: false,
    });
    nvRef.current = nv;
    if (canvasRef.current) {
      nv.attachToCanvas(canvasRef.current).then(() => {
        nv.setSliceType(SLICE_TYPE.MULTIPLANAR);
      });
    }
    return () => {
      nvRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    async loadVolumes(imageUrl: string, overlayBuffer?: ArrayBuffer, overlayName?: string) {
      const nv = nvRef.current;
      if (!nv) return;
      setLoadError(null);
      setLoaded(false);
      try {
        const volumeList = [
          { url: imageUrl, colormap: "gray", opacity: 1 },
          ...(overlayBuffer
            ? [
                {
                  buffer: overlayBuffer,
                  name: overlayName ?? "vista3d-segmentation.nii.gz",
                  colormap: "actc",
                  opacity: 0.55,
                  colormapLabel: undefined,
                },
              ]
            : []),
        ];
        // Cast to any to satisfy TypeScript's stricter ImageFromUrlOptions definition
        await nv.loadVolumes(volumeList as any);
        nv.setSliceType(SLICE_TYPE.MULTIPLANAR);
        setLoaded(true);
      } catch (err) {
        setLoadError(
          err instanceof Error
            ? err.message
            : "Could not render the volume in-browser (it may not be CORS-accessible).",
        );
      }
    },
    clear() {
      nvRef.current?.volumes.forEach((v) => nvRef.current?.removeVolume(v));
      setLoaded(false);
      setLoadError(null);
    },
  }));

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-[var(--color-border)] bg-black">
      <canvas ref={canvasRef} className="h-full w-full" />

      {!loaded && !loadError && !processing && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--color-text-faint)]">
          <div className="font-[family-name:var(--font-mono)] text-xs tracking-wider">
            NO VOLUME LOADED
          </div>
          <div className="text-xs text-[var(--color-text-faint)]">
            Run a segmentation to preview it here
          </div>
        </div>
      )}

      {processing && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="scan-sweep absolute left-0 right-0 h-24 bg-gradient-to-b from-transparent via-[var(--color-accent)]/15 to-transparent" />
          <div className="absolute left-0 right-0 top-1/2 h-px bg-[var(--color-accent)]/40 scan-sweep" />
        </div>
      )}

      {loadError && (
        <div className="absolute inset-x-3 bottom-3 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 font-[family-name:var(--font-mono)] text-xs text-[var(--color-danger)]">
          {loadError}
        </div>
      )}
    </div>
  );
});

export default Viewer;
