import React, { useState } from 'react';
import {
  Users,
  UserPlus,
  Play,
  Pause,
  Clock,
  Sparkles,
  AlertTriangle,
  Search,
  CheckCircle2,
  Phone,
  ChevronRight,
  RotateCw,
  Filter,
  MoreVertical,
  Volume2,
  Calendar,
  Activity,
  Scale,
  Thermometer,
  X,
  Save
} from 'lucide-react';
import { Clinic, TokenItem, QueueSession } from '../types/queue';
import { db } from '../lib/firebase';
import { soundManager } from '../lib/audio';
import { getAverageWaitSummary } from './waitMetrics';

interface ReceptionistViewProps {
  clinic: Clinic;
  session: QueueSession | null;
  tokens: TokenItem[];
  onTokenUpdated: (token: Partial<TokenItem> & Pick<TokenItem, 'id'>) => void;
  onOpenAddWalkIn: () => void;
  onOpenDelayBroadcast: () => void;
}

export const ReceptionistView: React.FC<ReceptionistViewProps> = ({
  clinic,
  session,
  tokens,
  onTokenUpdated,
  onOpenAddWalkIn,
  onOpenDelayBroadcast,
}) => {
  const isBasicPlan = String(clinic.featurePlan || '').toUpperCase() === 'BASIC';
  const [filterTab, setFilterTab] = useState<'ALL' | 'WAITING' | 'SERVING' | 'HOLD' | 'COMPLETED'>('WAITING');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [selectedScheduledSlot, setSelectedScheduledSlot] = useState('ALL');

  // Vitals & Triage Note editing state
  const [vitalsToken, setVitalsToken] = useState<TokenItem | null>(null);
  const [vitalsWeight, setVitalsWeight] = useState('');
  const [vitalsTemp, setVitalsTemp] = useState('');
  const [vitalsSpO2, setVitalsSpO2] = useState('');
  const [vitalsBpSys, setVitalsBpSys] = useState('');
  const [vitalsBpDia, setVitalsBpDia] = useState('');
  const [isSavingVitals, setIsSavingVitals] = useState(false);

  const openVitalsModal = (token: TokenItem) => {
    setVitalsToken(token);
    
    // Parse weight clean number
    const rawWeight = token.weight || token.preConsultationNotes?.weight || '';
    setVitalsWeight(rawWeight.replace(/[^\d.]/g, ''));

    // Parse temp clean number
    const rawTemp = token.temperature || token.preConsultationNotes?.temperature || token.preConsultationNotes?.feverTemp || '';
    setVitalsTemp(rawTemp.replace(/[^\d.]/g, ''));

    const rawSpO2 = token.oxygenSaturation || token.preConsultationNotes?.oxygenSaturation || token.preConsultationNotes?.spo2 || '';
    setVitalsSpO2(String(rawSpO2 || '').replace(/[^\d.]/g, ''));

    // Parse BP into Systolic and Diastolic
    const rawBp = token.bloodPressure || token.preConsultationNotes?.bloodPressure || token.preConsultationNotes?.bpReading || '';
    if (rawBp.includes('/')) {
      const parts = rawBp.split('/');
      setVitalsBpSys(parts[0].replace(/\D/g, ''));
      setVitalsBpDia(parts[1].replace(/\D/g, ''));
    } else {
      setVitalsBpSys(rawBp.replace(/\D/g, ''));
      setVitalsBpDia('');
    }

  };

  const handleSaveVitals = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vitalsToken) return;

    setIsSavingVitals(true);
    try {
      const existingNotes = vitalsToken.preConsultationNotes || {
        symptoms: 'Walk-in consultation',
        duration: '1 day',
        severity: 'Mild',
        submittedAt: new Date().toISOString(),
      };

      const formattedWeight = vitalsWeight.trim() ? `${vitalsWeight.trim()} kg` : undefined;
      const formattedTemp = vitalsTemp.trim() ? `${vitalsTemp.trim()} °F` : undefined;
      const formattedSpO2 = vitalsSpO2.trim() ? `${vitalsSpO2.trim()}%` : undefined;
      const formattedBp =
        vitalsBpSys.trim() && vitalsBpDia.trim()
          ? `${vitalsBpSys.trim()}/${vitalsBpDia.trim()} mmHg`
          : vitalsBpSys.trim()
          ? `${vitalsBpSys.trim()} mmHg`
          : undefined;

      const updatedPreNotes = {
        ...existingNotes,
        weight: formattedWeight,
        temperature: formattedTemp,
        feverTemp: formattedTemp,
        oxygenSaturation: formattedSpO2,
        spo2: formattedSpO2,
        bloodPressure: formattedBp,
        bpReading: formattedBp,
        lastEditedBy: 'RECEPTIONIST' as const,
      };

      const response = await fetch(`/api/staff/queue/${encodeURIComponent(vitalsToken.id)}/details`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weight: formattedWeight, temperature: formattedTemp, oxygenSaturation: formattedSpO2,
          bloodPressure: formattedBp, preConsultationNotes: updatedPreNotes,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to update patient vitals.');

      showToast(`Vitals saved for #${vitalsToken.tokenNumber} (${vitalsToken.patientName})`);
      setVitalsToken(null);
    } catch (err) {
      console.error('Error saving vitals:', err);
      showToast('Failed to save vitals. Please retry.');
    } finally {
      setIsSavingVitals(false);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const timingOptions = Array.from(new Set(tokens.map((token) => token.scheduledSlot).filter(Boolean))) as string[];
  const scopedTokens = selectedScheduledSlot === 'ALL' ? tokens : tokens.filter((token) => token.scheduledSlot === selectedScheduledSlot);
  const activeToken = scopedTokens.find(t => (
    t.status === 'CALLED' || t.status === 'SERVING' || t.status === 'IN_CONSULTATION'
  ));
  const isServingStatus = (status: TokenItem['status']) => ['CALLED', 'SERVING', 'IN_CONSULTATION'].includes(status);
  const waitingTokens = scopedTokens.filter(t => t.status === 'WAITING').sort((a, b) => {
    const pA = a.priority ?? 10;
    const pB = b.priority ?? 10;
    if (pA !== pB) return pA - pB;
    return a.sequenceNumber - b.sequenceNumber;
  });
  const holdTokens = scopedTokens.filter(t => t.status === 'HOLD');
  const completedTokens = scopedTokens.filter(t => t.status === 'COMPLETED');
  const averageWaitSummary = getAverageWaitSummary(clinic.doctorStatus, waitingTokens, clinic.avgConsultationMinutes);
  const averageWaitMinutes = averageWaitSummary.averageWaitMinutes;

  // Filter list
  const filteredTokens = scopedTokens.filter(token => {
    // Tab filter
    if (filterTab === 'WAITING' && token.status !== 'WAITING') return false;
    if (filterTab === 'SERVING' && !isServingStatus(token.status)) return false;
    if (filterTab === 'HOLD' && token.status !== 'HOLD') return false;
    if (filterTab === 'COMPLETED' && token.status !== 'COMPLETED') return false;

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = token.patientName.toLowerCase().includes(q);
      const matchPhone = token.patientPhone.includes(q);
      const matchToken = token.tokenNumber.toLowerCase().includes(q);
      return matchName || matchPhone || matchToken;
    }
    return true;
  }).sort((a, b) => {
    if (filterTab === 'WAITING') {
      const pA = a.priority ?? 10;
      const pB = b.priority ?? 10;
      if (pA !== pB) return pA - pB;
      return a.sequenceNumber - b.sequenceNumber;
    }
    return b.sequenceNumber - a.sequenceNumber;
  });

  // Call Next Token
  const handleCallNextToken = async () => {
    if (waitingTokens.length === 0) {
      showToast('No patients currently waiting in queue!');
      return;
    }

    setIsAdvancing(true);
    try {
      // Pick the next token by emergency/normal priority.
      const nextToken = waitingTokens[0];
      const response = await fetch(`/api/staff/queue/${encodeURIComponent(nextToken.id)}/call`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to call next token.');

      // Sound announcement
      soundManager.announceToken(nextToken.tokenNumber, nextToken.patientName, clinic.cabinNumber);
      onTokenUpdated(payload);

      showToast(`Called Token #${nextToken.tokenNumber} (${nextToken.patientName}) to Cabin!`);
    } catch (err) {
      console.error('Error calling next token:', err);
      showToast(err instanceof Error ? err.message : 'Failed to advance token. Check connection.');
    } finally {
      setIsAdvancing(false);
    }
  };

  const handleMarkPaymentPaid = async (token: TokenItem) => {
    try {
      const response = await fetch(`/api/staff/queue/${encodeURIComponent(token.id)}/payment`, {
        method: 'PATCH',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to update payment status.');
      onTokenUpdated(payload);
      showToast(`Payment marked paid for #${token.tokenNumber}.`);
    } catch (error) {
      console.error('Error updating payment status:', error);
      showToast(error instanceof Error ? error.message : 'Unable to update payment status.');
    }
  };

  const handleDeleteConsultation = async (token: TokenItem) => {
    if (!window.confirm(`Delete the consultation for ${token.patientName}?`)) return;
    try {
      const response = await fetch(`/api/staff/queue/${encodeURIComponent(token.id)}/cancel`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to delete consultation.');
      onTokenUpdated(payload);
      showToast(`Deleted consultation for ${token.patientName}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to delete consultation.');
    }
  };

  // Hold / No-Show active token
  const handleHoldActiveToken = async () => {
    if (!activeToken) {
      showToast('No active token in cabin to put on hold.');
      return;
    }
    try {
      const response = await fetch(`/api/staff/queue/${encodeURIComponent(activeToken.id)}/hold`, {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to hold token.');

      // Now call next immediately if available
      if (waitingTokens.length > 0) {
        const nextToken = waitingTokens[0];
        const nextResponse = await fetch(`/api/staff/queue/${encodeURIComponent(nextToken.id)}/call`, {
          method: 'POST',
          credentials: 'include',
        });
        const nextPayload = await nextResponse.json().catch(() => ({}));
        if (!nextResponse.ok) throw new Error(nextPayload.error || 'Unable to call next token.');
        onTokenUpdated(nextPayload);
        soundManager.announceToken(nextToken.tokenNumber, nextToken.patientName, clinic.cabinNumber);
      }

      onTokenUpdated(payload);

      showToast(`Token #${activeToken.tokenNumber} placed ON HOLD. Queue advanced.`);
    } catch (err) {
      console.error('Error putting token on hold:', err);
    }
  };

  // Reactivate Hold Token back to front of waiting list
  const handleReactivateHold = async (token: TokenItem) => {
    try {
      const response = await fetch(`/api/staff/queue/${encodeURIComponent(token.id)}/resume`, {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to resume token.');
      onTokenUpdated(payload);
      showToast(`Token #${token.tokenNumber} reactivated at the top of the waiting queue!`);
    } catch (err) {
      console.error('Error reactivating token:', err);
    }
  };

  // Promote a waiting patient only when the case is an emergency.
  const handleEmergencyOverride = async (token: TokenItem) => {
    try {
      const response = await fetch(`/api/staff/queue/${encodeURIComponent(token.id)}/emergency`, {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to set emergency priority.');
      onTokenUpdated(payload);
      soundManager.playEmergencyChime();
      showToast(`Emergency priority set for ${token.patientName}.`);
    } catch (err) {
      console.error('Error setting emergency priority:', err);
    }
  };

  // Direct Call specific token right now
  const handleDirectCallToken = async (token: TokenItem) => {
    try {
      const response = await fetch(`/api/staff/queue/${encodeURIComponent(token.id)}/call`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to call token.');

      soundManager.announceToken(token.tokenNumber, token.patientName, clinic.cabinNumber);
      onTokenUpdated(payload);
      showToast(`Directly calling Token #${token.tokenNumber} to Cabin!`);
    } catch (err) {
      console.error('Error direct calling token:', err);
    }
  };

  if (isBasicPlan) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto pb-12">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-violet-300 font-bold">Basic plan</div>
              <h1 className="text-2xl font-black text-white mt-2">Reception minimal queue</h1>
            </div>
            <div className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-semibold text-violet-300">
              Only core queue tools enabled
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            onClick={onOpenAddWalkIn}
            className="bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-bold p-4 rounded-2xl"
          >
            <UserPlus className="w-5 h-5 mb-2 text-teal-400 mx-auto" />
            <div>Add Patient</div>
          </button>
          <button
            onClick={handleCallNextToken}
            disabled={isAdvancing || waitingTokens.length === 0}
            className="bg-gradient-to-r from-teal-500 to-emerald-400 hover:from-teal-400 hover:to-emerald-300 text-slate-950 font-black p-4 rounded-2xl disabled:opacity-50"
          >
            <Play className="w-5 h-5 mb-2 mx-auto" />
            <div>Next</div>
          </button>
          <button
            onClick={handleHoldActiveToken}
            disabled={!activeToken}
            className="bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-bold p-4 rounded-2xl disabled:opacity-50"
          >
            <Pause className="w-5 h-5 mb-2 text-amber-400 mx-auto" />
            <div>Skip</div>
          </button>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <h2 className="text-lg font-bold text-white">Live tracking</h2>
            <span className="text-xs text-slate-400">Name & mobile only</span>
          </div>
          <div className="divide-y divide-slate-800">
            {tokens.filter(token => token.status !== 'COMPLETED').map(token => (
              <div key={token.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="font-semibold text-white">{token.patientName}</div>
                  <div className="text-xs text-slate-400">{token.patientPhone}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wider text-teal-300">{token.status}</div>
                  <div className="text-xs text-slate-400">{token.tokenNumber}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-6xl mx-auto pb-10">
      {timingOptions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
          <span className="mr-1 text-xs font-bold uppercase tracking-wider text-slate-400">Timing</span>
          {['ALL', ...timingOptions].map((slot) => (
            <button key={slot} type="button" onClick={() => setSelectedScheduledSlot(slot)} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${selectedScheduledSlot === slot ? 'bg-teal-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
              {slot === 'ALL' ? 'All timings' : slot}
            </button>
          ))}
        </div>
      )}
      
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-teal-500 text-slate-950 font-semibold px-3 py-2.5 rounded-lg shadow-xl flex items-center gap-2 border border-teal-400">
          <Sparkles className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5 sm:gap-4">
      {/* Patient currently in the cabin */}
      <div className="col-span-2 min-h-20 min-w-0 overflow-hidden rounded-2xl border border-teal-500/30 bg-gradient-to-br from-teal-950/30 to-slate-900 p-4 shadow-lg shadow-teal-950/20 sm:col-span-4 sm:p-5 lg:col-span-1">
        <div className="flex min-w-0 w-full flex-col gap-4">
          <div className="min-w-0 overflow-hidden">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-teal-300">In cabin now</p>
            {activeToken ? (
              <>
                <div className="mt-3 rounded-xl border border-teal-500/20 bg-slate-950/50 p-3">
                  <span className="block text-[10px] uppercase tracking-wider text-teal-300">Token number</span>
                  <span className="mt-1 block truncate text-2xl font-black tracking-wide text-white">{activeToken.tokenNumber}</span>
                </div>
                <h2 className="mt-3 truncate text-base font-bold text-white">{activeToken.patientName}</h2>
                <div className="mt-1 space-y-1 text-xs text-slate-400">
                  <p className="truncate">{activeToken.patientPhone}</p>
                  {(activeToken.patientAge || activeToken.patientGender) && (
                    <p className="truncate">{activeToken.patientAge ? `${activeToken.patientAge} years` : ''}{activeToken.patientAge && activeToken.patientGender ? ' · ' : ''}{activeToken.patientGender || ''}</p>
                  )}
                </div>
              </>
            ) : (
              <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950/40 p-3">
                <h2 className="text-sm font-semibold text-slate-300">No patient in cabin</h2>
                <p className="mt-1 text-xs text-slate-500">The cabin is ready for the next token.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main control bar */}
      <div className="contents">
        
        {/* Button 1: Call Next Token */}
        <button
          onClick={handleCallNextToken}
          disabled={isAdvancing || waitingTokens.length === 0}
          className="col-span-2 min-h-20 sm:col-span-1 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold p-3.5 rounded-2xl flex flex-col items-center justify-center text-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed lg:aspect-square"
        >
          <Play className="mb-2 h-6 w-6 text-slate-950" />
          <span className="text-base font-bold leading-tight">Call next</span>
          <span className="mt-1 text-xs font-bold leading-tight text-slate-900/80">
            {waitingTokens.length > 0 ? `Next: #${waitingTokens[0].tokenNumber}` : 'Queue Empty'}
          </span>
        </button>

        {/* Button 2: Add Walk-In Patient */}
        <button
          onClick={onOpenAddWalkIn}
          className="min-h-20 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-semibold p-3.5 rounded-2xl flex flex-col items-center justify-center text-center transition-colors lg:aspect-square"
        >
          <UserPlus className="mb-2 h-6 w-6 text-teal-400" />
          <span className="text-base font-semibold leading-tight">Add patient</span>
          <span className="mt-1 text-xs font-normal leading-tight text-slate-400">Walk-in token</span>
        </button>

        {/* Button 3: Hold / No-Show */}
        <button
          onClick={handleHoldActiveToken}
          disabled={!activeToken}
          className="min-h-20 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-semibold p-3.5 rounded-2xl flex flex-col items-center justify-center text-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed lg:aspect-square"
        >
          <Pause className="mb-2 h-6 w-6 text-amber-400" />
          <span className="text-base font-semibold leading-tight">Hold patient</span>
          <span className="mt-1 text-xs font-normal leading-tight text-slate-400">Skip active token</span>
        </button>

        {/* Button 4: Delay Broadcast */}
        <button
          onClick={onOpenDelayBroadcast}
          className="min-h-20 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-semibold p-3.5 rounded-2xl flex flex-col items-center justify-center text-center transition-colors lg:aspect-square"
        >
          <Clock className="mb-2 h-6 w-6 text-slate-300" />
          <span className="text-base font-semibold leading-tight">Set delay</span>
          <span className="mt-1 text-xs font-normal leading-tight text-slate-400">
            {clinic.delayMinutes > 0 ? `+${clinic.delayMinutes}m Active` : 'Add Delay to ETAs'}
          </span>
        </button>

      </div>

      </div>

      {/* Merged Queue Center (Tabs + Table) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        
        {/* Table Filter Tabs and Search Toolbar */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          
          {/* Tabs */}
          <div className="flex items-center space-x-1 sm:space-x-2 overflow-x-auto pb-1 sm:pb-0">
            <button
              onClick={() => setFilterTab('WAITING')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                filterTab === 'WAITING'
                  ? 'bg-teal-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white bg-slate-800/60'
              }`}
            >
              Waiting ({waitingTokens.length})
            </button>

            <button
              onClick={() => setFilterTab('SERVING')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                filterTab === 'SERVING'
                  ? 'bg-teal-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white bg-slate-800/60'
              }`}
            >
              Serving ({activeToken ? 1 : 0})
            </button>

            <button
              onClick={() => setFilterTab('HOLD')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                filterTab === 'HOLD'
                  ? 'bg-teal-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white bg-slate-800/60'
              }`}
            >
              On Hold ({holdTokens.length})
            </button>

            <button
              onClick={() => setFilterTab('COMPLETED')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                filterTab === 'COMPLETED'
                  ? 'bg-teal-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white bg-slate-800/60'
              }`}
            >
              Completed ({completedTokens.length})
            </button>

            <button
              onClick={() => setFilterTab('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                filterTab === 'ALL'
                  ? 'bg-teal-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white bg-slate-800/60'
              }`}
            >
              All ({tokens.length})
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-full md:w-64">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search token, name, phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
        </div>

        {/* Queue Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 uppercase font-semibold border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Token</th>
                <th className="py-3 px-4">Patient Name & Contact</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Payment</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {filteredTokens.length > 0 ? (
                filteredTokens.map((token, index) => {
                  const isServing = isServingStatus(token.status);
                  const isHold = token.status === 'HOLD';
                  const isCompleted = token.status === 'COMPLETED';

                  return (
                    <tr
                      key={token.id}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        isServing ? 'bg-teal-950/20 font-medium' : ''
                      }`}
                    >
                      {/* Token # */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <span className={`font-mono font-black text-sm px-2.5 py-1 rounded-lg border ${
                            isServing
                              ? 'bg-teal-500 text-slate-950 border-teal-400'
                              : 'bg-slate-800 text-teal-300 border-slate-700'
                          }`}>
                            {token.tokenNumber}
                          </span>
                        </div>
                      </td>

                      {/* Patient Name */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div>
                          <div className="font-bold text-white text-sm">{token.patientName}</div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                            <Phone className="w-3 h-3 text-slate-500" />
                            <span>{token.patientPhone}</span>
                            {token.patientAge && <span>• {token.patientAge}y</span>}
                          </div>
                        </div>
                      </td>

                      {/* Token Type */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          token.tokenType === 'ONLINE'
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            : token.tokenType === 'WALK_IN'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-slate-700/50 text-slate-300 border border-slate-700'
                        }`}>
                          {token.tokenType}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          isServing
                            ? 'bg-teal-500 text-slate-950 font-black'
                            : isHold
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : isCompleted
                            ? 'bg-slate-800 text-slate-400'
                            : 'bg-blue-500/15 text-blue-300'
                        }`}>
                          {token.status}
                        </span>
                      </td>

                      {/* Payment */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="text-emerald-400 font-bold">₹{token.amountPaid > 0 ? token.amountPaid : clinic.consultationFee}</span>
                        <span className={`text-[10px] block font-semibold ${token.paymentStatus === 'PAID' ? 'text-emerald-400' : 'text-amber-300'}`}>
                          {token.paymentStatus === 'PAID' ? 'Paid' : 'Payment pending'}
                        </span>
                        {token.paymentStatus !== 'PAID' && (
                          <button
                            type="button"
                            onClick={() => void handleMarkPaymentPaid(token)}
                            className="mt-1 rounded-md bg-emerald-500/15 px-2 py-1 text-[10px] font-bold text-emerald-300 transition hover:bg-emerald-500/25"
                          >
                            Mark paid
                          </button>
                        )}
                      </td>

                      {/* Action Buttons */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end space-x-1.5">
                          
                          {/* Call Now */}
                          {token.status === 'WAITING' && (
                            <button
                              onClick={() => handleDirectCallToken(token)}
                              title="Directly Call to Cabin"
                              className="p-1.5 rounded-lg bg-teal-500/20 hover:bg-teal-500 text-teal-300 hover:text-slate-950 transition-colors"
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {(token.status === 'WAITING' || token.status === 'HOLD') && (
                            <button
                              type="button"
                              onClick={() => void handleDeleteConsultation(token)}
                              title="Delete consultation"
                              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {!token.isEmergency && !isCompleted && (
                            <button
                              onClick={() => handleEmergencyOverride(token)}
                              title="Set Emergency Priority"
                              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 transition-colors"
                            >
                              <AlertTriangle className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Re-activate Hold */}
                          {isHold && (
                            <button
                              onClick={() => handleReactivateHold(token)}
                              title="Re-activate back to queue"
                              className="px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[10px] font-bold"
                            >
                              Re-queue
                            </button>
                          )}

                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    No tokens found matching the selected filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Vitals intake modal */}
      {vitalsToken && !isBasicPlan && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-xl bg-teal-500/10 text-teal-400">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-mono font-bold text-teal-400">
                    TOKEN #{vitalsToken.tokenNumber}
                  </div>
                  <h3 className="text-lg font-bold text-white">
                    Record Vitals: {vitalsToken.patientName}
                  </h3>
                </div>
              </div>

              <button
                onClick={() => setVitalsToken(null)}
                className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveVitals} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                {/* Weight with predefined kg */}
                <div>
                  <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1 flex items-center gap-1">
                    <Scale className="w-3.5 h-3.5 text-teal-400" />
                    Weight
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type="number"
                      step="0.1"
                      placeholder="70"
                      value={vitalsWeight}
                      onChange={(e) => setVitalsWeight(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 pl-3 pr-10 text-xs text-white placeholder-slate-600 focus:ring-2 focus:ring-teal-500 focus:outline-none font-mono"
                    />
                    <span className="absolute right-3 text-xs font-bold text-teal-400 select-none pointer-events-none">
                      kg
                    </span>
                  </div>
                </div>

                {/* Temperature with predefined °F */}
                <div>
                  <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1 flex items-center gap-1">
                    <Thermometer className="w-3.5 h-3.5 text-amber-400" />
                    Temperature
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type="number"
                      step="0.1"
                      placeholder="98.6"
                      value={vitalsTemp}
                      onChange={(e) => setVitalsTemp(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 pl-3 pr-10 text-xs text-white placeholder-slate-600 focus:ring-2 focus:ring-teal-500 focus:outline-none font-mono"
                    />
                    <span className="absolute right-3 text-xs font-bold text-amber-400 select-none pointer-events-none">
                      °F
                    </span>
                  </div>
                </div>

                {/* Oxygen saturation */}
                <div>
                  <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1 flex items-center gap-1">
                    <Activity className="w-3.5 h-3.5 text-cyan-400" />
                    SpO₂
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type="number"
                      step="0.1"
                      placeholder="98"
                      value={vitalsSpO2}
                      onChange={(e) => setVitalsSpO2(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 pl-3 pr-10 text-xs text-white placeholder-slate-600 focus:ring-2 focus:ring-teal-500 focus:outline-none font-mono"
                    />
                    <span className="absolute right-3 text-xs font-bold text-cyan-400 select-none pointer-events-none">
                      %
                    </span>
                  </div>
                </div>

                {/* Blood Pressure with 2 columns and / in between */}
                <div>
                  <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <Activity className="w-3.5 h-3.5 text-rose-400" />
                      Blood Pressure
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">mmHg</span>
                  </label>
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1">
                      <input
                        type="number"
                        placeholder="120"
                        value={vitalsBpSys}
                        onChange={(e) => setVitalsBpSys(e.target.value)}
                        title="Systolic (SYS)"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white text-center placeholder-slate-600 focus:ring-2 focus:ring-teal-500 focus:outline-none font-mono"
                      />
                    </div>
                    <span className="text-slate-500 font-black text-base select-none">/</span>
                    <div className="flex-1">
                      <input
                        type="number"
                        placeholder="80"
                        value={vitalsBpDia}
                        onChange={(e) => setVitalsBpDia(e.target.value)}
                        title="Diastolic (DIA)"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white text-center placeholder-slate-600 focus:ring-2 focus:ring-teal-500 focus:outline-none font-mono"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setVitalsToken(null)}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingVitals}
                  className="flex-1 py-3 bg-teal-500 hover:bg-teal-400 text-slate-950 rounded-xl text-xs font-black shadow-lg shadow-teal-500/20 flex items-center justify-center gap-1.5"
                >
                  <Save className="w-4 h-4" />
                  <span>{isSavingVitals ? 'Saving...' : 'Save Vitals'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
