import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import slide1 from "@/assets/w7.jpeg.asset.json";
import slide2 from "@/assets/w71.jpeg.asset.json";
import slide3 from "@/assets/w72.jpeg.asset.json";
import slide4 from "@/assets/w73.jpeg.asset.json";
import slide5 from "@/assets/w8.jpeg.asset.json";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "Welcome — SocioHub" },
      { name: "description", content: "Society management, simplified — payments, visitors, community in one app." },
    ],
  }),
  component: WelcomeCarousel,
});

const slides = [
  { img: slide1.url, title: "Welcome to a new\nliving experience", body: "SocioHub brings your entire society together — one calm, simple home for everything." },
  { img: slide2.url, title: "Knock, knock", body: "Always know who's at the gate. Approve visitors and deliveries in a single tap." },
  { img: slide3.url, title: "Know a guy?", body: "Find trusted electricians, plumbers and helpers — all rated by your community." },
  { img: slide4.url, title: "Pay like a pro", body: "Stay on top of maintenance, rent and society dues with secure UPI & card payments." },
  { img: slide5.url, title: "Step into the circle", body: "Make new friends, join polls, and stay connected with your neighbours." },
];

function WelcomeCarousel() {
  const navigate = useNavigate();
  const [i, setI] = useState(0);
  const last = i === slides.length - 1;

  useEffect(() => {
    if (last) return;
    const t = setTimeout(() => setI((v) => v + 1), 4500);
    return () => clearTimeout(t);
  }, [i, last]);

  function done() {
    try { localStorage.setItem("sociohub:welcomed", "1"); } catch {}
    navigate({ to: "/login" });
  }

  const slide = slides[i];

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      {/* Image area */}
      <div className="relative flex-1 overflow-hidden">
        <img
          key={i}
          src={slide.img}
          alt=""
          className="absolute inset-0 h-full w-full object-cover animate-in fade-in duration-500"
        />
        {/* progress bars */}
        <div className="absolute top-3 inset-x-4 flex gap-1.5 z-10">
          {slides.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setI(idx)}
              aria-label={`Go to slide ${idx + 1}`}
              className="h-1 flex-1 rounded-full bg-white/40 overflow-hidden"
            >
              <span
                className={cn(
                  "block h-full bg-white transition-all",
                  idx < i && "w-full",
                  idx === i && "w-full animate-[progress_4.5s_linear]",
                  idx > i && "w-0",
                )}
              />
            </button>
          ))}
        </div>
        <button
          onClick={done}
          className="absolute top-4 right-4 z-10 text-xs font-semibold text-white/90 bg-black/30 backdrop-blur px-3 py-1.5 rounded-full"
        >
          Skip
        </button>
      </div>

      {/* Caption + CTA */}
      <div className="px-6 pt-7 pb-8 text-center space-y-3 bg-background">
        <h1 className="text-[26px] font-bold tracking-tight whitespace-pre-line leading-tight">
          {slide.title}
        </h1>
        <p className="text-[15px] text-muted-foreground max-w-xs mx-auto leading-snug">
          {slide.body}
        </p>

        <div className="pt-4 flex items-center gap-3">
          {!last ? (
            <>
              <Button
                variant="ghost"
                onClick={done}
                className="rounded-full h-12 px-5 text-muted-foreground"
              >
                Skip
              </Button>
              <Button
                onClick={() => setI(i + 1)}
                className="flex-1 h-12 rounded-full text-base font-semibold bg-primary text-primary-foreground"
              >
                Next
              </Button>
            </>
          ) : (
            <Button
              onClick={done}
              className="flex-1 h-13 rounded-full text-base font-bold bg-[oklch(0.88_0.18_95)] text-black hover:brightness-95"
              style={{ height: 52 }}
            >
              Get Started
            </Button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes progress { from { width: 0% } to { width: 100% } }
      `}</style>
    </div>
  );
}
