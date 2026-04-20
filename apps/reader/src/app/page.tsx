import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#f4f1ec] text-[#1a1a1a] selection:bg-[#1a1a1a] selection:text-[#f4f1ec]">
      {/* Navigation */}
      <nav className="flex items-center justify-between px-8 py-6 lg:px-12">
        <div className="flex items-center gap-3">
          <div className="flex h-10 items-center gap-1.5 bg-[#1a1a1a] px-5 text-[#f4f1ec]">
            <span className="text-sm font-medium tracking-widest uppercase">
              Menu
            </span>
            <div className="flex flex-col gap-[3px] ml-2">
              <span className="block h-[1.5px] w-4 bg-[#f4f1ec]" />
              <span className="block h-[1.5px] w-4 bg-[#f4f1ec]" />
            </div>
          </div>
        </div>

        <span className="text-2xl font-bold tracking-tight italic hidden sm:block">
          inhale
        </span>

        <div className="hidden items-center gap-8 text-xs font-medium tracking-widest uppercase md:flex">
          <Link href="/library" className="cursor-pointer hover:opacity-60 transition-opacity">
            Library
          </Link>
          <span className="cursor-pointer hover:opacity-60 transition-opacity">
            Fields
          </span>
          <span className="cursor-pointer hover:opacity-60 transition-opacity">
            Collections
          </span>
        </div>
      </nav>

      {/* Main Grid */}
      <main className="px-8 lg:px-12">
        {/* Hero Section */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-px mt-4">
          {/* Left column */}
          <div className="lg:col-span-4 border-t border-[#1a1a1a]/15 pt-8 pb-12 lg:pr-10">
            <div className="mb-12">
              <p className="text-sm leading-relaxed max-w-[280px] text-[#1a1a1a]/70">
                A curated archive of breakthrough research across physics,
                biology, computer science, and mathematics.
              </p>
            </div>

            <div className="flex items-baseline gap-3 mb-2">
              <span className="text-5xl font-bold tracking-tighter">
                12K+
              </span>
              <span className="text-xs tracking-wide text-[#1a1a1a]/60 uppercase">
                papers indexed
              </span>
            </div>

            {/* Decorative cross */}
            <div className="mt-16 flex items-center gap-4">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                className="text-[#1a1a1a]/30"
              >
                <path d="M8 0v16M0 8h16" stroke="currentColor" strokeWidth="1" />
              </svg>
            </div>
          </div>

          {/* Center — oversized typography */}
          <div className="lg:col-span-4 border-t border-[#1a1a1a]/15 pt-8 flex flex-col items-center justify-center relative overflow-hidden min-h-[400px] lg:min-h-[520px]">
            {/* Large background letters */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
              <span className="text-[20rem] lg:text-[28rem] font-black leading-none text-[#1a1a1a] opacity-[0.06] tracking-tighter">
                in
              </span>
            </div>

            <div className="relative z-10 text-center">
              <h1 className="text-6xl sm:text-7xl lg:text-8xl font-black tracking-tighter leading-[0.85] uppercase">
                Inhale
                <br />
                <span className="text-[#1a1a1a]/20">Science</span>
              </h1>
              <Link href="/login" className="mt-8 inline-flex items-center gap-2 bg-[#1a1a1a] text-[#f4f1ec] px-6 py-3 text-sm font-medium tracking-wide hover:bg-[#333] transition-colors">
                Explore Papers
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  className="ml-1"
                >
                  <path
                    d="M1 13L13 1M13 1H4M13 1v9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
              </Link>
            </div>
          </div>

          {/* Right column */}
          <div className="lg:col-span-4 border-t border-[#1a1a1a]/15 pt-8 lg:pl-10">
            {/* Category navigation */}
            <div className="flex flex-col items-end gap-2 text-right mb-12">
              <span className="text-xs tracking-widest uppercase text-[#1a1a1a]/40">
                Physics
              </span>
              <span className="text-xs tracking-widest uppercase text-[#1a1a1a]/40">
                Biology
              </span>
              <span className="text-xs tracking-widest uppercase font-semibold text-[#1a1a1a] flex items-center gap-2">
                <svg
                  width="6"
                  height="6"
                  viewBox="0 0 6 6"
                  fill="currentColor"
                >
                  <polygon points="0,0 6,3 0,6" />
                </svg>
                Computer Science
              </span>
              <span className="text-xs tracking-widest uppercase text-[#1a1a1a]/40">
                Mathematics
              </span>
              <span className="text-xs tracking-widest uppercase text-[#1a1a1a]/40">
                Chemistry
              </span>
            </div>

            {/* Decorative circles */}
            <div className="flex items-center justify-end gap-2 mb-10">
              <div className="w-8 h-8 rounded-full border border-[#1a1a1a]/20 flex items-center justify-center">
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 8 8"
                  fill="none"
                >
                  <path
                    d="M4 0v8M0 4h8"
                    stroke="currentColor"
                    strokeWidth="0.8"
                    className="text-[#1a1a1a]/50"
                  />
                </svg>
              </div>
              <div className="w-8 h-8 rounded-full border border-[#1a1a1a]/20 flex items-center justify-center">
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 8 8"
                  fill="none"
                >
                  <path
                    d="M4 0v8M0 4h8"
                    stroke="currentColor"
                    strokeWidth="0.8"
                    className="text-[#1a1a1a]/50"
                  />
                </svg>
              </div>
              <div className="w-8 h-8 rounded-full border border-[#1a1a1a]/20 flex items-center justify-center">
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 8 8"
                  fill="none"
                >
                  <path
                    d="M4 0v8M0 4h8"
                    stroke="currentColor"
                    strokeWidth="0.8"
                    className="text-[#1a1a1a]/50"
                  />
                </svg>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold tracking-tight leading-tight mb-3">
                Peer-Reviewed
                <br />
                Research Archive
              </h2>
              <p className="text-sm leading-relaxed text-[#1a1a1a]/60 max-w-[300px] ml-auto text-right">
                Dive into a rigorously curated collection of papers spanning
                every major scientific discipline, from foundational theory to
                cutting-edge discovery.
              </p>
            </div>
          </div>
        </div>

        {/* Bottom Section — Featured / Recent */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-px mt-2 border-t border-[#1a1a1a]/15 pt-10 pb-16">
          {/* Left — large statement */}
          <div className="lg:col-span-5 pb-8 lg:pb-0 lg:pr-10">
            <h2 className="text-4xl sm:text-5xl font-black tracking-tighter leading-[0.95] uppercase">
              Step into the
              <br />
              frontier of
              <br />
              knowledge
            </h2>

            {/* Decorative cross */}
            <div className="mt-10 flex items-center gap-4">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                className="text-[#1a1a1a]/30"
              >
                <path d="M8 0v16M0 8h16" stroke="currentColor" strokeWidth="1" />
              </svg>
            </div>
          </div>

          {/* Right — paper cards */}
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Paper card */}
            <div className="group cursor-pointer">
              <div className="bg-[#1a1a1a] h-44 mb-4 flex items-end p-5 relative overflow-hidden">
                <div className="absolute top-4 right-4 text-[#f4f1ec]/30 text-xs tracking-widest uppercase">
                  2026
                </div>
                <span className="text-[#f4f1ec] text-lg font-bold tracking-tight leading-tight group-hover:opacity-80 transition-opacity">
                  Quantum Error
                  <br />
                  Correction at Scale
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs tracking-widest uppercase text-[#1a1a1a]/50">
                  Physics
                </span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  className="text-[#1a1a1a]/40 group-hover:text-[#1a1a1a] transition-colors"
                >
                  <path
                    d="M1 13L13 1M13 1H4M13 1v9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
              </div>
            </div>

            <div className="group cursor-pointer">
              <div className="bg-[#e8e4dd] h-44 mb-4 flex items-end p-5 relative overflow-hidden border border-[#1a1a1a]/10">
                <div className="absolute top-4 right-4 text-[#1a1a1a]/30 text-xs tracking-widest uppercase">
                  2025
                </div>
                <span className="text-[#1a1a1a] text-lg font-bold tracking-tight leading-tight group-hover:opacity-60 transition-opacity">
                  Protein Folding
                  <br />
                  via Diffusion Models
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs tracking-widest uppercase text-[#1a1a1a]/50">
                  Biology / CS
                </span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  className="text-[#1a1a1a]/40 group-hover:text-[#1a1a1a] transition-colors"
                >
                  <path
                    d="M1 13L13 1M13 1H4M13 1v9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
              </div>
            </div>

            <div className="group cursor-pointer">
              <div className="bg-[#e8e4dd] h-44 mb-4 flex items-end p-5 relative overflow-hidden border border-[#1a1a1a]/10">
                <div className="absolute top-4 right-4 text-[#1a1a1a]/30 text-xs tracking-widest uppercase">
                  2026
                </div>
                <span className="text-[#1a1a1a] text-lg font-bold tracking-tight leading-tight group-hover:opacity-60 transition-opacity">
                  Topological Data
                  <br />
                  Analysis in R^n
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs tracking-widest uppercase text-[#1a1a1a]/50">
                  Mathematics
                </span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  className="text-[#1a1a1a]/40 group-hover:text-[#1a1a1a] transition-colors"
                >
                  <path
                    d="M1 13L13 1M13 1H4M13 1v9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
              </div>
            </div>

            <div className="group cursor-pointer">
              <div className="bg-[#1a1a1a] h-44 mb-4 flex items-end p-5 relative overflow-hidden">
                <div className="absolute top-4 right-4 text-[#f4f1ec]/30 text-xs tracking-widest uppercase">
                  2025
                </div>
                <span className="text-[#f4f1ec] text-lg font-bold tracking-tight leading-tight group-hover:opacity-80 transition-opacity">
                  Neural Symbolic
                  <br />
                  Reasoning Systems
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs tracking-widest uppercase text-[#1a1a1a]/50">
                  Computer Science
                </span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  className="text-[#1a1a1a]/40 group-hover:text-[#1a1a1a] transition-colors"
                >
                  <path
                    d="M1 13L13 1M13 1H4M13 1v9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Footer strip */}
        <div className="border-t border-[#1a1a1a]/15 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <span className="text-2xl font-bold tracking-tight italic">
              inhale
            </span>
            <span className="text-[10px] tracking-widest uppercase text-[#1a1a1a]/40">
              A science papers library
            </span>
          </div>

          {/* Slider-style progress */}
          <div className="flex items-center gap-4">
            <span className="text-xs font-mono text-[#1a1a1a]/40">01</span>
            <div className="w-40 h-px bg-[#1a1a1a]/20 relative">
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-8 h-px bg-[#1a1a1a]" />
              <div className="absolute left-8 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[#1a1a1a] -ml-1" />
            </div>
            <span className="text-xs font-mono text-[#1a1a1a]/40">05</span>
          </div>

          <div className="flex items-center gap-2 text-[#1a1a1a]/40">
            <span className="text-xs">©2026</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              className="ml-2"
            >
              <circle
                cx="7"
                cy="7"
                r="6"
                stroke="currentColor"
                strokeWidth="1"
              />
              <text
                x="7"
                y="10"
                textAnchor="middle"
                fill="currentColor"
                fontSize="8"
                fontWeight="bold"
              >
                R
              </text>
            </svg>
          </div>
        </div>
      </main>
    </div>
  );
}
