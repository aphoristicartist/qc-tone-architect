"use client";

import { type ToneBlock } from "@/lib/types";
import { getDeviceById } from "@/lib/devices";
import {
  Zap,
  Speaker,
  Music,
  Timer,
  Waves,
  Disc3,
  Gauge,
  SlidersHorizontal,
  ArrowUpDown,
  Radio,
  ShieldOff,
  Box,
} from "lucide-react";

const CATEGORY_COLORS: Record<string, string> = {
  amp: "from-orange-500/20 to-orange-600/10 border-orange-500/40 text-orange-300",
  cab: "from-stone-500/20 to-stone-600/10 border-stone-500/40 text-stone-300",
  drive: "from-red-500/20 to-red-600/10 border-red-500/40 text-red-300",
  delay: "from-blue-500/20 to-blue-600/10 border-blue-500/40 text-blue-300",
  reverb: "from-purple-500/20 to-purple-600/10 border-purple-500/40 text-purple-300",
  modulation: "from-cyan-500/20 to-cyan-600/10 border-cyan-500/40 text-cyan-300",
  compressor: "from-yellow-500/20 to-yellow-600/10 border-yellow-500/40 text-yellow-300",
  eq: "from-green-500/20 to-green-600/10 border-green-500/40 text-green-300",
  pitch: "from-pink-500/20 to-pink-600/10 border-pink-500/40 text-pink-300",
  wah: "from-amber-500/20 to-amber-600/10 border-amber-500/40 text-amber-300",
  gate: "from-zinc-500/20 to-zinc-600/10 border-zinc-500/40 text-zinc-300",
  utility: "from-gray-500/20 to-gray-600/10 border-gray-500/40 text-gray-300",
};

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  amp: Zap,
  cab: Speaker,
  drive: Music,
  delay: Timer,
  reverb: Waves,
  modulation: Disc3,
  compressor: Gauge,
  eq: SlidersHorizontal,
  pitch: ArrowUpDown,
  wah: Radio,
  gate: ShieldOff,
  utility: Box,
};

function BlockCard({ block }: { block: ToneBlock }) {
  const device = getDeviceById(block.device_id);
  const category = device?.category || "utility";
  const colors = CATEGORY_COLORS[category] || CATEGORY_COLORS.utility;
  const Icon = CATEGORY_ICONS[category] || Box;

  const params = Object.entries(block.parameters);

  const formatValue = (value: string | number | boolean) => {
    if (typeof value === "boolean") return value ? "On" : "Off";
    return String(value);
  };

  return (
    <div
      className={`relative rounded-xl border bg-gradient-to-br ${colors} p-4 min-w-[180px] backdrop-blur-sm transition-all hover:scale-[1.02] hover:shadow-lg hover:shadow-black/20`}
    >
      {block.bypassed && (
        <div className="absolute inset-0 rounded-xl bg-black/60 flex items-center justify-center z-10">
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
            Bypassed
          </span>
        </div>
      )}

      <div className="flex items-start gap-2 mb-2">
        <Icon className="w-4 h-4 mt-0.5 shrink-0 opacity-70" />
        <div className="min-w-0">
          <h4 className="font-semibold text-sm leading-tight truncate">
            {block.device_name}
          </h4>
          <p className="text-[10px] uppercase tracking-wider opacity-50 mt-0.5">
            {category}
          </p>
        </div>
      </div>

      <p className="text-xs opacity-60 mb-3 line-clamp-2">{block.role}</p>

      {params.length > 0 && (
        <div className="space-y-1.5">
          {params.map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wider opacity-40 truncate">
                {key}
              </span>
              <span className="text-xs font-mono opacity-80">
                {formatValue(value)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="absolute top-2 right-2 text-[10px] font-mono opacity-30">
        {block.row}.{block.position}
      </div>
    </div>
  );
}

export default function SignalChain({ blocks }: { blocks: ToneBlock[] }) {
  const rows = new Map<number, ToneBlock[]>();
  for (const block of blocks) {
    const row = block.row || 1;
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row)!.push(block);
  }

  for (const [, rowBlocks] of rows) {
    rowBlocks.sort((a, b) => a.position - b.position);
  }

  const sortedRows = [...rows.entries()].sort(([a], [b]) => a - b);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-px flex-1 bg-gradient-to-r from-zinc-700 to-transparent" />
        <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">
          Signal Chain
        </span>
        <div className="h-px flex-1 bg-gradient-to-l from-zinc-700 to-transparent" />
      </div>

      {sortedRows.map(([rowNum, rowBlocks]) => (
        <div key={rowNum}>
          {sortedRows.length > 1 && (
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-2 pl-1">
              Row {rowNum}
            </div>
          )}
          <div
            className="flex items-stretch gap-3 overflow-x-auto pb-2 scrollbar-thin"
            role="region"
            aria-label={`Signal chain row ${rowNum}`}
            tabIndex={0}
          >
            {/* Input indicator */}
            <div className="flex items-center shrink-0">
              <div className="w-8 h-8 rounded-full border border-zinc-700 bg-zinc-800/50 flex items-center justify-center">
                <span className="text-[9px] text-zinc-400 font-mono">IN</span>
              </div>
              <div className="w-6 h-px bg-zinc-700" />
            </div>

            {rowBlocks.map((block, i) => (
              <div key={block.device_id + i} className="flex items-center shrink-0">
                <BlockCard block={block} />
                {i < rowBlocks.length - 1 && (
                  <div className="w-6 h-px bg-zinc-700 shrink-0" />
                )}
              </div>
            ))}

            {/* Output indicator */}
            <div className="flex items-center shrink-0">
              <div className="w-6 h-px bg-zinc-700" />
              <div className="w-8 h-8 rounded-full border border-zinc-700 bg-zinc-800/50 flex items-center justify-center">
                <span className="text-[9px] text-zinc-400 font-mono">OUT</span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
