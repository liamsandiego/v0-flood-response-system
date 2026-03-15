export default function NotFound() {
  return (
    <div className="h-screen w-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="font-mono text-6xl font-bold text-white/20">404</h1>
        <p className="font-mono text-sm text-white/40">Page not found</p>
        <a
          href="/"
          className="inline-block font-mono text-xs text-emerald-400/60 hover:text-emerald-400 transition-colors"
        >
          Return to Mission Control
        </a>
      </div>
    </div>
  );
}
