import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { PIPELINE_STAGES, STATUS_ORDER, type Run } from "./types";

function ElapsedTimer({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    const start = new Date(startTime).getTime();
    const tick = () => {
      const diff = Math.floor((Date.now() - start) / 1000);
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setElapsed(`${m}:${s.toString().padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime]);

  return <span className="font-mono text-lg text-muted-foreground">{elapsed}</span>;
}

export function ProgressView({ run }: { run: Run }) {
  const currentIndex = STATUS_ORDER[run.status] ?? 0;

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        {/* Logo */}
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-8">Brandly</h1>

        {/* Pulsing ring */}
        <div className="relative mx-auto mb-8 h-24 w-24">
          <div className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
          <div className="absolute inset-2 animate-pulse rounded-full bg-primary/30" />
          <div className="absolute inset-4 flex items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </div>

        {/* Current step */}
        <p className="text-lg font-medium text-foreground mb-2">
          {run.current_step || "Starting..."}
        </p>
        <ElapsedTimer startTime={run.created_at} />

        {/* Vertical stepper */}
        <div className="mt-10 space-y-0 text-left mx-auto max-w-xs">
          {PIPELINE_STAGES.map((stage, i) => {
            const done = currentIndex > i;
            const active = currentIndex === i;
            return (
              <div key={stage.key} className="flex items-start gap-3 relative">
                {/* Line */}
                {i < PIPELINE_STAGES.length - 1 && (
                  <div
                    className={`absolute left-[13px] top-7 w-0.5 h-6 ${
                      done ? "bg-primary" : "bg-border"
                    }`}
                  />
                )}
                {/* Circle */}
                <div
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                    done
                      ? "border-primary bg-primary text-primary-foreground"
                      : active
                      ? "border-primary bg-background text-primary"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  {done ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <span className="text-xs font-medium">{i + 1}</span>
                  )}
                </div>
                {/* Label */}
                <span
                  className={`pt-1 text-sm ${
                    done ? "text-foreground font-medium" : active ? "text-foreground font-medium" : "text-muted-foreground"
                  }`}
                >
                  {stage.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Safe to leave message */}
        <p className="mt-10 text-sm text-muted-foreground">
          You can safely leave this page. We'll save your results and they'll be waiting when you return.
        </p>

        <Link
          to="/dashboard"
          className="mt-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
