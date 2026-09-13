import React, { useState, useEffect, useRef } from 'react';
import * as QRCode from 'qrcode';
import {
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  Activity,
  Clock
} from 'lucide-react';
import { Clinic, TokenItem, QueueSession } from '../types/queue';
import { soundManager } from '../lib/audio';
import { formatDoctorName } from '../lib/doctorName';
import { makeDoctorBookingUrl } from '../lib/doctorQr';

interface TvDisplayViewProps {
  clinic: Clinic;
  session: QueueSession | null;
  tokens: TokenItem[];
}

export const TvDisplayView: React.FC<TvDisplayViewProps> = ({
  clinic,
  session,
  tokens,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const prevTokenRef = useRef<string | null>(null);

  const activeToken = tokens.find(t => (
    t.status === 'CALLED' || t.status === 'SERVING' || t.status === 'IN_CONSULTATION'
  ));
  const waitingTokens = tokens
    .filter(t => t.status === 'WAITING')
    .sort((a, b) => {
      const pA = a.priority ?? 10;
      const pB = b.priority ?? 10;
      if (pA !== pB) return pA - pB;
      return a.sequenceNumber - b.sequenceNumber;
    });

  // Clock ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setLastUpdated(new Date());
  }, [tokens, clinic.doctorStatus]);

  // Voice Announcement on token change
  useEffect(() => {
    if (activeToken && activeToken.tokenNumber !== prevTokenRef.current) {
      if (prevTokenRef.current !== null && soundEnabled) {
        soundManager.announceToken(activeToken.tokenNumber, undefined, clinic.cabinNumber);
      }
      prevTokenRef.current = activeToken.tokenNumber;
    }
  }, [activeToken?.tokenNumber, soundEnabled, clinic.cabinNumber]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const isDoctorIn = clinic.doctorStatus === 'IN';
  const bookingUrl = makeDoctorBookingUrl(clinic.id, clinic.doctorId || '');
  const [generatedBookingQr, setGeneratedBookingQr] = useState('');

  useEffect(() => {
    let active = true;
    setGeneratedBookingQr('');
    if (!clinic.doctorId) return undefined;

    void QRCode.toDataURL(bookingUrl, { width: 220, margin: 1, errorCorrectionLevel: 'M' })
      .then((dataUrl) => {
        if (active) setGeneratedBookingQr(dataUrl);
      })
      .catch(() => {
        if (active) setGeneratedBookingQr('');
      });

    return () => {
      active = false;
    };
  }, [bookingUrl, clinic.doctorId]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-between overflow-hidden bg-[radial-gradient(circle_at_15%_15%,rgba(20,184,166,0.16),transparent_28%),radial-gradient(circle_at_85%_85%,rgba(59,130,246,0.12),transparent_30%),#020817] p-4 text-white select-none sm:p-7 lg:p-9 font-sans">
      
      {/* Top TV Header Bar */}
      <header className="flex items-center justify-between border-b border-slate-800/80 pb-4 sm:pb-5">
        
        {/* Clinic Name & Doctor Details */}
        <div className="flex min-w-0 items-center space-x-3 sm:space-x-4">
          <img src="/nextq-logo.png" alt="NEXTQ" className="h-16 w-44 shrink-0 object-contain object-left sm:h-20 sm:w-56" />
          <div className="min-w-0">
            <div className="mt-1 flex items-center space-x-2 truncate text-xs text-slate-400 sm:space-x-3 sm:text-sm">
              <span className="truncate font-black text-2xl text-white sm:text-3xl lg:text-4xl">{clinic.name}</span>
              <span className="text-slate-500">•</span>
              <span className="text-teal-300 font-black text-xl sm:text-2xl lg:text-3xl">{formatDoctorName(clinic.doctorName)}</span>
              <span className="text-slate-500">•</span>
              <span className="text-slate-300 font-semibold text-sm sm:text-base">{clinic.cabinNumber}</span>
            </div>
          </div>
        </div>

        {/* Right Side: Doctor Status, Clock & Controls */}
        <div className="flex items-center space-x-4 sm:space-x-6">
          
          {/* Doctor Status Banner */}
          <div className={`hidden items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-black shadow-lg sm:flex sm:px-4 sm:text-sm ${
            isDoctorIn
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
          }`}>
            <span className={`w-3.5 h-3.5 rounded-full ${isDoctorIn ? 'bg-emerald-400 animate-ping' : 'bg-rose-400'}`} />
            <span>{isDoctorIn ? 'DOCTOR IN CABIN' : 'DOCTOR AWAY'}</span>
          </div>

          {/* Current Live Time with Day & Date */}
          <div className="hidden md:flex flex-col text-right font-mono bg-slate-900/80 px-4 py-2 rounded-2xl border border-slate-800">
            <div className="text-xs text-teal-300 font-bold tracking-wider uppercase">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
            <span className="text-2xl font-black text-white">{currentTime}</span>
          </div>

          <button
            onClick={() => {
              setSoundEnabled(!soundEnabled);
              if (!soundEnabled && activeToken) {
                soundManager.announceToken(activeToken.tokenNumber, undefined, clinic.cabinNumber);
              }
            }}
            title={soundEnabled ? 'Mute Chimes' : 'Enable Chimes'}
            className="p-3 rounded-2xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white transition-all shadow"
          >
            {soundEnabled ? <Volume2 className="w-6 h-6 text-teal-400" /> : <VolumeX className="w-6 h-6 text-slate-500" />}
          </button>

          <button
            onClick={toggleFullscreen}
            title="Toggle Fullscreen"
            className="p-3 rounded-2xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white transition-all shadow"
          >
            {isFullscreen ? <Minimize2 className="w-6 h-6" /> : <Maximize2 className="w-6 h-6" />}
          </button>

        </div>
      </header>

      {/* Main Massive Center Display: Currently Serving */}
      <main className="tv-display-main my-4 grid min-h-0 flex-1 grid-cols-1 items-stretch gap-5 lg:grid-cols-12 lg:gap-6">
        
        {/* Now Serving Card */}
        <div className="relative flex min-h-0 flex-col justify-center overflow-hidden rounded-[2rem] border-2 border-teal-400/50 bg-gradient-to-br from-slate-900 via-slate-900 to-teal-950/50 p-4 text-center shadow-2xl sm:p-6 lg:col-span-6 lg:p-8 xl:col-span-5">
          <div className="absolute top-0 right-0 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Serving Pill */}
          <div className="mx-auto inline-flex items-center space-x-2 rounded-full border border-teal-500/40 bg-teal-500/20 px-4 py-2 font-mono text-xs font-bold uppercase tracking-widest text-teal-300 sm:text-sm">
            <Activity className="w-4 h-4 animate-pulse" />
            <span>{activeToken ? 'NOW SERVING' : 'NEXT PATIENT SOON'}</span>
          </div>

          {/* Massive Number */}
          <div className="my-2 text-[clamp(4rem,11vw,10rem)] font-black leading-none tracking-tighter text-white drop-shadow-[0_15px_30px_rgba(20,184,166,0.3)]">
            {activeToken ? activeToken.tokenNumber : '---'}
          </div>

          {/* Patient Details */}
          <div className="mt-3 space-y-2">
            <h2 className="text-2xl font-black text-teal-300 sm:text-3xl lg:text-4xl">
              {activeToken ? 'Please proceed' : 'Waiting for next patient'}
            </h2>
            <p className="text-sm font-medium text-slate-400 sm:text-lg">
              {activeToken
                ? clinic.cabinNumber?.trim()
                  ? <>Please go to <span className="font-bold text-white">{clinic.cabinNumber}</span></>
                  : 'Please proceed'
                : 'Please watch this screen for your token number'}
            </p>
          </div>
        </div>

        {/* Next Patients Card */}
        <div className="h-full lg:col-span-6 xl:col-span-5">
          
          {/* Upcoming Tokens Box */}
          <div className="flex h-full flex-col rounded-[2rem] border border-slate-700/80 bg-slate-900/90 p-3 shadow-xl sm:p-4">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <span className="text-sm sm:text-base font-black uppercase tracking-wider text-slate-300">
                NEXT PATIENTS
              </span>
              <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-full bg-teal-500/10 text-teal-300 border border-teal-500/20">
                {waitingTokens.length} in queue
              </span>
            </div>

            <div className="mt-4 flex flex-1 flex-col justify-center space-y-3">
              {waitingTokens.length > 0 ? (
                waitingTokens.slice(0, 4).map((tok, idx) => (
                  <div
                    key={tok.id}
                    className="flex items-center justify-between rounded-2xl border border-slate-800/80 bg-slate-950 p-3 shadow sm:p-4"
                  >
                    <div className="flex items-center space-x-3">
                      <span className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 font-bold text-xs flex items-center justify-center">
                        #{idx + 1}
                      </span>
                      <div>
                        <div className="font-bold text-sm text-white sm:text-base">Token {tok.tokenNumber}</div>
                        <div className="text-xs text-slate-500">Please be ready</div>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="font-mono text-xl font-black px-3 py-1 rounded-xl border bg-teal-950/40 text-teal-300 border-teal-500/30">
                        {tok.tokenNumber}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-slate-500 text-sm">
                  No other patients in queue.
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Phone Tracking Side Card */}
        <div className="flex items-center justify-between gap-4 rounded-[2rem] border border-slate-700/80 bg-slate-900/90 p-3 shadow-xl sm:p-4 lg:col-span-12 xl:col-span-2 xl:flex-col xl:items-center xl:justify-center xl:text-center">
          <div>
            <span className="block text-xs font-black uppercase tracking-wider text-teal-400">
              Scan to book an appointment
            </span>
          </div>

          <div className="flex aspect-square w-36 shrink-0 items-center justify-center rounded-2xl border border-teal-500/30 bg-teal-500/10 p-2 text-teal-300 sm:w-40 xl:mt-5 xl:w-full xl:max-w-[220px]">
            <img
              src={clinic.qrCodeUrl || generatedBookingQr}
              alt="QR code to book an appointment"
              className="block h-full w-full rounded-xl bg-white object-contain p-1"
            />
          </div>
        </div>
      </main>

      {/* Bottom Signage Footer Ticker */}
      <footer className="grid grid-cols-1 items-center gap-2 border-t border-slate-800/80 pt-3 text-center text-[11px] font-medium text-slate-400 sm:grid-cols-2 sm:text-xs sm:text-left">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
          <span className="font-bold uppercase tracking-wide text-teal-300">{clinic.name} · Smart Queue</span>
        </div>
        <div className="text-center">
          <span>Live queue · Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <span className="ml-2">· Est. pacing ~{clinic.avgConsultationMinutes || 8.5} min/patient</span>
          {clinic.delayMinutes > 0 && (
            <span className="text-amber-400 font-bold ml-2">
              · Delay +{clinic.delayMinutes} min
            </span>
          )}
        </div>
      </footer>
    </div>
  );
};
