import ToneGenerator from "@/components/tone-generator";
import QCStatus from "@/components/qc-status";
import { getToneProviderLabel } from "@/lib/tone-provider";
import { Guitar } from "lucide-react";

export default function Home() {
  const modelName = getToneProviderLabel();

  return (
    <main className="flex-1 flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800/50 bg-zinc-950/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-zinc-700 to-zinc-800 border border-zinc-600/30 flex items-center justify-center">
              <Guitar className="w-4 h-4 text-zinc-300" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-zinc-100 leading-none">
                QC Tone Architect
              </h1>
              <p className="text-[10px] text-zinc-400 mt-0.5 uppercase tracking-wider">
                Quad Cortex AI Tone Designer
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <QCStatus />
            <span className="px-2 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400">
              {modelName}
            </span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-8">
        <div className="mb-8">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3 tracking-tight">
            Design your sound
          </h2>
          <p className="text-sm text-zinc-400 max-w-xl leading-relaxed">
            Describe the sound you&apos;re after — an instrument, artist, genre,
            song, or just vibes — and get a complete Quad Cortex signal chain
            with amp, cab, effects, and parameter settings.
          </p>
        </div>

        <ToneGenerator />
      </div>

      {/* Footer */}
      <footer className="border-t border-zinc-800/30 py-4">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center justify-between text-[10px] text-zinc-400">
          <span>Independent project · not affiliated with Neural DSP.</span>
          <span>Model: {modelName}</span>
        </div>
      </footer>
    </main>
  );
}
