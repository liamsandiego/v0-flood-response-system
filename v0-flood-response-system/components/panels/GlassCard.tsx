// =============================================================================
// GlassCard — Reusable glassmorphism container for floating UI panels
// =============================================================================

import { type ReactNode } from "react";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  critical?: boolean;
}

export default function GlassCard({ children, className = "", critical = false }: GlassCardProps) {
  return (
    <div
      className={[
        "rounded-xl border backdrop-blur-xl shadow-2xl transition-all duration-500",
        critical
          ? "bg-red-950/60 border-red-500/40 shadow-red-500/20"
          : "bg-slate-900/60 border-white/10 shadow-black/40",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}
